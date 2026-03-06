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
  ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetImage, buttonSetImagePosition,
  widgetAddChild, widgetClearChildren, widgetRemoveChild,
  widgetSetWidth, widgetSetHeight, widgetSetHugging, widgetSetHidden,
  stackSetDetachesHidden, widgetMatchParentHeight,
  embedNSView,
  openFolderDialog, openFileDialog,
} from 'perry/ui';
import { Editor } from '@honeide/editor/perry';
import { getActiveTheme, setActiveTheme, type ResolvedUIColors } from './theme/theme-loader';
import type { LayoutMode } from '../platform';
import { getWorkbenchSettings, updateSettings, onSettingsChange } from './settings';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// Extracted modules
import { setBg, setFg, setBtnFg, setBtnTint, getFileName, detectLanguage, getFileIcon, getFileIconColor } from './ui-helpers';
import {
  renderSearchPanel as renderSearchPanelImpl,
  setSearchWorkspaceRoot, setSearchFileOpener, setSearchEditorReloader,
  setSearchCurrentEditorPath, resetSearchPanelReady,
} from './views/search/search-panel';
import {
  renderGitPanel as renderGitPanelImpl,
  setGitWorkspaceRoot, setGitFileOpener, setGitStatusBarUpdater, setGitDiffOpener,
  resetGitPanelReady, refreshGitState, updateStatusBarBranch,
  getGitFileStatus, getGitDirStatus,
} from './views/git/git-panel';
import {
  renderDiffView, openDiffForFile, closeDiffView, isDiffActive, setDiffThemeColors,
  getDiffHeaderWidget, getDiffEditorsWidget,
} from './views/diff/diff-view';
import {
  renderExplorerPanel, refreshSidebarContent, updateSidebarSelection,
  setSidebarWorkspaceRoot, setSidebarFileClickCallback, setSidebarOpenFolderCallback,
  setSidebarNewFileCallback, setSidebarThemeColors, setSidebarCurrentEditorPath,
} from './views/explorer/sidebar-render';
import {
  initTabBar, setTabDisplayCallback, setTabThemeColors,
  openTab, getActiveTabPath, getActiveTabIdx, getTabCount,
  markTabSaved, updateTabDirtyIcon, applyAllTabColors, closeActiveTab,
} from './views/tabs/tab-bar';
import {
  renderStatusBar as renderStatusBarImpl, setStatusBarCursorGetter,
  updateStatusBarBranchLabel as updateStatusBarBranchLabelImpl,
  updateStatusBarDiagnostics as updateStatusBarDiagnosticsImpl,
  updateStatusBarLanguage as updateStatusBarLanguageImpl,
  pollCursorPosition as pollCursorPositionImpl,
  recolorStatusBar, getStatusBarWidget,
} from './views/status-bar/status-bar';
import { renderDebugPanel } from './views/debug/debug-panel';
// Extensions panel hidden for now — no runtime extension system yet
import { renderChatPanel, setChatWorkspaceRoot, setChatFilePathGetter, setChatFileContentGetter } from './views/ai-chat/chat-panel';
import { renderTerminalPanel, setTerminalCwd, destroyTerminalPanel, setTerminalCloseCallback } from './views/terminal/terminal-panel';
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

// Dynamic file tree — loaded from opened folder
let workspaceRoot = '';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module-level widget refs
// ---------------------------------------------------------------------------

let themeColors: ResolvedUIColors | null = null;

// Activity bar
let activityButtons: unknown[] = [];
let activityIndicators: unknown[] = [];
let activeActivityIdx = 0;

// Sidebar
let sidebarContainer: unknown = null;

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

// Breadcrumb bar
let breadcrumbContainer: unknown = null;
let breadcrumbReady: number = 0;

// Diff view
let diffViewContainer: unknown = null;
let normalEditorContainer: unknown = null;
let tabBarContainer: unknown = null;

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

// Shell-level widget refs for live theme recoloring
let shellWidget: unknown = null;
let leftContentWidget: unknown = null;
let activityBarWidget: unknown = null;
let editorPaneWidget: unknown = null;
let termPanelWidget: unknown = null;
let termBorderWidget: unknown = null;

// Deferred button actions (Perry button callbacks can't do structural UI mutations —
// widgetClearChildren/widgetAddChild inside a button callback causes RefCell panic)
let pendingActivityIdx: number = -1;

// ---------------------------------------------------------------------------
// Named update functions (read module-level refs at call time)
// ---------------------------------------------------------------------------

function updateActivityBar(): void {
  if (!themeColors) return;
  for (let i = 0; i < activityButtons.length; i++) {
    if (i === activeActivityIdx) {
      setBtnTint(activityButtons[i], themeColors.activityBarForeground);
      if (i < activityIndicators.length) {
        setBg(activityIndicators[i], '#ffffff');
      }
    } else {
      setBtnTint(activityButtons[i], themeColors.activityBarInactiveForeground);
      if (i < activityIndicators.length) {
        setBg(activityIndicators[i], themeColors.activityBarBackground);
      }
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
    // Folder icon in breadcrumb
    const dirIcon = Button('', () => {});
    buttonSetBordered(dirIcon, 0);
    buttonSetImage(dirIcon, 'folder.fill');
    buttonSetImagePosition(dirIcon, 1);
    textSetFontSize(dirIcon, 9);
    if (themeColors) setBtnTint(dirIcon, '#E8AB53');
    widgetAddChild(breadcrumbContainer, dirIcon);

    const dirText = Text(dirName);
    textSetFontSize(dirText, 11);
    if (themeColors) setFg(dirText, themeColors.editorForeground);
    widgetAddChild(breadcrumbContainer, dirText);

    // Chevron separator
    const sepIcon = Button('', () => {});
    buttonSetBordered(sepIcon, 0);
    buttonSetImage(sepIcon, 'chevron.right');
    buttonSetImagePosition(sepIcon, 1);
    textSetFontSize(sepIcon, 7);
    if (themeColors) setBtnTint(sepIcon, themeColors.editorForeground);
    widgetAddChild(breadcrumbContainer, sepIcon);
  }
  // File icon in breadcrumb
  const bcFileIcon = Button('', () => {});
  buttonSetBordered(bcFileIcon, 0);
  const bcIcon = getFileIcon(fileName);
  buttonSetImage(bcFileIcon, bcIcon);
  buttonSetImagePosition(bcFileIcon, 1);
  textSetFontSize(bcFileIcon, 9);
  const bcColor = getFileIconColor(fileName);
  if (bcColor.length > 0) {
    setBtnTint(bcFileIcon, bcColor);
  } else if (themeColors) {
    setBtnTint(bcFileIcon, themeColors.editorForeground);
  }
  widgetAddChild(breadcrumbContainer, bcFileIcon);

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
    updateSettings({ terminalVisible: false });
  } else {
    terminalVisible = 1;
    widgetSetHidden(terminalArea, 0);
    updateSettings({ terminalVisible: true });
  }
}

function onFolderOpened(folderPath: string): void {
  workspaceRoot = folderPath;
  setSidebarWorkspaceRoot(folderPath);
  setSearchWorkspaceRoot(folderPath);
  setGitWorkspaceRoot(folderPath);
  setTerminalCwd(folderPath);
  setLspWorkspaceRoot(folderPath);
  setChatWorkspaceRoot(folderPath);
  initLspBridge();
  refreshSidebarContent();
  updateSettings({ lastOpenFolder: folderPath });
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
    updateSettings({ sidebarVisible: false });
  } else {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    widgetSetHidden(sidebarBorderWidget, 0);
    updateSettings({ sidebarVisible: true });
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

function autoRenderChat(): void {
  if (rightPanelRendered > 0) return;
  rightPanelRendered = 1;
  renderChatPanel(rightPanelContainer, themeColors as ResolvedUIColors);
}

export function closeEditorAction(): void {
  setTimeout(() => { closeEditorDeferred(); }, 0);
}

function closeEditorDeferred(): void {
  closeActiveTab();
}

export function newFileAction(): void {
  // Defer to next tick to avoid RefCell reentrancy in Perry menu callbacks
  setTimeout(() => { newFileDeferred(); }, 0);
}

function newFileDeferred(): void {
  const path = '/tmp/hone-untitled';
  const name = 'Untitled';
  try {
    writeFileSync(path, '\n');
  } catch (e: any) {
    // ignore write errors
  }
  openFileInEditor(path, name);
}

export function findAction(): void {
  // Defer to next tick to avoid RefCell reentrancy in Perry menu callbacks
  setTimeout(() => { findDeferred(); }, 0);
}

function findDeferred(): void {
  if (sidebarToggleReady > 0 && sidebarVisible < 1) {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    widgetSetHidden(sidebarBorderWidget, 0);
  }
  switchSidebarPanel(1);
}

export function saveFileAction(): void {
  if (currentEditorFilePath.length < 1) return;
  if (editorReady < 1) return;
  const content = editorInstance.getContent();
  writeFileSync(currentEditorFilePath, content);
  triggerDiagnostics();
  markTabSaved(content.length);
}

function pollDirtyState(): void {
  if (editorReady < 1) return;
  const content = editorInstance.getContent();
  updateTabDirtyIcon(content.length);
}

export function openFileAction(): void {
  openFileDialog((path: string) => { onFileOpenedCb2(path); });
}

function onFileOpenedCb2(filePath: string): void {
  if (filePath.length < 1) return;
  const name = getFileName(filePath);
  openFileInEditor(filePath, name);
}

function safeReadFile(filePath: string): string {
  let content = '';
  try {
    content = readFileSync(filePath);
  } catch (e) {
    return '';
  }
  return content;
}

// Module-level refs for diff widgets currently in editorPane
let activeDiffHeader: unknown = null;
let activeDiffEditors: unknown = null;

/** Show the diff view for a file. Adds diff widgets alongside editor. */
function showDiffForFile(filePath: string, relPath: string): void {
  if (!editorPaneWidget) return;
  // Create the diff editors
  openDiffForFile(filePath, relPath, workspaceRoot, 0);
  // Hide the editor while diff is active
  if (editorWidget) widgetSetHidden(editorWidget, 1);
  const hdr = getDiffHeaderWidget();
  if (hdr) {
    widgetAddChild(editorPaneWidget, hdr);
    activeDiffHeader = hdr;
  }
  const edr = getDiffEditorsWidget();
  if (edr) {
    widgetAddChild(editorPaneWidget, edr);
    widgetSetHugging(edr, 1);
    activeDiffEditors = edr;
  }
}

/** Close the diff view and restore the normal editor. */
function hideDiffView(): void {
  if (!editorPaneWidget) return;
  // Remove diff widgets from the editor pane
  if (activeDiffEditors) {
    widgetRemoveChild(editorPaneWidget, activeDiffEditors);
    activeDiffEditors = null;
  }
  if (activeDiffHeader) {
    widgetRemoveChild(editorPaneWidget, activeDiffHeader);
    activeDiffHeader = null;
  }
  // Dispose diff editors (clears children first, then destroys native views)
  closeDiffView();
  // Restore the main editor
  if (editorWidget) widgetSetHidden(editorWidget, 0);
}


function displayFileContent(filePath: string): void {
  currentEditorFilePath = filePath;
  setSidebarCurrentEditorPath(filePath);
  updateBreadcrumb();
  updateStatusBarLanguageImpl(filePath);
  if (editorReady < 1) return;
  const content = safeReadFile(filePath);
  editorInstance.setContent(content);
  editorInstance.render();
}

function openFileInEditor(filePath: string, fileName: string): void {
  // Close diff view BEFORE modifying the tab bar — the tab rebuild triggers
  // a layout pass that crashes if diff editor NSViews are still in the hierarchy.
  if (isDiffActive() > 0) {
    hideDiffView();
  }
  openTab(filePath, fileName);
  displayFileContent(filePath);
}

// ---------------------------------------------------------------------------
// Callbacks for extracted panels
// ---------------------------------------------------------------------------

/** Get cursor position from editor for status bar polling. */
function getCursorPosition(): { line: number; column: number } | null {
  if (editorReady < 1) return null;
  const vm = editorInstance.viewModel;
  const cursors = vm.cursors;
  if (cursors.length < 1) return null;
  return cursors[0];
}

/** Called by tab bar when the active tab changes. */
function onTabDisplay(path: string): void {
  if (path.length < 1) {
    currentEditorFilePath = '';
    setSidebarCurrentEditorPath('');
    updateBreadcrumb();
    return;
  }
  displayFileContent(path);
  updateSidebarSelection();
}

/** Called by sidebar explorer when a file is clicked. */
function onSidebarFileClick(path: string, name: string): void {
  openFileInEditor(path, name);
  setSidebarCurrentEditorPath(currentEditorFilePath);
  updateSidebarSelection();
}

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

function getCurrentEditorPathForChat(): string {
  return currentEditorFilePath;
}

/** Called by git panel when a file is clicked (untracked files). */
function openFileFromGitPanel(path: string, name: string): void {
  openFileInEditor(path, name);
}

// Deferred diff opener (Perry button callbacks can't do structural UI mutations)
let pendingDiffFilePath = '';
let pendingDiffRelPath = '';

/** Called by git panel when a modified/staged file is clicked — opens diff view. */
function onGitDiffOpen(filePath: string, relPath: string): void {
  pendingDiffFilePath = filePath;
  pendingDiffRelPath = relPath;
  setTimeout(() => { onGitDiffOpenDeferred(); }, 0);
}

function onGitDiffOpenDeferred(): void {
  if (pendingDiffFilePath.length < 1) return;
  const fp = pendingDiffFilePath;
  const rp = pendingDiffRelPath;
  pendingDiffFilePath = '';
  pendingDiffRelPath = '';
  showDiffForFile(fp, rp);
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
  // Defer UI mutations to next tick to avoid RefCell reentrancy in Perry button callbacks
  pendingActivityIdx = idx;
  setTimeout(() => { onActivityClickDeferred(); }, 0);
}

function onActivityClickDeferred(): void {
  const idx = pendingActivityIdx;
  if (idx < 0) return;
  pendingActivityIdx = -1;
  // AI Chat (idx=4) toggles the right panel instead of the sidebar
  if (idx === 4) {
    toggleRightPanel();
    return;
  }
  activeActivityIdx = idx;
  updateActivityBar();
  switchSidebarPanel(idx);
  // Persist active panel (only for sidebar panels, not settings gear)
  if (idx >= 0 && idx <= 3) {
    updateSettings({ activePanelIndex: idx });
  }
}

function switchSidebarPanel(idx: number): void {
  if (!sidebarContainer) return;
  if (idx === 0) {
    resetSearchPanelReady();
    renderExplorerPanel(sidebarContainer, themeColors as ResolvedUIColors);
    return;
  }
  widgetClearChildren(sidebarContainer);
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

  // idx===4 (AI Chat) handled by toggleRightPanel, not here

  if (idx === 6) {
    renderSettingsPanel(sidebarContainer, themeColors as ResolvedUIColors);
    return;
  }
}

// ---------------------------------------------------------------------------
// Activity bar
// ---------------------------------------------------------------------------

function renderActivityBarDesktop(colors: ResolvedUIColors): unknown {
  activityButtons = [];
  activityIndicators = [];

  // Icons: 0=Files, 1=Search, 2=Git, 3=Debug, 4=AI Chat
  const icons = ['doc.on.doc', 'magnifyingglass', 'arrow.triangle.branch', 'ladybug', 'sparkles'];

  for (let i = 0; i < 5; i++) {
    const idx = i;
    const btn = Button('', () => { onActivityClick(idx); });
    buttonSetBordered(btn, 0);
    buttonSetImage(btn, icons[i]);
    buttonSetImagePosition(btn, 1);
    setBtnTint(btn, colors.activityBarForeground);
    activityButtons.push(btn);

    // 2px indicator bar on left side
    const indicator = VStack(0, []);
    widgetSetWidth(indicator, 2);
    widgetSetHeight(indicator, 20);
    if (i === activeActivityIdx) {
      setBg(indicator, '#ffffff');
    } else {
      setBg(indicator, colors.activityBarBackground);
    }
    activityIndicators.push(indicator);
  }

  updateActivityBar();

  const bar = VStackWithInsets(4, 0, 0, 0, 0);
  setBg(bar, colors.activityBarBackground);
  for (let i = 0; i < activityButtons.length; i++) {
    const row = HStack(0, [activityIndicators[i], activityButtons[i]]);
    widgetSetHeight(row, 48);
    widgetAddChild(bar, row);
  }
  widgetAddChild(bar, Spacer());

  // Settings gear icon → Settings panel (idx 6)
  const settingsBtn = Button('', () => { onActivityClick(6); });
  buttonSetBordered(settingsBtn, 0);
  buttonSetImage(settingsBtn, 'gearshape');
  buttonSetImagePosition(settingsBtn, 1);
  setBtnTint(settingsBtn, colors.activityBarInactiveForeground);
  widgetAddChild(bar, settingsBtn);

  activityBarWidget = bar;
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
  const inner = VStackWithInsets(0, 0, 0, 0, 0);
  setBg(inner, colors.sideBarBackground);
  sidebarContainer = inner;

  renderExplorerPanel(inner, colors);

  const scroll = ScrollView();
  scrollViewSetChild(scroll, inner);

  return scroll;
}

// ---------------------------------------------------------------------------
// Editor area
// ---------------------------------------------------------------------------

function renderEditorArea(colors: ResolvedUIColors): unknown {
  const defaultFile = workspaceRoot + '/src/app.ts';
  const defaultName = 'app.ts';

  const tbc = HStack(0, []);
  initTabBar(tbc, colors, defaultFile, defaultName);

  const ed = new Editor(800, 600);
  editorInstance = ed;
  editorReady = 1;

  const nsviewPtr = hone_editor_nsview(ed.nativeHandle as number);
  editorWidget = embedNSView(nsviewPtr);

  displayFileContent(defaultFile);

  // Poll cursor position for status bar (every ~250ms)
  setInterval(() => { pollCursorPositionImpl(); }, 250);
  // Poll dirty state every 500ms
  setInterval(() => { pollDirtyState(); }, 500);

  // Breadcrumb bar
  breadcrumbContainer = HStackWithInsets(4, 4, 8, 4, 8);
  setBg(breadcrumbContainer, colors.editorBackground);
  breadcrumbReady = 1;
  updateBreadcrumb();

  widgetSetHugging(editorWidget, 1); // editor stretches to fill available space
  tabBarContainer = tbc;

  // Diff view container (initially unused; swapped into editorPane when diff is active)
  const diffCtr = VStack(0, []);
  widgetSetHugging(diffCtr, 1);
  diffViewContainer = diffCtr;
  renderDiffView(diffCtr, colors);

  // editorPane: tabs + breadcrumb + editor. When diff is active, the editor
  // is replaced with diffCtr via widgetClearChildren/widgetAddChild.
  const editorPane = VStack(0, [tbc, breadcrumbContainer, editorWidget]);
  setBg(editorPane, colors.editorBackground);
  widgetSetHugging(editorPane, 1); // editor pane stretches in mainRow
  editorPaneWidget = editorPane;

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
// Live theme recoloring
// ---------------------------------------------------------------------------

/** Re-apply theme colors to all stored widget refs. Called after theme switch. */
function recolorUI(): void {
  if (!themeColors) return;
  const c = themeColors;

  // Shell containers
  if (shellWidget) setBg(shellWidget, c.editorBackground);
  if (leftContentWidget) setBg(leftContentWidget, c.editorBackground);
  if (activityBarWidget) setBg(activityBarWidget, c.activityBarBackground);
  if (sidebarContainer) setBg(sidebarContainer, c.sideBarBackground);
  if (editorPaneWidget) setBg(editorPaneWidget, c.editorBackground);
  if (breadcrumbContainer) setBg(breadcrumbContainer, c.editorBackground);

  // Terminal area
  if (termPanelWidget) setBg(termPanelWidget, c.editorBackground);
  if (termBorderWidget) setBg(termBorderWidget, c.panelBorder);

  // Borders
  if (sidebarBorderWidget) setBg(sidebarBorderWidget, c.panelBorder);
  if (rightPanelBorder) setBg(rightPanelBorder, c.panelBorder);

  // Right panel (AI Chat)
  if (rightPanelWidget) setBg(rightPanelWidget, c.sideBarBackground);

  // Activity bar icon colors
  for (let i = 0; i < activityButtons.length; i++) {
    if (i === activeActivityIdx) {
      setBtnTint(activityButtons[i], c.activityBarForeground);
    } else {
      setBtnTint(activityButtons[i], c.activityBarInactiveForeground);
    }
  }

  // Status bar
  recolorStatusBar(c);

  // Tab bar
  setTabThemeColors(c);
  applyAllTabColors();

  // Diff view
  setDiffThemeColors(c);

  // Re-render active sidebar panel with new colors
  switchSidebarPanel(activeActivityIdx);
}

/** Open the Settings panel in the sidebar. */
export function openSettingsAction(): void {
  // Show sidebar if hidden
  if (sidebarToggleReady > 0 && sidebarVisible < 1) {
    sidebarVisible = 1;
    if (sidebarWidget) widgetSetHidden(sidebarWidget, 0);
    if (sidebarBorderWidget) widgetSetHidden(sidebarBorderWidget, 0);
    updateSettings({ sidebarVisible: true });
  }
  // Switch to settings (idx 6)
  onActivityClick(6);
}

// Listen for settings changes — detect theme toggle and apply live
let _lastThemeName = '';

function onSettingsChanged(): void {
  const s = getWorkbenchSettings();
  const newTheme = s.colorTheme;
  if (newTheme.length < 1) return;
  // Check if theme changed
  if (_lastThemeName.length > 0) {
    if (_lastThemeName.charCodeAt(5) === newTheme.charCodeAt(5)) return; // same theme
  }
  _lastThemeName = newTheme;

  // Switch the active theme
  if (setActiveTheme(newTheme)) {
    const active = getActiveTheme();
    if (active) {
      themeColors = active.uiColors;
      recolorUI();
    }
  }
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

  // Restore last opened folder, or fall back to cwd
  const _initSettings = getWorkbenchSettings();
  if (_initSettings.lastOpenFolder.length > 0) {
    workspaceRoot = _initSettings.lastOpenFolder;
  }
  if (workspaceRoot.length < 1) {
    try {
      const cwd = execSync('pwd');
      // Trim trailing newline
      if (cwd.length > 0 && cwd.charCodeAt(cwd.length - 1) === 10) {
        workspaceRoot = cwd.slice(0, cwd.length - 1);
      } else {
        workspaceRoot = cwd;
      }
    } catch (e: any) {
      workspaceRoot = '';
    }
  }

  // Wire up extracted panel callbacks
  setSidebarWorkspaceRoot(workspaceRoot);
  setSidebarFileClickCallback(onSidebarFileClick);
  setSidebarOpenFolderCallback(openFolderAction);
  setSidebarNewFileCallback(newFileAction);
  setSidebarCurrentEditorPath(currentEditorFilePath);
  setTabDisplayCallback(onTabDisplay);
  setStatusBarCursorGetter(getCursorPosition);
  setSearchWorkspaceRoot(workspaceRoot);
  setSearchFileOpener(openFileFromSearchPanel);
  setSearchEditorReloader(reloadEditorContent);
  setSearchCurrentEditorPath(getCurrentEditorPath);
  setGitWorkspaceRoot(workspaceRoot);
  setGitFileOpener(openFileFromGitPanel);
  setGitDiffOpener(onGitDiffOpen);
  setGitStatusBarUpdater(updateStatusBarBranchLabelImpl);
  setTerminalCwd(workspaceRoot);
  setChatWorkspaceRoot(workspaceRoot);
  setChatFilePathGetter(() => { return getCurrentEditorPathForChat(); });

  // Wire welcome tab actions
  setWelcomeActions(openFolderAction, openFileAction, openFileAction);

  // Wire LSP bridge
  setLspWorkspaceRoot(workspaceRoot);
  initLspBridge();
  setDiagnosticsFileOpener(openFileFromSearchPanel);
  setAutocompleteAcceptHandler(onAutocompleteAccept);
  setDiagnosticsStatusUpdater(updateStatusBarDiagnosticsImpl);

  // Initialize git state for status bar
  refreshGitState();
  updateStatusBarBranch();

  if (layoutMode === 'compact') {
    const editorArea = renderEditorArea(themeColors);
    const explorerPanel = renderSidebar(themeColors);
    const bottomBar = renderBottomToolbar(themeColors);
    const statusBar = renderStatusBarImpl(themeColors);

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
    const statusBar = renderStatusBarImpl(themeColors);

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
  const statusBar = renderStatusBarImpl(themeColors);

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

  // Apply persisted sidebar visibility
  if (!settings.sidebarVisible) {
    sidebarVisible = 0;
    widgetSetHidden(sidebar, 1);
    widgetSetHidden(sidebarBorder, 1);
  }

  // Apply persisted active panel
  if (settings.activePanelIndex > 0 && settings.activePanelIndex <= 3) {
    activeActivityIdx = settings.activePanelIndex;
    updateActivityBar();
    switchSidebarPanel(settings.activePanelIndex);
  }

  // Perry string === can be unreliable — use charCodeAt
  const isRight = sidebarLocation.length > 0 && sidebarLocation.charCodeAt(0) === 114; // 'r'

  const mainRow = isRight
    ? HStack(0, [activityBar, editorArea, sidebarBorder, sidebar])
    : HStack(0, [activityBar, sidebar, sidebarBorder, editorArea]);
  mainRowWidget = mainRow;

  widgetSetHugging(mainRow, 1);
  widgetSetHugging(statusBar, 750);

  // Terminal bottom panel (hidden by default unless persisted, toggle via Cmd+J)
  const termPanel = VStack(0, []);
  setBg(termPanel, themeColors.editorBackground);
  widgetSetHeight(termPanel, 200);
  widgetSetHugging(termPanel, 750);
  setTerminalCloseCallback(toggleTerminalAction);
  renderTerminalPanel(termPanel, themeColors);
  if (!settings.terminalVisible) {
    widgetSetHidden(termPanel, 1);
  } else {
    terminalVisible = 1;
  }
  terminalArea = termPanel;
  termPanelWidget = termPanel;

  // Terminal border
  const termBorder = VStack(0, []);
  setBg(termBorder, themeColors.panelBorder);
  widgetSetWidth(termBorder, 1);
  widgetSetHugging(termBorder, 1000);
  widgetSetHidden(termBorder, 1);
  termBorderWidget = termBorder;

  // Notification overlay container (positioned at top-right)
  notifOverlay = VStack(4, []);
  widgetSetWidth(notifOverlay, 300);
  widgetSetHugging(notifOverlay, 750);
  initNotifications(notifOverlay, themeColors);

  // Left content area: mainRow + terminal + status bar
  const leftContent = VStack(0, [mainRow, termPanel, statusBar]);
  setBg(leftContent, themeColors.editorBackground);
  widgetSetHugging(leftContent, 1); // stretch to fill
  stackSetDetachesHidden(leftContent, 1); // hidden terminal doesn't take up space
  leftContentWidget = leftContent;

  // Right panel for AI Chat (Cursor-style) — outside mainRow to avoid
  // layout conflicts with the embedded editor NSView
  const rightPanel = VStack(8, []);
  setBg(rightPanel, themeColors.sideBarBackground);
  widgetSetWidth(rightPanel, 360);
  widgetSetHugging(rightPanel, 750);
  rightPanelContainer = rightPanel;
  rightPanelWidget = rightPanel;
  const rightBorderDiv = VStack(0, []);
  setBg(rightBorderDiv, themeColors.panelBorder);
  widgetSetWidth(rightBorderDiv, 1);
  widgetSetHugging(rightBorderDiv, 1000);
  rightPanelBorder = rightBorderDiv;
  rightPanelVisible = 1;
  rightPanelRendered = 0;

  // Outer shell: left content + right panel
  const shell = HStack(0, [leftContent, rightBorderDiv, rightPanel]);
  setBg(shell, themeColors.editorBackground);
  stackSetDetachesHidden(shell, 1); // hidden right panel doesn't take up space
  shellWidget = shell;

  // Pin children to fill parent height (HStack default CenterY alignment
  // only centers children instead of stretching them vertically)
  widgetMatchParentHeight(leftContent);
  // NOTE: Do NOT use widgetMatchParentHeight(mainRow) — it conflicts with the
  // VStack Fill distribution when terminal panel is also in the stack. mainRow
  // stretches via hugging priority 1 instead.
  widgetMatchParentHeight(activityBar);
  widgetMatchParentHeight(sidebar);
  widgetMatchParentHeight(editorArea);

  // Register settings change listener for live theme switching
  _lastThemeName = settings.colorTheme;
  onSettingsChange(() => { onSettingsChanged(); });

  // Auto-render chat panel after delay
  setInterval(() => { autoRenderChat(); }, 2000);

  return shell;
}
