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
  buttonSetContentTintColor,
  widgetSetBackgroundColor, widgetAddChild, widgetClearChildren,
  widgetSetWidth, widgetSetHugging, widgetSetHidden, embedNSView,
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

/** Load a flat file list from a directory (1 level deep). */
function loadFileTree(rootPath: string): void {
  workspaceRoot = rootPath;
  fileEntries = [];
  const names: string[] = readdirSync(rootPath);
  // Separate dirs and files, then sort each alphabetically
  const dirs: string[] = [];
  const files: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    // Skip hidden files/dirs
    if (name.charAt(0) === '.') continue;
    const fullPath = join(rootPath, name);
    if (isDirectory(fullPath)) {
      dirs.push(name);
    } else {
      files.push(name);
    }
  }
  dirs.sort();
  files.sort();
  // Dirs first, then files
  for (let i = 0; i < dirs.length; i++) {
    const name = dirs[i];
    const fullPath = join(rootPath, name);
    fileEntries.push({ name: name, path: fullPath, depth: 0, isDir: true, label: name });
  }
  for (let i = 0; i < files.length; i++) {
    const name = files[i];
    const fullPath = join(rootPath, name);
    fileEntries.push({ name: name, path: fullPath, depth: 0, isDir: false, label: name });
  }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const PANELS = ['Files', 'Search', 'Git', 'Debug', 'Ext'];

/** Open tabs — each entry is a file path */
let openTabs: string[] = [];
let openTabNames: string[] = [];

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

// Editor tabs
let tabBarButtons: unknown[] = [];
let activeTabIdx = 0;

// Editor content widgets
let tabBarContainer: unknown = null;

// The real editor instance — avoid union type (Editor | null) since Perry
// inverts null checks on union-typed variables and closures lose `this`.
let editorInstance: Editor = null as any;  // non-union type
let editorReady: number = 0;              // 0 = not ready, 1 = ready (numeric, not boolean)
let editorWidget: unknown = null;

// Sidebar toggling (full/split layouts)
let sidebarWidget: unknown = null;
let sidebarBorderWidget: unknown = null;
let sidebarVisible: number = 1;

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
    if (i === selectedFileIdx && i < fileEntries.length && !fileEntries[i].isDir) {
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

/** Rebuild sidebar file tree from current fileEntries. */
function refreshSidebar(): void {
  if (!themeColors || !sidebarContainer) return;
  widgetClearChildren(sidebarContainer);

  const title = Text('EXPLORER');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, themeColors.sideBarForeground);
  widgetAddChild(sidebarContainer, title);

  fileTreeButtons = [];
  selectedFileIdx = -1;

  for (let i = 0; i < fileEntries.length; i++) {
    const file = fileEntries[i];
    const idx = i;
    const btn = Button(file.label, () => { onFileClick(idx); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 13);
    if (file.isDir) {
      buttonSetImage(btn, 'folder.fill');
      setBtnTint(btn, '#E8AB53');
    } else {
      buttonSetImage(btn, 'doc.text');
      if (themeColors) {
        setBtnTint(btn, themeColors.sideBarForeground);
      }
    }
    fileTreeButtons.push(btn);
    widgetAddChild(sidebarContainer, btn);
  }
  updateFileTree();
  widgetAddChild(sidebarContainer, Spacer());
}

/** Module-level callback for folder dialog — called from menu or elsewhere. */
function onFolderOpened(folderPath: string): void {
  loadFileTree(folderPath);
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
  if (!sidebarWidget) return;
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
  if (openTabs.length === 0) return;
  if (activeTabIdx < 0 || activeTabIdx >= openTabs.length) return;

  // Build new arrays without the closed tab (avoid splice — Perry safety)
  const newTabs: string[] = [];
  const newNames: string[] = [];
  for (let i = 0; i < openTabs.length; i++) {
    if (i !== activeTabIdx) {
      newTabs.push(openTabs[i]);
      newNames.push(openTabNames[i]);
    }
  }
  openTabs = newTabs;
  openTabNames = newNames;

  // Adjust active index
  if (activeTabIdx >= openTabs.length && openTabs.length > 0) {
    activeTabIdx = openTabs.length - 1;
  }

  // Rebuild tab bar
  rebuildTabBar();

  // Show content of new active tab
  if (openTabs.length > 0 && activeTabIdx >= 0) {
    displayFileContent(openTabs[activeTabIdx]);
  }
}

/** Rebuild the tab bar from current openTabs/openTabNames. */
function rebuildTabBar(): void {
  if (!tabBarContainer || !themeColors) return;
  widgetClearChildren(tabBarContainer);
  tabBarButtons = [];

  for (let i = 0; i < openTabs.length; i++) {
    const idx = i;
    const name = openTabNames[i];
    const btn = Button(name, () => { onTabClick(idx); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 13);
    tabBarButtons.push(btn);
    widgetAddChild(tabBarContainer, btn);
  }
  widgetAddChild(tabBarContainer, Spacer());
  updateEditorTabs();
}

/** Extract filename from a full path. */
function getFileName(filePath: string): string {
  let lastSlash = -1;
  for (let i = 0; i < filePath.length; i++) {
    if (filePath.charAt(i) === '/') lastSlash = i;
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
  if (!themeColors) return;

  // Check if already open
  let tabIdx = -1;
  for (let i = 0; i < openTabs.length; i++) {
    if (openTabs[i] === filePath) {
      tabIdx = i;
      break;
    }
  }

  if (tabIdx >= 0) {
    // Already open — just switch to it
    activeTabIdx = tabIdx;
    updateEditorTabs();
    displayFileContent(filePath);
    return;
  }

  // Add new tab
  openTabs.push(filePath);
  openTabNames.push(fileName);

  // Create tab button and add to tab bar
  const idx = openTabs.length - 1;
  const btn = Button(fileName, () => { onTabClick(idx); });
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 13);
  tabBarButtons.push(btn);
  widgetAddChild(tabBarContainer, btn);

  activeTabIdx = idx;
  updateEditorTabs();
  displayFileContent(filePath);
}

function onActivityClick(idx: number): void {
  activeActivityIdx = idx;
  updateActivityBar();
  switchSidebarPanel(idx);
}

/** Switch sidebar content based on activity bar selection. */
function switchSidebarPanel(idx: number): void {
  if (!themeColors || !sidebarContainer) return;
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

function onFileClick(idx: number): void {
  selectedFileIdx = idx;
  updateFileTree();

  if (idx >= fileEntries.length) return;
  const entry = fileEntries[idx];
  if (!entry.isDir) {
    openFileInEditor(entry.path, entry.name);
    // Auto-hide explorer in compact mode
    if (compactShowingExplorer > 0) {
      hideExplorer();
    }
  }
}

function onTabClick(idx: number): void {
  activeTabIdx = idx;
  updateEditorTabs();
  if (idx < openTabs.length) {
    displayFileContent(openTabs[idx]);
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
    // Set icon tint to white/foreground color
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

  const title = Text('EXPLORER');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(sidebar, title);

  fileTreeButtons = [];

  if (fileEntries.length === 0) {
    // Show hint to open a folder
    const hint = Text('Open a folder to get started');
    textSetFontSize(hint, 12);
    setFg(hint, colors.sideBarForeground);
    widgetAddChild(sidebar, hint);
  } else {
    for (let i = 0; i < fileEntries.length; i++) {
      const file = fileEntries[i];
      const idx = i;
      const btn = Button(file.label, () => { onFileClick(idx); });
      buttonSetBordered(btn, 0);
      textSetFontSize(btn, 13);
      if (file.isDir) {
        buttonSetImage(btn, 'folder.fill');
        // Folder icon in warm yellow/gold
        setBtnTint(btn, '#E8AB53');
      } else {
        buttonSetImage(btn, 'doc.text');
        // File icon in sidebar foreground color
        setBtnTint(btn, colors.sideBarForeground);
      }
      fileTreeButtons.push(btn);
      widgetAddChild(sidebar, btn);
    }
    updateFileTree();
  }

  widgetAddChild(sidebar, Spacer());
  return sidebar;
}

// ---------------------------------------------------------------------------
// Editor area
// ---------------------------------------------------------------------------

function renderEditorArea(colors: ResolvedUIColors): unknown {
  tabBarButtons = [];
  openTabs = [];
  openTabNames = [];

  if (__platform__ !== 5) {
    // Native: open default file on startup
    const defaultFile = '/Users/amlug/projects/hone/hone-ide/src/app.ts';
    const defaultName = 'app.ts';
    openTabs.push(defaultFile);
    openTabNames.push(defaultName);

    const btn = Button(' app.ts ', () => { onTabClick(0); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 13);
    tabBarButtons.push(btn);
  }

  activeTabIdx = 0;
  updateEditorTabs();

  tabBarContainer = HStack(0, []);
  setBg(tabBarContainer, colors.tabInactiveBackground);
  for (let i = 0; i < tabBarButtons.length; i++) {
    widgetAddChild(tabBarContainer, tabBarButtons[i]);
  }
  widgetAddChild(tabBarContainer, Spacer());

  // Create the editor (simplified constructor — no object spread or ??)
  const ed = new Editor(800, 600);
  editorInstance = ed;
  editorReady = 1;

  // Get the native NSView and embed it in Perry's layout.
  const nsviewPtr = hone_editor_nsview(ed.nativeHandle as number);
  editorWidget = embedNSView(nsviewPtr);

  // Load default file content (native only — on web, no file open yet)
  if (__platform__ !== 5 && openTabs.length > 0) {
    displayFileContent(openTabs[0]);
  }

  // Editor widget must be in the initial VStack children array — Perry's
  // NSStackView layout doesn't properly size views added via widgetAddChild().
  // No Spacer() — the editor should fill remaining space (like the working
  // perry-app example: VStack(0, [toolbar, hed.widget, statusBar])).
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

  // Load default workspace (hone-ide project dir) if no folder open yet
  // On web (__platform__ === 5), skip — user opens a folder via File System Access API
  if (fileEntries.length === 0 && __platform__ !== 5) {
    loadFileTree('/Users/amlug/projects/hone/hone-ide');
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
