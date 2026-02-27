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
  textSetColor, textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetTextColor, buttonSetTitle,
  widgetSetBackgroundColor, widgetAddChild,
  widgetSetWidth, widgetSetHugging,
} from 'perry/ui';
import { getActiveTheme, type ResolvedUIColors } from './theme/theme-loader';
import type { LayoutMode } from '../platform';
import { getWorkbenchSettings } from './settings';

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
// Data
// ---------------------------------------------------------------------------

const PANELS = ['Files', 'Search', 'Git', 'Debug', 'Ext'];

const FILES = [
  { name: 'src/', depth: 0, isDir: true },
  { name: 'app.ts', depth: 1, isDir: false },
  { name: 'platform.ts', depth: 1, isDir: false },
  { name: 'commands.ts', depth: 1, isDir: false },
  { name: 'keybindings.ts', depth: 1, isDir: false },
  { name: 'workbench/', depth: 1, isDir: true },
  { name: 'render.ts', depth: 2, isDir: false },
  { name: 'package.json', depth: 0, isDir: false },
  { name: 'tsconfig.json', depth: 0, isDir: false },
];

const TABS = ['app.ts', 'platform.ts', 'render.ts'];

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
    if (i === selectedFileIdx && !FILES[i].isDir) {
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

function onActivityClick(idx: number): void {
  activeActivityIdx = idx;
  updateActivityBar();
}

function onFileClick(idx: number): void {
  selectedFileIdx = idx;
  updateFileTree();
}

function onTabClick(idx: number): void {
  activeTabIdx = idx;
  updateEditorTabs();
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

  for (let i = 0; i < FILES.length; i++) {
    const file = FILES[i];
    const indent = '  '.repeat(file.depth);
    const prefix = file.isDir ? '\u25B6 ' : '  ';
    const label = indent + prefix + file.name;

    const idx = i;
    const btn = Button(label, () => { onFileClick(idx); });
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

  for (let i = 0; i < TABS.length; i++) {
    const idx = i;
    const btn = Button(' ' + TABS[i] + ' ', () => { onTabClick(idx); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 13);
    tabBarButtons.push(btn);
  }

  updateEditorTabs();

  const tabBar = HStack(0, []);
  setBg(tabBar, colors.tabInactiveBackground);
  for (let i = 0; i < tabBarButtons.length; i++) {
    widgetAddChild(tabBar, tabBarButtons[i]);
  }
  widgetAddChild(tabBar, Spacer());

  // Line numbers
  const lineNumbers = VStack(2, []);
  for (let i = 1; i <= 15; i++) {
    const ln = Text(`${i}`);
    textSetFontSize(ln, 13);
    setFg(ln, colors.editorLineNumberForeground);
    widgetAddChild(lineNumbers, ln);
  }

  // Code content
  const codeLines = [
    'import { App } from "perry/ui";',
    '',
    'const count = State(0);',
    '',
    'export function main() {',
    '  console.log("Hello Hone!");',
    '}',
    '',
    '// AI-native code editor',
    '// for all platforms',
    '',
    'function init() {',
    '  loadThemes();',
    '  registerCommands();',
    '  createWindow();',
    '}',
  ];

  const codeContent = VStack(2, []);
  for (const line of codeLines) {
    const t = Text(line || ' ');
    textSetFontSize(t, 13);
    setFg(t, colors.editorForeground);
    widgetAddChild(codeContent, t);
  }

  const editorBody = HStackWithInsets(8, 4, 8, 4, 8);
  setBg(editorBody, colors.editorBackground);
  widgetAddChild(editorBody, lineNumbers);
  widgetAddChild(editorBody, codeContent);

  const editor = VStack(0, [tabBar, editorBody, Spacer()]);
  setBg(editor, colors.editorBackground);

  return editor;
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
    const editor = renderEditorArea(themeColors);
    const bottomBar = renderActivityBarCompact(themeColors);
    const statusBar = renderStatusBar(themeColors);
    const shell = VStack(0, [editor, statusBar, bottomBar]);
    setBg(shell, themeColors.editorBackground);
    return shell;
  }

  const settings = getWorkbenchSettings();
  const sidebarLocation = settings.sidebarLocation;

  const activityBar = renderActivityBarDesktop(themeColors);
  const sidebar = renderSidebar(themeColors);
  const editor = renderEditorArea(themeColors);
  const statusBar = renderStatusBar(themeColors);

  // Constrain panel widths so editor fills remaining space
  widgetSetWidth(activityBar, 48);
  widgetSetHugging(activityBar, 750);
  widgetSetWidth(sidebar, 220);
  widgetSetHugging(sidebar, 750);
  widgetSetHugging(editor, 1);

  // 1px vertical divider between sidebar and editor
  const sidebarBorder = VStack(0, []);
  setBg(sidebarBorder, themeColors.panelBorder);
  widgetSetWidth(sidebarBorder, 1);
  widgetSetHugging(sidebarBorder, 1000);

  // Sidebar location: left (default) or right
  const mainRow = sidebarLocation === 'right'
    ? HStack(0, [activityBar, editor, sidebarBorder, sidebar])
    : HStack(0, [activityBar, sidebar, sidebarBorder, editor]);

  const shell = VStack(0, [mainRow, statusBar]);
  setBg(shell, themeColors.editorBackground);
  return shell;
}
