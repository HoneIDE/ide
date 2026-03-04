/**
 * Workbench renderer — builds the Perry UI widget tree for the IDE shell.
 *
 * Perry is imperative: widgets are created once, then mutated directly.
 * Clickable items use Button (borderless) since NSTextField labels don't
 * accept mouse events. Non-interactive labels use Text.
 *
 * IMPORTANT: Perry captures variables by VALUE in closures, not by reference.
 * To mutate widgets from callbacks, store widget handles in module-level `let`
 * variables and access them via named functions (not closures).
 */

import {
  VStack, HStack, Text, Button, Spacer,
  VStackWithInsets, HStackWithInsets,
  textSetColor, textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString,
  buttonSetBordered, buttonSetTextColor, buttonSetTitle, buttonSetImage,
  buttonSetImagePosition, buttonSetContentTintColor,
  widgetSetBackgroundColor, widgetAddChild, widgetAddChildAt, widgetClearChildren,
  widgetSetWidth, widgetSetHugging, widgetSetHidden, widgetRemoveChild,
  widgetSetContextMenu, menuCreate, menuAddItem,
  embedNSView,
  openFolderDialog, openFileDialog,
} from 'perry/ui';
import { Editor } from '@honeide/editor/perry';
import { getActiveTheme, type ResolvedUIColors } from './theme/theme-loader';
import type { LayoutMode } from '../platform';
import { getWorkbenchSettings } from './settings';
import { readFileSync, readdirSync, isDirectory } from 'fs';
import { join } from 'path';

// Compile-time platform ID injected by Perry codegen:
// 0 = macOS, 1 = iOS, 2 = Android, 3 = Windows, 4 = Linux, 5 = Web
declare const __platform__: number;

// FFI function from @honeide/editor — returns raw NSView* for an EditorView
declare function hone_editor_nsview(handle: number): number;

// Syntax highlighting is now handled by @honeide/editor's KeywordSyntaxEngine

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function hexToRGBA(hex: string): [number, number, number, number] {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1.0;
  return [r, g, b, a];
}

function setBg(widget: unknown, hex: string): void {
  const [r, g, b, a] = hexToRGBA(hex);
  widgetSetBackgroundColor(widget, r, g, b, a);
}

function setFg(text: unknown, hex: string): void {
  const [r, g, b, a] = hexToRGBA(hex);
  textSetColor(text, r, g, b, a);
}

function setBtnFg(btn: unknown, hex: string): void {
  const [r, g, b, a] = hexToRGBA(hex);
  buttonSetTextColor(btn, r, g, b, a);
}

function setBtnTint(btn: unknown, hex: string): void {
  const [r, g, b, a] = hexToRGBA(hex);
  buttonSetContentTintColor(btn, r, g, b, a);
}

// ---------------------------------------------------------------------------
// File tree data — real project paths
// ---------------------------------------------------------------------------

interface FileEntry {
  name: string;
  path: string;
  depth: number;
  isDir: boolean;
  label: string;
}

// Dynamic file tree — loaded from opened folder
let workspaceRoot = '';
let fileEntries: FileEntry[] = [];

// Flat arrays for file paths/names — indexed by numeric ID for closure capture.
// Perry's GC may collect strings captured directly in closures, so we store them
// in module-level arrays and read via a named function at click time.
let flatFilePaths: string[] = [];
let flatFileNames: string[] = [];

// Expanded directory tracking — individual module-level variables (no arrays).
// Uses pathHash = length * 256 + lastCharCode for collision-resistant IDs.
let exp0 = -1;
let exp1 = -1;
let exp2 = -1;
let exp3 = -1;
let exp4 = -1;
let exp5 = -1;
let exp6 = -1;
let exp7 = -1;

/** Compute a numeric hash for a path: length * 256 + lastCharCode. */
function pathId(path: string): number {
  const len = path.length;
  const last = path.charCodeAt(len - 1);
  return len * 256 + last;
}

/** Check if a directory path is currently expanded (no array, no loop). */
function isDirExpanded(path: string): boolean {
  const id = pathId(path);
  if (exp0 === id) return true;
  if (exp1 === id) return true;
  if (exp2 === id) return true;
  if (exp3 === id) return true;
  if (exp4 === id) return true;
  if (exp5 === id) return true;
  if (exp6 === id) return true;
  if (exp7 === id) return true;
  return false;
}


/** Track entry count explicitly (Perry .length may be stale on module-level arrays). */
let fileEntryCount = 0;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const PANELS = ['Files', 'Search', 'Git', 'Debug', 'Ext'];

/** Open tabs — each entry is a file path */
let openTabs: string[] = [];
let openTabNames: string[] = [];
let openTabCount: number = 0;  // Manual count since Perry .push() may not update .length across calls

// ---------------------------------------------------------------------------
// Module-level widget refs (Perry closures capture by value, so we must
// access these through named functions to get the current value)
// ---------------------------------------------------------------------------

let themeColors: ResolvedUIColors | null = null;

// Activity bar
let activityButtons: unknown[] = [];
let activeActivityIdx = 0;

// Sidebar file tree
let fileTreeButtons: unknown[] = [];
let selectedFileIdx = -1;
let sidebarContainer: unknown = null;
let sidebarReady: number = 0;

// Editor tabs
let tabBarButtons: unknown[] = [];
let activeTabIdx = 0;

// Editor content widgets
let tabBarContainer: unknown = null;
let tabBarReady: number = 0;  // 0 = not set, 1 = ready (numeric flag avoids NaN-box truthiness issue)

// The real editor instance — avoid union type (Editor | null) since Perry
// inverts null checks on union-typed variables and closures lose `this`.
let editorInstance: Editor = null as any;  // non-union type
let editorReady: number = 0;              // 0 = not ready, 1 = ready (numeric, not boolean)
let editorWidget: unknown = null;

// Sidebar toggling (full/split layouts)
let sidebarWidget: unknown = null;
let sidebarBorderWidget: unknown = null;
let sidebarVisible: number = 1;
let sidebarToggleReady: number = 0;

// Compact layout panel toggling
let compactEditorPane: unknown = null;
let compactExplorerPane: unknown = null;
let compactShowingExplorer: number = 0;  // 0 = editor visible, 1 = explorer visible

// ---------------------------------------------------------------------------
// Named update functions (read module-level refs at call time)
// ---------------------------------------------------------------------------

function updateActivityBar(): void {
  if (!themeColors) return;
  for (let i = 0; i < activityButtons.length; i++) {
    if (i === activeActivityIdx) {
      setBtnTint(activityButtons[i], themeColors.activityBarForeground);
    } else {
      setBtnTint(activityButtons[i], themeColors.activityBarInactiveForeground);
    }
  }
}

function updateFileTree(): void {
  if (!themeColors) return;
  for (let i = 0; i < fileTreeButtons.length; i++) {
    if (i === selectedFileIdx && i < fileEntries.length && !isDirectory(fileEntries[i].path)) {
      setBg(fileTreeButtons[i], themeColors.listActiveSelectionBackground);
      setBtnFg(fileTreeButtons[i], themeColors.listActiveSelectionForeground);
    } else {
      setBg(fileTreeButtons[i], themeColors.sideBarBackground);
      setBtnFg(fileTreeButtons[i], themeColors.sideBarForeground);
    }
  }
}

function updateEditorTabs(): void {
  if (!themeColors) return;
  for (let i = 0; i < tabBarButtons.length; i++) {
    if (i === activeTabIdx) {
      setBtnFg(tabBarButtons[i], themeColors.tabActiveForeground);
      setBg(tabBarButtons[i], themeColors.tabActiveBackground);
    } else {
      setBtnFg(tabBarButtons[i], themeColors.tabInactiveForeground);
      setBg(tabBarButtons[i], themeColors.tabInactiveBackground);
    }
  }
}

/** Rebuild sidebar file tree by directly reading the filesystem.
 *  We do this INSIDE refreshSidebar because Perry module-level variable reads
 *  (exp0, exp1, etc.) work correctly here but NOT in functions called from
 *  loadFileTree/addDirEntries (those see stale snapshots). */
function refreshSidebar(): void {
  if (sidebarReady < 1) return;
  widgetClearChildren(sidebarContainer);

  const title = Text('EXPLORER');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, themeColors.sideBarForeground);
  widgetAddChild(sidebarContainer, title);

  fileTreeButtons = [];
  fileEntries = [];
  flatFilePaths = [];
  flatFileNames = [];
  fileEntryCount = 0;
  selectedFileIdx = -1;

  if (workspaceRoot.length > 0) {
    renderTreeLevel(workspaceRoot, 0);
  }

  widgetAddChild(sidebarContainer, Spacer());
}

/** Render one level of the file tree directly into sidebarContainer.
 *  Called from refreshSidebar — reads exp0..exp7 which are fresh in this context. */
function renderTreeLevel(dirPath: string, depth: number): void {
  const names: string[] = readdirSync(dirPath);
  const dirs: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const ch0 = name.charCodeAt(0);
    if (ch0 === 46) continue; // skip hidden (.)
    const fullPath = join(dirPath, name);
    if (isDirectory(fullPath)) {
      dirs.push(name);
    } else {
      files.push(name);
    }
  }
  dirs.sort();
  files.sort();

  // Dirs first
  for (let i = 0; i < dirs.length; i++) {
    const name = dirs[i];
    const fullPath = join(dirPath, name);
    const idx = fileEntryCount;
    fileEntries[idx] = { name: name, path: fullPath, depth: depth, isDir: true, label: name };
    flatFilePaths[idx] = fullPath;
    flatFileNames[idx] = name;
    fileEntryCount = fileEntryCount + 1;

    const expanded = isDirExpanded(fullPath);
    // Capture pathId as a NUMBER in the closure — immune to string GC
    const dirId = pathId(fullPath);
    const btn = Button(name, () => { onDirToggle(dirId); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 13);
    if (expanded) {
      buttonSetImage(btn, 'folder');
    } else {
      buttonSetImage(btn, 'folder.fill');
    }
    if (themeColors) {
      setBtnFg(btn, themeColors.sideBarForeground);
    }

    if (depth > 0) {
      const row = HStack(0, []);
      const indent = Text('');
      widgetSetWidth(indent, depth * 16);
      widgetAddChild(row, indent);
      widgetAddChild(row, btn);
      fileTreeButtons.push(btn);
      widgetAddChild(sidebarContainer, row);
    } else {
      fileTreeButtons.push(btn);
      widgetAddChild(sidebarContainer, btn);
    }

    // Recurse into expanded dirs
    if (expanded) {
      renderTreeLevel(fullPath, depth + 1);
    }
  }

  // Files after dirs
  for (let i = 0; i < files.length; i++) {
    const name = files[i];
    const fullPath = join(dirPath, name);
    const idx = fileEntryCount;
    fileEntries[idx] = { name: name, path: fullPath, depth: depth, isDir: false, label: name };
    flatFilePaths[idx] = fullPath;
    flatFileNames[idx] = name;
    fileEntryCount = fileEntryCount + 1;

    // Capture numeric index — named function reads from module-level arrays at click time
    const capturedIdx = idx;
    const btn = Button(name, () => { onFileClick(capturedIdx); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 13);
    buttonSetImage(btn, 'doc.text');
    if (themeColors) {
      setBtnFg(btn, themeColors.sideBarForeground);
    }

    if (depth > 0) {
      const row = HStack(0, []);
      const indent = Text('');
      widgetSetWidth(indent, depth * 16);
      widgetAddChild(row, indent);
      widgetAddChild(row, btn);
      fileTreeButtons.push(btn);
      widgetAddChild(sidebarContainer, row);
    } else {
      fileTreeButtons.push(btn);
      widgetAddChild(sidebarContainer, btn);
    }
  }
}

/** Module-level callback for folder dialog — called from menu or elsewhere. */
function onFolderOpened(folderPath: string): void {
  workspaceRoot = folderPath;
  refreshSidebar();
}

/** Open folder dialog — callable from menu bar or command. */
export function openFolderAction(): void {
  openFolderDialog((path: string) => { onFolderOpenedCb(path); });
}

// Module-level function for the callback (Perry closures can't call methods on captured this)
function onFolderOpenedCb(path: string): void {
  // Guard against cancelled dialog
  if (path.length < 1) return;
  onFolderOpened(path);
}

/** Toggle sidebar visibility — callable from menu bar. */
export function toggleSidebarAction(): void {
  if (sidebarToggleReady < 1) return;
  if (sidebarVisible > 0) {
    sidebarVisible = 0;
    widgetSetHidden(sidebarWidget, 1);
    if (sidebarBorderWidget) widgetSetHidden(sidebarBorderWidget, 1);
  } else {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    if (sidebarBorderWidget) widgetSetHidden(sidebarBorderWidget, 0);
  }
}

/** Close the active editor tab — callable from menu bar. */
export function closeEditorAction(): void {
  onTabClose(activeTabIdx);
}

/** Rebuild the tab bar from current openTabs/openTabNames. */
function rebuildTabBar(): void {
  if (tabBarReady > 0) {
    rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);
  }
}

/** Rebuild the tab bar — pass all data directly to avoid stale module-level reads. */
function rebuildTabBarDirect(count: number, names: string[], paths: string[], container: unknown): void {
  widgetClearChildren(container);
  tabBarButtons = [];

  for (let i = 0; i < count; i++) {
    const idx = i;
    const name = names[i];
    const path = paths[i];
    // Capture path in closure so tab click doesn't need module-level array reads
    const btn = Button(name, () => { onTabClickDirect(idx, path); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 13);
    tabBarButtons[i] = btn;
    widgetAddChild(container, btn);
  }
  widgetAddChild(container, Spacer());

  // Apply colors inline (avoid reading themeColors from a separate function)
  applyTabColors(count);
}

/** Apply tab colors to current tabBarButtons. */
function applyTabColors(count: number): void {
  if (!themeColors) return;
  for (let i = 0; i < count; i++) {
    if (i === activeTabIdx) {
      setBtnFg(tabBarButtons[i], themeColors.tabActiveForeground);
      setBg(tabBarButtons[i], themeColors.tabActiveBackground);
    } else {
      setBtnFg(tabBarButtons[i], themeColors.tabInactiveForeground);
      setBg(tabBarButtons[i], themeColors.tabInactiveBackground);
    }
  }
}


/** Extract filename from a full path. Uses charCodeAt for comparison
 *  since Perry's string === is broken (always returns true). */
function getFileName(filePath: string): string {
  let lastSlash = -1;
  for (let i = 0; i < filePath.length; i++) {
    const ch = filePath.charCodeAt(i);
    if (ch === 47 || ch === 92) lastSlash = i;  // '/' or '\'
  }
  if (lastSlash >= 0) {
    return filePath.slice(lastSlash + 1);
  }
  return filePath;
}

/** Open a file via the native file dialog — callable from menu bar. */
export function openFileAction(): void {
  openFileDialog((path: string) => { onFileOpenedCb2(path); });
}

function onFileOpenedCb2(filePath: string): void {
  // Guard against cancelled dialog (TAG_UNDEFINED → empty string)
  if (filePath.length < 1) return;
  const name = getFileName(filePath);
  openFileInEditor(filePath, name);
}

/** Detect language from file extension. */
function detectLanguage(filePath: string): string {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.rs')) return 'rust';
  if (filePath.endsWith('.html') || filePath.endsWith('.htm')) return 'html';
  if (filePath.endsWith('.css')) return 'css';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.md')) return 'markdown';
  if (filePath.endsWith('.c') || filePath.endsWith('.h')) return 'c';
  if (filePath.endsWith('.cpp') || filePath.endsWith('.hpp')) return 'cpp';
  return 'plaintext';
}

function displayFileContent(filePath: string): void {
  if (editorReady < 1) return;  // numeric check, no union-type issue
  const content = readFileSync(filePath);
  editorInstance.setContent(content);
  editorInstance.render();
}

function openFileInEditor(filePath: string, fileName: string): void {
  // Compute display name inline (Perry function returns for strings are unreliable)
  let lastSlash = -1;
  for (let i = 0; i < filePath.length; i++) {
    const ch = filePath.charCodeAt(i);
    if (ch === 47 || ch === 92) lastSlash = i;  // 47='/' 92='\'
  }
  let displayName = filePath;
  if (lastSlash >= 0) {
    displayName = filePath.slice(lastSlash + 1);
  }

  // Append a new tab to the tab bar (don't clear — module-level arrays are stale
  // from callbacks, so we can't rebuild from stored data).
  if (tabBarReady > 0) {
    // Create tab group: [name button, close button] with padding
    const tabGroup = HStackWithInsets(4, 0, 10, 0, 6);
    const tabBtn = Button(displayName, () => { loadFileFromTab(filePath); });
    buttonSetBordered(tabBtn, 0);
    textSetFontSize(tabBtn, 13);
    // Close button — xmark icon
    const closeBtn = Button('', () => { removeTabGroup(tabGroup); });
    buttonSetBordered(closeBtn, 0);
    buttonSetImage(closeBtn, 'xmark');
    buttonSetImagePosition(closeBtn, 1);
    textSetFontSize(closeBtn, 9);
    widgetAddChild(tabGroup, tabBtn);
    widgetAddChild(tabGroup, closeBtn);
    if (themeColors) {
      setBtnFg(tabBtn, themeColors.tabActiveForeground);
      setBg(tabGroup, themeColors.tabActiveBackground);
      setBtnFg(closeBtn, themeColors.tabActiveForeground);
    }
    // Context menu for right-click
    const tabMenu = menuCreate();
    menuAddItem(tabMenu, 'Close', () => { removeTabGroup(tabGroup); });
    menuAddItem(tabMenu, 'Close Others', () => { closeOtherTabGroups(tabGroup); });
    menuAddItem(tabMenu, 'Close All', () => { closeAllTabs(); });
    widgetSetContextMenu(tabGroup, tabMenu);
    widgetAddChild(tabBarContainer, tabGroup);
  }

  // Load file content
  if (editorReady > 0) {
    const content = readFileSync(filePath);
    editorInstance.setContent(content);
    editorInstance.render();
  }
}

/** Load file content — called from tab click closures with captured path. */
function loadFileFromTab(filePath: string): void {
  if (editorReady > 0) {
    const content = readFileSync(filePath);
    editorInstance.setContent(content);
    editorInstance.render();
  }
}

/** Hide a tab group (close the tab). */
function removeTabGroup(group: unknown): void {
  widgetRemoveChild(tabBarContainer, group);
}

function closeAllTabs(): void {
  widgetClearChildren(tabBarContainer);
}

function closeOtherTabGroups(keepGroup: unknown): void {
  // Clear all and re-add the one to keep
  widgetClearChildren(tabBarContainer);
  widgetAddChild(tabBarContainer, keepGroup);
}

function onActivityClick(idx: number): void {
  activeActivityIdx = idx;
  updateActivityBar();
  switchSidebarPanel(idx);
}

/** Switch sidebar content based on activity bar selection. */
function switchSidebarPanel(idx: number): void {
  if (sidebarReady < 1) return;
  if (idx === 0) {
    // Explorer — rebuild file tree
    refreshSidebar();
    return;
  }
  widgetClearChildren(sidebarContainer);
  fileTreeButtons = [];
  selectedFileIdx = -1;

  // Determine panel title — use literal strings (Perry string + is broken)
  let panelTitle = 'SEARCH';
  let panelHint = 'Type to search across files';
  if (idx === 2) { panelTitle = 'SOURCE CONTROL'; panelHint = 'No repository detected'; }
  if (idx === 3) { panelTitle = 'RUN AND DEBUG'; panelHint = 'No launch configuration'; }
  if (idx === 4) { panelTitle = 'EXTENSIONS'; panelHint = 'No extensions installed'; }
  if (idx === 5) { panelTitle = 'SETTINGS'; panelHint = 'Settings editor coming soon'; }

  const title = Text(panelTitle);
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, themeColors.sideBarForeground);
  widgetAddChild(sidebarContainer, title);

  const hint = Text(panelHint);
  textSetFontSize(hint, 12);
  setFg(hint, themeColors.sideBarForeground);
  widgetAddChild(sidebarContainer, hint);
  widgetAddChild(sidebarContainer, Spacer());
}

/** Toggle dir expansion using pre-computed numeric ID (no string reads at click time). */
function onDirToggle(id: number): void {
  toggleExpById(id);
  refreshSidebar();
}

/** Toggle expansion by numeric ID directly (no pathId computation needed). */
function toggleExpById(id: number): void {
  if (exp0 === id) { exp0 = -1; return; }
  if (exp1 === id) { exp1 = -1; return; }
  if (exp2 === id) { exp2 = -1; return; }
  if (exp3 === id) { exp3 = -1; return; }
  if (exp4 === id) { exp4 = -1; return; }
  if (exp5 === id) { exp5 = -1; return; }
  if (exp6 === id) { exp6 = -1; return; }
  if (exp7 === id) { exp7 = -1; return; }
  if (exp0 === -1) { exp0 = id; return; }
  if (exp1 === -1) { exp1 = id; return; }
  if (exp2 === -1) { exp2 = id; return; }
  if (exp3 === -1) { exp3 = id; return; }
  if (exp4 === -1) { exp4 = id; return; }
  if (exp5 === -1) { exp5 = id; return; }
  if (exp6 === -1) { exp6 = id; return; }
  if (exp7 === -1) { exp7 = id; return; }
}

function onFileClick(idx: number): void {
  // Read from flat arrays (not object fields — avoids corrupted keys_array)
  const path = flatFilePaths[idx];
  const name = flatFileNames[idx];
  if (path.length < 1) return;  // guard against undefined/empty
  openFileInEditor(path, name);
  if (compactShowingExplorer > 0) {
    hideExplorer();
  }
}

function onTabClick(idx: number): void {
  activeTabIdx = idx;
  updateEditorTabs();
  if (idx < openTabCount) {
    displayFileContent(openTabs[idx]);
  }
}

/** Tab click with captured path — avoids stale module-level array reads. */
function onTabClickDirect(idx: number, path: string): void {
  activeTabIdx = idx;
  // Color update — tabBarButtons may be stale from callback, skip if empty
  if (tabBarButtons.length > 0) {
    applyTabColors(tabBarButtons.length);
  }
  // Load file content using captured path (not module-level array)
  if (editorReady > 0) {
    const content = readFileSync(path);
    editorInstance.setContent(content);
    editorInstance.render();
  }
}

function onTabClose(idx: number): void {
  if (openTabCount < 2) return; // Don't close the last tab
  // Build new arrays without the closed tab
  const newTabs: string[] = [];
  const newNames: string[] = [];
  let j = 0;
  for (let i = 0; i < openTabCount; i++) {
    if (i === idx) continue;
    newTabs[j] = openTabs[i];
    newNames[j] = openTabNames[i];
    j = j + 1;
  }
  const newCount = j;
  openTabs = newTabs;
  openTabNames = newNames;
  openTabCount = newCount;

  // Adjust active tab index
  if (activeTabIdx >= newCount) {
    activeTabIdx = newCount - 1;
  }
  if (activeTabIdx > idx) {
    activeTabIdx = activeTabIdx - 1;
  }

  // Rebuild tab bar — pass local refs
  if (tabBarReady > 0) {
    rebuildTabBarDirect(newCount, newNames, newTabs, tabBarContainer);
  }
  if (editorReady > 0 && activeTabIdx >= 0) {
    const content = readFileSync(newTabs[activeTabIdx]);
    editorInstance.setContent(content);
    editorInstance.render();
  }
}

// ---------------------------------------------------------------------------
// Activity bar
// ---------------------------------------------------------------------------

function renderActivityBarDesktop(colors: ResolvedUIColors): unknown {
  activityButtons = [];

  // SF Symbol icons for each panel
  const icons = ['doc.on.doc', 'magnifyingglass', 'arrow.triangle.branch', 'ladybug', 'puzzlepiece.extension'];

  for (let i = 0; i < PANELS.length; i++) {
    const idx = i;
    const btn = Button('', () => { onActivityClick(idx); });
    buttonSetBordered(btn, 0);
    buttonSetImage(btn, icons[i]);
    buttonSetImagePosition(btn, 1); // NSImageOnly — icon only, no text
    setBtnTint(btn, colors.activityBarForeground);
    activityButtons.push(btn);
  }

  updateActivityBar();

  const bar = VStackWithInsets(8, 12, 6, 12, 6);
  setBg(bar, colors.activityBarBackground);
  for (let i = 0; i < activityButtons.length; i++) {
    widgetAddChild(bar, activityButtons[i]);
  }
  widgetAddChild(bar, Spacer());

  // Settings gear icon
  const settingsBtn = Button('', () => { onActivityClick(5); });
  buttonSetBordered(settingsBtn, 0);
  buttonSetImage(settingsBtn, 'gearshape');
  buttonSetImagePosition(settingsBtn, 1); // NSImageOnly
  setBtnTint(settingsBtn, colors.activityBarInactiveForeground);
  widgetAddChild(bar, settingsBtn);

  return bar;
}

function renderActivityBarCompact(colors: ResolvedUIColors): unknown {
  const icons = ['folder', 'doc.text', 'sparkles', 'terminal'];
  activityButtons = [];

  for (let i = 0; i < icons.length; i++) {
    const idx = i;
    const btn = Button('', () => { onActivityClick(idx); });
    buttonSetBordered(btn, 0);
    buttonSetImage(btn, icons[i]);
    buttonSetImagePosition(btn, 1); // NSImageOnly
    setBtnTint(btn, colors.activityBarForeground);
    activityButtons.push(btn);
  }

  updateActivityBar();

  const bar = HStack(0, []);
  setBg(bar, colors.activityBarBackground);
  for (let i = 0; i < activityButtons.length; i++) {
    widgetAddChild(bar, activityButtons[i]);
  }
  return bar;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function renderSidebar(colors: ResolvedUIColors): unknown {
  const sidebar = VStackWithInsets(1, 8, 8, 8, 8);
  setBg(sidebar, colors.sideBarBackground);
  sidebarContainer = sidebar;
  sidebarReady = 1;

  // Populate using refreshSidebar (reads filesystem + expansion state inline)
  refreshSidebar();

  return sidebar;
}

// ---------------------------------------------------------------------------
// Editor area
// ---------------------------------------------------------------------------

function renderEditorArea(colors: ResolvedUIColors): unknown {
  tabBarButtons = [];

  // Always set up default file (no __platform__ guard — !== may be unreliable)
  const defaultFile = 'C:/Users/Ralph/projects/hone/hone-ide/src/app.ts';
  const defaultName = 'app.ts';
  openTabs = [defaultFile];
  openTabNames = [defaultName];
  openTabCount = 1;

  const defaultPath = defaultFile;
  const initTabGroup = HStackWithInsets(4, 0, 10, 0, 6);
  const btn = Button('app.ts', () => { loadFileFromTab(defaultPath); });
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 13);
  const initCloseBtn = Button('', () => { removeTabGroup(initTabGroup); });
  buttonSetBordered(initCloseBtn, 0);
  buttonSetImage(initCloseBtn, 'xmark');
  buttonSetImagePosition(initCloseBtn, 1);
  textSetFontSize(initCloseBtn, 9);
  widgetAddChild(initTabGroup, btn);
  widgetAddChild(initTabGroup, initCloseBtn);
  setBtnFg(btn, colors.tabActiveForeground);
  setBg(initTabGroup, colors.tabActiveBackground);
  setBtnFg(initCloseBtn, colors.tabActiveForeground);
  // Context menu for initial tab
  const initTabMenu = menuCreate();
  menuAddItem(initTabMenu, 'Close', () => { removeTabGroup(initTabGroup); });
  menuAddItem(initTabMenu, 'Close Others', () => { closeOtherTabGroups(initTabGroup); });
  menuAddItem(initTabMenu, 'Close All', () => { closeAllTabs(); });
  widgetSetContextMenu(initTabGroup, initTabMenu);
  tabBarButtons = [initTabGroup];

  const tbc = HStack(0, []);
  tabBarContainer = tbc;
  tabBarReady = 1;
  setBg(tabBarContainer, colors.tabInactiveBackground);
  for (let i = 0; i < tabBarButtons.length; i++) {
    widgetAddChild(tabBarContainer, tabBarButtons[i]);
  }

  // Create the editor (simplified constructor — no object spread or ??)
  const ed = new Editor(800, 600);
  editorInstance = ed;
  editorReady = 1;

  // Get the native NSView and embed it in Perry's layout.
  const nsviewPtr = hone_editor_nsview(ed.nativeHandle as number);
  editorWidget = embedNSView(nsviewPtr);

  // Load default file content
  displayFileContent(openTabs[0]);

  // Editor widget must be in the initial VStack children array — Perry's
  // NSStackView layout doesn't properly size views added via widgetAddChild().
  const editorPane = VStack(0, [tabBarContainer, editorWidget]);
  setBg(editorPane, colors.editorBackground);

  return editorPane;
}

// ---------------------------------------------------------------------------
// Compact layout — panel toggling
// ---------------------------------------------------------------------------

function showExplorer(): void {
  compactShowingExplorer = 1;
  widgetSetHidden(compactEditorPane, 1);    // hide editor
  widgetSetHidden(compactExplorerPane, 0);  // show explorer
}

function hideExplorer(): void {
  compactShowingExplorer = 0;
  widgetSetHidden(compactEditorPane, 0);    // show editor
  widgetSetHidden(compactExplorerPane, 1);  // hide explorer
}

function onBottomBarFiles(): void {
  if (compactShowingExplorer > 0) {
    hideExplorer();
  } else {
    showExplorer();
  }
}

function onBottomBarEditor(): void {
  hideExplorer();
}

function onBottomBarAI(): void {
  // Placeholder — future AI panel
}

function onBottomBarTerm(): void {
  // Placeholder — future terminal panel
}

function onBottomBarSettings(): void {
  // Placeholder — future settings panel
}

function renderBottomToolbar(colors: ResolvedUIColors): unknown {
  const filesBtn = Button('', () => { onBottomBarFiles(); });
  const editorBtn = Button('', () => { onBottomBarEditor(); });
  const aiBtn = Button('', () => { onBottomBarAI(); });
  const termBtn = Button('', () => { onBottomBarTerm(); });
  const settingsBtn = Button('', () => { onBottomBarSettings(); });

  buttonSetImage(filesBtn, 'folder');
  buttonSetImage(editorBtn, 'doc.text');
  buttonSetImage(aiBtn, 'sparkles');
  buttonSetImage(termBtn, 'terminal');
  buttonSetImage(settingsBtn, 'gearshape');
  buttonSetImagePosition(filesBtn, 1);
  buttonSetImagePosition(editorBtn, 1);
  buttonSetImagePosition(aiBtn, 1);
  buttonSetImagePosition(termBtn, 1);
  buttonSetImagePosition(settingsBtn, 1);

  const allBtns = [filesBtn, editorBtn, aiBtn, termBtn, settingsBtn];
  for (let i = 0; i < allBtns.length; i++) {
    buttonSetBordered(allBtns[i], 0);
    setBtnTint(allBtns[i], colors.activityBarForeground);
  }

  const bar = HStack(0, [filesBtn, Spacer(), editorBtn, Spacer(), aiBtn, Spacer(), termBtn, Spacer(), settingsBtn]);
  setBg(bar, colors.activityBarBackground);
  return bar;
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function renderStatusBar(colors: ResolvedUIColors): unknown {
  const branch = Text(' main');
  textSetFontSize(branch, 12);
  setFg(branch, colors.statusBarForeground);

  const lang = Text('TypeScript ');
  textSetFontSize(lang, 12);
  setFg(lang, colors.statusBarForeground);

  const bar = HStack(8, [branch, Spacer(), lang]);
  setBg(bar, colors.statusBarBackground);
  return bar;
}

// ---------------------------------------------------------------------------
// Main workbench shell
// ---------------------------------------------------------------------------

export function renderWorkbench(layoutMode: LayoutMode): unknown {
  const theme = getActiveTheme();
  if (!theme) {
    return VStack(0, [Text('Hone IDE \u2014 No theme loaded')]);
  }

  themeColors = theme.uiColors;

  // Set default workspace root if not already set
  if (workspaceRoot.length === 0) {
    workspaceRoot = 'C:/Users/Ralph/projects/hone/hone-ide';
  }

  if (layoutMode === 'compact') {
    const editorArea = renderEditorArea(themeColors);
    const explorerPanel = renderSidebar(themeColors);
    const bottomBar = renderBottomToolbar(themeColors);
    const statusBar = renderStatusBar(themeColors);

    compactEditorPane = editorArea;
    compactExplorerPane = explorerPanel;

    // Explorer starts hidden
    widgetSetHidden(explorerPanel, 1);

    // Both panels in same VStack — hidden one collapses automatically
    const contentArea = VStack(0, [editorArea, explorerPanel]);
    widgetSetHugging(contentArea, 1);  // fill available space

    widgetSetHugging(statusBar, 750);
    widgetSetHugging(bottomBar, 750);
    const shell = VStack(0, [contentArea, statusBar, bottomBar]);
    setBg(shell, themeColors.editorBackground);
    return shell;
  }

  if (layoutMode === 'split') {
    const sidebar = renderSidebar(themeColors);
    const editorArea = renderEditorArea(themeColors);
    const statusBar = renderStatusBar(themeColors);

    widgetSetWidth(sidebar, 180);
    widgetSetHugging(sidebar, 750);
    widgetSetHugging(editorArea, 1);

    const sidebarBorder = VStack(0, []);
    setBg(sidebarBorder, themeColors.panelBorder);
    widgetSetWidth(sidebarBorder, 1);
    widgetSetHugging(sidebarBorder, 1000);

    // Store refs for sidebar toggling
    sidebarWidget = sidebar;
    sidebarBorderWidget = sidebarBorder;
    sidebarToggleReady = 1;

    const mainRow = HStack(0, [sidebar, sidebarBorder, editorArea]);
    widgetSetHugging(mainRow, 1);
    widgetSetHugging(statusBar, 750);
    const shell = VStack(0, [mainRow, statusBar]);
    setBg(shell, themeColors.editorBackground);
    return shell;
  }

  const settings = getWorkbenchSettings();
  const sidebarLocation = settings.sidebarLocation;

  const activityBar = renderActivityBarDesktop(themeColors);
  const sidebar = renderSidebar(themeColors);
  const editorArea = renderEditorArea(themeColors);
  const statusBar = renderStatusBar(themeColors);

  // Constrain panel widths so editor fills remaining space
  widgetSetWidth(activityBar, 48);
  widgetSetHugging(activityBar, 750);
  widgetSetWidth(sidebar, 220);
  widgetSetHugging(sidebar, 750);
  widgetSetHugging(editorArea, 1);

  // 1px vertical divider between sidebar and editor
  const sidebarBorder = VStack(0, []);
  setBg(sidebarBorder, themeColors.panelBorder);
  widgetSetWidth(sidebarBorder, 1);
  widgetSetHugging(sidebarBorder, 1000);

  // Store refs for sidebar toggling
  sidebarWidget = sidebar;
  sidebarBorderWidget = sidebarBorder;
  sidebarToggleReady = 1;

  // Sidebar location: left (default) or right
  const mainRow = sidebarLocation === 'right'
    ? HStack(0, [activityBar, editorArea, sidebarBorder, sidebar])
    : HStack(0, [activityBar, sidebar, sidebarBorder, editorArea]);

  widgetSetHugging(mainRow, 1);
  widgetSetHugging(statusBar, 750);
  const shell = VStack(0, [mainRow, statusBar]);
  setBg(shell, themeColors.editorBackground);
  return shell;
}
