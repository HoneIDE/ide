/**
 * File tree sidebar — extracted from render.ts.
 *
 * Renders the file explorer in the sidebar container.
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, Text, Button, Spacer,
  VStackWithInsets, HStackWithInsets,
  ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  buttonSetBordered, buttonSetImage, buttonSetImagePosition,
  widgetAddChild, widgetClearChildren, widgetSetWidth, widgetSetHeight,
} from 'perry/ui';
import { readdirSync, isDirectory } from 'fs';
import { join } from 'path';
import { setBg, setFg, setBtnFg, setBtnTint, pathId, getFileName, getFileIcon, getFileIconColor, truncateName } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarBackground, getSideBarForeground, getListActiveSelectionBackground } from '../../theme/theme-colors';
import { getGitFileStatus, getGitDirStatus } from '../git/git-panel';

// ---------------------------------------------------------------------------
// Module-level state (must be declared BEFORE any function — Perry no-hoist)
// ---------------------------------------------------------------------------

// Perry AOT: module-level array indexed assignment with objects is broken.
// Use parallel string arrays with .push() instead of FileEntry[].
let fileEntryPaths: string[] = [];
let fileEntryLabels: string[] = [];

let sidebarWorkspaceRoot = '';
let panelColors: ResolvedUIColors = null as any;
let sidebarCurrentEditorPath = '';

let fileEntryCount = 0;
let fileRowWidgets: unknown[] = [];
let fileTreeButtons: unknown[] = [];
let selectedFileIdx = -1;

let sidebarContainer: unknown = null;
let sidebarReady: number = 0;

// Expanded directory tracking — Set<number> (no limit on expanded dirs).
let expandedDirs: Set<number> = new Set();

// Deferred file click
let pendingFileClickIdx: number = -1;

// External callbacks
let _fileClickCallback: (path: string, name: string) => void = _noopClick;
let _openFolderCallback: () => void = _noopVoid;
let _newFileCallback: () => void = _noopVoid;

function _noopClick(_p: string, _n: string): void {}
function _noopVoid(): void {}

// ---------------------------------------------------------------------------
// Setter functions (wired by render.ts)
// ---------------------------------------------------------------------------

export function setSidebarWorkspaceRoot(root: string): void {
  sidebarWorkspaceRoot = root;
}

export function setSidebarFileClickCallback(cb: (path: string, name: string) => void): void {
  _fileClickCallback = cb;
}

export function setSidebarOpenFolderCallback(cb: () => void): void {
  _openFolderCallback = cb;
}

export function setSidebarNewFileCallback(cb: () => void): void {
  _newFileCallback = cb;
}

export function setSidebarThemeColors(colors: ResolvedUIColors): void {
  panelColors = colors;
}

export function setSidebarCurrentEditorPath(path: string): void {
  sidebarCurrentEditorPath = path;
}

export function resetSidebarReady(): void {
  sidebarReady = 0;
}

// ---------------------------------------------------------------------------
// Directory expansion
// ---------------------------------------------------------------------------

function isDirExpanded(path: string): boolean {
  return expandedDirs.has(pathId(path));
}

function toggleExpById(id: number): void {
  if (expandedDirs.has(id)) { expandedDirs.delete(id); }
  else { expandedDirs.add(id); }
}

function collapseAllDirs(): void {
  expandedDirs.clear();
  setTimeout(() => { refreshSidebar(); }, 0);
}

function onDirToggle(id: number): void {
  toggleExpById(id);
  setTimeout(() => { deferredRefreshSidebar(); }, 0);
}

function deferredRefreshSidebar(): void {
  refreshSidebar();
}

// ---------------------------------------------------------------------------
// File click handlers
// ---------------------------------------------------------------------------

function onFileClick(idx: number): void {
  if (idx < 0) return;
  if (idx >= fileEntryCount) return;
  // Defer to next tick — synchronous widget mutations inside a button callback
  // cause RefCell reentrancy panics (or crashes) in Perry's Rust widget system.
  pendingFileClickIdx = idx;
  setTimeout(() => { onFileClickDeferred(); }, 0);
}

function onFileClickDeferred(): void {
  const idx = pendingFileClickIdx;
  if (idx < 0) return;
  pendingFileClickIdx = -1;
  if (idx >= fileEntryCount) return;
  const path = fileEntryPaths[idx];
  const label = fileEntryLabels[idx];
  _fileClickCallback(path, label);
}

// ---------------------------------------------------------------------------
// Selection tracking
// ---------------------------------------------------------------------------

export function updateSidebarSelection(): void {
  if (!panelColors) return;
  // Clear old selection
  if (selectedFileIdx >= 0) {
    if (selectedFileIdx < fileRowWidgets.length) {
      setBg(fileRowWidgets[selectedFileIdx], getSideBarBackground());
    }
  }
  // Find new selection (use charCodeAt — Perry === is unreliable for strings)
  selectedFileIdx = -1;
  for (let i = 0; i < fileEntryCount; i++) {
    const epath = fileEntryPaths[i];
    if (epath.length === sidebarCurrentEditorPath.length && epath.length > 0) {
      let match = 1;
      for (let j = 0; j < epath.length; j++) {
        if (epath.charCodeAt(j) !== sidebarCurrentEditorPath.charCodeAt(j)) { match = 0; break; }
      }
      if (match > 0) {
        selectedFileIdx = i;
        if (i < fileRowWidgets.length) {
          setBg(fileRowWidgets[i], getListActiveSelectionBackground());
        }
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sidebar rendering
// ---------------------------------------------------------------------------

function refreshSidebar(): void {
  if (sidebarReady < 1) return;
  // If remote mode is active, render the remote tree instead
  if (isRemoteMode > 0 && remoteEntryCount > 0) {
    refreshRemoteSidebar();
    return;
  }
  widgetClearChildren(sidebarContainer);
  fileTreeButtons = [];
  selectedFileIdx = -1;
  fileEntryPaths = [];
  fileEntryLabels = [];
  fileEntryCount = 0;
  fileRowWidgets = [];

  if (sidebarWorkspaceRoot.length < 1) {
    const hint = Text('Open a folder to start');
    textSetFontSize(hint, 12);
    setFg(hint, getSideBarForeground());
    widgetAddChild(sidebarContainer, hint);
    const openBtn = Button('Open Folder', () => { openFolderAction(); });
    buttonSetBordered(openBtn, 0);
    textSetFontSize(openBtn, 13);
    setBtnFg(openBtn, getSideBarForeground());
    widgetAddChild(sidebarContainer, openBtn);
    widgetAddChild(sidebarContainer, Spacer());
    return;
  }

  // --- 1. EXPLORER title row (22px, thin text, left-padded 4px) ---
  const explorerLabel = Text('EXPLORER');
  textSetFontSize(explorerLabel, 11);
  textSetFontWeight(explorerLabel, 11, 0.4);
  setFg(explorerLabel, getSideBarForeground());
  const explorerRow = HStackWithInsets(0, 0, 4, 0, 4);
  widgetSetHeight(explorerRow, 24);
  widgetAddChild(explorerRow, explorerLabel);
  widgetAddChild(explorerRow, Spacer());
  widgetAddChild(sidebarContainer, explorerRow);

  // --- 2. FOLDERS section header (22px, bold, translucent bg) ---
  const foldersLabel = Text('FOLDERS');
  textSetFontSize(foldersLabel, 11);
  textSetFontWeight(foldersLabel, 11, 0.7);
  setFg(foldersLabel, getSideBarForeground());
  const dotsBtn = Button('', () => {});
  buttonSetBordered(dotsBtn, 0);
  buttonSetImage(dotsBtn, 'ellipsis');
  buttonSetImagePosition(dotsBtn, 1);
  textSetFontSize(dotsBtn, 10);
  setBtnTint(dotsBtn, getSideBarForeground());
  const foldersRow = HStackWithInsets(0, 0, 4, 0, 4);
  widgetSetHeight(foldersRow, 24);
  setBg(foldersRow, getSideBarBackground());
  widgetAddChild(foldersRow, foldersLabel);
  widgetAddChild(foldersRow, Spacer());
  widgetAddChild(foldersRow, dotsBtn);
  widgetAddChild(sidebarContainer, foldersRow);

  // --- 3. Root folder row (22px, bold uppercase, chevron + action buttons) ---
  const rootName = getFileName(sidebarWorkspaceRoot);
  let rootDisplay = '';
  for (let ci = 0; ci < rootName.length; ci++) {
    const cc = rootName.charCodeAt(ci);
    if (cc >= 97 && cc <= 122) {
      rootDisplay += String.fromCharCode(cc - 32);
    } else {
      rootDisplay += rootName.charAt(ci);
    }
  }
  const rootChevron = Text('\u02C5');
  textSetFontSize(rootChevron, 9);
  setFg(rootChevron, getSideBarForeground());
  const rootLabel = Text(rootDisplay);
  textSetFontSize(rootLabel, 11);
  textSetFontWeight(rootLabel, 11, 0.7);
  setFg(rootLabel, getSideBarForeground());

  // New file button
  const newFileBtn = Button('', () => { newFileAction(); });
  buttonSetBordered(newFileBtn, 0);
  buttonSetImage(newFileBtn, 'doc.badge.plus');
  buttonSetImagePosition(newFileBtn, 1);
  textSetFontSize(newFileBtn, 10);
  setBtnTint(newFileBtn, getSideBarForeground());

  // New folder button
  const newFolderBtn = Button('', () => {});
  buttonSetBordered(newFolderBtn, 0);
  buttonSetImage(newFolderBtn, 'folder.badge.plus');
  buttonSetImagePosition(newFolderBtn, 1);
  textSetFontSize(newFolderBtn, 10);
  setBtnTint(newFolderBtn, getSideBarForeground());

  // Collapse all button
  const collapseBtn = Button('', () => { collapseAllDirs(); });
  buttonSetBordered(collapseBtn, 0);
  buttonSetImage(collapseBtn, 'arrow.down.right.and.arrow.up.left');
  buttonSetImagePosition(collapseBtn, 1);
  textSetFontSize(collapseBtn, 10);
  setBtnTint(collapseBtn, getSideBarForeground());

  const rootRow = HStackWithInsets(2, 0, 4, 0, 4);
  widgetSetHeight(rootRow, 24);
  widgetAddChild(rootRow, rootChevron);
  widgetAddChild(rootRow, rootLabel);
  widgetAddChild(rootRow, Spacer());
  widgetAddChild(rootRow, newFileBtn);
  widgetAddChild(rootRow, newFolderBtn);
  widgetAddChild(rootRow, collapseBtn);
  widgetAddChild(sidebarContainer, rootRow);

  // --- 4. File tree ---
  renderTreeLevel(sidebarWorkspaceRoot, 0);

  // // --- 5. OUTLINE collapsed section ---
  // const outlineChevron = Text('\u25B7');
  // textSetFontSize(outlineChevron, 9);
  // if (panelColors) setFg(outlineChevron, getSideBarForeground());
  // const outlineLabel = Text('OUTLINE');
  // textSetFontSize(outlineLabel, 11);
  // textSetFontWeight(outlineLabel, 11, 0.7);
  // if (panelColors) setFg(outlineLabel, getSideBarForeground());
  // const outlineRow = HStackWithInsets(4, 0, 4, 0, 4);
  // widgetSetHeight(outlineRow, 22);
  // if (panelColors) setBg(outlineRow, getSideBarBackground());
  // widgetAddChild(outlineRow, outlineChevron);
  // widgetAddChild(outlineRow, outlineLabel);
  // widgetAddChild(sidebarContainer, outlineRow);

  // // --- 6. TIMELINE collapsed section ---
  // const timelineChevron = Text('\u25B7');
  // textSetFontSize(timelineChevron, 9);
  // if (panelColors) setFg(timelineChevron, getSideBarForeground());
  // const timelineLabel = Text('TIMELINE');
  // textSetFontSize(timelineLabel, 11);
  // textSetFontWeight(timelineLabel, 11, 0.7);
  // if (panelColors) setFg(timelineLabel, getSideBarForeground());
  // const timelineRow = HStackWithInsets(4, 0, 4, 0, 4);
  // widgetSetHeight(timelineRow, 22);
  // if (panelColors) setBg(timelineRow, getSideBarBackground());
  // widgetAddChild(timelineRow, timelineChevron);
  // widgetAddChild(timelineRow, timelineLabel);
  // widgetAddChild(sidebarContainer, timelineRow);

  widgetAddChild(sidebarContainer, Spacer());
}

function renderTreeLevel(dirPath: string, depth: number): void {
  if (depth > 10) return;
  let names: string[] = [];
  try { names = readdirSync(dirPath); } catch (e) { return; }

  // Separate dirs and files
  // Perry AOT: local array indexed assignment may also be broken — use .push()
  let dirNames: string[] = [];
  let fileNames: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (n.charCodeAt(0) === 46) continue; // skip hidden
    const full = join(dirPath, n);
    if (isDirectory(full)) {
      dirNames.push(n);
    } else {
      fileNames.push(n);
    }
  }
  const dirCount = dirNames.length;
  const fileCount = fileNames.length;

  // Render directories first — chevron + name (fewer widgets per row for speed)
  for (let i = 0; i < dirCount; i++) {
    const name = dirNames[i];
    const full = join(dirPath, name);
    const expanded = isDirExpanded(full);
    const id = pathId(full);

    const indentPx = depth * 16 + 4;
    const row = HStackWithInsets(4, 0, indentPx, 0, 4);
    widgetSetHeight(row, 22);

    // Chevron (16px wide)
    const chevron = Button('', () => { onDirToggle(id); });
    buttonSetBordered(chevron, 0);
    if (expanded) {
      buttonSetImage(chevron, 'chevron.down');
    } else {
      buttonSetImage(chevron, 'chevron.right');
    }
    textSetFontSize(chevron, 9);
    widgetSetWidth(chevron, 14);
    setBtnTint(chevron, getSideBarForeground());
    widgetAddChild(row, chevron);

    // Name button
    const displayName = truncateName(name, 30);
    const btn = Button(displayName, () => { onDirToggle(id); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 13);
    setBtnFg(btn, getSideBarForeground());
    widgetAddChild(row, btn);

    widgetAddChild(row, Spacer());
    widgetAddChild(sidebarContainer, row);

    if (expanded) {
      renderTreeLevel(full, depth + 1);
    }
  }

  // Render files — icon + name (fewer widgets per row for speed)
  for (let i = 0; i < fileCount; i++) {
    const name = fileNames[i];
    const full = join(dirPath, name);
    const idx = fileEntryCount;
    fileEntryPaths.push(full);
    fileEntryLabels.push(name);
    fileEntryCount = fileEntryCount + 1;

    // Indent: depth*16 + 14 for chevron space + 4 base
    const indentPx = depth * 16 + 18;
    const row = HStackWithInsets(4, 0, indentPx, 0, 4);
    widgetSetHeight(row, 22);

    // File icon (16px wide)
    const fIcon = getFileIcon(name);
    const iconBtn = Button('', () => { onFileClick(idx); });
    buttonSetBordered(iconBtn, 0);
    buttonSetImage(iconBtn, fIcon);
    textSetFontSize(iconBtn, 11);
    widgetSetWidth(iconBtn, 16);
    const fColor = getFileIconColor(name);
    if (fColor.length > 0) {
      setBtnTint(iconBtn, fColor);
    } else {
      setBtnTint(iconBtn, getSideBarForeground());
    }
    widgetAddChild(row, iconBtn);

    // File name button
    let fileColor = getSideBarForeground();
    if (sidebarWorkspaceRoot.length > 0 && full.length > sidebarWorkspaceRoot.length + 1) {
      const relPath = full.slice(sidebarWorkspaceRoot.length + 1);
      const gStatus = getGitFileStatus(relPath);
      if (gStatus === 1) { fileColor = '#E2C08D'; }
      if (gStatus === 2) { fileColor = '#73C991'; }
      if (gStatus === 3) { fileColor = '#73C991'; }
      if (gStatus === 4) { fileColor = '#E57373'; }
    }

    const displayName = truncateName(name, 30);
    const nameBtn = Button(displayName, () => { onFileClick(idx); });
    buttonSetBordered(nameBtn, 0);
    textSetFontSize(nameBtn, 13);
    if (fileColor.length > 0) setBtnFg(nameBtn, fileColor);
    widgetAddChild(row, nameBtn);

    widgetAddChild(row, Spacer());

    fileTreeButtons.push(nameBtn);
    fileRowWidgets.push(row);

    // Selection highlight
    if (panelColors && sidebarCurrentEditorPath.length > 0 && full.length === sidebarCurrentEditorPath.length) {
      let selMatch = 1;
      for (let si = 0; si < full.length; si++) {
        if (full.charCodeAt(si) !== sidebarCurrentEditorPath.charCodeAt(si)) { selMatch = 0; break; }
      }
      if (selMatch > 0) {
        setBg(row, getListActiveSelectionBackground());
        selectedFileIdx = idx;
      }
    }

    widgetAddChild(sidebarContainer, row);
  }
}

// Module-level function wrappers for callbacks (Perry closures capture by value)
function openFolderAction(): void { _openFolderCallback(); }
function newFileAction(): void { _newFileCallback(); }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Render file tree into the given container (shared sidebar VStack). */
export function renderExplorerPanel(container: unknown, colors: ResolvedUIColors): void {
  panelColors = colors;
  sidebarContainer = container;
  sidebarReady = 1;
  if (isRemoteMode > 0) {
    refreshRemoteSidebar();
  } else {
    refreshSidebar();
  }
}

/** Refresh the sidebar file tree (e.g. after opening a folder). */
export function refreshSidebarContent(): void {
  refreshSidebar();
}

// ---------------------------------------------------------------------------
// Remote file tree (for sync guest — renders files received from host)
// ---------------------------------------------------------------------------

// Remote entries: parallel arrays of relative paths + isDir flags
let remoteEntryPaths: string[] = [];
let remoteEntryIsDir: number[] = [];
let remoteEntryCount: number = 0;
let remoteRootName = '';
let isRemoteMode: number = 0;

// Callback for when guest clicks a remote file
let _remoteFileClickCallback: (relPath: string) => void = _noopRemoteClick;
function _noopRemoteClick(_p: string): void {}

export function setRemoteFileClickCallback(cb: (relPath: string) => void): void {
  _remoteFileClickCallback = cb;
}

/**
 * Set remote file tree entries. Called when guest receives FILE_TREE from host.
 * Each entry is "D|rel/path" (directory) or "F|rel/path" (file).
 * Entries are newline-separated in the raw message.
 */
export function setRemoteFileTree(rootName: string, entries: string[], count: number): void {
  remoteEntryPaths = [];
  remoteEntryIsDir = [];
  remoteEntryCount = 0;
  remoteRootName = rootName;
  isRemoteMode = 1;
  for (let i = 0; i < count; i++) {
    const entry = entries[i];
    if (entry.length < 3) continue;
    const typeChar = entry.charCodeAt(0);
    const relPath = entry.substring(2);
    remoteEntryPaths.push(relPath);
    if (typeChar === 68) { // 'D'
      remoteEntryIsDir.push(1);
    } else {
      remoteEntryIsDir.push(0);
    }
    remoteEntryCount = remoteEntryCount + 1;
  }
  // Set workspace root to a virtual name so sidebar renders
  sidebarWorkspaceRoot = rootName;
  refreshRemoteSidebar();
}

function refreshRemoteSidebar(): void {
  if (sidebarReady < 1) return;
  widgetClearChildren(sidebarContainer);
  fileTreeButtons = [];
  selectedFileIdx = -1;
  fileEntryPaths = [];
  fileEntryLabels = [];
  fileEntryCount = 0;
  fileRowWidgets = [];

  // --- EXPLORER title ---
  const explorerLabel = Text('EXPLORER');
  textSetFontSize(explorerLabel, 11);
  textSetFontWeight(explorerLabel, 11, 0.4);
  setFg(explorerLabel, getSideBarForeground());
  const explorerRow = HStackWithInsets(0, 0, 4, 0, 4);
  widgetSetHeight(explorerRow, 24);
  widgetAddChild(explorerRow, explorerLabel);
  widgetAddChild(explorerRow, Spacer());
  widgetAddChild(sidebarContainer, explorerRow);

  // --- Root folder name ---
  let rootDisplay = '';
  for (let ci = 0; ci < remoteRootName.length; ci++) {
    const cc = remoteRootName.charCodeAt(ci);
    if (cc >= 97 && cc <= 122) {
      rootDisplay += String.fromCharCode(cc - 32);
    } else {
      rootDisplay += remoteRootName.charAt(ci);
    }
  }
  const syncBadge = Text('SYNCED');
  textSetFontSize(syncBadge, 9);
  textSetFontWeight(syncBadge, 9, 0.6);
  setFg(syncBadge, '#569CD6');
  const rootLabel = Text(rootDisplay);
  textSetFontSize(rootLabel, 11);
  textSetFontWeight(rootLabel, 11, 0.7);
  setFg(rootLabel, getSideBarForeground());
  const rootRow = HStackWithInsets(4, 0, 4, 0, 4);
  widgetSetHeight(rootRow, 24);
  widgetAddChild(rootRow, rootLabel);
  widgetAddChild(rootRow, Spacer());
  widgetAddChild(rootRow, syncBadge);
  widgetAddChild(sidebarContainer, rootRow);

  // --- Render remote entries ---
  // Build a flat tree sorted by path. Dirs first at each level.
  // For simplicity: just render flat list with indentation based on slash count.
  for (let i = 0; i < remoteEntryCount; i++) {
    const relPath = remoteEntryPaths[i];
    const isDir = remoteEntryIsDir[i];

    // Calculate depth from slash count
    let depth = 0;
    for (let ci = 0; ci < relPath.length; ci++) {
      if (relPath.charCodeAt(ci) === 47) depth = depth + 1;
    }

    // Get filename (last segment)
    let lastSlash = -1;
    for (let ci = relPath.length - 1; ci >= 0; ci--) {
      if (relPath.charCodeAt(ci) === 47) { lastSlash = ci; break; }
    }
    let name = relPath;
    if (lastSlash >= 0) {
      name = relPath.substring(lastSlash + 1);
    }

    if (isDir > 0) {
      // Directory row
      const indentPx = depth * 16 + 4;
      const row = HStackWithInsets(4, 0, indentPx, 0, 4);
      widgetSetHeight(row, 22);
      const chevron = Text('\u02C5');
      textSetFontSize(chevron, 9);
      setFg(chevron, getSideBarForeground());
      widgetAddChild(row, chevron);
      const displayName = truncateName(name, 30);
      const dirLabel = Text(displayName);
      textSetFontSize(dirLabel, 13);
      setFg(dirLabel, getSideBarForeground());
      widgetAddChild(row, dirLabel);
      widgetAddChild(row, Spacer());
      widgetAddChild(sidebarContainer, row);
    } else {
      // File row — clickable
      const idx = fileEntryCount;
      fileEntryPaths.push(relPath);
      fileEntryLabels.push(name);
      fileEntryCount = fileEntryCount + 1;

      const indentPx = depth * 16 + 18;
      const row = HStackWithInsets(4, 0, indentPx, 0, 4);
      widgetSetHeight(row, 22);

      // File icon
      const fIcon = getFileIcon(name);
      const iconBtn = Button('', () => { onRemoteFileClick(idx); });
      buttonSetBordered(iconBtn, 0);
      buttonSetImage(iconBtn, fIcon);
      textSetFontSize(iconBtn, 11);
      widgetSetWidth(iconBtn, 16);
      const fColor = getFileIconColor(name);
      if (fColor.length > 0) {
        setBtnTint(iconBtn, fColor);
      } else {
        setBtnTint(iconBtn, getSideBarForeground());
      }
      widgetAddChild(row, iconBtn);

      // File name button
      const displayName = truncateName(name, 30);
      const nameBtn = Button(displayName, () => { onRemoteFileClick(idx); });
      buttonSetBordered(nameBtn, 0);
      textSetFontSize(nameBtn, 13);
      setBtnFg(nameBtn, getSideBarForeground());
      widgetAddChild(row, nameBtn);
      widgetAddChild(row, Spacer());

      fileTreeButtons.push(nameBtn);
      fileRowWidgets.push(row);
      widgetAddChild(sidebarContainer, row);
    }
  }

  widgetAddChild(sidebarContainer, Spacer());
}

let pendingRemoteClickIdx: number = -1;

function onRemoteFileClick(idx: number): void {
  pendingRemoteClickIdx = idx;
  setTimeout(() => { onRemoteFileClickDeferred(); }, 0);
}

function onRemoteFileClickDeferred(): void {
  const idx = pendingRemoteClickIdx;
  if (idx < 0 || idx >= fileEntryCount) return;
  pendingRemoteClickIdx = -1;
  const relPath = fileEntryPaths[idx];
  _remoteFileClickCallback(relPath);
}

export function isRemoteExplorerMode(): number {
  return isRemoteMode;
}

