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
  TextField,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetImage, buttonSetImagePosition,
  widgetAddChild, widgetClearChildren, widgetRemoveChild,
  widgetSetWidth, widgetSetHeight, widgetSetHugging, widgetSetHidden, widgetSetBackgroundColor,
  stackSetDetachesHidden, stackSetDistribution,
  widgetMatchParentHeight, widgetMatchParentWidth,
  embedNSView,
  openFolderDialog, openFileDialog, saveFileDialog,
  textfieldFocus,
  frameSplitCreate, frameSplitAddChild,
} from 'perry/ui';
import { Editor } from '@honeide/editor/perry';
import { getActiveTheme, setActiveTheme } from './theme/theme-loader';
import {
  getEditorBackground, getEditorForeground,
  getActivityBarBackground, getActivityBarForeground, getActivityBarInactiveForeground,
  getSideBarBackground, getSideBarForeground,
  getStatusBarBackground, getStatusBarForeground,
  getPanelBorder, getPanelBackground,
  getTabActiveBackground, getTabActiveForeground,
  getTabInactiveBackground, getTabInactiveForeground, getTabBorder,
  getInputBackground, getInputForeground, getInputBorder, getInputPlaceholderForeground,
  getButtonBackground, getButtonForeground, getButtonHoverBackground,
  getListActiveSelectionBackground, getListActiveSelectionForeground, getListHoverBackground,
  getCommandPaletteBackground, getCommandPaletteForeground,
  getFocusBorder, getBadgeBackground, getBadgeForeground,
  getTitleBarBackground, getTitleBarForeground,
  getEditorSelectionBackground, getEditorLineHighlightBackground,
  getEditorCursorForeground, getEditorLineNumberForeground, getEditorLineNumberActiveForeground,
} from './theme/theme-colors';
import type { LayoutMode } from '../platform';
import { getWorkbenchSettings, updateSettings, onSettingsChange } from './settings';
import { readFileSync, writeFileSync, readdirSync, isDirectory, existsSync } from 'fs';
import { join } from 'path';
import { getTempDir, getCwd, getHomeDir } from './paths';
import { getPlatformContext } from '../platform';

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
  getOpenTabCount, getOpenTabPath, setActiveTabByIndex,
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
// Extensions panel hidden for now — no runtime extension system yet
import { renderChatPanel, focusChatInput, getChatInputHandle, setChatWorkspaceRoot, setChatFilePathGetter, setChatFileContentGetter } from './views/ai-chat/chat-panel';
import { renderTerminalPanel, setTerminalCwd, destroyTerminalPanel, setTerminalCloseCallback, setTerminalProblemsFileOpener } from './views/terminal/terminal-panel';
import { renderSettingsTab } from './views/settings-ui/settings-panel';
import { setWelcomeActions, createWelcomeContent } from './views/welcome/welcome-tab';
import { initNotifications, showNotification } from './views/notifications/notifications';
import { setLspWorkspaceRoot, initLspBridge, triggerDiagnostics, getCompletions, setDiagnosticsStatusUpdater } from './views/lsp/lsp-bridge';
import { setDiagnosticsFileOpener } from './views/lsp/diagnostics-panel';
import { createAutocompletePopup, setAutocompleteAcceptHandler } from './views/lsp/autocomplete-popup';
import { buildSyncPanel, refreshSyncPanel, setSyncPanelColors, setSyncStatusText, setSyncPairCallback, setSyncPairingCode, addSyncDevice, removeSyncDevice } from './views/sync/sync-panel';
import { initSyncHost, setOnGuestConnected, setOnGuestDisconnected, getHostRoomId, getHostRelayUrl, generateHostPairingCode } from './sync-host';
import { initSyncGuest } from './sync-guest';
import { getOrCreateDeviceId } from './paths';
import {
  connectToRelay, setOnRelayConnected, setOnRelayDisconnected,
  setOnRelayMessage, isRelayConnected,
} from './sync-transport';

// Compile-time platform ID injected by Perry codegen:
// 0 = macOS, 1 = iOS, 2 = Android, 3 = Windows, 4 = Linux, 5 = Web
declare const __platform__: number;

// FFI function from @honeide/editor — returns raw NSView* for an EditorView
declare function hone_editor_nsview(handle: number): number;


// Dynamic file tree — loaded from opened folder
let workspaceRoot = '';

// DEBUG info from app.ts
let _debugInfo = '';
export function setDebugInfo(info: string): void {
  _debugInfo = info;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module-level widget refs
// ---------------------------------------------------------------------------

// themeColors removed — use getter functions from theme-colors.ts instead
// (Perry crashes on property access of objects with >16 fields)

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
let compactChatPane: unknown = null;
let compactShowingExplorer: number = 0;
let compactShowingChat: number = 0;
let compactChatRendered: number = 0;
let compactShell: unknown = null;
let compactContentContainer: unknown = null;

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
let chatInputWidget: unknown = null;
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
  for (let i = 0; i < activityButtons.length; i++) {
    if (i === activeActivityIdx) {
      setBtnTint(activityButtons[i], getActivityBarForeground());
      if (i < activityIndicators.length) {
        setBg(activityIndicators[i], '#ffffff');
      }
    } else {
      setBtnTint(activityButtons[i], getActivityBarInactiveForeground());
      if (i < activityIndicators.length) {
        setBg(activityIndicators[i], getActivityBarBackground());
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
    setBtnTint(dirIcon, '#E8AB53');
    widgetAddChild(breadcrumbContainer, dirIcon);

    const dirText = Text(dirName);
    textSetFontSize(dirText, 11);
    setFg(dirText, getEditorForeground());
    widgetAddChild(breadcrumbContainer, dirText);

    // Chevron separator
    const sepIcon = Button('', () => {});
    buttonSetBordered(sepIcon, 0);
    buttonSetImage(sepIcon, 'chevron.right');
    buttonSetImagePosition(sepIcon, 1);
    textSetFontSize(sepIcon, 7);
    setBtnTint(sepIcon, getEditorForeground());
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
  } else {
    setBtnTint(bcFileIcon, getEditorForeground());
  }
  widgetAddChild(breadcrumbContainer, bcFileIcon);

  const fileText = Text(fileName);
  textSetFontSize(fileText, 11);
  setFg(fileText, getEditorForeground());
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
    // Defer chat panel rendering to next tick (avoid GC pressure in button callback)
    if (rightPanelRendered < 1) {
      setTimeout(() => { doChatRender(); }, 0);
    }
    // Focus chat input (uses setInterval inside chat-panel module)
    focusChatInput();
  }
}

function doChatRender(): void {
  if (rightPanelRendered > 0) return;
  rightPanelRendered = 1;
  chatInputWidget = renderChatPanel(rightPanelContainer, null as any);
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
  let path = getTempDir();
  path += '/Untitled';
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

export function saveFileAsAction(): void {
  setTimeout(() => { saveFileAsDeferred(); }, 0);
}

let pendingSaveAsPath = '';

function saveFileAsDeferred(): void {
  if (editorReady < 1) return;
  const defaultName = currentEditorFilePath.length > 0 ? getFileName(currentEditorFilePath) : 'untitled.txt';
  saveFileDialog((path: string) => { onSaveAsCb(path); }, defaultName, '');
}

function onSaveAsCb(path: string): void {
  if (path.length < 1) return;
  if (editorReady < 1) return;
  const content = editorInstance.getContent();
  writeFileSync(path, content);
  currentEditorFilePath = path;
  setSidebarCurrentEditorPath(path);
  updateBreadcrumb();
  updateStatusBarLanguageImpl(path);
  let savedMsg = 'Saved to ';
  savedMsg += getFileName(path);
  showNotification(savedMsg, 'info');
}

export function zoomInAction(): void {
  const s = getWorkbenchSettings();
  updateSettings({ editorFontSize: s.editorFontSize + 1 });
}

export function zoomOutAction(): void {
  const s = getWorkbenchSettings();
  if (s.editorFontSize > 6) {
    updateSettings({ editorFontSize: s.editorFontSize - 1 });
  }
}

export function zoomResetAction(): void {
  updateSettings({ editorFontSize: 13 });
}

export function showWelcomeAction(): void {
  setTimeout(() => { showWelcomeDeferred(); }, 0);
}

function showWelcomeDeferred(): void {
  const welcomeContent = createWelcomeContent(null as any);
  const path = '__welcome__';
  const name = 'Welcome';
  openTab(path, name);
  // Don't load file content for welcome tab
}

export function goToLineAction(): void {
  setTimeout(() => { goToLineDeferred(); }, 0);
}

// Go to Line state
let goToLineInput: unknown = null;
let goToLineText = '';

function goToLineDeferred(): void {
  if (!sidebarContainer) return;
  // Show sidebar if hidden
  if (sidebarToggleReady > 0 && sidebarVisible < 1) {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    widgetSetHidden(sidebarBorderWidget, 0);
  }
  widgetClearChildren(sidebarContainer);
  resetSearchPanelReady();

  const title = Text('GO TO LINE');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(sidebarContainer, title);

  goToLineText = '';
  goToLineInput = TextField('Line number...', (text: string) => { goToLineText = text; });
  widgetAddChild(sidebarContainer, goToLineInput);

  const goBtn = Button('Go', () => { onGoToLineConfirm(); });
  buttonSetBordered(goBtn, 0);
  textSetFontSize(goBtn, 12);
  setBtnFg(goBtn, getSideBarForeground());
  widgetAddChild(sidebarContainer, goBtn);
  widgetAddChild(sidebarContainer, Spacer());
}

function onGoToLineConfirm(): void {
  if (goToLineText.length < 1) return;
  if (editorReady < 1) return;
  let lineNum = 0;
  for (let i = 0; i < goToLineText.length; i++) {
    const ch = goToLineText.charCodeAt(i);
    if (ch >= 48 && ch <= 57) {
      lineNum = lineNum * 10 + (ch - 48);
    }
  }
  if (lineNum < 1) return;
  // Set cursor to the target line
  const vm = editorInstance.viewModel;
  const cursors = vm.cursors;
  if (cursors.length > 0) {
    cursors[0].line = lineNum - 1;
    cursors[0].column = 0;
  }
  editorInstance.render();
  // Switch back to file explorer
  activeActivityIdx = 0;
  updateActivityBar();
  switchSidebarPanel(0);
}

export function goToFileAction(): void {
  setTimeout(() => { goToFileDeferred(); }, 0);
}

// Go to File state
let goToFileInput: unknown = null;
let goToFileText = '';
let goToFileResults: unknown = null;
let goToFileFilePaths: string[] = [];
let goToFileFileNames: string[] = [];
let goToFileCount: number = 0;

function collectFiles(dirPath: string, depth: number): void {
  if (depth > 6) return;
  if (goToFileCount >= 500) return;
  let names: string[] = [];
  try { names = readdirSync(dirPath); } catch (e) { return; }
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name.charCodeAt(0) === 46) continue; // skip hidden
    if (goToFileCount >= 500) return;
    const fullPath = join(dirPath, name);
    if (isDirectory(fullPath)) {
      // Skip node_modules
      if (name.length === 12 && name.charCodeAt(0) === 110) continue;
      collectFiles(fullPath, depth + 1);
    } else {
      goToFileFilePaths[goToFileCount] = fullPath;
      goToFileFileNames[goToFileCount] = name;
      goToFileCount = goToFileCount + 1;
    }
  }
}

function goToFileDeferred(): void {
  if (!sidebarContainer) return;
  // Show sidebar if hidden
  if (sidebarToggleReady > 0 && sidebarVisible < 1) {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    widgetSetHidden(sidebarBorderWidget, 0);
  }
  widgetClearChildren(sidebarContainer);
  resetSearchPanelReady();

  const title = Text('GO TO FILE');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(sidebarContainer, title);

  goToFileText = '';
  goToFileInput = TextField('File name...', (text: string) => { onGoToFileInput(text); });
  widgetAddChild(sidebarContainer, goToFileInput);

  // Collect all files from workspace
  goToFileFilePaths = [];
  goToFileFileNames = [];
  goToFileCount = 0;
  if (workspaceRoot.length > 0) {
    collectFiles(workspaceRoot, 0);
  }

  goToFileResults = VStack(2, []);
  const scroll = ScrollView();
  // Perry: scrollViewSetChild compiles to no-op, use widgetAddChild workaround
  widgetAddChild(scroll, goToFileResults);
  widgetAddChild(sidebarContainer, scroll);

  // Show all files initially
  renderGoToFileList('');
}

function onGoToFileInput(text: string): void {
  goToFileText = text;
  setTimeout(() => { renderGoToFileListDeferred(); }, 0);
}

function renderGoToFileListDeferred(): void {
  renderGoToFileList(goToFileText);
}

function renderGoToFileList(query: string): void {
  if (!goToFileResults) return;
  widgetClearChildren(goToFileResults);

  let shown = 0;
  let lowerQuery = '';
  for (let i = 0; i < query.length; i++) {
    const ch = query.charCodeAt(i);
    if (ch >= 65 && ch <= 90) {
      lowerQuery += String.fromCharCode(ch + 32);
    } else {
      lowerQuery += query.slice(i, i + 1);
    }
  }

  for (let i = 0; i < goToFileCount; i++) {
    if (shown >= 50) break;
    const name = goToFileFileNames[i];
    // Filter by query
    if (lowerQuery.length > 0) {
      let lowerName = '';
      for (let j = 0; j < name.length; j++) {
        const ch = name.charCodeAt(j);
        if (ch >= 65 && ch <= 90) {
          lowerName += String.fromCharCode(ch + 32);
        } else {
          lowerName += name.slice(j, j + 1);
        }
      }
      // Simple substring match
      let found = 0;
      for (let k = 0; k <= lowerName.length - lowerQuery.length; k++) {
        let match = 1;
        for (let m = 0; m < lowerQuery.length; m++) {
          if (lowerName.charCodeAt(k + m) !== lowerQuery.charCodeAt(m)) {
            match = 0;
            break;
          }
        }
        if (match > 0) { found = 1; break; }
      }
      if (found < 1) continue;
    }

    const filePath = goToFileFilePaths[i];
    const fileName = name;
    const btn = Button(name, () => { onGoToFileSelect(filePath, fileName); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 11);
    setBtnFg(btn, getSideBarForeground());
    widgetAddChild(goToFileResults, btn);
    shown = shown + 1;
  }

  if (shown < 1) {
    const noResults = Text('No matching files');
    textSetFontSize(noResults, 11);
    setFg(noResults, getSideBarForeground());
    widgetAddChild(goToFileResults, noResults);
  }
}

let pendingGoToFilePath = '';
let pendingGoToFileName = '';

function onGoToFileSelect(path: string, name: string): void {
  pendingGoToFilePath = path;
  pendingGoToFileName = name;
  setTimeout(() => { onGoToFileSelectDeferred(); }, 0);
}

function onGoToFileSelectDeferred(): void {
  if (pendingGoToFilePath.length < 1) return;
  const fp = pendingGoToFilePath;
  const fn = pendingGoToFileName;
  pendingGoToFilePath = '';
  pendingGoToFileName = '';
  openFileInEditor(fp, fn);
  // Switch back to file explorer
  activeActivityIdx = 0;
  updateActivityBar();
  switchSidebarPanel(0);
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

// Module-level ref for settings tab widget in editorPane
let activeSettingsWidget: unknown = null;
let settingsTabCreated: number = 0;

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


/** Show the settings tab in the editor pane. */
function showSettingsInEditorPane(): void {
  if (!editorPaneWidget) return;
  if (activeDiffEditors) hideDiffView();
  if (editorWidget) widgetSetHidden(editorWidget, 1);
  if (activeSettingsWidget) {
    widgetSetHidden(activeSettingsWidget, 0);
    return;
  }
  const settingsCtr = VStack(0, []);
  widgetSetHugging(settingsCtr, 1);
  renderSettingsTab(settingsCtr, null as any);
  widgetAddChild(editorPaneWidget, settingsCtr);
  activeSettingsWidget = settingsCtr;
}

/** Hide the settings tab from the editor pane. */
function hideSettingsInEditorPane(): void {
  if (!activeSettingsWidget) return;
  widgetSetHidden(activeSettingsWidget, 1);
  if (editorWidget) widgetSetHidden(editorWidget, 0);
}

function displayFileContent(filePath: string): void {
  // Virtual paths (__settings__, __welcome__) — don't read file
  if (filePath.length > 2 && filePath.charCodeAt(0) === 95 && filePath.charCodeAt(1) === 95) {
    // __settings__ (length 12)
    if (filePath.length === 12 && filePath.charCodeAt(2) === 115) {
      showSettingsInEditorPane();
    }
    return;
  }
  // Switching away from settings — hide it
  if (activeSettingsWidget) hideSettingsInEditorPane();
  currentEditorFilePath = filePath;
  setSidebarCurrentEditorPath(filePath);
  updateBreadcrumb();
  updateStatusBarLanguageImpl(filePath);
  updateSidebarSelection();
  if (editorReady < 1) return;
  const lang = detectLanguage(filePath);
  editorInstance.setLanguage(lang);
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
    renderExplorerPanel(sidebarContainer, null as any);
    return;
  }
  widgetClearChildren(sidebarContainer);
  resetSearchPanelReady();

  if (idx === 1) {
    resetGitPanelReady();
    renderSearchPanelImpl(sidebarContainer, null as any);
    return;
  }

  if (idx === 2) {
    resetGitPanelReady();
    renderGitPanelImpl(sidebarContainer, null as any);
    return;
  }

  if (idx === 3) {
    widgetClearChildren(sidebarContainer);
    const panel = buildSyncPanel(themeColors as ResolvedUIColors);
    widgetAddChild(sidebarContainer, panel);
    return;
  }

  // idx===4 (AI Chat) handled by toggleRightPanel, not here
}

// ---------------------------------------------------------------------------
// Activity bar
// ---------------------------------------------------------------------------

function renderActivityBarDesktop(): unknown {
  activityButtons = [];
  activityIndicators = [];

  // Icons: 0=Files, 1=Search, 2=Git, 3=Sync, 4=AI Chat
  const icons = ['doc.on.doc', 'magnifyingglass', 'arrow.triangle.branch', 'arrow.triangle.2.circlepath', 'sparkles'];

  for (let i = 0; i < 5; i++) {
    const idx = i;
    const btn = Button('', () => { onActivityClick(idx); });
    buttonSetBordered(btn, 0);
    buttonSetImage(btn, icons[i]);
    buttonSetImagePosition(btn, 1);
    textSetFontSize(btn, 20);
    setBtnTint(btn, getActivityBarForeground());
    activityButtons.push(btn);

    // 2px indicator bar on left side
    const indicator = VStack(0, []);
    widgetSetWidth(indicator, 2);
    widgetSetHeight(indicator, 20);
    if (i === activeActivityIdx) {
      setBg(indicator, '#ffffff');
    } else {
      setBg(indicator, getActivityBarBackground());
    }
    activityIndicators.push(indicator);
  }

  updateActivityBar();

  const bar = VStackWithInsets(4, 0, 0, 0, 0);
  setBg(bar, getActivityBarBackground());
  for (let i = 0; i < activityButtons.length; i++) {
    // 2px indicator | 10px gap | button (centered) | fill
    const gap = VStack(0, []);
    widgetSetWidth(gap, 10);
    const row = HStack(0, [activityIndicators[i], gap, activityButtons[i], Spacer()]);
    widgetSetHeight(row, 48);
    widgetAddChild(bar, row);
  }
  widgetAddChild(bar, Spacer());

  // Settings gear icon → opens Settings tab in editor pane
  const settingsBtn = Button('', () => { openSettingsAction(); });
  buttonSetBordered(settingsBtn, 0);
  buttonSetImage(settingsBtn, 'gearshape');
  buttonSetImagePosition(settingsBtn, 1);
  textSetFontSize(settingsBtn, 20);
  setBtnTint(settingsBtn, getActivityBarInactiveForeground());
  widgetAddChild(bar, settingsBtn);

  activityBarWidget = bar;
  return bar;
}

function renderActivityBarCompact(): unknown {
  const icons = ['folder', 'doc.text', 'sparkles', 'terminal'];
  activityButtons = [];

  for (let i = 0; i < icons.length; i++) {
    const idx = i;
    const btn = Button('', () => { onActivityClick(idx); });
    buttonSetBordered(btn, 0);
    buttonSetImage(btn, icons[i]);
    buttonSetImagePosition(btn, 1);
    textSetFontSize(btn, 20);
    setBtnTint(btn, getActivityBarForeground());
    activityButtons.push(btn);
  }

  updateActivityBar();

  const bar = HStack(0, []);
  setBg(bar, getActivityBarBackground());
  for (let i = 0; i < activityButtons.length; i++) {
    widgetAddChild(bar, activityButtons[i]);
  }
  return bar;
}

// ---------------------------------------------------------------------------
// iPad top activity bar — horizontal icons with safe area inset
// ---------------------------------------------------------------------------

function initSplitSidebarExplorer(): void {
  if (!sidebarContainer) return;
  const colors = getActiveTheme();
  if (!colors) return;
  renderExplorerPanel(sidebarContainer, colors);
}

function renderIPadTopBar(colors: ResolvedUIColors): unknown {
  // Create buttons using same handlers as bottom toolbar
  const filesBtn = Button('', () => { onBottomBarFiles(); });
  const searchBtn = Button('', () => { onBottomBarSearch(); });
  const aiBtn = Button('', () => { onBottomBarAI(); });
  const syncBtn = Button('', () => { onBottomBarSync(); });
  const settingsBtn = Button('', () => { onBottomBarSettings(); });

  buttonSetImage(filesBtn, 'folder');
  buttonSetImage(searchBtn, 'magnifyingglass');
  buttonSetImage(aiBtn, 'sparkles');
  buttonSetImage(syncBtn, 'arrow.triangle.2.circlepath');
  buttonSetImage(settingsBtn, 'gearshape');

  const allBtns = [filesBtn, searchBtn, aiBtn, syncBtn, settingsBtn];
  for (let i = 0; i < allBtns.length; i++) {
    buttonSetBordered(allBtns[i], 0);
    buttonSetImagePosition(allBtns[i], 1);
    setBtnTint(allBtns[i], colors.activityBarForeground);
    widgetSetWidth(allBtns[i], 48);
    widgetSetHeight(allBtns[i], 40);
  }

  // Icon row — EqualSpacing distribution spreads icons across the full width
  const iconRow = HStack(0, [filesBtn, searchBtn, aiBtn, syncBtn, settingsBtn]);
  stackSetDistribution(iconRow, 3); // 3 = EqualSpacing

  // Safe area spacer (iPad top inset ~24px for status bar area)
  const safeArea = Text('');
  widgetSetHeight(safeArea, 24);

  // 1px bottom border
  const border = Text('');
  widgetSetHeight(border, 1);
  setBg(border, colors.panelBorder);

  const bar = VStack(0, [safeArea, iconRow, border]);
  setBg(bar, colors.activityBarBackground);

  activityBarWidget = bar;
  return bar;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function renderSidebar(): unknown {
  const inner = VStackWithInsets(0, 0, 0, 0, 0);
  setBg(inner, getSideBarBackground());
  sidebarContainer = inner;

  renderExplorerPanel(inner, null as any);

  const scroll = ScrollView();
  // Perry: scrollViewSetChild compiles to no-op, use widgetAddChild workaround
  widgetAddChild(scroll, inner);

  return scroll;
}

// ---------------------------------------------------------------------------
// Editor area
// ---------------------------------------------------------------------------

function renderEditorArea(): unknown {
  let defaultFile = '';
  defaultFile += workspaceRoot;
  if (__platform__ === 3) {
    defaultFile += '\\src\\app.ts';
  } else {
    defaultFile += '/src/app.ts';
  }
  const defaultName = 'app.ts';

  const tbc = HStack(0, []);
  initTabBar(tbc, null as any, defaultFile, defaultName);

  const ed = new Editor(800, 600);
  editorInstance = ed;
  editorReady = 1;

  const nsviewPtr = hone_editor_nsview(ed.nativeHandle as number);
  editorWidget = embedNSView(nsviewPtr);

  displayFileContent(defaultFile);

  // Poll cursor position for status bar
  setInterval(() => { pollCursorPositionImpl(); }, 250);
  setInterval(() => { pollDirtyState(); }, 500);

  // Breadcrumb bar
  breadcrumbContainer = HStackWithInsets(4, 4, 8, 4, 8);
  setBg(breadcrumbContainer, getEditorBackground());
  breadcrumbReady = 1;
  updateBreadcrumb();

  widgetSetHugging(editorWidget, 1);
  tabBarContainer = tbc;

  const editorPane = VStack(0, [tbc, breadcrumbContainer, editorWidget]);
  setBg(editorPane, getEditorBackground());
  widgetSetHugging(editorPane, 1); // editor pane stretches in mainRow
  // Embedded NSView has no intrinsic width — pin it to fill the VStack's width
  widgetMatchParentWidth(editorWidget);
  editorPaneWidget = editorPane;

  return editorPane;
}

// ---------------------------------------------------------------------------
// Compact layout — panel toggling
// ---------------------------------------------------------------------------

function swapCompactPanel(panel: unknown): void {
  if (!compactContentContainer) return;
  widgetClearChildren(compactContentContainer);
  widgetAddChild(compactContentContainer, panel);
  // On iOS, swapped panels must pin width to parent VStack for full-screen width
  widgetMatchParentWidth(panel);
}

function showExplorer(): void {
  compactShowingExplorer = 1;
  compactShowingChat = 0;
  swapCompactPanel(compactExplorerPane);
}

function hideExplorer(): void {
  compactShowingExplorer = 0;
  compactShowingChat = 0;
  swapCompactPanel(compactEditorPane);
}

function showChat(): void {
  compactShowingChat = 1;
  compactShowingExplorer = 0;
  // Lazy-create chat pane
  if (!compactChatPane) {
    const chatPane = VStackWithInsets(0, 8, 8, 8, 8);
    setBg(chatPane, (themeColors as ResolvedUIColors).sideBarBackground);
    compactChatPane = chatPane;
  }
  swapCompactPanel(compactChatPane);
  // Render chat panel on first show (deferred to avoid GC pressure)
  if (compactChatRendered < 1) {
    compactChatRendered = 1;
    setTimeout(() => { doCompactChatRender(); }, 0);
  } else {
    focusChatInput();
  }
}

function doCompactChatRender(): void {
  if (!compactChatPane) return;
  chatInputWidget = renderChatPanel(compactChatPane, themeColors as ResolvedUIColors);
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

function onBottomBarSearch(): void {
  // Show search panel in sidebar, then show sidebar
  if (!sidebarContainer) return;
  widgetClearChildren(sidebarContainer);
  resetSearchPanelReady();
  renderSearchPanelImpl(sidebarContainer, themeColors as ResolvedUIColors);
  showExplorer();
}

function onBottomBarAI(): void {
  // Toggle AI chat in compact mode
  if (compactShowingChat > 0) {
    hideExplorer(); // hideExplorer resets both flags and shows editor
  } else {
    showChat();
  }
}

function onBottomBarSync(): void {
  // Show sync panel in sidebar, then show sidebar
  if (!sidebarContainer) return;
  widgetClearChildren(sidebarContainer);
  const panel = buildSyncPanel(themeColors as ResolvedUIColors);
  widgetAddChild(sidebarContainer, panel);
  showExplorer();
}

function onBottomBarSettings(): void {
  // Render settings as a standalone panel directly into content container
  // (not inside the sidebar ScrollView — nested ScrollViews break on iOS)
  compactShowingExplorer = 1;
  compactShowingChat = 0;
  const settingsCtr = VStack(0, []);
  widgetSetHugging(settingsCtr, 1);
  renderSettingsTab(settingsCtr, null as any);
  swapCompactPanel(settingsCtr);
}

function renderBottomToolbar(): unknown {
  const filesBtn = Button('', () => { onBottomBarFiles(); });
  const searchBtn = Button('', () => { onBottomBarSearch(); });
  const aiBtn = Button('', () => { onBottomBarAI(); });
  const syncBtn = Button('', () => { onBottomBarSync(); });
  const settingsBtn = Button('', () => { onBottomBarSettings(); });

  buttonSetImage(filesBtn, 'folder');
  buttonSetImage(searchBtn, 'magnifyingglass');
  buttonSetImage(aiBtn, 'sparkles');
  buttonSetImage(syncBtn, 'arrow.triangle.2.circlepath');
  buttonSetImage(settingsBtn, 'gearshape');
  buttonSetImagePosition(filesBtn, 1);
  buttonSetImagePosition(searchBtn, 1);
  buttonSetImagePosition(aiBtn, 1);
  buttonSetImagePosition(syncBtn, 1);
  buttonSetImagePosition(settingsBtn, 1);

  const allBtns = [filesBtn, searchBtn, aiBtn, syncBtn, settingsBtn];
  for (let i = 0; i < allBtns.length; i++) {
    buttonSetBordered(allBtns[i], 0);
    setBtnTint(allBtns[i], getActivityBarForeground());
    // Enforce minimum touch target (44pt Apple HIG)
    widgetSetWidth(allBtns[i], 44);
    widgetSetHeight(allBtns[i], 44);
  }

  const bar = HStack(0, [filesBtn, Spacer(), searchBtn, Spacer(), aiBtn, Spacer(), syncBtn, Spacer(), settingsBtn]);
  setBg(bar, getActivityBarBackground());
  widgetSetHeight(bar, 49); // 44pt buttons + 5pt padding
  return bar;
}

// ---------------------------------------------------------------------------
// Live theme recoloring
// ---------------------------------------------------------------------------

/** Re-apply theme colors to all stored widget refs. Called after theme switch. */
function recolorUI(): void {
  // Shell containers
  if (shellWidget) setBg(shellWidget, getEditorBackground());
  if (leftContentWidget) setBg(leftContentWidget, getEditorBackground());
  if (activityBarWidget) setBg(activityBarWidget, getActivityBarBackground());
  if (sidebarContainer) setBg(sidebarContainer, getSideBarBackground());
  if (editorPaneWidget) setBg(editorPaneWidget, getEditorBackground());
  if (breadcrumbContainer) setBg(breadcrumbContainer, getEditorBackground());

  // Terminal area
  if (termPanelWidget) setBg(termPanelWidget, getEditorBackground());
  if (termBorderWidget) setBg(termBorderWidget, getPanelBorder());

  // Borders
  if (sidebarBorderWidget) setBg(sidebarBorderWidget, getPanelBorder());
  if (rightPanelBorder) setBg(rightPanelBorder, getPanelBorder());

  // Right panel (AI Chat)
  if (rightPanelWidget) setBg(rightPanelWidget, getSideBarBackground());

  // Sync panel colors
  setSyncPanelColors(c);

  // Activity bar icon colors
  for (let i = 0; i < activityButtons.length; i++) {
    if (i === activeActivityIdx) {
      setBtnTint(activityButtons[i], getActivityBarForeground());
    } else {
      setBtnTint(activityButtons[i], getActivityBarInactiveForeground());
    }
  }

  // Status bar
  recolorStatusBar(null as any);

  // Tab bar
  setTabThemeColors(null as any);
  applyAllTabColors();

  // Diff view
  setDiffThemeColors(null as any);

  // Re-render active sidebar panel with new colors
  switchSidebarPanel(activeActivityIdx);
}

/** Open the Settings tab in the editor pane. */
export function openSettingsAction(): void {
  setTimeout(() => { openSettingsDeferred(); }, 0);
}

function openSettingsDeferred(): void {
  if (settingsTabCreated < 1) {
    openTab('__settings__', 'Settings');
    settingsTabCreated = 1;
  } else {
    // Tab exists — just activate it via tab click simulation
    activateSettingsTab();
  }
  showSettingsInEditorPane();
}

function activateSettingsTab(): void {
  // Find the __settings__ tab by scanning openTabs via the tab bar's exported helper
  // Since we can't reliably compare strings in arrays, just set the active tab index
  // by scanning for a path of length 12 starting with '_'
  for (let i = 0; i < getOpenTabCount(); i++) {
    const p = getOpenTabPath(i);
    if (p.length === 12 && p.charCodeAt(0) === 95 && p.charCodeAt(1) === 95) {
      setActiveTabByIndex(i);
      return;
    }
  }
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
    recolorUI();
  }
}

// ---------------------------------------------------------------------------
// Sync system initialization
// ---------------------------------------------------------------------------

function initSyncSystem(layoutMode: LayoutMode): void {
  const deviceId = getOrCreateDeviceId();
  const ctx = getPlatformContext();

  // Wire pair button callback
  setSyncPairCallback(onSyncPairClicked);

  if (ctx.deviceClass === 'desktop') {
    // Desktop is the sync host
    initSyncHost(deviceId, 'Hone Desktop');
    setOnGuestConnected(onSyncGuestConnected);
    setOnGuestDisconnected(onSyncGuestDisconnected);
  } else {
    // Mobile/tablet is the sync guest
    let deviceName = 'Hone Mobile';
    if (ctx.deviceClass === 'tablet') {
      deviceName = 'Hone iPad';
    }
    let platform = 'unknown';
    if (__platform__ === 0) platform = 'macOS';
    if (__platform__ === 1) platform = 'iOS';
    if (__platform__ === 2) platform = 'Android';
    if (__platform__ === 3) platform = 'Windows';
    initSyncGuest(deviceId, deviceName, platform);
  }

  // Wire relay event callbacks
  setOnRelayConnected(onRelayConnectedImpl);
  setOnRelayDisconnected(onRelayDisconnectedImpl);
  setOnRelayMessage(onRelayMessageImpl);

  // Connect to relay (desktop hosts immediately; guests connect after pairing)
  if (ctx.deviceClass === 'desktop') {
    const relayUrl = getHostRelayUrl();
    const roomId = getHostRoomId();
    connectToRelay(relayUrl, roomId, deviceId);
  }

  // Poll sync panel refresh every 5s
  setInterval(() => { refreshSyncPanelDeferred(); }, 5000);
}

function onSyncPairClicked(): void {
  const code = generateHostPairingCode();
  setSyncPairingCode(code);
  let msg = 'Code: ';
  msg += code;
  msg += ' — Waiting for guest...';
  syncStatusOverride = msg;
  setSyncStatusText(msg);
}

function onSyncGuestConnected(deviceId: string, deviceName: string): void {
  addSyncDevice(deviceName, 'connected');
  syncStatusOverride = '';
  setSyncStatusText('Guest connected');
  refreshSyncPanelDeferred();
}

function onSyncGuestDisconnected(deviceId: string): void {
  // For now just refresh — could remove device by id
  refreshSyncPanelDeferred();
}

function onRelayConnectedImpl(): void {
  setSyncStatusText('Connected to relay');
  refreshSyncPanelDeferred();
}

function onRelayDisconnectedImpl(): void {
  setSyncStatusText('Disconnected from relay');
  refreshSyncPanelDeferred();
}

function onRelayMessageImpl(data: string): void {
  // Messages from relay will be processed here
  // For now, just refresh the panel to show activity
  refreshSyncPanelDeferred();
}

let syncStatusOverride = '';

function refreshSyncPanelDeferred(): void {
  // Check relay connection state and update status if no user-initiated override
  if (isRelayConnected() > 0) {
    if (syncStatusOverride.length === 0) {
      setSyncStatusText('Connected to relay');
    }
  }
  refreshSyncPanel();
}

// ---------------------------------------------------------------------------
// Main workbench shell
// ---------------------------------------------------------------------------

export function renderWorkbench(layoutMode: LayoutMode): unknown {
  // Determine workspace root
  const _initSettings = getWorkbenchSettings();
  const _launchCwd = getCwd();
  const _homeDir = getHomeDir();

  let _cwdIsProject = 0;
  if (_launchCwd.length > 1) {
    let _cwdMatchesHome = 0;
    if (_launchCwd.length === _homeDir.length) {
      _cwdMatchesHome = 1;
      for (let _ci = 0; _ci < _launchCwd.length; _ci++) {
        if (_launchCwd.charCodeAt(_ci) !== _homeDir.charCodeAt(_ci)) {
          _cwdMatchesHome = 0;
          break;
        }
      }
    }
    if (_cwdMatchesHome < 1) {
      _cwdIsProject = 1;
    }
  }

  if (_cwdIsProject > 0) {
    workspaceRoot = _launchCwd;
  } else if (_initSettings.lastOpenFolder.length > 0) {
    let _lastFolderValid = 0;
    try {
      if (existsSync(_initSettings.lastOpenFolder)) {
        if (isDirectory(_initSettings.lastOpenFolder)) {
          _lastFolderValid = 1;
        }
      }
    } catch (e: any) {}
    if (_lastFolderValid > 0) {
      workspaceRoot = _initSettings.lastOpenFolder;
    } else {
      workspaceRoot = _launchCwd;
    }
  } else {
    workspaceRoot = _launchCwd;
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

  // Initialize sync system
  initSyncSystem(layoutMode);

  if (layoutMode === 'compact') {
    const editorArea = renderEditorArea(themeColors);
    const explorerPanel = renderSidebar(themeColors);
    const statusBar = renderStatusBarImpl(themeColors);
    const bottomBar = renderBottomToolbar(themeColors);

    compactEditorPane = editorArea;
    compactExplorerPane = explorerPanel;

    // Content container holds the active panel (editor, explorer, or chat).
    // On iOS, hidden views in UIStackView break layout — so we swap children
    // dynamically instead of using widgetSetHidden.
    const contentCtr = VStack(0, [editorArea]);
    widgetSetHugging(contentCtr, 1);
    compactContentContainer = contentCtr;

    widgetSetHugging(statusBar, 750);
    widgetSetHugging(bottomBar, 750);

    const shell = VStack(0, [contentCtr, statusBar, bottomBar]);
    setBg(shell, themeColors.editorBackground);
    compactShell = shell;
    return shell;
  }

  if (layoutMode === 'split') {
    // Full iPad split layout using frame-based split
    // renderSidebar() can't be used directly because renderExplorerPanel triggers
    // a layout crash in frame-based containers. Build sidebar inline instead.
    const sidebarInner = VStackWithInsets(0, 0, 0, 0, 0);
    setBg(sidebarInner, themeColors.sideBarBackground);
    sidebarContainer = sidebarInner;
    // Defer explorer panel init to after layout is established
    const sideScroll = ScrollView();
    scrollViewSetChild(sideScroll, sidebarInner);
    const leftBox = sideScroll;
    const rightBox = renderEditorArea(themeColors);

    const statusBar = renderStatusBarImpl(themeColors);
    const topBar = renderIPadTopBar(themeColors);
    widgetSetHugging(topBar, 750);

    const splitContainer = frameSplitCreate(280);
    frameSplitAddChild(splitContainer, leftBox);
    frameSplitAddChild(splitContainer, rightBox);
    widgetSetHugging(splitContainer, 1);

    widgetSetHugging(statusBar, 750);

    const shell = VStack(0, [topBar, splitContainer, statusBar]);
    setBg(shell, themeColors.editorBackground);

    // Defer explorer panel init — calling it synchronously during layout setup
    // causes the frame split container to black-screen on iOS.
    setTimeout(() => { initSplitSidebarExplorer(); }, 100);

    _lastThemeName = getWorkbenchSettings().colorTheme;
    onSettingsChange(() => { onSettingsChanged(); });

    return shell;
  }

  // Desktop (full) layout
  const settings = getWorkbenchSettings();

  const activityBar = renderActivityBarDesktop();
  const sidebar = renderSidebar();
  const editorArea = renderEditorArea();
  const statusBar = renderStatusBarImpl(null as any);

  widgetSetWidth(activityBar, 48);
  widgetSetHugging(activityBar, 750);
  widgetSetWidth(sidebar, 220);
  widgetSetHugging(sidebar, 750);
  widgetSetHugging(editorArea, 1);

  const sidebarBorder = VStack(0, []);
  setBg(sidebarBorder, getPanelBorder());
  widgetSetWidth(sidebarBorder, 1);
  widgetSetHugging(sidebarBorder, 1000);

  sidebarWidget = sidebar;
  sidebarBorderWidget = sidebarBorder;
  sidebarToggleReady = 1;

  // Apply persisted sidebar visibility
  if (settings.sidebarVisible === false) {
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

  const mainRow = HStack(0, [activityBar, sidebar, sidebarBorder, editorArea]);
  mainRowWidget = mainRow;

  widgetSetHugging(mainRow, 1);
  widgetSetHugging(statusBar, 750);

  // Platform context for responsive sizing
  const ctx = getPlatformContext();

  // Terminal bottom panel
  let termHeight = Math.floor(ctx.screen.height * 0.25);
  if (termHeight < 150) termHeight = 150;
  if (termHeight > 250) termHeight = 250;
  const termPanel = VStack(0, []);
  setBg(termPanel, getEditorBackground());
  widgetSetHeight(termPanel, termHeight);
  widgetSetHugging(termPanel, 750);
  setTerminalCloseCallback(toggleTerminalAction);
  setTerminalProblemsFileOpener(openFileFromSearchPanel);
  renderTerminalPanel(termPanel, null as any);
  if (settings.terminalVisible === false) {
    widgetSetHidden(termPanel, 1);
  } else {
    terminalVisible = 1;
  }
  terminalArea = termPanel;
  termPanelWidget = termPanel;

  // Terminal border
  const termBorder = VStack(0, []);
  setBg(termBorder, getPanelBorder());
  widgetSetWidth(termBorder, 1);
  widgetSetHugging(termBorder, 1000);
  widgetSetHidden(termBorder, 1);
  termBorderWidget = termBorder;

  // Notification overlay
  let notifWidth = 300;
  if (ctx.screen.width < 400) {
    notifWidth = ctx.screen.width - 40;
  }
  notifOverlay = VStack(4, []);
  widgetSetWidth(notifOverlay, notifWidth);
  widgetSetHugging(notifOverlay, 750);
  initNotifications(notifOverlay, null as any);

  // Left content area: mainRow + terminal + status bar
  const leftContent = VStack(0, [mainRow, termPanel, statusBar]);
  setBg(leftContent, getEditorBackground());
  widgetSetHugging(leftContent, 1); // stretch to fill
  stackSetDetachesHidden(leftContent, 1); // hidden terminal doesn't take up space
  // VStack alignment=Leading doesn't stretch children to fill cross-axis width.
  // Pin arranged subviews' widths to the VStack so they fill horizontally.
  widgetMatchParentWidth(mainRow);
  widgetMatchParentWidth(statusBar);
  leftContentWidget = leftContent;

  // Right panel for AI Chat
  let rightPanelWidth = 360;
  if (ctx.deviceClass.charCodeAt(0) === 116) { // 'tablet'
    rightPanelWidth = 300;
  }
  const rightPanel = VStack(8, []);
  setBg(rightPanel, getSideBarBackground());
  widgetSetWidth(rightPanel, rightPanelWidth);
  widgetSetHugging(rightPanel, 750);
  rightPanelContainer = rightPanel;
  rightPanelWidget = rightPanel;
  const rightBorderDiv = VStack(0, []);
  setBg(rightBorderDiv, getPanelBorder());
  widgetSetWidth(rightBorderDiv, 1);
  widgetSetHugging(rightBorderDiv, 1000);
  rightPanelBorder = rightBorderDiv;
  rightPanelVisible = 0;
  rightPanelRendered = 0;
  widgetSetHidden(rightPanel, 1);
  widgetSetHidden(rightBorderDiv, 1);

  // Outer shell: left content + right panel
  const shell = HStack(0, [leftContent, rightBorderDiv, rightPanel]);
  setBg(shell, getEditorBackground());
  stackSetDetachesHidden(shell, 1);
  shellWidget = shell;

  widgetMatchParentHeight(leftContent);
  widgetMatchParentHeight(activityBar);
  widgetMatchParentHeight(sidebar);
  widgetMatchParentHeight(editorArea);

  // Register settings change listener for live theme switching
  _lastThemeName = settings.colorTheme;
  onSettingsChange(() => { onSettingsChanged(); });

  return shell;
}

