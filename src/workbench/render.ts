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
  buttonSetBordered, buttonSetTextColor, buttonSetTitle,
  widgetSetBackgroundColor, widgetAddChild, widgetClearChildren,
  widgetSetWidth, widgetSetHugging, widgetSetHidden, embedNSView,
} from 'perry/ui';
import { Editor } from '@honeide/editor/perry';
import { getActiveTheme, type ResolvedUIColors } from './theme/theme-loader';
import type { LayoutMode } from '../platform';
import { getWorkbenchSettings } from './settings';
import { readFileSync } from 'fs';

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

// Perry string + operator is broken — all paths and labels must be full string literals
const FILE_ENTRIES: FileEntry[] = [
  { name: 'src/', path: '/Users/amlug/projects/hone/hone-ide/src', depth: 0, isDir: true, label: '\u25B6 src/' },
  { name: 'app.ts', path: '/Users/amlug/projects/hone/hone-ide/src/app.ts', depth: 1, isDir: false, label: '    app.ts' },
  { name: 'platform.ts', path: '/Users/amlug/projects/hone/hone-ide/src/platform.ts', depth: 1, isDir: false, label: '    platform.ts' },
  { name: 'commands.ts', path: '/Users/amlug/projects/hone/hone-ide/src/commands.ts', depth: 1, isDir: false, label: '    commands.ts' },
  { name: 'keybindings.ts', path: '/Users/amlug/projects/hone/hone-ide/src/keybindings.ts', depth: 1, isDir: false, label: '    keybindings.ts' },
  { name: 'menu.ts', path: '/Users/amlug/projects/hone/hone-ide/src/menu.ts', depth: 1, isDir: false, label: '    menu.ts' },
  { name: 'window.ts', path: '/Users/amlug/projects/hone/hone-ide/src/window.ts', depth: 1, isDir: false, label: '    window.ts' },
  { name: 'workbench/', path: '/Users/amlug/projects/hone/hone-ide/src/workbench', depth: 1, isDir: true, label: '  \u25B6 workbench/' },
  { name: 'render.ts', path: '/Users/amlug/projects/hone/hone-ide/src/workbench/render.ts', depth: 2, isDir: false, label: '        render.ts' },
  { name: 'settings.ts', path: '/Users/amlug/projects/hone/hone-ide/src/workbench/settings.ts', depth: 2, isDir: false, label: '        settings.ts' },
  { name: 'layout/', path: '/Users/amlug/projects/hone/hone-ide/src/workbench/layout', depth: 2, isDir: true, label: '    \u25B6 layout/' },
  { name: 'grid.ts', path: '/Users/amlug/projects/hone/hone-ide/src/workbench/layout/grid.ts', depth: 3, isDir: false, label: '            grid.ts' },
  { name: 'tab-manager.ts', path: '/Users/amlug/projects/hone/hone-ide/src/workbench/layout/tab-manager.ts', depth: 3, isDir: false, label: '            tab-manager.ts' },
  { name: 'panel-registry.ts', path: '/Users/amlug/projects/hone/hone-ide/src/workbench/layout/panel-registry.ts', depth: 3, isDir: false, label: '            panel-registry.ts' },
  { name: 'theme/', path: '/Users/amlug/projects/hone/hone-ide/src/workbench/theme', depth: 2, isDir: true, label: '    \u25B6 theme/' },
  { name: 'theme-loader.ts', path: '/Users/amlug/projects/hone/hone-ide/src/workbench/theme/theme-loader.ts', depth: 3, isDir: false, label: '            theme-loader.ts' },
  { name: 'builtin-themes.ts', path: '/Users/amlug/projects/hone/hone-ide/src/workbench/theme/builtin-themes.ts', depth: 3, isDir: false, label: '            builtin-themes.ts' },
  { name: 'token-theme.ts', path: '/Users/amlug/projects/hone/hone-ide/src/workbench/theme/token-theme.ts', depth: 3, isDir: false, label: '            token-theme.ts' },
  { name: 'package.json', path: '/Users/amlug/projects/hone/hone-ide/package.json', depth: 0, isDir: false, label: '  package.json' },
  { name: 'tsconfig.json', path: '/Users/amlug/projects/hone/hone-ide/tsconfig.json', depth: 0, isDir: false, label: '  tsconfig.json' },
  { name: 'CLAUDE.md', path: '/Users/amlug/projects/hone/hone-ide/CLAUDE.md', depth: 0, isDir: false, label: '  CLAUDE.md' },
];

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
      setBtnFg(activityButtons[i], themeColors.activityBarForeground);
    } else {
      setBtnFg(activityButtons[i], themeColors.activityBarInactiveForeground);
    }
  }
}

function updateFileTree(): void {
  if (!themeColors) return;
  for (let i = 0; i < fileTreeButtons.length; i++) {
    if (i === selectedFileIdx && !FILE_ENTRIES[i].isDir) {
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

  // Create tab button
  const idx = openTabs.length - 1;
  // Perry string + is broken — use fileName directly (no padding spaces)
  const btn = Button(fileName, () => { onTabClick(idx); });
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 13);
  tabBarButtons.push(btn);

  // Add to tab bar
  widgetAddChild(tabBarContainer, btn);

  activeTabIdx = idx;
  updateEditorTabs();
  displayFileContent(filePath);
}

function onActivityClick(idx: number): void {
  activeActivityIdx = idx;
  updateActivityBar();
}

function onFileClick(idx: number): void {
  selectedFileIdx = idx;
  updateFileTree();

  // Open file in editor if it's not a directory
  const entry = FILE_ENTRIES[idx];
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

  for (let i = 0; i < PANELS.length; i++) {
    const idx = i;
    const btn = Button(PANELS[i].charAt(0), () => { onActivityClick(idx); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 18);
    activityButtons.push(btn);
  }

  updateActivityBar();

  const bar = VStackWithInsets(12, 12, 6, 12, 6);
  setBg(bar, colors.activityBarBackground);
  for (let i = 0; i < activityButtons.length; i++) {
    widgetAddChild(bar, activityButtons[i]);
  }
  widgetAddChild(bar, Spacer());

  const settings = Text('\u2699');
  textSetFontSize(settings, 16);
  setFg(settings, colors.activityBarInactiveForeground);
  widgetAddChild(bar, settings);

  return bar;
}

function renderActivityBarCompact(colors: ResolvedUIColors): unknown {
  const labels = ['Files', 'Editor', 'AI', 'Term'];
  activityButtons = [];

  for (let i = 0; i < labels.length; i++) {
    const idx = i;
    const btn = Button(labels[i], () => { onActivityClick(idx); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 12);
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
  const title = Text('EXPLORER');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);

  fileTreeButtons = [];

  for (let i = 0; i < FILE_ENTRIES.length; i++) {
    const file = FILE_ENTRIES[i];
    // Use pre-computed label — Perry string + and .repeat() are broken
    const idx = i;
    const btn = Button(file.label, () => { onFileClick(idx); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 13);
    fileTreeButtons.push(btn);
  }

  updateFileTree();

  const sidebar = VStackWithInsets(1, 8, 8, 8, 8);
  setBg(sidebar, colors.sideBarBackground);
  widgetAddChild(sidebar, title);
  for (let i = 0; i < fileTreeButtons.length; i++) {
    widgetAddChild(sidebar, fileTreeButtons[i]);
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

  // Start with app.ts open — use literal paths (Perry string + is broken)
  const defaultFile = '/Users/amlug/projects/hone/hone-ide/src/app.ts';
  const defaultName = 'app.ts';
  openTabs.push(defaultFile);
  openTabNames.push(defaultName);

  const btn = Button(' app.ts ', () => { onTabClick(0); });
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 13);
  tabBarButtons.push(btn);

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

  // Load default file content
  displayFileContent(defaultFile);

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
  const filesBtn = Button('F', () => { onBottomBarFiles(); });
  const editorBtn = Button('E', () => { onBottomBarEditor(); });
  const aiBtn = Button('A', () => { onBottomBarAI(); });
  const termBtn = Button('T', () => { onBottomBarTerm(); });
  const settingsBtn = Button('S', () => { onBottomBarSettings(); });

  const allBtns = [filesBtn, editorBtn, aiBtn, termBtn, settingsBtn];
  for (let i = 0; i < allBtns.length; i++) {
    buttonSetBordered(allBtns[i], 0);
    textSetFontSize(allBtns[i], 20);
    setBtnFg(allBtns[i], colors.activityBarForeground);
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

    const mainRow = HStack(0, [sidebar, sidebarBorder, editorArea]);
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

  // Sidebar location: left (default) or right
  const mainRow = sidebarLocation === 'right'
    ? HStack(0, [activityBar, editorArea, sidebarBorder, sidebar])
    : HStack(0, [activityBar, sidebar, sidebarBorder, editorArea]);

  const shell = VStack(0, [mainRow, statusBar]);
  setBg(shell, themeColors.editorBackground);
  return shell;
}
