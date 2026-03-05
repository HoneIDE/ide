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
  TextField, ScrollView, scrollViewSetChild,
  textfieldSetString, textfieldFocus,
  textSetColor, textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString,
  buttonSetBordered, buttonSetTextColor, buttonSetTitle, buttonSetImage,
  buttonSetImagePosition, buttonSetContentTintColor,
  widgetSetBackgroundColor, widgetAddChild, widgetAddChildAt, widgetClearChildren,
  widgetSetWidth, widgetSetHeight, widgetSetHugging, widgetSetHidden, widgetRemoveChild,
  widgetSetContextMenu, menuCreate, menuAddItem,
  embedNSView,
  openFolderDialog, openFileDialog,
} from 'perry/ui';
import { Editor } from '@honeide/editor/perry';
import { getActiveTheme, type ResolvedUIColors } from './theme/theme-loader';
import type { LayoutMode } from '../platform';
import { getWorkbenchSettings } from './settings';
import { readFileSync, readdirSync, isDirectory, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Extracted modules
import { hexToRGBA, setBg, setFg, setBtnFg, setBtnTint, pathId, getFileName, strEq, toLowerCode, detectLanguage, isTextFile } from './ui-helpers';
import {
  renderSearchPanel as renderSearchPanelImpl,
  setSearchWorkspaceRoot, setSearchFileOpener, setSearchEditorReloader,
  setSearchCurrentEditorPath, resetSearchPanelReady,
} from './views/search/search-panel';
import {
  renderGitPanel as renderGitPanelImpl,
  setGitWorkspaceRoot, setGitFileOpener, setGitStatusBarUpdater,
  resetGitPanelReady, refreshGitState, updateStatusBarBranch,
} from './views/git/git-panel';
import { renderDebugPanel } from './views/debug/debug-panel';
import { renderExtensionsPanel } from './views/extensions/extensions-panel';
import { renderChatPanel } from './views/ai-chat/chat-panel';
import { renderTerminalPanel, setTerminalCwd } from './views/terminal/terminal-panel';
import { renderSettingsPanel } from './views/settings-ui/settings-panel';
import { setWelcomeActions, createWelcomeContent } from './views/welcome/welcome-tab';
import { initNotifications, showNotification } from './views/notifications/notifications';
import { renderPRReviewPanel } from './views/pr-review/pr-review-panel';
import { setLspWorkspaceRoot, initLspBridge, triggerDiagnostics, getCompletions, setDiagnosticsStatusUpdater } from './views/lsp/lsp-bridge';
import { setDiagnosticsFileOpener } from './views/lsp/diagnostics-panel';
import { createAutocompletePopup, setAutocompleteAcceptHandler } from './views/lsp/autocomplete-popup';

// Compile-time platform ID injected by Perry codegen:
// 0 = macOS, 1 = iOS, 2 = Android, 3 = Windows, 4 = Linux, 5 = Web
declare const __platform__: number;

// FFI function from @honeide/editor — returns raw NSView* for an EditorView
declare function hone_editor_nsview(handle: number): number;

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

// Expanded directory tracking — individual module-level variables (no arrays).
let exp0 = -1;
let exp1 = -1;
let exp2 = -1;
let exp3 = -1;
let exp4 = -1;
let exp5 = -1;
let exp6 = -1;
let exp7 = -1;
let exp8 = -1;
let exp9 = -1;
let exp10 = -1;
let exp11 = -1;
let exp12 = -1;
let exp13 = -1;
let exp14 = -1;
let exp15 = -1;

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
  if (exp8 === id) return true;
  if (exp9 === id) return true;
  if (exp10 === id) return true;
  if (exp11 === id) return true;
  if (exp12 === id) return true;
  if (exp13 === id) return true;
  if (exp14 === id) return true;
  if (exp15 === id) return true;
  return false;
}

let fileEntryCount = 0;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

let openTabs: string[] = [];
let openTabNames: string[] = [];
let openTabCount: number = 0;

// ---------------------------------------------------------------------------
// Module-level widget refs
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
let tabBarReady: number = 0;

let editorInstance: Editor = null as any;
let editorReady: number = 0;
let editorWidget: unknown = null;
let currentEditorFilePath = '';

// Sidebar toggling (full/split layouts)
let sidebarWidget: unknown = null;
let sidebarBorderWidget: unknown = null;
let sidebarVisible: number = 1;
let sidebarToggleReady: number = 0;

// Compact layout panel toggling
let compactEditorPane: unknown = null;
let compactExplorerPane: unknown = null;
let compactShowingExplorer: number = 0;

// Status bar
let statusBarBranchLabel: unknown = null;

// Breadcrumb bar
let breadcrumbContainer: unknown = null;
let breadcrumbReady: number = 0;

// Right panel (AI Chat — Cursor-style)
let rightPanelWidget: unknown = null;
let rightPanelBorder: unknown = null;
let rightPanelContainer: unknown = null;
let rightPanelVisible: number = 0;
let rightPanelRendered: number = 0;
let mainRowWidget: unknown = null;

// Notification overlay
let notifOverlay: unknown = null;

// Terminal bottom panel
let terminalArea: unknown = null;
let terminalVisible: number = 0;

// Status bar diagnostics label
let statusBarDiagLabel: unknown = null;

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
    if (i === selectedFileIdx) {
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
      setBg(tabBarButtons[i], themeColors.tabActiveBackground);
    } else {
      setBg(tabBarButtons[i], themeColors.tabInactiveBackground);
    }
  }
}

function updateBreadcrumb(): void {
  if (breadcrumbReady < 1 || !breadcrumbContainer) return;
  widgetClearChildren(breadcrumbContainer);
  if (currentEditorFilePath.length < 1) return;
  // Show path segments as breadcrumb
  let lastSlash = -1;
  let secondLastSlash = -1;
  for (let i = 0; i < currentEditorFilePath.length; i++) {
    if (currentEditorFilePath.charCodeAt(i) === 47) {
      secondLastSlash = lastSlash;
      lastSlash = i;
    }
  }
  let dirName = '';
  if (secondLastSlash >= 0 && lastSlash > secondLastSlash) {
    dirName = currentEditorFilePath.slice(secondLastSlash + 1, lastSlash);
  }
  let fileName = currentEditorFilePath.slice(lastSlash + 1);

  if (dirName.length > 0) {
    const dirText = Text(dirName);
    textSetFontSize(dirText, 11);
    if (themeColors) setFg(dirText, themeColors.editorForeground);
    widgetAddChild(breadcrumbContainer, dirText);
    const sep = Text(' > ');
    textSetFontSize(sep, 11);
    if (themeColors) setFg(sep, themeColors.editorForeground);
    widgetAddChild(breadcrumbContainer, sep);
  }
  const fileText = Text(fileName);
  textSetFontSize(fileText, 11);
  if (themeColors) setFg(fileText, themeColors.editorForeground);
  widgetAddChild(breadcrumbContainer, fileText);
  widgetAddChild(breadcrumbContainer, Spacer());
}

export function toggleTerminalAction(): void {
  if (!terminalArea) return;
  if (terminalVisible > 0) {
    terminalVisible = 0;
    widgetSetHidden(terminalArea, 1);
  } else {
    terminalVisible = 1;
    widgetSetHidden(terminalArea, 0);
  }
}

function refreshSidebar(): void {
  if (sidebarReady < 1) return;
  widgetClearChildren(sidebarContainer);
  fileTreeButtons = [];
  selectedFileIdx = -1;
  fileEntries = [];
  fileEntryCount = 0;

  if (workspaceRoot.length < 1) {
    const hint = Text('Open a folder to start');
    textSetFontSize(hint, 12);
    if (themeColors) setFg(hint, themeColors.sideBarForeground);
    widgetAddChild(sidebarContainer, hint);
    const openBtn = Button('Open Folder', () => { openFolderAction(); });
    buttonSetBordered(openBtn, 0);
    textSetFontSize(openBtn, 13);
    if (themeColors) setBtnFg(openBtn, themeColors.sideBarForeground);
    widgetAddChild(sidebarContainer, openBtn);
    widgetAddChild(sidebarContainer, Spacer());
    return;
  }

  // Header
  const header = Text('EXPLORER');
  textSetFontSize(header, 11);
  textSetFontWeight(header, 11, 0.7);
  if (themeColors) setFg(header, themeColors.sideBarForeground);
  widgetAddChild(sidebarContainer, header);

  // Render file tree inline using renderTreeLevel
  renderTreeLevel(workspaceRoot, 0);

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

  // Render directories first
  for (let i = 0; i < dirCount; i++) {
    const name = dirNames[i];
    const full = join(dirPath, name);
    const expanded = isDirExpanded(full);
    const id = pathId(full);
    let icon = 'folder.fill';
    if (expanded) icon = 'folder';

    const btn = Button(name, () => { onDirToggle(id); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 12);
    buttonSetImage(btn, icon);
    if (themeColors) {
      setBtnFg(btn, themeColors.sideBarForeground);
      setBtnTint(btn, '#E8AB53');
    }

    if (depth > 0) {
      const wrapper = HStack(0, []);
      const indent = Text('');
      widgetSetWidth(indent, depth * 16);
      widgetAddChild(wrapper, indent);
      widgetAddChild(wrapper, btn);
      widgetAddChild(sidebarContainer, wrapper);
    } else {
      widgetAddChild(sidebarContainer, btn);
    }

    if (expanded) {
      renderTreeLevel(full, depth + 1);
    }
  }

  // Render files
  for (let i = 0; i < fileCount; i++) {
    const name = fileNames[i];
    const full = join(dirPath, name);
    const idx = fileEntryCount;
    fileEntries[idx] = { name: name, path: full, depth: depth, isDir: false, label: name };
    fileEntryCount = fileEntryCount + 1;

    const btn = Button(name, () => { onFileClick(idx); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 12);
    buttonSetImage(btn, 'doc');
    if (themeColors) {
      setBtnFg(btn, themeColors.sideBarForeground);
      setBtnTint(btn, themeColors.sideBarForeground);
    }
    fileTreeButtons.push(btn);

    if (depth > 0) {
      const wrapper = HStack(0, []);
      const indent = Text('');
      widgetSetWidth(indent, depth * 16);
      widgetAddChild(wrapper, indent);
      widgetAddChild(wrapper, btn);
      widgetAddChild(sidebarContainer, wrapper);
    } else {
      widgetAddChild(sidebarContainer, btn);
    }
  }
}

function onFolderOpened(folderPath: string): void {
  workspaceRoot = folderPath;
  setSearchWorkspaceRoot(folderPath);
  setGitWorkspaceRoot(folderPath);
  setTerminalCwd(folderPath);
  setLspWorkspaceRoot(folderPath);
  initLspBridge();
  refreshSidebar();
}

export function openFolderAction(): void {
  openFolderDialog((path: string) => { onFolderOpenedCb(path); });
}

function onFolderOpenedCb(path: string): void {
  if (path.length < 1) return;
  onFolderOpened(path);
}

export function toggleSidebarAction(): void {
  if (sidebarToggleReady < 1) return;
  if (sidebarVisible > 0) {
    sidebarVisible = 0;
    widgetSetHidden(sidebarWidget, 1);
    widgetSetHidden(sidebarBorderWidget, 1);
  } else {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    widgetSetHidden(sidebarBorderWidget, 0);
  }
}

function toggleRightPanel(): void {
  if (rightPanelVisible > 0) {
    rightPanelVisible = 0;
    widgetSetHidden(rightPanelWidget, 1);
    widgetSetHidden(rightPanelBorder, 1);
  } else {
    rightPanelVisible = 1;
    widgetSetHidden(rightPanelWidget, 0);
    widgetSetHidden(rightPanelBorder, 0);
    // Render chat panel on first open
    if (rightPanelRendered < 1) {
      rightPanelRendered = 1;
      renderChatPanel(rightPanelContainer, themeColors as ResolvedUIColors);
    }
  }
}

export function closeEditorAction(): void {
  if (openTabCount < 1) return;
  onTabClose(activeTabIdx);
}

export function saveFileAction(): void {
  if (currentEditorFilePath.length < 1) return;
  if (editorReady < 1) return;
  const content = editorInstance.getContent();
  writeFileSync(currentEditorFilePath, content);
  triggerDiagnostics();
}

function rebuildTabBar(): void {
  if (tabBarReady < 1) return;
  rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);
}

function rebuildTabBarDirect(count: number, names: string[], paths: string[], container: unknown): void {
  widgetClearChildren(container);
  tabBarButtons = [];
  for (let i = 0; i < count; i++) {
    const idx = i;
    const path = paths[i];
    const name = names[i];
    const tabGroup = HStackWithInsets(4, 0, 10, 0, 6);
    const tabBtn = Button(name, () => { onTabClickDirect(idx, path); });
    buttonSetBordered(tabBtn, 0);
    textSetFontSize(tabBtn, 13);
    const closeBtn = Button('', () => { onTabClose(idx); });
    buttonSetBordered(closeBtn, 0);
    buttonSetImage(closeBtn, 'xmark');
    buttonSetImagePosition(closeBtn, 1);
    textSetFontSize(closeBtn, 9);
    widgetAddChild(tabGroup, tabBtn);
    widgetAddChild(tabGroup, closeBtn);
    if (themeColors) {
      if (i === activeTabIdx) {
        setBtnFg(tabBtn, themeColors.tabActiveForeground);
        setBg(tabGroup, themeColors.tabActiveBackground);
      } else {
        setBtnFg(tabBtn, themeColors.tabActiveForeground);
        setBg(tabGroup, themeColors.tabInactiveBackground);
      }
      setBtnFg(closeBtn, themeColors.tabActiveForeground);
    }
    const tabMenu = menuCreate();
    menuAddItem(tabMenu, 'Close', () => { onTabClose(idx); });
    menuAddItem(tabMenu, 'Close Others', () => { closeOtherTabs(idx); });
    menuAddItem(tabMenu, 'Close All', () => { closeAllTabs(); });
    widgetSetContextMenu(tabGroup, tabMenu);
    widgetAddChild(container, tabGroup);
    tabBarButtons.push(tabGroup);
  }
}

function applyTabColors(count: number): void {
  if (!themeColors) return;
  for (let i = 0; i < count; i++) {
    if (i === activeTabIdx) {
      setBg(tabBarButtons[i], themeColors.tabActiveBackground);
    } else {
      setBg(tabBarButtons[i], themeColors.tabInactiveBackground);
    }
  }
}

export function openFileAction(): void {
  openFileDialog((path: string) => { onFileOpenedCb2(path); });
}

function onFileOpenedCb2(filePath: string): void {
  if (filePath.length < 1) return;
  const name = getFileName(filePath);
  openFileInEditor(filePath, name);
}

function displayFileContent(filePath: string): void {
  currentEditorFilePath = filePath;
  updateBreadcrumb();
  if (editorReady < 1) return;
  const content = readFileSync(filePath);
  editorInstance.setContent(content);
  editorInstance.render();
}

function openFileInEditor(filePath: string, fileName: string): void {
  // Check if file is already open — switch to that tab
  for (let i = 0; i < openTabCount; i++) {
    if (openTabs[i].length === filePath.length && openTabs[i] === filePath) {
      activeTabIdx = i;
      currentEditorFilePath = filePath;
      updateBreadcrumb();
      if (tabBarReady > 0) {
        applyTabColors(openTabCount);
      }
      if (editorReady > 0) {
        const content = readFileSync(filePath);
        editorInstance.setContent(content);
        editorInstance.render();
      }
      return;
    }
  }

  // Extract display name
  let lastSlash = -1;
  for (let i = 0; i < filePath.length; i++) {
    if (filePath.charCodeAt(i) === 47) lastSlash = i;
  }
  let displayName = filePath;
  if (lastSlash >= 0) {
    displayName = filePath.slice(lastSlash + 1);
  }

  // Add to tracking arrays
  openTabs[openTabCount] = filePath;
  openTabNames[openTabCount] = displayName;
  openTabCount = openTabCount + 1;
  activeTabIdx = openTabCount - 1;
  currentEditorFilePath = filePath;
  updateBreadcrumb();

  // Rebuild tab bar from arrays (keeps widgets and arrays in sync)
  if (tabBarReady > 0) {
    rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);
  }

  if (editorReady > 0) {
    const content = readFileSync(filePath);
    editorInstance.setContent(content);
    editorInstance.render();
  }
}

function closeAllTabs(): void {
  openTabs = [];
  openTabNames = [];
  openTabCount = 0;
  activeTabIdx = 0;
  currentEditorFilePath = '';
  updateBreadcrumb();
  if (tabBarReady > 0) {
    widgetClearChildren(tabBarContainer);
  }
}

function closeOtherTabs(keepIdx: number): void {
  if (keepIdx < 0 || keepIdx >= openTabCount) return;
  const keptPath = openTabs[keepIdx];
  const keptName = openTabNames[keepIdx];
  openTabs = [keptPath];
  openTabNames = [keptName];
  openTabCount = 1;
  activeTabIdx = 0;
  currentEditorFilePath = keptPath;
  updateBreadcrumb();
  if (tabBarReady > 0) {
    rebuildTabBarDirect(1, openTabNames, openTabs, tabBarContainer);
  }
  if (editorReady > 0) {
    const content = readFileSync(keptPath);
    editorInstance.setContent(content);
    editorInstance.render();
  }
}

// ---------------------------------------------------------------------------
// Callbacks for extracted panels
// ---------------------------------------------------------------------------

/** Called by search panel when a file is opened from results. */
function openFileFromSearchPanel(path: string, name: string): void {
  openFileInEditor(path, name);
}

/** Called by search panel to reload editor after replace. */
function reloadEditorContent(path: string, content: string): void {
  if (editorReady > 0) {
    editorInstance.setContent(content);
    editorInstance.render();
  }
}

/** Called by search panel to get current editor path. */
function getCurrentEditorPath(): string {
  return currentEditorFilePath;
}

/** Called by git panel when a file is clicked. */
function openFileFromGitPanel(path: string, name: string): void {
  openFileInEditor(path, name);
}

/** Called by git panel to update status bar branch. */
function updateStatusBarBranchLabel(branch: string): void {
  if (statusBarBranchLabel) {
    textSetString(statusBarBranchLabel, branch);
  }
}

function updateStatusBarDiagnostics(errors: number, warnings: number): void {
  if (statusBarDiagLabel) {
    if (errors > 0 || warnings > 0) {
      textSetString(statusBarDiagLabel, errors + ' errors, ' + warnings + ' warnings');
    } else {
      textSetString(statusBarDiagLabel, '');
    }
  }
}

/** Called by autocomplete popup when a completion is accepted. */
function onAutocompleteAccept(text: string): void {
  // Editor text insertion is handled via the native event system (ts_mode)
  // Autocomplete accept will be wired when the editor exposes insertText API
}

// ---------------------------------------------------------------------------
// Activity bar / sidebar panel switching
// ---------------------------------------------------------------------------

function onActivityClick(idx: number): void {
  // AI Chat (idx=5) toggles the right panel instead of the sidebar
  if (idx === 5) {
    toggleRightPanel();
    return;
  }
  activeActivityIdx = idx;
  updateActivityBar();
  switchSidebarPanel(idx);
}

function switchSidebarPanel(idx: number): void {
  if (sidebarReady < 1) return;
  if (idx === 0) {
    resetSearchPanelReady();
    refreshSidebar();
    return;
  }
  widgetClearChildren(sidebarContainer);
  fileTreeButtons = [];
  selectedFileIdx = -1;
  resetSearchPanelReady();

  if (idx === 1) {
    resetGitPanelReady();
    renderSearchPanelImpl(sidebarContainer, themeColors as ResolvedUIColors);
    return;
  }

  if (idx === 2) {
    resetGitPanelReady();
    renderGitPanelImpl(sidebarContainer, themeColors as ResolvedUIColors);
    return;
  }

  if (idx === 3) {
    renderDebugPanel(sidebarContainer, themeColors as ResolvedUIColors);
    return;
  }

  if (idx === 4) {
    renderExtensionsPanel(sidebarContainer, themeColors as ResolvedUIColors);
    return;
  }

  // idx===5 (AI Chat) handled by toggleRightPanel, not here

  if (idx === 6) {
    renderSettingsPanel(sidebarContainer, themeColors as ResolvedUIColors);
    return;
  }
}

// ---------------------------------------------------------------------------
// Directory expansion
// ---------------------------------------------------------------------------

function onDirToggle(id: number): void {
  toggleExpById(id);
  refreshSidebar();
}

function toggleExpById(id: number): void {
  if (exp0 === id) { exp0 = -1; return; }
  if (exp1 === id) { exp1 = -1; return; }
  if (exp2 === id) { exp2 = -1; return; }
  if (exp3 === id) { exp3 = -1; return; }
  if (exp4 === id) { exp4 = -1; return; }
  if (exp5 === id) { exp5 = -1; return; }
  if (exp6 === id) { exp6 = -1; return; }
  if (exp7 === id) { exp7 = -1; return; }
  if (exp8 === id) { exp8 = -1; return; }
  if (exp9 === id) { exp9 = -1; return; }
  if (exp10 === id) { exp10 = -1; return; }
  if (exp11 === id) { exp11 = -1; return; }
  if (exp12 === id) { exp12 = -1; return; }
  if (exp13 === id) { exp13 = -1; return; }
  if (exp14 === id) { exp14 = -1; return; }
  if (exp15 === id) { exp15 = -1; return; }
  if (exp0 === -1) { exp0 = id; return; }
  if (exp1 === -1) { exp1 = id; return; }
  if (exp2 === -1) { exp2 = id; return; }
  if (exp3 === -1) { exp3 = id; return; }
  if (exp4 === -1) { exp4 = id; return; }
  if (exp5 === -1) { exp5 = id; return; }
  if (exp6 === -1) { exp6 = id; return; }
  if (exp7 === -1) { exp7 = id; return; }
  if (exp8 === -1) { exp8 = id; return; }
  if (exp9 === -1) { exp9 = id; return; }
  if (exp10 === -1) { exp10 = id; return; }
  if (exp11 === -1) { exp11 = id; return; }
  if (exp12 === -1) { exp12 = id; return; }
  if (exp13 === -1) { exp13 = id; return; }
  if (exp14 === -1) { exp14 = id; return; }
  if (exp15 === -1) { exp15 = id; return; }
}

function onFileClick(idx: number): void {
  if (idx >= fileEntryCount) return;
  const entry = fileEntries[idx];
  openFileInEditor(entry.path, entry.label);
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

function onTabClickDirect(idx: number, path: string): void {
  currentEditorFilePath = path;
  activeTabIdx = idx;
  updateBreadcrumb();
  if (tabBarButtons.length > 0) {
    applyTabColors(tabBarButtons.length);
  }
  if (editorReady > 0) {
    const content = readFileSync(path);
    editorInstance.setContent(content);
    editorInstance.render();
  }
}

function onTabClose(idx: number): void {
  if (openTabCount < 2) return;
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

  if (activeTabIdx === idx) {
    // Closing the active tab — switch to prev or stay at same position
    if (activeTabIdx >= newCount) activeTabIdx = newCount - 1;
  } else if (activeTabIdx > idx) {
    // Closing a tab before the active one — shift index down
    activeTabIdx = activeTabIdx - 1;
  }

  if (tabBarReady > 0) {
    rebuildTabBarDirect(newCount, newNames, newTabs, tabBarContainer);
  }
  if (editorReady > 0 && activeTabIdx >= 0) {
    currentEditorFilePath = newTabs[activeTabIdx];
    updateBreadcrumb();
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

  const icons = ['doc.on.doc', 'magnifyingglass', 'arrow.triangle.branch', 'ladybug', 'puzzlepiece.extension', 'sparkles'];

  for (let i = 0; i < 6; i++) {
    const idx = i;
    const btn = Button('', () => { onActivityClick(idx); });
    buttonSetBordered(btn, 0);
    buttonSetImage(btn, icons[i]);
    buttonSetImagePosition(btn, 1);
    setBtnTint(btn, colors.activityBarForeground);
    activityButtons.push(btn);
  }

  updateActivityBar();

  const bar = VStackWithInsets(20, 12, 6, 12, 6);
  setBg(bar, colors.activityBarBackground);
  for (let i = 0; i < activityButtons.length; i++) {
    widgetAddChild(bar, activityButtons[i]);
  }
  widgetAddChild(bar, Spacer());

  // Settings gear icon → Settings panel (idx 6)
  const settingsBtn = Button('', () => { onActivityClick(6); });
  buttonSetBordered(settingsBtn, 0);
  buttonSetImage(settingsBtn, 'gearshape');
  buttonSetImagePosition(settingsBtn, 1);
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
    buttonSetImagePosition(btn, 1);
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
  const inner = VStackWithInsets(1, 8, 8, 8, 8);
  setBg(inner, colors.sideBarBackground);
  sidebarContainer = inner;
  sidebarReady = 1;

  refreshSidebar();

  const scroll = ScrollView();
  scrollViewSetChild(scroll, inner);

  return scroll;
}

// ---------------------------------------------------------------------------
// Editor area
// ---------------------------------------------------------------------------

function renderEditorArea(colors: ResolvedUIColors): unknown {
  tabBarButtons = [];

  const defaultFile = workspaceRoot + '/src/app.ts';
  const defaultName = 'app.ts';
  openTabs = [defaultFile];
  openTabNames = [defaultName];
  openTabCount = 1;
  activeTabIdx = 0;

  const tbc = HStack(0, []);
  tabBarContainer = tbc;
  tabBarReady = 1;
  setBg(tabBarContainer, colors.tabInactiveBackground);
  rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);

  const ed = new Editor(800, 600);
  editorInstance = ed;
  editorReady = 1;

  const nsviewPtr = hone_editor_nsview(ed.nativeHandle as number);
  editorWidget = embedNSView(nsviewPtr);

  displayFileContent(openTabs[0]);

  // Breadcrumb bar
  breadcrumbContainer = HStackWithInsets(4, 4, 8, 4, 8);
  setBg(breadcrumbContainer, colors.editorBackground);
  breadcrumbReady = 1;
  updateBreadcrumb();

  const editorPane = VStack(0, [tabBarContainer, breadcrumbContainer, editorWidget]);
  setBg(editorPane, colors.editorBackground);

  return editorPane;
}

// ---------------------------------------------------------------------------
// Compact layout — panel toggling
// ---------------------------------------------------------------------------

function showExplorer(): void {
  compactShowingExplorer = 1;
  widgetSetHidden(compactEditorPane, 1);
  widgetSetHidden(compactExplorerPane, 0);
}

function hideExplorer(): void {
  compactShowingExplorer = 0;
  widgetSetHidden(compactEditorPane, 0);
  widgetSetHidden(compactExplorerPane, 1);
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

function onBottomBarAI(): void {}

function onBottomBarTerm(): void {}

function onBottomBarSettings(): void {}

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
  statusBarBranchLabel = branch;

  const diagLabel = Text('');
  textSetFontSize(diagLabel, 12);
  setFg(diagLabel, colors.statusBarForeground);
  statusBarDiagLabel = diagLabel;

  const lang = Text('TypeScript ');
  textSetFontSize(lang, 12);
  setFg(lang, colors.statusBarForeground);

  const bar = HStack(8, [branch, Spacer(), diagLabel, lang]);
  setBg(bar, colors.statusBarBackground);

  // Initialize git state for status bar
  refreshGitState();
  updateStatusBarBranch();

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

  // Set default workspace root to cwd if not already set
  if (workspaceRoot.length < 1) {
    try {
      workspaceRoot = execSync('pwd', { encoding: 'utf-8', timeout: 2000 }).trim();
    } catch (e: any) {
      workspaceRoot = '';
    }
  }

  // Wire up extracted panel callbacks
  setSearchWorkspaceRoot(workspaceRoot);
  setSearchFileOpener(openFileFromSearchPanel);
  setSearchEditorReloader(reloadEditorContent);
  setSearchCurrentEditorPath(getCurrentEditorPath);
  setGitWorkspaceRoot(workspaceRoot);
  setGitFileOpener(openFileFromGitPanel);
  setGitStatusBarUpdater(updateStatusBarBranchLabel);
  setTerminalCwd(workspaceRoot);

  // Wire welcome tab actions
  setWelcomeActions(openFolderAction, openFileAction, openFileAction);

  // Wire LSP bridge
  setLspWorkspaceRoot(workspaceRoot);
  initLspBridge();
  setDiagnosticsFileOpener(openFileFromSearchPanel);
  setAutocompleteAcceptHandler(onAutocompleteAccept);
  setDiagnosticsStatusUpdater(updateStatusBarDiagnostics);

  if (layoutMode === 'compact') {
    const editorArea = renderEditorArea(themeColors);
    const explorerPanel = renderSidebar(themeColors);
    const bottomBar = renderBottomToolbar(themeColors);
    const statusBar = renderStatusBar(themeColors);

    compactEditorPane = editorArea;
    compactExplorerPane = explorerPanel;

    widgetSetHidden(explorerPanel, 1);

    const contentArea = VStack(0, [editorArea, explorerPanel]);
    widgetSetHugging(contentArea, 1);

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

  widgetSetWidth(activityBar, 48);
  widgetSetHugging(activityBar, 750);
  widgetSetWidth(sidebar, 220);
  widgetSetHugging(sidebar, 750);
  widgetSetHugging(editorArea, 1);

  const sidebarBorder = VStack(0, []);
  setBg(sidebarBorder, themeColors.panelBorder);
  widgetSetWidth(sidebarBorder, 1);
  widgetSetHugging(sidebarBorder, 1000);

  sidebarWidget = sidebar;
  sidebarBorderWidget = sidebarBorder;
  sidebarToggleReady = 1;

  // Perry string === can be unreliable — use charCodeAt
  const isRight = sidebarLocation.length > 0 && sidebarLocation.charCodeAt(0) === 114; // 'r'

  const mainRow = isRight
    ? HStack(0, [activityBar, editorArea, sidebarBorder, sidebar])
    : HStack(0, [activityBar, sidebar, sidebarBorder, editorArea]);
  mainRowWidget = mainRow;

  widgetSetHugging(mainRow, 1);
  widgetSetHugging(statusBar, 750);

  // Terminal bottom panel (hidden by default, toggle via Cmd+J)
  const termPanel = VStackWithInsets(0, 4, 0, 0, 0);
  setBg(termPanel, themeColors.editorBackground);
  widgetSetHeight(termPanel, 200);
  widgetSetHugging(termPanel, 750);
  renderTerminalPanel(termPanel, themeColors);
  widgetSetHidden(termPanel, 1);
  terminalArea = termPanel;

  // Terminal border
  const termBorder = VStack(0, []);
  setBg(termBorder, themeColors.panelBorder);
  widgetSetWidth(termBorder, 1);
  widgetSetHugging(termBorder, 1000);
  widgetSetHidden(termBorder, 1);

  // Notification overlay container (positioned at top-right)
  notifOverlay = VStack(4, []);
  widgetSetWidth(notifOverlay, 300);
  widgetSetHugging(notifOverlay, 750);
  initNotifications(notifOverlay, themeColors);

  // Left content area: mainRow + terminal + status bar
  const leftContent = VStack(0, [mainRow, termPanel, statusBar]);
  setBg(leftContent, themeColors.editorBackground);
  widgetSetHugging(leftContent, 1); // stretch to fill

  // Right panel for AI Chat (Cursor-style) — outside mainRow to avoid
  // layout conflicts with the embedded editor NSView
  const rightPanel = VStack(8, []);
  setBg(rightPanel, themeColors.sideBarBackground);
  widgetSetWidth(rightPanel, 300);
  widgetSetHugging(rightPanel, 750);
  rightPanelContainer = rightPanel;
  rightPanelWidget = rightPanel;
  const rightBorderDiv = VStack(0, []);
  setBg(rightBorderDiv, themeColors.panelBorder);
  widgetSetWidth(rightBorderDiv, 1);
  widgetSetHugging(rightBorderDiv, 1000);
  rightPanelBorder = rightBorderDiv;
  // Start hidden — toggle via activity bar icon
  rightPanelVisible = 0;
  rightPanelRendered = 0;
  widgetSetHidden(rightPanel, 1);
  widgetSetHidden(rightBorderDiv, 1);

  // Outer shell: left content + right panel
  const shell = HStack(0, [leftContent, rightBorderDiv, rightPanel]);
  setBg(shell, themeColors.editorBackground);
  return shell;
}
