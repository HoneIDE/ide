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
  openFolderDialog, openFileDialog, saveFileDialog, pollOpenFile,
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
  applyDarkColors, applyLightColors, isCurrentThemeDark,
} from './theme/theme-colors';
import type { LayoutMode } from '../platform';
import { getWorkbenchSettings, updateSettings, onSettingsChange } from './settings';
import { readFileSync, writeFileSync, readdirSync, isDirectory, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { spawnBackground } from 'child_process';
import { execSync } from 'child_process';
import { getTempDir, getCwd, getHomeDir } from './paths';
import { getPlatformContext } from '../platform';

import { registerBuiltinCommands, registerCommand } from '../commands';

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
  setRemoteFileTree, setRemoteFileClickCallback, isRemoteExplorerMode,
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
import { renderChatPanel, focusChatInput, getChatInputHandle, setChatWorkspaceRoot, setChatFilePathGetter, setChatFileContentGetter, setChatRemoteGuest, setChatRelaySendFn, setChatRelayForwardFn, startClaudeForRelay, handleClaudeRelayLine, handleClaudeRelayEvent } from './views/ai-chat/chat-panel';
import { renderTerminalPanel, setTerminalCwd, destroyTerminalPanel, setTerminalCloseCallback, setTerminalProblemsFileOpener } from './views/terminal/terminal-panel';
import { renderSettingsTab } from './views/settings-ui/settings-panel';
import { setWelcomeActions, createWelcomeContent } from './views/welcome/welcome-tab';
import { initNotifications, showNotification } from './views/notifications/notifications';
import { setLspWorkspaceRoot, initLspBridge, triggerDiagnostics, getCompletions, setDiagnosticsStatusUpdater } from './views/lsp/lsp-bridge';
import { setDiagnosticsFileOpener } from './views/lsp/diagnostics-panel';
import { createAutocompletePopup, setAutocompleteAcceptHandler } from './views/lsp/autocomplete-popup';
import { initTelemetry, telemetryTrackFileOpen, telemetryTrackSettingsOpen, telemetryTrackStartup, telemetryTrackThemeChange, telemetryTrackTerminalOpen } from './telemetry';
import { buildSyncPanel, refreshSyncPanel, setSyncStatusText, setSyncPairCallback, setSyncJoinCallback, setSyncPairingCode, addSyncDevice, removeSyncDevice } from './views/sync/sync-panel';
import { initSyncHost, setOnGuestConnected, setOnGuestDisconnected, getHostRoomId, getHostRelayUrl, generateHostPairingCode, validatePairingAttempt, addGuest, handleClaudeSendFromGuest, handleClaudeStopFromGuest, setOnClaudeRelayRequest, setOnClaudeRelayStop } from './sync-host';
import { initSyncGuest, sendClaudeRequest } from './sync-guest';
import { getOrCreateDeviceId } from './paths';
import {
  connectToRelay, disconnectFromRelay, sendToRelay,
  setOnRelayConnected, setOnRelayDisconnected,
  setOnRelayMessage, isRelayConnected, setOnTransportDebug,
} from './sync-transport';

// Compile-time platform ID injected by Perry codegen:
// 0 = macOS, 1 = iOS, 2 = Android, 3 = Windows, 4 = Linux, 5 = Web
declare const __platform__: number;

// FFI function from @honeide/editor — returns raw NSView* for an EditorView
declare function hone_editor_nsview(handle: number): number;


// Dynamic file tree — loaded from opened folder
let workspaceRoot = '';
let _renderStartMs: number = 0;

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
// Track which compact panel is active: 0=editor, 1=files, 2=search, 3=sync, 4=settings, 5=chat
let compactActivePanel: number = 0;
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
    telemetryTrackTerminalOpen();
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
  // In remote mode, send save to host via relay instead of writing locally
  if (isRemoteExplorerMode() > 0) {
    let msg = 'FILE_SAVE|';
    msg += currentEditorFilePath;
    msg += '\n';
    msg += content;
    sendToRelay(msg);
    let savingMsg = 'Saving: ';
    savingMsg += currentEditorFilePath;
    setSyncStatusText(savingMsg);
    return;
  }
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
  telemetryTrackSettingsOpen();
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
  telemetryTrackFileOpen();
}

function checkOpenFileRequests(): void {
  const path = pollOpenFile();
  if (path.length > 0) {
    // Extract file name from path
    let lastSlash = -1;
    for (let i = path.length - 1; i >= 0; i--) {
      if (path.charCodeAt(i) === 47) { lastSlash = i; break; }
    }
    let name = path;
    if (lastSlash >= 0) {
      name = path.slice(lastSlash + 1);
    }
    openFileInEditor(path, name);
  }
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
    const panel = buildSyncPanel();
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
  renderExplorerPanel(sidebarContainer, colors as any);
}

function renderIPadTopBar(): unknown {
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
    setBtnTint(allBtns[i], getActivityBarForeground());
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
  setBg(border, getPanelBorder());

  const bar = VStack(0, [safeArea, iconRow, border]);
  setBg(bar, getActivityBarBackground());

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

  // Wrap in ScrollView for scrollable file tree
  const scroll = ScrollView();
  scrollViewSetChild(scroll, inner);
  setBg(scroll, getSideBarBackground());
  // Pin inner VStack width to ScrollView (NSScrollView doesn't propagate width)
  widgetMatchParentWidth(inner);
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

  const tbc = HStack(1, []);
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
  // On iOS, ScrollView doesn't propagate width to content — pin sidebarContainer
  // to ScrollView width so explorer/sync/search panels fill the screen
  if (sidebarContainer) widgetMatchParentWidth(sidebarContainer);
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
    setBg(chatPane, getSideBarBackground());
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
  chatInputWidget = renderChatPanel(compactChatPane, null as any);
}

function onBottomBarFiles(): void {
  if (compactActivePanel === 1) {
    // Already showing files — toggle back to editor
    hideExplorer();
    compactActivePanel = 0;
  } else {
    // Re-render explorer into sidebarContainer (sync/search may have replaced it)
    if (sidebarContainer) {
      resetSearchPanelReady();
      renderExplorerPanel(sidebarContainer, null as any);
    }
    showExplorer();
    compactActivePanel = 1;
  }
}

function onBottomBarEditor(): void {
  hideExplorer();
  compactActivePanel = 0;
}

function onBottomBarSearch(): void {
  if (!sidebarContainer) return;
  widgetClearChildren(sidebarContainer);
  resetSearchPanelReady();
  renderSearchPanelImpl(sidebarContainer, null as any);
  showExplorer();
  compactActivePanel = 2;
}

function onBottomBarAI(): void {
  if (compactActivePanel === 5) {
    hideExplorer();
    compactActivePanel = 0;
  } else {
    showChat();
    compactActivePanel = 5;
  }
}

function onBottomBarSync(): void {
  if (!sidebarContainer) return;
  widgetClearChildren(sidebarContainer);
  const panel = buildSyncPanel();
  widgetAddChild(sidebarContainer, panel);
  showExplorer();
  compactActivePanel = 3;
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
  compactActivePanel = 4;
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
  // Check if theme changed — compare 6th char: 'D' (68) for Dark, 'L' (76) for Light
  if (_lastThemeName.length > 0) {
    if (_lastThemeName.charCodeAt(5) === newTheme.charCodeAt(5)) return; // same theme
  }
  _lastThemeName = newTheme;

  // Apply the correct color palette
  // 'Hone Light' has 'L' (76) at charCodeAt(5), 'Hone Dark' has 'D' (68)
  if (newTheme.charCodeAt(5) === 76) {
    applyLightColors();
  } else {
    applyDarkColors();
  }

  setActiveTheme(newTheme);
  recolorUI();
  telemetryTrackThemeChange(newTheme);
}

// ---------------------------------------------------------------------------
// Sync system initialization
// ---------------------------------------------------------------------------

let syncDeviceId = '';
let syncDeviceName = 'Hone Desktop';
let syncStatusOverride = '';
let syncAutoJoinPending: number = 0;
let fileTreeReceived: number = 0;
let fileTreeRetries: number = 0;

// --- Guest file cache (bulk sync) ---
// Maps relPath → file content. Populated during initial bulk sync from host.
let fileCacheKeys: string[] = [];
let fileCacheVals: string[] = [];
let fileCacheCount: number = 0;
let bulkSyncTotal: number = 0;
let bulkSyncReceived: number = 0;
let bulkSyncDone: number = 0;

function fileCacheGet(relPath: string): string {
  for (let i = 0; i < fileCacheCount; i++) {
    if (fileCacheKeys[i].length === relPath.length) {
      let match = 1;
      for (let j = 0; j < relPath.length; j++) {
        if (fileCacheKeys[i].charCodeAt(j) !== relPath.charCodeAt(j)) { match = 0; break; }
      }
      if (match > 0) return fileCacheVals[i];
    }
  }
  return '';
}

function fileCacheHas(relPath: string): number {
  for (let i = 0; i < fileCacheCount; i++) {
    if (fileCacheKeys[i].length === relPath.length) {
      let match = 1;
      for (let j = 0; j < relPath.length; j++) {
        if (fileCacheKeys[i].charCodeAt(j) !== relPath.charCodeAt(j)) { match = 0; break; }
      }
      if (match > 0) return 1;
    }
  }
  return 0;
}

function fileCacheSet(relPath: string, content: string): void {
  // Update existing entry if present
  for (let i = 0; i < fileCacheCount; i++) {
    if (fileCacheKeys[i].length === relPath.length) {
      let match = 1;
      for (let j = 0; j < relPath.length; j++) {
        if (fileCacheKeys[i].charCodeAt(j) !== relPath.charCodeAt(j)) { match = 0; break; }
      }
      if (match > 0) {
        fileCacheVals[i] = content;
        return;
      }
    }
  }
  fileCacheKeys.push(relPath);
  fileCacheVals.push(content);
  fileCacheCount = fileCacheCount + 1;
}

// Module-level storage for collectSyncTree
// Use Map (not Array.push — broken cross-function) and Map.size (not scalar counter — invisible cross-function)
let syncTreeEntries: Map<number, string> = new Map();

function syncDebugLog(msg: string): void {
  try {
    // Use device-specific log file to avoid cross-process corruption
    let logFile = '/tmp/hone-sync-';
    logFile += syncDeviceId.substring(0, 8);
    logFile += '.log';
    let prev = '';
    try { prev = readFileSync(logFile); } catch (e: any) {}
    let out = prev;
    out += '\n';
    out += msg;
    writeFileSync(logFile, out);
  } catch (e: any) {}
}

function initSyncSystem(layoutMode: LayoutMode): void {
  syncDeviceId = getOrCreateDeviceId();
  const ctx = getPlatformContext();

  // Wire pair + join button callbacks
  setSyncPairCallback(onSyncPairClicked);
  setSyncJoinCallback(onSyncJoinClicked);

  if (ctx.deviceClass === 'desktop') {
    initSyncHost(syncDeviceId, 'Hone Desktop');
    setOnGuestConnected(onSyncGuestConnected);
    setOnGuestDisconnected(onSyncGuestDisconnected);
    // Wire host-side Claude Code relay: when guest sends a prompt, start local Claude session
    setOnClaudeRelayRequest(onClaudeRelayRequestFromGuest);
    setOnClaudeRelayStop(onClaudeRelayStopFromGuest);
  } else {
    syncDeviceName = 'Hone Mobile';
    if (ctx.deviceClass === 'tablet') {
      syncDeviceName = 'Hone iPad';
    }
    let platform = 'unknown';
    if (__platform__ === 0) platform = 'macOS';
    if (__platform__ === 1) platform = 'iOS';
    if (__platform__ === 2) platform = 'Android';
    if (__platform__ === 3) platform = 'Windows';
    initSyncGuest(syncDeviceId, syncDeviceName, platform);
    // Mark chat panel as remote guest so Claude Code mode routes through relay
    setChatRemoteGuest(1);
    setChatRelaySendFn(onChatRelayClaudeSend);
  }

  // Wire relay event callbacks
  setOnRelayConnected(onRelayConnectedImpl);
  setOnRelayDisconnected(onRelayDisconnectedImpl);
  setOnRelayMessage(onRelayMessageImpl);
  setOnTransportDebug(onTransportDebugImpl);

  // Wire remote file click callback (for sync guest)
  setRemoteFileClickCallback(onRemoteFileClicked);

  // --- DEBUG AUTO-CONNECT (disabled for testing) ---
  // Manual pairing: click "Pair Device" on host, enter code on guest
  setSyncStatusText('Ready — click Pair Device or Join');

  // Poll sync panel refresh every 5s
  setInterval(() => { refreshSyncPanelDeferred(); }, 5000);
}

function autoConnectDebug(): void {
  const debugRoom = 'pair-DEBUG2';
  const relayUrl = getHostRelayUrl();
  let dbg = 'autoConnectDebug: url=';
  dbg += relayUrl;
  dbg += ' room=';
  dbg += debugRoom;
  dbg += ' device=';
  dbg += syncDeviceId;
  // Write debug to file so we can read it from terminal
  try { writeFileSync('/tmp/hone-sync-debug.log', dbg); } catch (e: any) {}
  setSyncStatusText(dbg);
  connectToRelay(relayUrl, debugRoom, syncDeviceId);
}

function sendAutoJoinDebug(): void {
  // Auto-join: skip pairing, just request file tree directly
  setSyncStatusText('Requesting file tree...');
  sendToRelay('FILE_TREE_REQ');
  fileTreeRetries = 0;
  // Retry FILE_TREE_REQ every 3s until we get a response (host may not be connected yet)
  setInterval(() => { retryFileTreeReq(); }, 3000);
}

function retryFileTreeReq(): void {
  if (fileTreeReceived > 0) return;
  fileTreeRetries = fileTreeRetries + 1;
  if (fileTreeRetries > 10) return;
  syncDebugLog('Retrying FILE_TREE_REQ attempt=' + String(fileTreeRetries));
  sendToRelay('FILE_TREE_REQ');
}

function onTransportDebugImpl(msg: string): void {
  setSyncStatusText(msg);
  syncDebugLog(msg);
}

function onSyncPairClicked(): void {
  // Generate code and use it as the relay room name
  const code = generateHostPairingCode();
  setSyncPairingCode(code);
  let roomId = 'pair-';
  roomId += code;

  // Disconnect any existing connection, then connect with code-based room
  disconnectFromRelay();
  const relayUrl = getHostRelayUrl();
  connectToRelay(relayUrl, roomId, syncDeviceId);

  syncStatusOverride = 'Waiting for guest...';
  setSyncStatusText('Waiting for guest...');
}

function onSyncJoinClicked(code: string): void {
  let dbg = 'onSyncJoinClicked code=[';
  dbg += code;
  dbg += '] len=';
  dbg += String(code.length);
  setSyncStatusText(dbg);
  if (code.length < 1) {
    setSyncStatusText('EMPTY code, aborting');
    return;
  }
  const upper = code.toUpperCase();
  let roomId = 'pair-';
  roomId += upper;

  // Connect to the same room as the host
  disconnectFromRelay();
  const relayUrl = getHostRelayUrl();
  let dbg2 = 'Connecting to ';
  dbg2 += relayUrl;
  dbg2 += ' room=';
  dbg2 += roomId;
  setSyncStatusText(dbg2);
  connectToRelay(relayUrl, roomId, syncDeviceId);

  syncStatusOverride = 'Joining...';

  // Send pair request after a short delay (wait for WS connect)
  setTimeout(() => { sendPairRequest(upper); }, 1500);
}

function sendPairRequest(code: string): void {
  // Format: PAIR_REQ|code|deviceId|deviceName
  let msg = 'PAIR_REQ|';
  msg += code;
  msg += '|';
  msg += syncDeviceId;
  msg += '|';
  msg += syncDeviceName;
  sendToRelay(msg);
}

function onSyncGuestConnected(deviceId: string, deviceName: string): void {
  addSyncDevice(deviceName, 'connected');
  syncStatusOverride = '';
  setSyncStatusText('Guest connected');
  refreshSyncPanelDeferred();
}

function onSyncGuestDisconnected(deviceId: string): void {
  refreshSyncPanelDeferred();
}

// ---------------------------------------------------------------------------
// Claude Code relay callbacks
// ---------------------------------------------------------------------------

// Host-side Claude Code state for relay
let claudeRelayLogPath = '';
let claudeRelayPid: number = 0;
let claudeRelayPollTimer: number = 0;
let claudeRelayLogOffset: number = 0;
let claudeRelayLineBuffer = '';
let claudeRelayDone: number = 0;
let claudeRelayNoData: number = 0;

/**
 * Host callback: guest requested Claude Code execution.
 * Start a local Claude Code subprocess and stream results back via relay.
 */
function onClaudeRelayRequestFromGuest(guestId: string, prompt: string, wsRoot: string, resumeId: string): void {
  syncDebugLog('Claude relay request from guest: prompt=' + prompt.slice(0, 50));

  // Import claude-process functions dynamically won't work in Perry.
  // Instead, use execSync/spawnBackground directly here (same-module pattern).

  // Find claude binary
  let claudeBin = '';
  try {
    const whichResult = execSync('which claude') as unknown as string;
    for (let i = 0; i < whichResult.length; i++) {
      const ch = whichResult.charCodeAt(i);
      if (ch === 10 || ch === 13) break;
      claudeBin += whichResult.slice(i, i + 1);
    }
  } catch (e) {}

  if (claudeBin.length < 3) {
    // Send error back to guest
    sendClaudeRelayError('Claude Code not found on host. Install: npm install -g @anthropic-ai/claude-code');
    return;
  }

  // Clean up previous relay session
  if (claudeRelayPollTimer > 0) {
    clearInterval(claudeRelayPollTimer);
    claudeRelayPollTimer = 0;
  }
  if (claudeRelayPid > 0) {
    try {
      let killCmd = 'kill ';
      killCmd += String(claudeRelayPid);
      execSync(killCmd);
    } catch (e) {}
  }

  // Build log file path
  let logPath = '';
  try {
    const homeResult = execSync('echo $HOME') as unknown as string;
    for (let i = 0; i < homeResult.length; i++) {
      const ch = homeResult.charCodeAt(i);
      if (ch === 10 || ch === 13) break;
      logPath += homeResult.slice(i, i + 1);
    }
  } catch (e) {}
  logPath += '/.hone/claude-relay-';
  logPath += String(Date.now());
  logPath += '.log';
  claudeRelayLogPath = logPath;
  claudeRelayLogOffset = 0;
  claudeRelayLineBuffer = '';
  claudeRelayDone = 0;
  claudeRelayNoData = 0;

  // Write prompt to temp file
  let promptFile = logPath;
  promptFile += '.prompt';
  try {
    writeFileSync(promptFile, prompt);
  } catch (e) {
    sendClaudeRelayError('Failed to write prompt file on host');
    return;
  }

  // Build shell command — same as claude-process.ts
  let cmd = 'unset CLAUDECODE; ';
  cmd += claudeBin;
  cmd += ' -p "$(cat ';
  cmd += shellEscapeRelay(promptFile);
  cmd += ')"';
  cmd += ' --output-format stream-json';
  cmd += ' --verbose';
  cmd += ' --max-turns 25';
  cmd += ' --permission-mode acceptEdits';

  if (wsRoot.length > 0) {
    cmd += ' --add-dir ';
    cmd += shellEscapeRelay(wsRoot);
  }

  if (resumeId.length > 0) {
    cmd += ' --resume ';
    cmd += shellEscapeRelay(resumeId);
  }

  cmd += ' > ';
  cmd += shellEscapeRelay(logPath);
  cmd += ' 2>&1';

  // Spawn background process
  const result = spawnBackground('/bin/sh', ['-c', cmd], '/dev/null');
  claudeRelayPid = result.pid;

  syncDebugLog('Claude relay spawned pid=' + String(claudeRelayPid));

  // Start polling log file and streaming results back to guest
  claudeRelayPollTimer = setInterval(() => { claudeRelayPollTick(); }, 100);

  // Clean up prompt file after delay
  setTimeout(() => { cleanupRelayPromptFile(promptFile); }, 3000);
}

function cleanupRelayPromptFile(path: string): void {
  try { unlinkSync(path); } catch (e) {}
}

function shellEscapeRelay(s: string): string {
  let result = "'";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 39) {
      result += "'\\''";
    } else {
      result += s.slice(i, i + 1);
    }
  }
  result += "'";
  return result;
}

/**
 * Poll the Claude Code log file and stream NDJSON events back to guest via relay.
 */
function claudeRelayPollTick(): void {
  if (claudeRelayDone > 0) return;
  if (claudeRelayLogPath.length < 1) return;

  let content = '';
  try {
    content = readFileSync(claudeRelayLogPath);
  } catch (e) {
    return;
  }

  if (content.length <= claudeRelayLogOffset) {
    claudeRelayNoData += 1;
    if (claudeRelayNoData > 60) {
      claudeRelayNoData = 0;
      // Check if process exited
      let gone: number = 0;
      try {
        let checkCmd = 'kill -0 ';
        checkCmd += String(claudeRelayPid);
        execSync(checkCmd);
      } catch (e) {
        gone = 1;
      }
      if (gone > 0) {
        claudeRelayDone = 1;
        if (claudeRelayPollTimer > 0) {
          clearInterval(claudeRelayPollTimer);
          claudeRelayPollTimer = 0;
        }
        // Send final result if we have nothing else
        sendClaudeRelayResult('', -1, -1);
      }
    }
    return;
  }

  claudeRelayNoData = 0;
  const newData = content.slice(claudeRelayLogOffset);
  claudeRelayLogOffset = content.length;

  let buffer = claudeRelayLineBuffer;
  buffer += newData;
  claudeRelayLineBuffer = '';

  let lineStart = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer.charCodeAt(i) === 10) {
      const line = buffer.slice(lineStart, i);
      if (line.length > 10) {
        processClaudeRelayLine(line);
      }
      lineStart = i + 1;
    }
  }

  if (lineStart < buffer.length) {
    claudeRelayLineBuffer = buffer.slice(lineStart);
  }
}

/**
 * Process a single NDJSON line from the Claude Code log and relay relevant events to guest.
 */
function processClaudeRelayLine(line: string): void {
  // Detect event type using same logic as chat-panel handleClaudeLine
  const evtType = detectRelayEventType(line);
  if (evtType < 1) return;

  // System event (1) — just note, don't send to guest
  if (evtType === 1) {
    return;
  }

  // Assistant event (2) — extract text and tool info, stream to guest
  if (evtType === 2) {
    // Check for tool_use
    if (lineContainsRelay(line, 'tool_use') > 0) {
      let toolName = extractAiField(line, '"name":');
      if (toolName.length > 0) {
        sendClaudeRelayStream('', 'tool', toolName);
      }
    }
    // Extract text content
    if (lineContainsRelay(line, '"type":"text"') > 0) {
      let searchPat = '"type":"text"';
      let foundPos = -1;
      for (let i = 0; i <= line.length - searchPat.length; i++) {
        let m: number = 1;
        for (let j = 0; j < searchPat.length; j++) {
          if (line.charCodeAt(i + j) !== searchPat.charCodeAt(j)) { m = 0; break; }
        }
        if (m > 0) { foundPos = i + searchPat.length; break; }
      }
      if (foundPos > 0) {
        let remainder = line.slice(foundPos);
        let textVal = extractAiField(remainder, '"text":');
        if (textVal.length > 0) {
          sendClaudeRelayStream(textVal, 'text', '');
        }
      }
    }
    return;
  }

  // Result event (3) — send final result to guest
  if (evtType === 3) {
    let isError: number = 0;
    if (lineContainsRelay(line, '"is_error":true') > 0) isError = 1;

    let resultText = extractAiField(line, ',"result":');
    // Parse cost and turns as strings, send as-is
    let costStr = extractAiField(line, '"total_cost":');
    let turnsStr = extractAiField(line, '"num_turns":');
    let costVal: number = -1;
    let turnsVal: number = -1;
    if (costStr.length > 0) costVal = Number(costStr);
    if (turnsStr.length > 0) turnsVal = Number(turnsStr);

    claudeRelayDone = 1;
    if (claudeRelayPollTimer > 0) {
      clearInterval(claudeRelayPollTimer);
      claudeRelayPollTimer = 0;
    }

    if (isError > 0) {
      sendClaudeRelayError(resultText);
    } else {
      sendClaudeRelayResult(resultText, costVal, turnsVal);
    }
    // Clean up log file
    try { unlinkSync(claudeRelayLogPath); } catch (e) {}
    return;
  }

  // User event (4) — tool result done
  if (evtType === 4) {
    sendClaudeRelayStream('', 'toolDone', '');
  }
}

function detectRelayEventType(line: string): number {
  // Same detection as handleClaudeLine: find "type":"..." value
  let pat = '"type":';
  let pos = -1;
  for (let i = 0; i <= line.length - pat.length; i++) {
    let m: number = 1;
    for (let j = 0; j < pat.length; j++) {
      if (line.charCodeAt(i + j) !== pat.charCodeAt(j)) { m = 0; break; }
    }
    if (m > 0) { pos = i + pat.length; break; }
  }
  if (pos < 0) return 0;
  // Skip whitespace and opening quote
  while (pos < line.length && (line.charCodeAt(pos) === 32 || line.charCodeAt(pos) === 9)) pos += 1;
  if (pos >= line.length || line.charCodeAt(pos) !== 34) return 0;
  pos += 1;
  // Read type value
  if (pos >= line.length) return 0;
  const ch0 = line.charCodeAt(pos);
  // system: s(115)
  if (ch0 === 115) return 1;
  // assistant: a(97)
  if (ch0 === 97) return 2;
  // result: r(114)
  if (ch0 === 114) return 3;
  // user: u(117)
  if (ch0 === 117) return 4;
  return 0;
}

function lineContainsRelay(line: string, sub: string): number {
  if (sub.length > line.length) return 0;
  for (let i = 0; i <= line.length - sub.length; i++) {
    let m: number = 1;
    for (let j = 0; j < sub.length; j++) {
      if (line.charCodeAt(i + j) !== sub.charCodeAt(j)) { m = 0; break; }
    }
    if (m > 0) return 1;
  }
  return 0;
}

/** Send a claude stream event to guest via relay. */
function sendClaudeRelayStream(delta: string, deltaType: string, toolName: string): void {
  let msg = '{"domain":"ai","operation":"claudeStream","payload":{"delta":"';
  msg += jsonEscapeRelay(delta);
  msg += '","deltaType":"';
  msg += deltaType;
  msg += '","toolName":"';
  msg += jsonEscapeRelay(toolName);
  msg += '"}}';
  sendToRelay(msg);
}

/** Send a claude result event to guest via relay. */
function sendClaudeRelayResult(resultText: string, costUsd: number, numTurns: number): void {
  let msg = '{"domain":"ai","operation":"claudeResult","payload":{"result":"';
  msg += jsonEscapeRelay(resultText);
  msg += '","costUsd":';
  msg += String(costUsd);
  msg += ',"numTurns":';
  msg += String(numTurns);
  msg += '}}';
  sendToRelay(msg);
}

/** Send a claude error event to guest via relay. */
function sendClaudeRelayError(error: string): void {
  let msg = '{"domain":"ai","operation":"claudeError","payload":{"error":"';
  msg += jsonEscapeRelay(error);
  msg += '"}}';
  sendToRelay(msg);
}

/** JSON-escape a string for relay payloads. */
function jsonEscapeRelay(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 92) { result += '\\\\'; }
    else if (ch === 34) { result += '\\"'; }
    else if (ch === 10) { result += '\\n'; }
    else if (ch === 13) { result += '\\r'; }
    else if (ch === 9) { result += '\\t'; }
    else { result += s.slice(i, i + 1); }
  }
  return result;
}

/**
 * Guest callback: send Claude Code prompt to host via relay.
 * Called from chat-panel.ts via setChatRelaySendFn.
 */
function onChatRelayClaudeSend(prompt: string): void {
  sendClaudeRequest(prompt, workspaceRoot, '');
}

/**
 * Host callback: stop Claude Code relay session.
 */
function onClaudeRelayStopFromGuest(guestId: string, sessionId: string): void {
  syncDebugLog('Claude relay stop from guest');
  claudeRelayDone = 1;
  if (claudeRelayPollTimer > 0) {
    clearInterval(claudeRelayPollTimer);
    claudeRelayPollTimer = 0;
  }
  if (claudeRelayPid > 0) {
    try {
      let killCmd = 'kill ';
      killCmd += String(claudeRelayPid);
      execSync(killCmd);
    } catch (e) {}
    claudeRelayPid = 0;
  }
}

function onRelayConnectedImpl(): void {
  if (syncStatusOverride.length === 0) {
    setSyncStatusText('Connected to relay');
  }
  syncDebugLog('onRelayConnectedImpl fired');
  refreshSyncPanelDeferred();
  // If auto-join is pending (debug mode), request file tree now
  if (syncAutoJoinPending > 0) {
    syncAutoJoinPending = 0;
    setSyncStatusText('Connected! Requesting files...');
    setTimeout(() => { sendAutoJoinDebug(); }, 500);
  }
}

function onRelayDisconnectedImpl(): void {
  setSyncStatusText('Disconnected');
  syncStatusOverride = '';
  refreshSyncPanelDeferred();
}

function onRelayMessageImpl(data: string): void {
  syncDebugLog('RECV: ' + data.substring(0, 200));

  // Extract "from" field to detect self-messages
  let msgFrom = '';
  const fromIdx = data.indexOf('"from"');
  if (fromIdx >= 0) {
    let fStart = fromIdx + 6;
    while (fStart < data.length && data.charCodeAt(fStart) !== 34) fStart = fStart + 1;
    fStart = fStart + 1; // skip opening "
    let fEnd = fStart;
    while (fEnd < data.length && data.charCodeAt(fEnd) !== 34) fEnd = fEnd + 1;
    msgFrom = data.substring(fStart, fEnd);
  }
  const isSelf = (msgFrom === syncDeviceId) ? 1 : 0;

  // Extract payload from relay envelope: find "payload" key and its string value
  const pkIdx = data.indexOf('"payload"');
  if (pkIdx < 0) return;
  // Find the opening quote of the value (skip colon and optional whitespace)
  let pStart = pkIdx + 9; // skip past "payload"
  // Skip : and whitespace
  while (pStart < data.length) {
    const c = data.charCodeAt(pStart);
    if (c === 58 || c === 32 || c === 9) { // : or space or tab
      pStart = pStart + 1;
    } else {
      break;
    }
  }
  if (pStart >= data.length || data.charCodeAt(pStart) !== 34) return; // must be opening "
  pStart = pStart + 1; // skip past opening "
  // Find closing unescaped quote
  let pEnd = pStart;
  for (let i = pStart; i < data.length; i++) {
    if (data.charCodeAt(i) === 92) { // backslash — skip next char
      i = i + 1;
    } else if (data.charCodeAt(i) === 34) { // quote — end of payload
      pEnd = i;
      break;
    }
  }
  const rawPayload = data.substring(pStart, pEnd);
  // Unescape JSON string escapes: \\n → \n, \\r → \r, \\" → ", \\\\ → backslash
  let payload = '';
  for (let ui = 0; ui < rawPayload.length; ui++) {
    if (rawPayload.charCodeAt(ui) === 92 && ui + 1 < rawPayload.length) {
      const nc = rawPayload.charCodeAt(ui + 1);
      if (nc === 110) { payload += '\n'; ui = ui + 1; }
      else if (nc === 114) { payload += '\r'; ui = ui + 1; }
      else if (nc === 34) { payload += '"'; ui = ui + 1; }
      else if (nc === 92) { payload += '\\'; ui = ui + 1; }
      else { payload += rawPayload.charAt(ui); }
    } else {
      payload += rawPayload.charAt(ui);
    }
  }

  // Handle PAIR_REQ|code|deviceId|deviceName
  if (payload.indexOf('PAIR_REQ|') === 0) {
    handlePairRequest(payload);
    return;
  }
  // Handle PAIR_OK|deviceId|deviceName
  if (payload.indexOf('PAIR_OK|') === 0) {
    handlePairAccepted(payload);
    return;
  }
  // Handle FILE_TREE_REQ — guest asks host for file tree (only from others)
  if (payload.indexOf('FILE_TREE_REQ') === 0) {
    if (isSelf < 1) handleFileTreeRequest();
    return;
  }
  // Handle FILE_TREE|rootName;;D|dir;;F|file;;... (only from others)
  if (payload.indexOf('FILE_TREE|') === 0) {
    if (isSelf < 1) handleFileTreeResponse(payload);
    return;
  }
  // Handle FILE_REQ|relPath — guest asks host for file content (only from others)
  if (payload.indexOf('FILE_REQ|') === 0) {
    if (isSelf < 1) handleFileContentRequest(payload);
    return;
  }
  // Handle FILE_DATA|relPath|content — host sends file to guest (only from others)
  if (payload.indexOf('FILE_DATA|') === 0) {
    if (isSelf < 1) handleFileContentResponse(payload);
    return;
  }
  // Handle BULK_SYNC_START|count — host starting bulk file push
  if (payload.indexOf('BULK_SYNC_START|') === 0) {
    if (isSelf < 1) {
      const countStr = payload.substring(16);
      bulkSyncTotal = Number(countStr);
      bulkSyncReceived = 0;
      bulkSyncDone = 0;
      setSyncStatusText('Receiving files: 0/' + countStr);
    }
    return;
  }
  // Handle BULK_SYNC_END — host finished bulk push
  if (payload.indexOf('BULK_SYNC_END') === 0) {
    if (isSelf < 1) {
      bulkSyncDone = 1;
      let doneMsg = 'Synced ';
      doneMsg += String(fileCacheCount);
      doneMsg += ' files';
      setSyncStatusText(doneMsg);
      syncDebugLog(doneMsg);
    }
    return;
  }
  // Handle FILE_SAVE_OK|relPath — host confirms save (check before FILE_SAVE| to avoid prefix match)
  if (payload.indexOf('FILE_SAVE_OK|') === 0) {
    if (isSelf < 1) handleFileSaveOk(payload);
    return;
  }
  // Handle FILE_SAVE|relPath\ncontent — guest sends edited file to host
  if (payload.indexOf('FILE_SAVE|') === 0) {
    if (isSelf < 1) handleFileSave(payload);
    return;
  }

  // Handle AI domain messages: {"domain":"ai","operation":"...","payload":{...}}
  // Check for "domain":"ai" (charCodeAt for { = 123, " = 34, d = 100)
  if (payload.length > 20 && payload.charCodeAt(0) === 123) {
    // Check if it starts with {"domain":"ai"
    // We look for "domain" key with "ai" value
    let isDomainAi: number = 0;
    let domainIdx = payload.indexOf('"domain"');
    if (domainIdx >= 0) {
      let afterDomain = domainIdx + 8;
      // Skip :"
      while (afterDomain < payload.length && payload.charCodeAt(afterDomain) !== 34) afterDomain += 1;
      afterDomain += 1;
      // Check if value starts with "ai"
      if (afterDomain + 1 < payload.length) {
        if (payload.charCodeAt(afterDomain) === 97 && payload.charCodeAt(afterDomain + 1) === 105) {
          isDomainAi = 1;
        }
      }
    }
    if (isDomainAi > 0 && isSelf < 1) {
      handleAiRelayMessage(payload, msgFrom);
      return;
    }
  }

  refreshSyncPanelDeferred();
}

function handlePairRequest(payload: string): void {
  // Parse: PAIR_REQ|code|deviceId|deviceName
  const sep1 = payload.indexOf('|');
  const rest1 = payload.substring(sep1 + 1);
  const sep2 = rest1.indexOf('|');
  const code = rest1.substring(0, sep2);
  const rest2 = rest1.substring(sep2 + 1);
  const sep3 = rest2.indexOf('|');
  const guestDeviceId = rest2.substring(0, sep3);
  const guestName = rest2.substring(sep3 + 1);

  // Validate the code
  if (validatePairingAttempt(code) > 0) {
    // Accept — add guest and send confirmation
    addGuest(guestDeviceId, guestName);
    addSyncDevice(guestName, 'connected');
    syncStatusOverride = '';
    setSyncStatusText('Paired!');
    setSyncPairingCode('');

    // Send acceptance: PAIR_OK|deviceId|deviceName
    let msg = 'PAIR_OK|';
    msg += syncDeviceId;
    msg += '|Hone Desktop';
    sendToRelay(msg);
    refreshSyncPanelDeferred();
  } else {
    // Reject
    sendToRelay('PAIR_NO|invalid code');
  }
}

function handlePairAccepted(payload: string): void {
  // Parse: PAIR_OK|deviceId|deviceName
  const sep1 = payload.indexOf('|');
  const rest1 = payload.substring(sep1 + 1);
  const sep2 = rest1.indexOf('|');
  const hostDeviceId = rest1.substring(0, sep2);
  const hostName = rest1.substring(sep2 + 1);

  addSyncDevice(hostName, 'connected');
  syncStatusOverride = '';
  setSyncStatusText('Paired!');
  refreshSyncPanelDeferred();
  // Guest: request file tree from host after pairing
  setTimeout(() => { requestFileTreeFromHost(); }, 500);
}

// ---------------------------------------------------------------------------
// File sync protocol
// ---------------------------------------------------------------------------

function requestFileTreeFromHost(): void {
  sendToRelay('FILE_TREE_REQ');
  setSyncStatusText('Requesting files...');
}

/** Host: scan workspace and send file tree to guest. */
function handleFileTreeRequest(): void {
  syncDebugLog('handleFileTreeRequest: root=' + workspaceRoot);
  if (workspaceRoot.length < 1) {
    sendToRelay('FILE_TREE|empty');
    return;
  }
  // Reset module-level tree storage
  syncTreeEntries = new Map();

  // Collect files — writes to module-level syncTreeEntries Map
  collectSyncTreeDir(workspaceRoot, '', 0);

  const entryCount = syncTreeEntries.size;
  syncDebugLog('collectSyncTree done: ' + String(entryCount) + ' entries');

  // Get the root folder name
  let rootName = getFileName(workspaceRoot);

  // Build message: FILE_TREE|rootName;;D|dir;;F|file;;...
  let msg = 'FILE_TREE|';
  msg += rootName;
  for (let i = 0; i < entryCount; i++) {
    if (syncTreeEntries.has(i)) {
      msg += ';;';
      msg += syncTreeEntries.get(i);
    }
  }

  syncDebugLog('msg len=' + String(msg.length) + ' first100=' + msg.substring(0, 100));
  sendToRelay(msg);
  setSyncStatusText('Sent file tree');

  // --- Bulk sync: send all text/source files after the tree ---
  // Collect file relPaths from the tree entries (capped at 200 files)
  let textFiles: string[] = [];
  let textFileCount = 0;
  for (let i = 0; i < entryCount; i++) {
    if (textFileCount >= 200) break;
    if (!syncTreeEntries.has(i)) continue;
    const entry = syncTreeEntries.get(i) as string;
    if (entry.length < 3) continue;
    // Only files (F|...), not dirs (D|...)
    if (entry.charCodeAt(0) !== 70) continue;
    const relPath = entry.substring(2);
    if (isTextFile(relPath) > 0) {
      textFiles.push(relPath);
      textFileCount = textFileCount + 1;
    }
  }

  // Send BULK_SYNC_START|count so guest knows how many files to expect
  let startMsg = 'BULK_SYNC_START|';
  startMsg += String(textFileCount);
  sendToRelay(startMsg);
  syncDebugLog('Bulk sync: ' + String(textFileCount) + ' text files');

  // Send each file with a small delay to avoid overwhelming the relay
  bulkSyncIdx = 0;
  bulkSyncFiles = textFiles;
  bulkSyncFileCount = textFileCount;
  bulkSyncTotalSent = 0;
  // Drip-feed files: send 1 file every 100ms via setInterval (reduced from 3/50ms)
  if (textFileCount > 0) {
    setSyncStatusText('Syncing ' + String(textFileCount) + ' files...');
    bulkSyncTimerId = setInterval(() => { bulkSyncTick(); }, 100);
  }
}

// Host: bulk sync state
let bulkSyncIdx: number = 0;
let bulkSyncFiles: string[] = [];
let bulkSyncFileCount: number = 0;
let bulkSyncTimerId: number = 0;
let bulkSyncTotalSent: number = 0;
const BULK_SYNC_BATCH = 1; // files per tick (reduced from 3 to limit memory pressure)
const BULK_FILE_MAX_SIZE = 51200; // 50KB per file (reduced from 1MB)
const BULK_SYNC_TOTAL_MAX = 5242880; // 5MB total cap

function bulkSyncTick(): void {
  // Stop early if total size cap exceeded
  if (bulkSyncTotalSent >= BULK_SYNC_TOTAL_MAX) {
    clearInterval(bulkSyncTimerId);
    sendToRelay('BULK_SYNC_END');
    setSyncStatusText('Sync capped (' + String(bulkSyncIdx) + ' files, 5MB limit)');
    syncDebugLog('Bulk sync stopped: total size cap reached');
    return;
  }
  let sent = 0;
  while (bulkSyncIdx < bulkSyncFileCount && sent < BULK_SYNC_BATCH) {
    const relPath = bulkSyncFiles[bulkSyncIdx];
    bulkSyncIdx = bulkSyncIdx + 1;
    let fullPath = workspaceRoot;
    fullPath += '/';
    fullPath += relPath;
    const content = safeReadFile(fullPath);
    // Skip files that are too large or couldn't be read
    if (content.length > BULK_FILE_MAX_SIZE) continue;
    if (content.length === 0) continue;
    // Check total size cap before sending
    if (bulkSyncTotalSent + content.length > BULK_SYNC_TOTAL_MAX) continue;
    let msg = 'FILE_DATA|';
    msg += relPath;
    msg += '\n';
    msg += content;
    sendToRelay(msg);
    bulkSyncTotalSent = bulkSyncTotalSent + content.length;
    sent = sent + 1;
  }
  if (bulkSyncIdx >= bulkSyncFileCount) {
    clearInterval(bulkSyncTimerId);
    sendToRelay('BULK_SYNC_END');
    setSyncStatusText('Sync complete (' + String(bulkSyncFileCount) + ' files)');
    syncDebugLog('Bulk sync complete');
  }
}

/** Check if a file is a text/source file based on extension. */
function isTextFile(relPath: string): number {
  // Find last dot
  let dotIdx = -1;
  for (let i = relPath.length - 1; i >= 0; i--) {
    if (relPath.charCodeAt(i) === 46) { dotIdx = i; break; }
    if (relPath.charCodeAt(i) === 47) break; // hit dir separator before dot
  }
  if (dotIdx < 0) return 0;
  const ext = relPath.substring(dotIdx + 1);
  // Common text/source extensions
  if (ext.length === 2) {
    if (ext === 'ts') return 1;
    if (ext === 'js') return 1;
    if (ext === 'rs') return 1;
    if (ext === 'py') return 1;
    if (ext === 'go') return 1;
    if (ext === 'rb') return 1;
    if (ext === 'md') return 1;
    if (ext === 'sh') return 1;
    if (ext === 'cs') return 1;
  }
  if (ext.length === 3) {
    if (ext === 'tsx') return 1;
    if (ext === 'jsx') return 1;
    if (ext === 'css') return 1;
    if (ext === 'vue') return 1;
    if (ext === 'yml') return 1;
    if (ext === 'xml') return 1;
    if (ext === 'svg') return 1;
    if (ext === 'sql') return 1;
    if (ext === 'txt') return 1;
    if (ext === 'ini') return 1;
    if (ext === 'cfg') return 1;
    if (ext === 'env') return 1;
    if (ext === 'htm') return 1;
    if (ext === 'lua') return 1;
    if (ext === 'zig') return 1;
    if (ext === 'nim') return 1;
  }
  if (ext.length === 4) {
    if (ext === 'json') return 1;
    if (ext === 'toml') return 1;
    if (ext === 'yaml') return 1;
    if (ext === 'html') return 1;
    if (ext === 'scss') return 1;
    if (ext === 'less') return 1;
    if (ext === 'lock') return 1;
    if (ext === 'conf') return 1;
    if (ext === 'java') return 1;
    if (ext === 'dart') return 1;
    if (ext === 'swift') return 0; // 5 chars, handled below
    if (ext === 'diff') return 1;
  }
  if (ext.length === 5) {
    if (ext === 'swift') return 1;
    if (ext === 'patch') return 1;
  }
  // Dotfiles without extension that are text: Makefile, Dockerfile, etc.
  // Handle by checking common names
  let lastSlash = -1;
  for (let i = relPath.length - 1; i >= 0; i--) {
    if (relPath.charCodeAt(i) === 47) { lastSlash = i; break; }
  }
  const name = lastSlash >= 0 ? relPath.substring(lastSlash + 1) : relPath;
  if (name === 'Makefile') return 1;
  if (name === 'Dockerfile') return 1;
  if (name === 'Cargo.toml') return 1;
  if (name === 'Cargo.lock') return 1;
  return 0;
}

function collectSyncTreeDir(absDir: string, relPrefix: string, depth: number): void {
  if (depth > 8) return;
  if (syncTreeEntries.size > 500) return;
  let names: string[] = [];
  try { names = readdirSync(absDir); } catch (e) {
    syncDebugLog('readdirSync FAILED: ' + absDir);
    return;
  }

  // First pass: separate dirs and files, skip hidden + known large dirs
  let dirCount = 0;
  let fileCount = 0;
  let dirMap: Map<number, string> = new Map();
  let fileMap: Map<number, string> = new Map();
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (n.length < 1) continue;
    if (n.charCodeAt(0) === 46) continue; // skip .hidden
    // Skip known large dirs using charCodeAt (Perry string === unreliable)
    if (n.length === 12 && n.charCodeAt(0) === 110) continue; // node_modules
    if (n.length === 6 && n.charCodeAt(0) === 116 && n.charCodeAt(1) === 97) continue; // target
    if (n.length === 5 && n.charCodeAt(0) === 98 && n.charCodeAt(1) === 117) continue; // build
    if (n.length === 4 && n.charCodeAt(0) === 100 && n.charCodeAt(1) === 105) continue; // dist
    if (n.length === 11 && n.charCodeAt(0) === 95 && n.charCodeAt(1) === 95) continue; // __pycache__
    if (n.length === 6 && n.charCodeAt(0) === 118 && n.charCodeAt(1) === 101) continue; // vendor
    // Skip .app bundles (macOS app bundles look like directories)
    if (n.length > 4 && n.charCodeAt(n.length - 4) === 46 && n.charCodeAt(n.length - 3) === 97 && n.charCodeAt(n.length - 2) === 112 && n.charCodeAt(n.length - 1) === 112) continue;
    const full = join(absDir, n);
    const isDirResult = isDirectory(full);
    if (isDirResult) {
      dirMap.set(dirCount, n);
      dirCount = dirCount + 1;
    } else {
      fileMap.set(fileCount, n);
      fileCount = fileCount + 1;
    }
  }

  // Add dirs first (with recursion), then files
  for (let i = 0; i < dirCount; i++) {
    if (syncTreeEntries.size > 500) return;
    if (!dirMap.has(i)) continue;
    const dn = dirMap.get(i) as string;
    let relPath = '';
    if (relPrefix.length > 0) {
      relPath = relPrefix;
      relPath += '/';
      relPath += dn;
    } else {
      relPath = dn;
    }
    let entry = 'D|';
    entry += relPath;
    syncTreeEntries.set(syncTreeEntries.size, entry);
    // Recurse
    const full = join(absDir, dn);
    collectSyncTreeDir(full, relPath, depth + 1);
  }
  for (let i = 0; i < fileCount; i++) {
    if (syncTreeEntries.size > 500) return;
    if (!fileMap.has(i)) continue;
    const fn_ = fileMap.get(i) as string;
    let relPath = '';
    if (relPrefix.length > 0) {
      relPath = relPrefix;
      relPath += '/';
      relPath += fn_;
    } else {
      relPath = fn_;
    }
    let entry = 'F|';
    entry += relPath;
    syncTreeEntries.set(syncTreeEntries.size, entry);
  }
}

/** Guest: receive file tree from host and populate explorer. */
function handleFileTreeResponse(payload: string): void {
  fileTreeReceived = 1;
  // Parse FILE_TREE|rootName;;D|dir;;F|file;;...
  const prefixLen = 10; // "FILE_TREE|".length
  const body = payload.substring(prefixLen);

  // Split by ;; separator
  let parts: string[] = [];
  let partStart = 0;
  for (let i = 0; i < body.length; i++) {
    if (body.charCodeAt(i) === 59 && i + 1 < body.length && body.charCodeAt(i + 1) === 59) {
      if (i > partStart) {
        parts.push(body.substring(partStart, i));
      }
      partStart = i + 2;
      i = i + 1; // skip second ;
    }
  }
  // Last part
  if (partStart < body.length) {
    parts.push(body.substring(partStart));
  }

  if (parts.length < 1) return;
  const rootName = parts[0];

  // Remaining parts are entries
  let entries: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    entries.push(parts[i]);
  }

  let dbgMsg = 'Tree: ';
  dbgMsg += String(entries.length);
  dbgMsg += ' entries from ';
  dbgMsg += rootName;
  setSyncStatusText(dbgMsg);
  syncDebugLog(dbgMsg);
  setRemoteFileTree(rootName, entries, entries.length);
  // Auto-switch to explorer panel to show the remote file tree
  switchSidebarPanel(0);

  // Auto-open the first source file in the tree (prefer .ts, then any text file)
  let firstFile = '';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.length > 2 && e.charCodeAt(0) === 70) { // 'F' = file entry
      const relPath = e.substring(2);
      // Prefer .ts files
      if (relPath.length > 3 && relPath.charCodeAt(relPath.length - 3) === 46 && relPath.charCodeAt(relPath.length - 2) === 116 && relPath.charCodeAt(relPath.length - 1) === 115) {
        firstFile = relPath;
        break;
      }
      if (firstFile.length === 0) firstFile = relPath;
    }
  }
  if (firstFile.length > 0) {
    onRemoteFileClicked(firstFile);
  }
}

/** Host: guest sent an edited file to save to disk. */
function handleFileSave(payload: string): void {
  // FILE_SAVE|relPath\ncontent
  const prefixLen = 10; // "FILE_SAVE|".length
  const body = payload.substring(prefixLen);
  let nlIdx = -1;
  for (let i = 0; i < body.length; i++) {
    if (body.charCodeAt(i) === 10) { nlIdx = i; break; }
  }
  if (nlIdx < 0) return;
  const relPath = body.substring(0, nlIdx);
  const content = body.substring(nlIdx + 1);
  if (relPath.length < 1) return;
  if (workspaceRoot.length < 1) return;
  let fullPath = workspaceRoot;
  fullPath += '/';
  fullPath += relPath;
  writeFileSync(fullPath, content);
  // Confirm to guest
  let okMsg = 'FILE_SAVE_OK|';
  okMsg += relPath;
  sendToRelay(okMsg);
  let statusMsg = 'Guest saved: ';
  statusMsg += relPath;
  setSyncStatusText(statusMsg);
  syncDebugLog(statusMsg);
}

/** Guest: host confirmed the file was saved. */
function handleFileSaveOk(payload: string): void {
  // FILE_SAVE_OK|relPath
  const relPath = payload.substring(13); // "FILE_SAVE_OK|".length
  let statusMsg = 'Saved: ';
  statusMsg += relPath;
  setSyncStatusText(statusMsg);
  // Update cached content so future opens show saved version
  if (editorReady > 0 && currentEditorFilePath.length > 0) {
    let isMatch = 0;
    if (currentEditorFilePath.length === relPath.length) {
      isMatch = 1;
      for (let k = 0; k < relPath.length; k++) {
        if (currentEditorFilePath.charCodeAt(k) !== relPath.charCodeAt(k)) { isMatch = 0; break; }
      }
    }
    if (isMatch > 0) {
      const content = editorInstance.getContent();
      fileCacheSet(relPath, content);
      markTabSaved(content.length);
    }
  }
}

// ---------------------------------------------------------------------------
// AI domain relay messages (Claude Code relay)
// ---------------------------------------------------------------------------

/**
 * Extract a JSON string field value from a relay payload.
 * keyWithColon includes the colon, e.g. '"operation":'
 */
function extractAiField(json: string, keyWithColon: string): string {
  let pos = -1;
  for (let i = 0; i <= json.length - keyWithColon.length; i++) {
    let match: number = 1;
    for (let j = 0; j < keyWithColon.length; j++) {
      if (json.charCodeAt(i + j) !== keyWithColon.charCodeAt(j)) {
        match = 0;
        break;
      }
    }
    if (match > 0) {
      pos = i + keyWithColon.length;
      break;
    }
  }
  if (pos < 0) return '';
  // Skip whitespace
  while (pos < json.length) {
    const ch = json.charCodeAt(pos);
    if (ch === 32 || ch === 9) { pos += 1; } else { break; }
  }
  if (pos >= json.length) return '';
  // Check for opening quote
  if (json.charCodeAt(pos) !== 34) return '';
  pos += 1;
  let result = '';
  while (pos < json.length) {
    const ch = json.charCodeAt(pos);
    if (ch === 92) {
      pos += 1;
      if (pos < json.length) {
        const next = json.charCodeAt(pos);
        if (next === 110) { result += '\n'; }
        else if (next === 116) { result += '\t'; }
        else if (next === 114) { result += '\r'; }
        else if (next === 34) { result += '"'; }
        else if (next === 92) { result += '\\'; }
        else { result += json.slice(pos, pos + 1); }
      }
    } else if (ch === 34) {
      break;
    } else {
      result += json.slice(pos, pos + 1);
    }
    pos += 1;
  }
  return result;
}

/**
 * Extract the inner "payload" JSON object from an AI domain message.
 * Returns the substring between the braces of the payload value.
 */
function extractAiPayload(json: string): string {
  let pat = '"payload"';
  let pos = -1;
  for (let i = 0; i <= json.length - pat.length; i++) {
    let match: number = 1;
    for (let j = 0; j < pat.length; j++) {
      if (json.charCodeAt(i + j) !== pat.charCodeAt(j)) {
        match = 0;
        break;
      }
    }
    if (match > 0) {
      pos = i + pat.length;
      break;
    }
  }
  if (pos < 0) return '';
  // Skip : and whitespace
  while (pos < json.length) {
    const ch = json.charCodeAt(pos);
    if (ch === 58 || ch === 32 || ch === 9) { pos += 1; } else { break; }
  }
  if (pos >= json.length) return '';
  // Expect opening { for the payload object
  if (json.charCodeAt(pos) !== 123) return '';
  let depth = 1;
  let start = pos;
  pos += 1;
  let inString: number = 0;
  while (pos < json.length && depth > 0) {
    const ch = json.charCodeAt(pos);
    if (inString > 0) {
      if (ch === 92) { pos += 1; } // skip escaped char
      else if (ch === 34) { inString = 0; }
    } else {
      if (ch === 34) { inString = 1; }
      else if (ch === 123) { depth += 1; }
      else if (ch === 125) { depth -= 1; }
    }
    pos += 1;
  }
  return json.slice(start, pos);
}

/**
 * Handle an AI-domain relay message.
 * On the HOST: receives claudeSend/claudeStop from guest, starts local Claude Code.
 * On the GUEST: receives claudeStream/claudeResult/claudeError from host, updates chat panel.
 */
function handleAiRelayMessage(payload: string, fromDeviceId: string): void {
  const operation = extractAiField(payload, '"operation":');
  if (operation.length < 6) return;
  const innerPayload = extractAiPayload(payload);

  syncDebugLog('AI relay: op=' + operation);

  // --- Host-side: receive requests from guest ---

  // claudeSend: c(0)l(1)a(2)u(3)d(4)e(5)S(6)e(7)n(8)d(9) — length 10, [7]=101 'e'
  if (operation.length === 10 && operation.charCodeAt(6) === 83 && operation.charCodeAt(7) === 101) {
    // Extract prompt and workspaceRoot from inner payload
    const prompt = extractAiField(innerPayload, '"prompt":');
    let reqWsRoot = extractAiField(innerPayload, '"workspaceRoot":');
    const resumeId = extractAiField(innerPayload, '"resumeSessionId":');
    // Use host workspace root if guest didn't specify one
    if (reqWsRoot.length < 1) reqWsRoot = workspaceRoot;
    handleClaudeSendFromGuest(fromDeviceId, prompt, reqWsRoot, resumeId);
    return;
  }

  // claudeStop: c(0)l(1)a(2)u(3)d(4)e(5)S(6)t(7)o(8)p(9) — length 10, [7]=116 't'
  if (operation.length === 10 && operation.charCodeAt(6) === 83 && operation.charCodeAt(7) === 116) {
    const sessionId = extractAiField(innerPayload, '"sessionId":');
    handleClaudeStopFromGuest(fromDeviceId, sessionId);
    return;
  }

  // --- Guest-side: receive events from host ---

  // claudeStream: 'claudeStream' length=12, charCodeAt(6)=83 'S'
  // claudeResult: 'claudeResult' length=12, charCodeAt(6)=82 'R'
  // claudeError:  'claudeError'  length=11, charCodeAt(6)=69 'E'
  if (operation.length === 12 && operation.charCodeAt(6) === 83) {
    handleClaudeRelayEvent(operation, innerPayload);
    return;
  }
  if (operation.length === 12 && operation.charCodeAt(6) === 82) {
    handleClaudeRelayEvent(operation, innerPayload);
    return;
  }
  if (operation.length === 11 && operation.charCodeAt(6) === 69) {
    handleClaudeRelayEvent(operation, innerPayload);
    return;
  }
}

/** Host: read file and send content to guest. */
function handleFileContentRequest(payload: string): void {
  // FILE_REQ|relPath
  const relPath = payload.substring(9);
  if (relPath.length < 1) return;
  if (workspaceRoot.length < 1) return;
  let fullPath = workspaceRoot;
  fullPath += '/';
  fullPath += relPath;
  const content = safeReadFile(fullPath);
  // Send FILE_DATA|relPath|content (content is base64-ish or raw)
  // For simplicity: send as raw with pipe separator
  // We need to escape pipes in content — use \n as separator since
  // the relay envelope already escapes it
  let msg = 'FILE_DATA|';
  msg += relPath;
  msg += '\n';
  msg += content;
  sendToRelay(msg);
}

/** Guest: receive file content from host and display in editor. */
// The file the user explicitly requested to open (empty = bulk sync background data)
let pendingOpenPath = '';

function handleFileContentResponse(payload: string): void {
  // FILE_DATA|relPath\ncontent
  const prefixLen = 10; // "FILE_DATA|".length
  const body = payload.substring(prefixLen);
  // Find first newline — separates relPath from content
  let nlIdx = -1;
  for (let i = 0; i < body.length; i++) {
    if (body.charCodeAt(i) === 10) { nlIdx = i; break; }
  }
  if (nlIdx < 0) return;
  const relPath = body.substring(0, nlIdx);
  const content = body.substring(nlIdx + 1);

  // Always cache the file content
  fileCacheSet(relPath, content);

  // Update bulk sync progress
  if (bulkSyncDone < 1 && bulkSyncTotal > 0) {
    bulkSyncReceived = bulkSyncReceived + 1;
    let progressMsg = 'Syncing: ';
    progressMsg += String(bulkSyncReceived);
    progressMsg += '/';
    progressMsg += String(bulkSyncTotal);
    setSyncStatusText(progressMsg);
  }

  // Only display in editor if this was a user-requested file
  let isRequested = 0;
  if (pendingOpenPath.length > 0 && pendingOpenPath.length === relPath.length) {
    isRequested = 1;
    for (let j = 0; j < relPath.length; j++) {
      if (pendingOpenPath.charCodeAt(j) !== relPath.charCodeAt(j)) { isRequested = 0; break; }
    }
  }
  if (isRequested > 0) {
    pendingOpenPath = '';
    displayFileFromCache(relPath, content);
  }
}

/** Display a file in the editor (from cache or network). */
function displayFileFromCache(relPath: string, content: string): void {
  setSyncStatusText('Loaded: ' + relPath);
  currentEditorFilePath = relPath;
  updateBreadcrumb();
  if (editorReady > 0) {
    const lang = detectLanguage(relPath);
    editorInstance.setLanguage(lang);
    editorInstance.setContent(content);
    editorInstance.render();
  }
  // Open tab for remote file
  let name = relPath;
  let lastSlash = -1;
  for (let ci = relPath.length - 1; ci >= 0; ci--) {
    if (relPath.charCodeAt(ci) === 47) { lastSlash = ci; break; }
  }
  if (lastSlash >= 0) name = relPath.substring(lastSlash + 1);
  openTab(relPath, name);
  // In compact mode, switch from explorer back to editor pane
  if (compactShowingExplorer > 0) {
    hideExplorer();
    compactActivePanel = 0;
  }
}

/** Guest clicked a remote file in the explorer. */
function onRemoteFileClicked(relPath: string): void {
  // Check local cache first — instant open if already synced
  if (fileCacheHas(relPath) > 0) {
    const content = fileCacheGet(relPath);
    displayFileFromCache(relPath, content);
    return;
  }
  // Not cached — request from host
  setSyncStatusText('Loading: ' + relPath);
  pendingOpenPath = relPath;
  let msg = 'FILE_REQ|';
  msg += relPath;
  sendToRelay(msg);
}

function refreshSyncPanelDeferred(): void {
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
  _renderStartMs = Date.now();

  // Apply theme colors based on saved setting before building any widgets
  const _initThemeSettings = getWorkbenchSettings();
  // 'Hone Light' has 'L' (76) at charCodeAt(5)
  if (_initThemeSettings.colorTheme.length > 5 && _initThemeSettings.colorTheme.charCodeAt(5) === 76) {
    applyLightColors();
  } else {
    applyDarkColors();
  }

  // Register commands with real handlers (overrides stubs in commands.ts)
  registerBuiltinCommands();
  registerCommand('workbench.action.newEditor', 'New Editor', newFileAction, { showInPalette: false });

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

  // Initialize anonymous telemetry (opt-in, privacy-first)
  initTelemetry();

  // Initialize git state for status bar
  refreshGitState();
  updateStatusBarBranch();

  // Initialize sync system
  initSyncSystem(layoutMode);

  if (layoutMode === 'compact') {
    const editorArea = renderEditorArea();
    const explorerPanel = renderSidebar();
    const statusBar = renderStatusBarImpl(null as any);
    const bottomBar = renderBottomToolbar();

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
    setBg(shell, getEditorBackground());
    compactShell = shell;
    telemetryTrackStartup(Date.now() - _renderStartMs);
    return shell;
  }

  if (layoutMode === 'split') {
    // Full iPad split layout using frame-based split
    // renderSidebar() can't be used directly because renderExplorerPanel triggers
    // a layout crash in frame-based containers. Build sidebar inline instead.
    const sidebarInner = VStackWithInsets(0, 0, 0, 0, 0);
    setBg(sidebarInner, getSideBarBackground());
    sidebarContainer = sidebarInner;
    // Defer explorer panel init to after layout is established
    const sideScroll = ScrollView();
    scrollViewSetChild(sideScroll, sidebarInner);
    const leftBox = sideScroll;
    const rightBox = renderEditorArea();

    const statusBar = renderStatusBarImpl(null as any);
    const topBar = renderIPadTopBar();
    widgetSetHugging(topBar, 750);

    const splitContainer = frameSplitCreate(280);
    frameSplitAddChild(splitContainer, leftBox);
    frameSplitAddChild(splitContainer, rightBox);
    widgetSetHugging(splitContainer, 1);

    widgetSetHugging(statusBar, 750);

    const shell = VStack(0, [topBar, splitContainer, statusBar]);
    setBg(shell, getEditorBackground());

    // Defer explorer panel init — calling it synchronously during layout setup
    // causes the frame split container to black-screen on iOS.
    setTimeout(() => { initSplitSidebarExplorer(); }, 100);

    _lastThemeName = getWorkbenchSettings().colorTheme;
    onSettingsChange(() => { onSettingsChanged(); });

    telemetryTrackStartup(Date.now() - _renderStartMs);
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

  // Poll for files opened via macOS "Open With" or command-line args
  setInterval(checkOpenFileRequests, 500);

  telemetryTrackStartup(Date.now() - _renderStartMs);
  return shell;
}

