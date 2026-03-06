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
import { getGitFileStatus, getGitDirStatus } from '../git/git-panel';

// ---------------------------------------------------------------------------
// Module-level state (must be declared BEFORE any function — Perry no-hoist)
// ---------------------------------------------------------------------------

interface FileEntry {
  name: string;
  path: string;
  depth: number;
  isDir: boolean;
  label: string;
}

let sidebarWorkspaceRoot = '';
let panelColors: ResolvedUIColors = null as any;
let sidebarCurrentEditorPath = '';

let fileEntries: FileEntry[] = [];
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
  pendingFileClickIdx = idx;
  setTimeout(() => { onFileClickDeferred(); }, 0);
}

function onFileClickDeferred(): void {
  const idx = pendingFileClickIdx;
  if (idx < 0) return;
  pendingFileClickIdx = -1;
  if (idx >= fileEntryCount) return;
  const entry = fileEntries[idx];
  _fileClickCallback(entry.path, entry.label);
}

// ---------------------------------------------------------------------------
// Selection tracking
// ---------------------------------------------------------------------------

export function updateSidebarSelection(): void {
  if (!panelColors) return;
  // Clear old selection
  if (selectedFileIdx >= 0 && selectedFileIdx < fileRowWidgets.length && fileRowWidgets[selectedFileIdx]) {
    setBg(fileRowWidgets[selectedFileIdx], panelColors.sideBarBackground);
  }
  // Find new selection
  selectedFileIdx = -1;
  for (let i = 0; i < fileEntryCount; i++) {
    if (fileEntries[i].path === sidebarCurrentEditorPath) {
      selectedFileIdx = i;
      if (i < fileRowWidgets.length && fileRowWidgets[i]) {
        setBg(fileRowWidgets[i], panelColors.listActiveSelectionBackground);
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Sidebar rendering
// ---------------------------------------------------------------------------

function refreshSidebar(): void {
  if (sidebarReady < 1) return;
  widgetClearChildren(sidebarContainer);
  fileTreeButtons = [];
  selectedFileIdx = -1;
  fileEntries = [];
  fileEntryCount = 0;
  fileRowWidgets = [];

  if (sidebarWorkspaceRoot.length < 1) {
    const hint = Text('Open a folder to start');
    textSetFontSize(hint, 12);
    if (panelColors) setFg(hint, panelColors.sideBarForeground);
    widgetAddChild(sidebarContainer, hint);
    const openBtn = Button('Open Folder', () => { openFolderAction(); });
    buttonSetBordered(openBtn, 0);
    textSetFontSize(openBtn, 13);
    if (panelColors) setBtnFg(openBtn, panelColors.sideBarForeground);
    widgetAddChild(sidebarContainer, openBtn);
    widgetAddChild(sidebarContainer, Spacer());
    return;
  }

  // --- 1. EXPLORER title row (22px, thin text, left-padded 4px) ---
  const explorerLabel = Text('EXPLORER');
  textSetFontSize(explorerLabel, 11);
  textSetFontWeight(explorerLabel, 11, 0.4);
  if (panelColors) setFg(explorerLabel, panelColors.sideBarTitleForeground);
  const explorerRow = HStackWithInsets(0, 0, 4, 0, 4);
  widgetSetHeight(explorerRow, 22);
  widgetAddChild(explorerRow, explorerLabel);
  widgetAddChild(explorerRow, Spacer());
  widgetAddChild(sidebarContainer, explorerRow);

  // --- 2. FOLDERS section header (22px, bold, translucent bg) ---
  const foldersLabel = Text('FOLDERS');
  textSetFontSize(foldersLabel, 11);
  textSetFontWeight(foldersLabel, 11, 0.7);
  if (panelColors) setFg(foldersLabel, panelColors.sideBarForeground);
  const dotsBtn = Button('', () => {});
  buttonSetBordered(dotsBtn, 0);
  buttonSetImage(dotsBtn, 'ellipsis');
  buttonSetImagePosition(dotsBtn, 1);
  textSetFontSize(dotsBtn, 10);
  if (panelColors) setBtnTint(dotsBtn, panelColors.sideBarForeground);
  const foldersRow = HStackWithInsets(0, 0, 4, 0, 4);
  widgetSetHeight(foldersRow, 22);
  if (panelColors) setBg(foldersRow, panelColors.sideBarSectionHeaderBackground);
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
  if (panelColors) setFg(rootChevron, panelColors.sideBarForeground);
  const rootLabel = Text(rootDisplay);
  textSetFontSize(rootLabel, 11);
  textSetFontWeight(rootLabel, 11, 0.7);
  if (panelColors) setFg(rootLabel, panelColors.sideBarForeground);

  // New file button
  const newFileBtn = Button('', () => { newFileAction(); });
  buttonSetBordered(newFileBtn, 0);
  buttonSetImage(newFileBtn, 'doc.badge.plus');
  buttonSetImagePosition(newFileBtn, 1);
  textSetFontSize(newFileBtn, 10);
  if (panelColors) setBtnTint(newFileBtn, panelColors.sideBarForeground);

  // New folder button
  const newFolderBtn = Button('', () => {});
  buttonSetBordered(newFolderBtn, 0);
  buttonSetImage(newFolderBtn, 'folder.badge.plus');
  buttonSetImagePosition(newFolderBtn, 1);
  textSetFontSize(newFolderBtn, 10);
  if (panelColors) setBtnTint(newFolderBtn, panelColors.sideBarForeground);

  // Collapse all button
  const collapseBtn = Button('', () => { collapseAllDirs(); });
  buttonSetBordered(collapseBtn, 0);
  buttonSetImage(collapseBtn, 'arrow.down.right.and.arrow.up.left');
  buttonSetImagePosition(collapseBtn, 1);
  textSetFontSize(collapseBtn, 10);
  if (panelColors) setBtnTint(collapseBtn, panelColors.sideBarForeground);

  const rootRow = HStackWithInsets(2, 0, 4, 0, 4);
  widgetSetHeight(rootRow, 22);
  widgetAddChild(rootRow, rootChevron);
  widgetAddChild(rootRow, rootLabel);
  widgetAddChild(rootRow, Spacer());
  widgetAddChild(rootRow, newFileBtn);
  widgetAddChild(rootRow, newFolderBtn);
  widgetAddChild(rootRow, collapseBtn);
  widgetAddChild(sidebarContainer, rootRow);

  // --- 4. File tree ---
  renderTreeLevel(sidebarWorkspaceRoot, 0);

  // --- 5. OUTLINE collapsed section ---
  const outlineChevron = Text('\u25B7');
  textSetFontSize(outlineChevron, 9);
  if (panelColors) setFg(outlineChevron, panelColors.sideBarForeground);
  const outlineLabel = Text('OUTLINE');
  textSetFontSize(outlineLabel, 11);
  textSetFontWeight(outlineLabel, 11, 0.7);
  if (panelColors) setFg(outlineLabel, panelColors.sideBarForeground);
  const outlineRow = HStackWithInsets(4, 0, 4, 0, 4);
  widgetSetHeight(outlineRow, 22);
  if (panelColors) setBg(outlineRow, panelColors.sideBarSectionHeaderBackground);
  widgetAddChild(outlineRow, outlineChevron);
  widgetAddChild(outlineRow, outlineLabel);
  widgetAddChild(sidebarContainer, outlineRow);

  // --- 6. TIMELINE collapsed section ---
  const timelineChevron = Text('\u25B7');
  textSetFontSize(timelineChevron, 9);
  if (panelColors) setFg(timelineChevron, panelColors.sideBarForeground);
  const timelineLabel = Text('TIMELINE');
  textSetFontSize(timelineLabel, 11);
  textSetFontWeight(timelineLabel, 11, 0.7);
  if (panelColors) setFg(timelineLabel, panelColors.sideBarForeground);
  const timelineRow = HStackWithInsets(4, 0, 4, 0, 4);
  widgetSetHeight(timelineRow, 22);
  if (panelColors) setBg(timelineRow, panelColors.sideBarSectionHeaderBackground);
  widgetAddChild(timelineRow, timelineChevron);
  widgetAddChild(timelineRow, timelineLabel);
  widgetAddChild(sidebarContainer, timelineRow);

  widgetAddChild(sidebarContainer, Spacer());
}

function renderTreeLevel(dirPath: string, depth: number): void {
  if (depth > 10) return;
  let names: string[] = [];
  try { names = readdirSync(dirPath); } catch (e) { return; }

  // Separate dirs and files
  let dirNames: string[] = [];
  let fileNames: string[] = [];
  let dirCount = 0;
  let fileCount = 0;
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (n.charCodeAt(0) === 46) continue; // skip hidden
    const full = join(dirPath, n);
    if (isDirectory(full)) {
      dirNames[dirCount] = n;
      dirCount = dirCount + 1;
    } else {
      fileNames[fileCount] = n;
      fileCount = fileCount + 1;
    }
  }

  // Render directories first — chevron + name only (no folder icon)
  for (let i = 0; i < dirCount; i++) {
    const name = dirNames[i];
    const full = join(dirPath, name);
    const expanded = isDirExpanded(full);
    const id = pathId(full);

    const row = HStack(2, []);
    widgetSetHeight(row, 22);

    // Indent
    const indentPx = depth * 20;
    if (indentPx > 0) {
      const indent = Text('');
      widgetSetWidth(indent, indentPx);
      widgetAddChild(row, indent);
    }

    // Chevron (16px wide, 9px font)
    const chevron = Button('', () => { onDirToggle(id); });
    buttonSetBordered(chevron, 0);
    if (expanded) {
      buttonSetImage(chevron, 'chevron.down');
    } else {
      buttonSetImage(chevron, 'chevron.right');
    }
    buttonSetImagePosition(chevron, 1);
    textSetFontSize(chevron, 9);
    widgetSetWidth(chevron, 16);
    if (panelColors) setBtnTint(chevron, panelColors.sideBarForeground);
    widgetAddChild(row, chevron);

    // Name button (13px, no icon)
    const displayName = truncateName(name, 30);
    const btn = Button(displayName, () => { onDirToggle(id); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 13);
    if (panelColors) setBtnFg(btn, panelColors.sideBarForeground);
    widgetAddChild(row, btn);

    // Spacer absorbs extra width — keeps content left-aligned
    widgetAddChild(row, Spacer());

    // Git badge for directory
    if (sidebarWorkspaceRoot.length > 0 && full.length > sidebarWorkspaceRoot.length + 1) {
      const dirRelPath = full.slice(sidebarWorkspaceRoot.length + 1);
      const dirGitStatus = getGitDirStatus(dirRelPath);
      if (dirGitStatus > 0) {
        let badgeLetter = 'M';
        let badgeColor = '#E2C08D';
        if (dirGitStatus === 2) { badgeLetter = 'U'; badgeColor = '#73C991'; }
        if (dirGitStatus === 3) { badgeLetter = 'A'; badgeColor = '#73C991'; }
        if (dirGitStatus === 4) { badgeLetter = 'D'; badgeColor = '#E57373'; }
        const badge = Text(badgeLetter);
        textSetFontSize(badge, 11);
        textSetFontFamily(badge, 11, 'Menlo');
        setFg(badge, badgeColor);
        widgetAddChild(row, badge);
      }
    }

    // Right padding
    const rpad = Text('');
    widgetSetWidth(rpad, 4);
    widgetAddChild(row, rpad);

    widgetAddChild(sidebarContainer, row);

    if (expanded) {
      renderTreeLevel(full, depth + 1);
    }
  }

  // Render files — icon + name + git badge
  for (let i = 0; i < fileCount; i++) {
    const name = fileNames[i];
    const full = join(dirPath, name);
    const idx = fileEntryCount;
    fileEntries[idx] = { name: name, path: full, depth: depth, isDir: false, label: name };
    fileEntryCount = fileEntryCount + 1;

    const row = HStack(2, []);
    widgetSetHeight(row, 22);

    // Indent (depth*20 + 16 for chevron space)
    const indentPx = depth * 20 + 16;
    const indent = Text('');
    widgetSetWidth(indent, indentPx);
    widgetAddChild(row, indent);

    // File icon (separate widget, image-only, 16px)
    const fIcon = getFileIcon(name);
    const iconBtn = Button('', () => { onFileClick(idx); });
    buttonSetBordered(iconBtn, 0);
    buttonSetImage(iconBtn, fIcon);
    buttonSetImagePosition(iconBtn, 1);
    textSetFontSize(iconBtn, 12);
    widgetSetWidth(iconBtn, 16);
    if (panelColors) {
      const fColor = getFileIconColor(name);
      if (fColor.length > 0) {
        setBtnTint(iconBtn, fColor);
      } else {
        setBtnTint(iconBtn, panelColors.sideBarForeground);
      }
    }
    widgetAddChild(row, iconBtn);

    // Determine git status and color
    let fileColor = '';
    let gitLetter = '';
    let gitColor = '';
    if (panelColors) {
      fileColor = panelColors.sideBarForeground;
    }
    if (sidebarWorkspaceRoot.length > 0 && full.length > sidebarWorkspaceRoot.length + 1) {
      const relPath = full.slice(sidebarWorkspaceRoot.length + 1);
      const gStatus = getGitFileStatus(relPath);
      if (gStatus === 1) { fileColor = '#E2C08D'; gitLetter = 'M'; gitColor = '#E2C08D'; }
      if (gStatus === 2) { fileColor = '#73C991'; gitLetter = 'U'; gitColor = '#73C991'; }
      if (gStatus === 3) { fileColor = '#73C991'; gitLetter = 'A'; gitColor = '#73C991'; }
      if (gStatus === 4) { fileColor = '#E57373'; gitLetter = 'D'; gitColor = '#E57373'; }
    }

    // File name button (13px)
    const displayName = truncateName(name, 30);
    const nameBtn = Button(displayName, () => { onFileClick(idx); });
    buttonSetBordered(nameBtn, 0);
    textSetFontSize(nameBtn, 13);
    if (fileColor.length > 0) setBtnFg(nameBtn, fileColor);
    widgetAddChild(row, nameBtn);

    // Spacer absorbs extra width — keeps content left-aligned
    widgetAddChild(row, Spacer());

    // Git badge
    if (gitLetter.length > 0) {
      const badge = Text(gitLetter);
      textSetFontSize(badge, 11);
      textSetFontFamily(badge, 11, 'Menlo');
      setFg(badge, gitColor);
      widgetAddChild(row, badge);
    }

    // Right padding
    const rpad = Text('');
    widgetSetWidth(rpad, 4);
    widgetAddChild(row, rpad);

    fileTreeButtons.push(nameBtn);
    fileRowWidgets[idx] = row;

    // Selection highlight
    if (panelColors && sidebarCurrentEditorPath.length > 0 && full === sidebarCurrentEditorPath) {
      setBg(row, panelColors.listActiveSelectionBackground);
      selectedFileIdx = idx;
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
  refreshSidebar();
}

/** Refresh the sidebar file tree (e.g. after opening a folder). */
export function refreshSidebarContent(): void {
  refreshSidebar();
}

