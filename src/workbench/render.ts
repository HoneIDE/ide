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
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString,
  buttonSetBordered, buttonSetImagePosition,
  widgetAddChild, widgetClearChildren, widgetRemoveChild, widgetAddOverlay, widgetSetOverlayFrame,
  widgetSetWidth, widgetSetHeight, widgetSetHugging, widgetSetHidden, widgetSetBackgroundColor,
  stackSetDetachesHidden, stackSetDistribution,
  widgetMatchParentHeight, widgetMatchParentWidth,
  widgetSetTooltip,
  embedNSView,
  openFolderDialog, openFileDialog, saveFileDialog, pollOpenFile,
  textfieldFocus,
  frameSplitCreate, frameSplitAddChild,
  menuCreate, menuAddItem, menuAddSeparator, widgetSetContextMenu,
} from 'perry/ui';
import { Editor, editorSetBgColor, editorSetFgColor, editorSetGutterFgColor, editorSetSelectionColor, editorSetCursorColor } from '@honeide/editor/perry';
import { t } from 'perry/i18n';
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
  getSecondaryTextColor,
  applyDarkColors, applyLightColors, isCurrentThemeDark,
} from './theme/theme-colors';
import type { LayoutMode } from '../platform';
import { getWorkbenchSettings, updateSettings, onSettingsChange, getSettingsVersion, getLastOpenTabs, getLastActiveTab, getLastPinnedTabs, applyWorkspaceOverlay, setNumberSetting } from './settings';
import { readFileSync, writeFileSync, readdirSync, isDirectory, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { spawnBackground } from 'child_process';
import { execSync, spawnSync } from 'child_process';
import { spawn } from 'perry/thread';
import { getTempDir, getCwd, getHomeDir, getAppDataDir } from './paths';
import { getPlatformContext, isWebPlatform } from '../platform';

import { registerBuiltinCommands, registerCommand } from '../commands';

// Extracted modules
import { setBg, setFg, setBtnFg, setBtnTint, hexToRGBA, getFileName, detectLanguage, getFileIcon, getFileIconColor, monoFont, setIconButton } from './ui-helpers';
import {
  renderSearchPanel as renderSearchPanelImpl,
  setSearchWorkspaceRoot, setSearchFileOpener, setSearchEditorReloader,
  setSearchCurrentEditorPath, resetSearchPanelReady,
} from './views/search/search-panel';
import {
  renderGitPanel as renderGitPanelImpl,
  setGitWorkspaceRoot, setGitFileOpener, setGitStatusBarUpdater, setGitDiffOpener,
  setGenerateCommitMessageHandler, setGeneratePRDescriptionHandler,
  resetGitPanelReady, refreshGitState, refreshGitStateAsync, updateStatusBarBranch,
  getGitFileStatus, getGitDirStatus,
} from './views/git/git-panel';
import {
  renderDiffView, openDiffForFile, closeDiffView, isDiffActive, setDiffThemeColors,
  getDiffHeaderWidget, getDiffEditorsWidget,
} from './views/diff/diff-view';
import {
  renderExplorerPanel, refreshSidebarContent, updateSidebarSelection, revealFileInExplorer, refreshSidebarSelection,
  setSidebarWorkspaceRoot, setSidebarFileClickCallback, setSidebarOpenFolderCallback, setSidebarShowHiddenFiles,
  setSidebarRespectGitignore,
  setSidebarNewFileCallback, setSidebarThemeColors, setSidebarCurrentEditorPath,
  setRemoteFileTree, setRemoteFileClickCallback, isRemoteExplorerMode,
  toggleRemoteDir, clickRemoteFile, getExpandedDirCount, getVisibleFileCount,
} from './views/explorer/sidebar-render';
import {
  setContextMenuWorkspaceRoot, setContextMenuRefreshCallback,
  setContextMenuFileOpener, setContextMenuTerminalOpener,
} from './views/explorer/context-menu';
import {
  initTabBar, setTabDisplayCallback, setTabThemeColors, setTabBarRestoring,
  openTab, getActiveTabPath, getActiveTabIdx, getTabCount,
  getOpenTabCount, getOpenTabPath, setActiveTabByIndex,
  markTabSaved, updateTabDirtyIcon, applyAllTabColors, closeActiveTab, renameActiveTab, closeAllOpenTabs,
  setOnBeforeTabClose, forceCloseTab, isTabDirty,
  pinTab as pinTabImpl,
} from './views/tabs/tab-bar';
import {
  renderStatusBar as renderStatusBarImpl, setStatusBarCursorGetter,
  updateStatusBarBranchLabel as updateStatusBarBranchLabelImpl,
  updateStatusBarDiagnostics as updateStatusBarDiagnosticsImpl,
  updateStatusBarLanguage as updateStatusBarLanguageImpl,
  updateStatusBarEol as updateStatusBarEolImpl,
  updateStatusBarEncoding as updateStatusBarEncodingImpl,
  updateStatusBarIndent as statusBarUpdateIndent,
  pollCursorPosition as pollCursorPositionImpl,
  recolorStatusBar, getStatusBarWidget,
  showUpdateIndicator, setUpdateBtnClickHandler,
  setOnBranchClick, setOnLanguageClick, setOnEncodingClick, setOnEolClick, setOnIndentClick,
  registerStatusBarItem as _sbRegister,
  updateStatusBarItemText as _sbUpdate,
  disposeStatusBarItem as _sbDispose,
} from './views/status-bar/status-bar';
import { clipboardWrite } from 'perry/ui';

// SHIP-V1-GAPS.md #98 — public API for extensions / future hone-api bridge.
// Re-exported here so callers can `import { addStatusBarItem, ... } from './render'`
// instead of reaching into views/status-bar directly.
export function addStatusBarItem(alignment: number, text: string, onClick: (() => void) | null): number {
  return _sbRegister(alignment, text, onClick);
}
export function setStatusBarItemText(idx: number, text: string): void {
  _sbUpdate(idx, text);
}
export function removeStatusBarItem(idx: number): void {
  _sbDispose(idx);
}
import { initUpdateChecker, setOnUpdateAvailable, getLatestVersion, isUpdateAvailable, checkForUpdatesManual } from './views/update/update-checker';
import { renderUpdateTab, resetUpdateTab } from './views/update/update-tab';
// Extensions panel hidden for now — no runtime extension system yet
import { renderChatPanel, focusChatInput, getChatInputHandle, setChatWorkspaceRoot, setChatFilePathGetter, setChatFileContentGetter, setChatRemoteGuest, setChatRelaySendFn, setChatRelayForwardFn, startClaudeForRelay, handleClaudeRelayLine, handleClaudeRelayEvent, prefillChatInput } from './views/ai-chat/chat-panel';
import { renderTerminalPanel, setTerminalCwd, destroyTerminalPanel, setTerminalCloseCallback, setTerminalProblemsFileOpener, applyTerminalThemeColors } from './views/terminal/terminal-panel';
import {
  renderDebugPanel as renderDebugPanelImpl,
  setDebugWorkspaceRoot, setDebugCurrentFilePath, setDebugFileOpener,
  resetDebugPanelReady,
} from './views/debug/debug-panel';
import { renderSettingsTab } from './views/settings-ui/settings-panel';
import { setWelcomeActions, setWelcomeRecentCallback, createWelcomeContent } from './views/welcome/welcome-tab';
import { initNotifications, showNotification } from './views/notifications/notifications';
import { initCommandPalette, openCommandPalette, closeCommandPalette, isCommandPaletteOpen } from './views/command-palette/command-palette';
import { openExternalUrl } from './views/ai-chat/markdown-render';
import { HONE_VERSION } from './version';
import { initWorkspaceTrust, isWorkspaceTrusted, trustWorkspace, revokeWorkspaceTrust } from './workspace-trust';
import { renderReferencesPeek, showReferencesFromJson, setReferencesJumpHandler } from './views/references-peek/references-peek';
import { renderTasksPanel, runDefaultBuildTask, runTaskByLabel, setTasksWorkspaceRoot, setTasksAppDataDir, setOnTaskRunStart, setOnTaskRunDone } from './views/tasks/tasks-panel';
import { initRecentItems, addRecentFile, addRecentFolder, getRecentPath, getRecentType } from './views/recent/recent-store';
import { createFindBar, setFindEditorCallbacks, showFindBar, showFindBarWithReplace, hideFindBar, isFindBarVisible } from './views/find/find-bar';
import { setLspWorkspaceRoot, initLspBridge, triggerDiagnostics, getCompletions, setDiagnosticsStatusUpdater } from './views/lsp/lsp-bridge';
import { setDiagnosticsFileOpener } from './views/lsp/diagnostics-panel';
import { createAutocompletePopup, setAutocompleteAcceptHandler } from './views/lsp/autocomplete-popup';
import { initTelemetry, telemetryTrackFileOpen, telemetryTrackSettingsOpen, telemetryTrackStartup, telemetryTrackThemeChange, telemetryTrackTerminalOpen } from './telemetry';
import { buildSyncPanel, refreshSyncPanel, setSyncStatusText, setSyncPairCallback, setSyncJoinCallback, setSyncPairingCode, addSyncDevice, removeSyncDevice } from './views/sync/sync-panel';
import { initSyncHost, setOnGuestConnected, setOnGuestDisconnected, addGuest, handleClaudeSendFromGuest, handleClaudeStopFromGuest, setOnClaudeRelayRequest, setOnClaudeRelayStop,
  generateProjectKey as hostGenerateProjectKey,
  getProjectKeyHex as hostGetProjectKey,
  setProjectKey as hostSetProjectKey,
  startKeyExchange as hostStartKeyExchange,
  getDhPublicKey as hostGetDhPublicKey,
  completeKeyExchange as hostCompleteKeyExchange,
  encryptDelta as hostEncryptDelta,
  decryptDelta as hostDecryptDelta,
} from './sync-host';
import { initSyncGuest, sendClaudeRequest,
  startGuestKeyExchange,
  getGuestDhPublicKey,
  receiveProjectKey as guestReceiveProjectKey,
  getGuestProjectKey,
  setGuestProjectKey,
  encryptDelta as guestEncryptDelta,
  decryptDelta as guestDecryptDelta,
  setReconnectEnabled, shouldReconnect, markReconnectAttempt, getReconnectDelay, resetReconnectAttempts, getReconnectAttempts,
} from './sync-guest';
import { getOrCreateDeviceId } from './paths';
import {
  connectToRelay, disconnectFromRelay, sendToRelay,
  setOnRelayConnected, setOnRelayDisconnected,
  setOnRelayMessage, isRelayConnected, setOnTransportDebug,
  setPayloadCrypto, setEncryptionReady, decryptIncomingPayload,
  setRelayToken, setRelayLastSeq, setMaxMessagesPerPoll,
} from './sync-transport';

import { dispatchPluginHook, isPluginSystemEnabled, setDecorationRenderCallback } from '../plugins';
import { getDiagFiles, getDiagLines, getDiagMessages, getDiagSeverities, getDiagCount } from './views/lsp/diagnostics-panel';
import { lspDidOpen, lspDidClose, lspDidSave, lspFormatDocument, lspHover, lspDefinition, lspSignatureHelp, setHoverCallback, setDefinitionCallback, setSignatureCallback, setFormatCallback, lspIsReady,
  lspReferences, lspRename, lspCodeActions, setReferencesCallback, setRenameCallback, setCodeActionsCallback,
  lspDocumentSymbols, setDocumentSymbolsCallback,
  lspWorkspaceSymbols, setWorkspaceSymbolsCallback,
} from './views/lsp/lsp-bridge';
import { renderOutlinePanel, setOutlineActiveFile, setOutlineJumpHandler } from './views/outline/outline-panel';
import { renderTimelinePanel, setTimelineActiveFile, setTimelineNotifier, setTimelineWorkspaceRoot } from './views/timeline/timeline-panel';
import { createHoverPopup, showHoverPopup, hideHoverPopup, isHoverVisible } from './views/lsp/hover-popup';
import { createSignaturePopup, showSignaturePopup, hideSignaturePopup, isSignatureVisible } from './views/lsp/signature-popup';
import { initInlineCompletion, setInlineEditorAccess, setInlineContextProviders, setInlineInsertCallback } from './views/ai-inline/inline-completion';

// Compile-time platform ID injected by Perry codegen:
// 0 = macOS, 1 = iOS, 2 = Android, 3 = Windows, 4 = Linux, 5 = Web
declare const __platform__: number;

// FFI functions from @honeide/editor
declare function hone_editor_nsview(handle: number): number;
declare function hone_editor_set_find_highlights(handle: number, json: number): void;
declare function hone_editor_clear_find_highlights(handle: number): void;
declare function hone_editor_scroll(handle: number, offsetY: number): void;


// Dynamic file tree — loaded from opened folder
let workspaceRoot = '';
let _renderStartMs: number = 0;
let pendingSidebarRefresh: number = 0;

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
// Last editor font applied — guards onSettingsChanged against redundant
// setFont calls on every 500ms settings-version poll tick.
let _lastEditorFontFamily: string = '';
let _lastEditorFontSize: number = 0;
let editorReady: number = 0;
let editorWidget: unknown = null;
let editorNativeHandle: number = 0;
let currentEditorFilePath = '';
// SHIP-V1-GAPS.md #86: tracks the djb2 hash of the file content the editor
// holds on disk. The disk-watch poller compares it against a fresh read every
// 2s; a mismatch on a clean tab triggers a one-tap reload, while a mismatch
// on a dirty tab surfaces a conflict notification.
let _externalFileHash: number = 0;
let _externalCheckPending: number = 0;

// Untitled file counter
let untitledCounter: number = 0;

// Find bar widget ref (for applying background from render.ts)
let findBarWidget: unknown = null;

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

// SHIP-V1-GAPS.md #24 sticky scroll widgets.
let stickyScrollRow: unknown = null;
let stickyScrollLabel: unknown = null;
let _lastStickyLine: number = -1;

// SHIP-V1-GAPS.md #44 merge conflict resolver widgets.
let conflictBar: unknown = null;
let conflictLabel: unknown = null;
let _conflictCount: number = 0;
let _conflictStartOffsets: number[] = [];
let _conflictSepOffsets: number[] = [];
let _conflictEndOffsets: number[] = [];
let _lastConflictSig: string = '';

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
    setIconButton(dirIcon, 'folder.fill');
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
    setIconButton(sepIcon, 'chevron.right');
    buttonSetImagePosition(sepIcon, 1);
    textSetFontSize(sepIcon, 7);
    setBtnTint(sepIcon, getEditorForeground());
    widgetAddChild(breadcrumbContainer, sepIcon);
  }
  // File icon in breadcrumb
  const bcFileIcon = Button('', () => {});
  buttonSetBordered(bcFileIcon, 0);
  const bcIcon = getFileIcon(fileName);
  setIconButton(bcFileIcon, bcIcon);
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
  if (isWebPlatform() > 0) return;
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
  closeAllOpenTabs();
  workspaceRoot = folderPath;
  // SHIP-V1-GAPS.md #42: read workspace settings overlay BEFORE wiring panels
  // so panels that consult settings (theme, font, tab size) see the overlay
  // immediately rather than reading user defaults and getting re-rendered.
  applyWorkspaceOverlay(folderPath);
  setSidebarWorkspaceRoot(folderPath);
  setContextMenuWorkspaceRoot(folderPath);
  setSearchWorkspaceRoot(folderPath);
  setGitWorkspaceRoot(folderPath);
  setDebugWorkspaceRoot(folderPath);
  setTerminalCwd(folderPath);
  setLspWorkspaceRoot(folderPath);
  setChatWorkspaceRoot(folderPath);
  setTasksWorkspaceRoot(folderPath);
  initLspBridge();
  refreshSidebarContent();
  updateSettings({ lastOpenFolder: folderPath });
  addRecentFolder(folderPath);
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

// SHIP-V1-GAPS.md #88 helpers for status-bar / sidebar context menus.
function toggleSidebarLocation(): void {
  const s = getWorkbenchSettings();
  const next = s.sidebarLocation === 'left' ? 'right' : 'left';
  updateSettings({ sidebarLocation: next });
  showNotification(t('Sidebar moved to') + ' ' + t(next) + '. ' + t('Restart to apply.'), 'info');
}

function copyBranchNameToClipboard(): void {
  if (workspaceRoot.length === 0) return;
  try {
    const r = spawnSync('git', ['-C', workspaceRoot, 'rev-parse', '--abbrev-ref', 'HEAD']);
    if (r.status !== 0) return;
    let s = r.stdout;
    let end = s.length;
    while (end > 0 && (s.charCodeAt(end - 1) === 10 || s.charCodeAt(end - 1) === 13)) end--;
    s = s.slice(0, end);
    clipboardWrite(s);
    showNotification(t('Branch name copied') + ': ' + s, 'info');
  } catch (_e: any) {}
}

function copyEditorPathToClipboard(): void {
  if (currentEditorFilePath.length === 0) {
    showNotification(t('No file open.'), 'info');
    return;
  }
  clipboardWrite(currentEditorFilePath);
  showNotification(t('Path copied'), 'info');
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
  untitledCounter = untitledCounter + 1;
  let numStr = '';
  numStr += String(untitledCounter);
  let name = t('Untitled') + '-';
  name += numStr;
  let path = getTempDir();
  path += '/Untitled-';
  path += numStr;
  try {
    writeFileSync(path, '');
  } catch (e: any) {
    // ignore write errors
  }
  openFileInEditor(path, name);
}

function isUntitledFile(): number {
  if (currentEditorFilePath.length < 1) return 0;
  const tempDir = getTempDir();
  // Check if path starts with tempDir + '/Untitled-'
  let prefix = '';
  prefix += tempDir;
  prefix += '/Untitled-';
  if (currentEditorFilePath.length < prefix.length) return 0;
  for (let i = 0; i < prefix.length; i++) {
    if (currentEditorFilePath.charCodeAt(i) !== prefix.charCodeAt(i)) return 0;
  }
  return 1;
}

export function findAction(): void {
  // Defer to next tick to avoid RefCell reentrancy in Perry menu callbacks
  setTimeout(() => { findDeferred(); }, 0);
}

function findDeferred(): void {
  showFindBar();
  applyFindBarBg();
}

function applyFindBarBg(): void {
  if (!findBarWidget) return;
  if (isCurrentThemeDark() > 0) {
    widgetSetBackgroundColor(findBarWidget, 0.16, 0.16, 0.18, 1.0);
  } else {
    widgetSetBackgroundColor(findBarWidget, 0.84, 0.84, 0.85, 1.0);
  }
}

export function saveFileAction(): void {
  if (currentEditorFilePath.length < 1) return;
  if (editorReady < 1) return;
  // Binary files are shown as a placeholder, never the real bytes. Saving
  // would overwrite the binary on disk with that placeholder string — hard
  // refuse. (The tab is effectively read-only; the open-time notification
  // already told the user.)
  if (_currentFileIsBinary > 0) {
    showNotification(t('Binary file — not saved.'), 'warning');
    return;
  }
  // Truncated large-file view — saving would persist only the visible first
  // 5000 lines and destroy the rest on disk. Hard refuse.
  if (_currentFileTruncated > 0) {
    showNotification(t('Large file is truncated/read-only — not saved (full-file editing is v1.1).'), 'warning');
    return;
  }
  // Untitled files → redirect to Save As
  if (isUntitledFile() > 0) {
    saveFileAsAction();
    return;
  }
  let content = editorInstance.getContent();
  // In remote mode, send save to host via relay instead of writing locally
  if (isRemoteExplorerMode() > 0) {
    let msg = 'FILE_SAVE|';
    msg += currentEditorFilePath;
    msg += '\n';
    msg += content;
    sendToRelay(msg);
    let savingMsg = t('Saving') + ': ';
    savingMsg += currentEditorFilePath;
    setSyncStatusText(savingMsg);
    return;
  }
  const fmtSettings = getWorkbenchSettings();
  // Format on save (built-in only — sync, no LSP race)
  if (fmtSettings.editorFormatOnSave) {
    content = applyBuiltinFormatToString(content, fmtSettings);
    editorInstance.setContent(content);
    editorInstance.render();
  } else if (fmtSettings.filesTrimTrailingWhitespace) {
    // Trim trailing whitespace on save (independent of format-on-save)
    content = inlineTrimTrailingWhitespace(content);
    editorInstance.setContent(content);
    editorInstance.render();
  }
  // Restore the file's original EOL before writing. `content` stays \n for
  // the editor + dirty-poll (the buffer is always \n internally); only the
  // bytes we persist get CRLF back. djb2Hash must hash the on-disk bytes so
  // the next disk-watcher tick (which reads raw file content) doesn't see a
  // phantom "changed on disk" because hash(\n) != hash(\r\n).
  const diskContent = restoreEolForSave(content);
  writeFileSync(currentEditorFilePath, diskContent);
  triggerDiagnostics();
  lspDidSave(currentEditorFilePath);
  markTabSaved(content.length);
  // SHIP-V1-GAPS.md #86: rehash on save so the disk watcher doesn't see our
  // own write as an external change. Hash the persisted (EOL-restored) bytes.
  _externalFileHash = djb2Hash(diskContent);
  _externalCheckPending = 0;
  // Dispatch onDocumentSave hook to plugins
  if (isPluginSystemEnabled() > 0) {
    let eventJson = '{"filePath":"';
    eventJson += currentEditorFilePath;
    eventJson += '"}';
    dispatchPluginHook('onDocumentSave', eventJson);
  }
}

export function saveFileAsAction(): void {
  setTimeout(() => { saveFileAsDeferred(); }, 0);
}

let pendingSaveAsPath = '';

function saveFileAsDeferred(): void {
  if (editorReady < 1) return;
  const defaultName = currentEditorFilePath.length > 0 ? getFileName(currentEditorFilePath) : 'untitled.txt';
  // Open Save As dialog in the workspace root folder (explorer's current folder)
  saveFileDialog((path: string) => { onSaveAsCb(path); }, defaultName, workspaceRoot);
}

function onSaveAsCb(path: string): void {
  if (path.length < 1) return;
  if (editorReady < 1) return;
  const content = editorInstance.getContent();
  // Preserve the source file's EOL on Save As too (a Windows user saving a
  // copy of a CRLF file expects CRLF, not a silent LF conversion).
  writeFileSync(path, restoreEolForSave(content));
  currentEditorFilePath = path;
  setSidebarCurrentEditorPath(path);
  updateBreadcrumb();
  updateStatusBarLanguageImpl(path);
  // Update tab bar entry with the new path/name
  renameActiveTab(path, getFileName(path));
  markTabSaved(content.length);
  let savedMsg = t('Saved to') + ' ';
  savedMsg += getFileName(path);
  showNotification(savedMsg, 'info');
}

export function replaceAction(): void {
  setTimeout(() => { replaceDeferred(); }, 0);
}

function replaceDeferred(): void {
  showFindBarWithReplace();
  applyFindBarBg();
}

// ---------------------------------------------------------------------------
// Find bar editor callbacks (module-level for Perry)
// ---------------------------------------------------------------------------

function findBarGetContent(): string {
  if (editorReady < 1) return '';
  return editorInstance.getContent();
}

function findBarSetContent(content: string): void {
  if (editorReady < 1) return;
  editorInstance.setContent(content);
}

function findBarScrollToLine(line: number): void {
  if (editorReady < 1) return;
  // Center the match line in the viewport with padding
  const vm = editorInstance.viewModel;
  vm.viewport.scroll.revealLine(line, 'center');
  editorInstance.render();
}

function findBarRenderEditor(): void {
  if (editorReady < 1) return;
  editorInstance.render();
}


/** Called from find-bar.ts with packed match data: "CUR:N|LINE,COL,LEN|..." */
function findBarPushDecorations(data: string): void {
  if (editorReady < 1) return;
  if (data.length < 1) return;

  // Handle clear
  if (data.charCodeAt(0) === 67 && data.length === 5) {
    // "CLEAR"
    editorInstance.clearLineBackgrounds();
    editorInstance.clearFindHighlights();
    lastFindHighlightCount = 0;
    return;
  }

  // Parse "CUR:N|LINE,COL,LEN|LINE,COL,LEN|..."
  let curMatch = 0;
  let parsePos = 4; // skip "CUR:"
  while (parsePos < data.length && data.charCodeAt(parsePos) !== 124) {
    const ch = data.charCodeAt(parsePos);
    if (ch >= 48 && ch <= 57) curMatch = curMatch * 10 + (ch - 48);
    parsePos = parsePos + 1;
  }

  // Parse match entries
  const matchLines: number[] = [];
  const matchCols: number[] = [];
  const matchLens: number[] = [];
  let matchCount = 0;

  while (parsePos < data.length) {
    parsePos = parsePos + 1; // skip '|'
    let mLine = 0;
    let mCol = 0;
    let mLen = 0;
    while (parsePos < data.length && data.charCodeAt(parsePos) !== 44) {
      const ch = data.charCodeAt(parsePos);
      if (ch >= 48 && ch <= 57) mLine = mLine * 10 + (ch - 48);
      parsePos = parsePos + 1;
    }
    parsePos = parsePos + 1;
    while (parsePos < data.length && data.charCodeAt(parsePos) !== 44) {
      const ch = data.charCodeAt(parsePos);
      if (ch >= 48 && ch <= 57) mCol = mCol * 10 + (ch - 48);
      parsePos = parsePos + 1;
    }
    parsePos = parsePos + 1;
    while (parsePos < data.length && data.charCodeAt(parsePos) !== 124) {
      const ch = data.charCodeAt(parsePos);
      if (ch >= 48 && ch <= 57) mLen = mLen * 10 + (ch - 48);
      parsePos = parsePos + 1;
    }
    matchLines.push(mLine);
    matchCols.push(mCol);
    matchLens.push(mLen);
    matchCount = matchCount + 1;
  }

  // Always clear all line backgrounds first, then set new ones
  // This is a single synchronous operation — no blink between frames
  editorInstance.clearLineBackgrounds();

  let currentLine = -1;
  if (curMatch >= 0 && curMatch < matchCount) {
    currentLine = matchLines[curMatch];
  }

  let prevLine = -1;
  for (let i = 0; i < matchCount; i++) {
    const line = matchLines[i];
    if (line === prevLine) continue;
    prevLine = line;
    const lineNum = line + 1;
    if (line === currentLine) {
      editorInstance.setLineBackground(lineNum, 0.91, 0.67, 0.33, 0.28);
    } else {
      editorInstance.setLineBackground(lineNum, 0.89, 0.76, 0.33, 0.15);
    }
  }
  lastFindHighlightCount = matchCount;

  // Character-precise highlight for current match
  if (curMatch >= 0 && curMatch < matchCount) {
    let json = '[{"line":';
    json += String(matchLines[curMatch]);
    json += ',"col":';
    json += String(matchCols[curMatch]);
    json += ',"len":';
    json += String(matchLens[curMatch]);
    json += ',"current":1}]';
    editorInstance.setFindHighlights(json);
  }
}

function findBarGetCharWidth(): number {
  if (editorReady < 1) return 8;
  return editorInstance.getCharWidth();
}

function findBarGetViewportStart(): number {
  if (editorReady < 1) return 0;
  return editorInstance.viewModel.viewport.visibleRange.startLine;
}

function findBarSetLineBg(line: number, r: number, g: number, b: number, a: number): void {
  if (editorReady < 1) return;
  editorInstance.setLineBackground(line, r, g, b, a);
}

function findBarClearLineBgs(): void {
  if (editorReady < 1) return;
  editorInstance.clearLineBackgrounds();
  editorInstance.clearFindHighlights();
}

// ---------------------------------------------------------------------------
// Inline completion editor callbacks (module-level for Perry)
// ---------------------------------------------------------------------------

function inlineGetCursorLine(): number {
  if (editorReady < 1) return -1;
  return editorInstance.getCursorLine();
}

function inlineGetCursorCol(): number {
  if (editorReady < 1) return -1;
  return editorInstance.getCursorColumn();
}

function inlineGetLineContent(line: number): string {
  if (editorReady < 1) return '';
  const vm = editorInstance.viewModel;
  const buf = vm.document.buffer;
  const lineCount = buf.getLineCount();
  if (line < 0 || line >= lineCount) return '';
  return buf.getLine(line);
}

function inlineSetGhostText(text: string, line: number, col: number): void {
  if (editorReady < 1) return;
  const vm = editorInstance.viewModel;
  vm.ghostText.show(line, col, text);
  editorInstance.render();
}

function inlineClearGhostText(): void {
  if (editorReady < 1) return;
  const vm = editorInstance.viewModel;
  vm.ghostText.dismiss();
  editorInstance.render();
}

function inlineGetFileContent(): string {
  if (editorReady < 1) return '';
  return editorInstance.getContent();
}

function inlineGetFilePath(): string {
  return currentEditorFilePath;
}

function inlineInsertText(text: string): void {
  if (editorReady < 1) return;
  // Use the editor's type command to insert text at cursor position
  editorInstance.executeCommand('editor.action.type', { text: text });
  editorInstance.render();
}

export function openRecentItem(idx: number): void {
  pendingRecentOpenIdx = idx;
  setTimeout(() => { openRecentItemDeferred(); }, 0);
}

let pendingRecentOpenIdx: number = -1;

function openRecentItemDeferred(): void {
  const idx = pendingRecentOpenIdx;
  if (idx < 0) return;
  pendingRecentOpenIdx = -1;
  const path = getRecentPath(idx);
  const type = getRecentType(idx);
  if (path.length < 1) return;
  // Check actual filesystem — type in recent.ini may be wrong
  let actuallyDir = type > 0 ? 1 : 0;
  if (actuallyDir < 1) {
    try { if (isDirectory(path)) actuallyDir = 1; } catch (e: any) {}
  }
  if (actuallyDir > 0) {
    onFolderOpened(path);
  } else {
    const name = getFileName(path);
    openFileInEditor(path, name);
  }
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
  const name = t('Welcome');
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

  const title = Text(t('GO TO LINE'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(sidebarContainer, title);

  goToLineText = '';
  goToLineInput = TextField(t('Line number...'), (text: string) => { goToLineText = text; });
  widgetAddChild(sidebarContainer, goToLineInput);

  const goBtn = Button(t('Go'), () => { onGoToLineConfirm(); });
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

/**
 * Command palette (SHIP-V1-GAPS.md #15). Cmd+Shift+P / Menu > View > Command Palette.
 * Renders into the sidebar using the same takeover pattern as `goToFileAction`.
 * On close, the sidebar reverts to whichever panel was active before.
 */
export function showCommandPaletteAction(): void {
  setTimeout(() => { showCommandPaletteDeferred(); }, 0);
}

/**
 * Show the Outline view in the sidebar (SHIP-V1-GAPS.md #84). The view is
 * already kept current by `setOutlineActiveFile` on every tab change — this
 * command just mounts it visibly.
 */
export function showOutlineAction(): void {
  setTimeout(() => { showOutlineDeferred(); }, 0);
}

function showOutlineDeferred(): void {
  if (!sidebarContainer) return;
  if (sidebarToggleReady > 0 && sidebarVisible < 1) {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    widgetSetHidden(sidebarBorderWidget, 0);
  }
  resetSearchPanelReady();
  renderOutlinePanel(sidebarContainer, getActiveTheme() as any);
  // Re-trigger the current file's symbols so the panel populates immediately.
  if (currentEditorFilePath.length > 0) {
    setOutlineActiveFile(currentEditorFilePath);
  }
}

/**
 * Timeline view (SHIP-V1-GAPS.md #85) — mount the per-file history panel in
 * the sidebar. Reads `git log --follow` for the active file. The activity
 * bar isn't a timeline target (no slot), so the entry point is the command
 * palette / Edit menu / keybinding.
 */
export function showTimelineAction(): void {
  setTimeout(() => { showTimelineDeferred(); }, 0);
}

function showTimelineDeferred(): void {
  if (!sidebarContainer) return;
  if (sidebarToggleReady > 0 && sidebarVisible < 1) {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    widgetSetHidden(sidebarBorderWidget, 0);
  }
  resetSearchPanelReady();
  setTimelineWorkspaceRoot(workspaceRoot);
  setTimelineNotifier((msg: string) => { showNotification(msg, 'info'); });
  renderTimelinePanel(sidebarContainer, getActiveTheme() as any);
  if (currentEditorFilePath.length > 0) {
    setTimelineActiveFile(currentEditorFilePath);
  }
}

/**
 * Tasks panel (SHIP-V1-GAPS.md #105). Reads .hone/tasks.json or
 * .vscode/tasks.json and lists tasks with run buttons.
 */
export function showTasksAction(): void {
  setTimeout(() => { showTasksDeferred(); }, 0);
}

function showTasksDeferred(): void {
  if (!sidebarContainer) return;
  if (sidebarToggleReady > 0 && sidebarVisible < 1) {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    widgetSetHidden(sidebarBorderWidget, 0);
  }
  resetSearchPanelReady();
  renderTasksPanel(sidebarContainer, getActiveTheme() as any);
}

/** Run the workspace's default build task (Cmd+Shift+B equivalent). */
export function runBuildTaskAction(): void {
  if (runDefaultBuildTask() < 1) {
    showNotification(t('No default build task — add one to .hone/tasks.json with "group":{"kind":"build","isDefault":true}'), 'warning');
  }
}

function showCommandPaletteDeferred(): void {
  if (!sidebarContainer) return;
  if (sidebarToggleReady > 0 && sidebarVisible < 1) {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    widgetSetHidden(sidebarBorderWidget, 0);
  }
  resetSearchPanelReady();
  openCommandPalette(getActiveTheme() as any);
}

/** Restore the file explorer when the command palette closes. */
function restoreSidebarAfterPalette(): void {
  if (!sidebarContainer) return;
  renderExplorerPanel(sidebarContainer, null as any);
}

// Go to File state
let goToFileInput: unknown = null;
let goToFileText = '';
let goToFileResults: unknown = null;
let goToFileFilePaths: string[] = [];
let goToFileFileNames: string[] = [];
let goToFileCount: number = 0;

function collectFilesRecursive(out: string[], outNames: string[], dirPath: string, depth: number): number {
  if (depth > 6) return out.length;
  if (out.length >= 500) return out.length;
  let names: string[] = [];
  try { names = readdirSync(dirPath); } catch (e) { return out.length; }
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name.charCodeAt(0) === 46) continue; // skip hidden
    if (out.length >= 500) return out.length;
    const fullPath = join(dirPath, name);
    if (isDirectory(fullPath)) {
      // Skip node_modules
      if (name.length === 12 && name.charCodeAt(0) === 110) continue;
      collectFilesRecursive(out, outNames, fullPath, depth + 1);
    } else {
      out.push(fullPath);
      outNames.push(name);
    }
  }
  return out.length;
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

  const title = Text(t('GO TO FILE'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(sidebarContainer, title);

  goToFileText = '';
  // SHIP-V1-GAPS.md #36: reset symbol-query state so the next `@` keystroke
  // refetches instead of rendering stale data from a prior open.
  _qoDocSymbolsJson = '';
  _qoDocSymbolsActive = 0;
  _qoWsSymbolsJson = '';
  goToFileInput = TextField(t('File name...'), (text: string) => { onGoToFileInput(text); });
  widgetAddChild(sidebarContainer, goToFileInput);

  // Collect all files from workspace (async — doesn't block UI)
  goToFileFilePaths = [];
  goToFileFileNames = [];
  goToFileCount = 0;

  goToFileResults = VStack(2, []);
  const scroll = ScrollView();
  widgetAddChild(scroll, goToFileResults);
  widgetAddChild(sidebarContainer, scroll);

  if (workspaceRoot.length > 0) {
    const wsRoot = workspaceRoot;
    spawn(() => {
      const paths: string[] = [];
      const names: string[] = [];
      collectFilesRecursive(paths, names, wsRoot, 0);
      return { paths: paths, names: names, count: paths.length };
    }).then((result) => { applyGoToFileResult(result); });
  }
}

function applyGoToFileResult(r: { paths: string[]; names: string[]; count: number }): void {
  goToFileFilePaths = r.paths;
  goToFileFileNames = r.names;
  goToFileCount = r.count;
  // Show all files initially
  renderGoToFileList('');
}

function onGoToFileInput(text: string): void {
  goToFileText = text;
  setTimeout(() => { renderGoToFileListDeferred(); }, 0);
}

function renderGoToFileListDeferred(): void {
  // SHIP-V1-GAPS.md #36: quick-open prefix routing.
  // ':<N>' → line jump in the active editor.
  // '@<q>' → document symbols (active file, LSP `documentSymbol`).
  // '#<q>' → workspace symbols (project-wide, LSP `workspace/symbol`).
  if (goToFileText.length > 0 && goToFileText.charCodeAt(0) === 58) {
    renderGoToFileLineJump(goToFileText.slice(1));
    return;
  }
  if (goToFileText.length > 0 && goToFileText.charCodeAt(0) === 64) {
    renderGoToFileDocSymbols(goToFileText.slice(1));
    return;
  }
  if (goToFileText.length > 0 && goToFileText.charCodeAt(0) === 35) {
    renderGoToFileWorkspaceSymbols(goToFileText.slice(1));
    return;
  }
  renderGoToFileList(goToFileText);
}

// SHIP-V1-GAPS.md #36: cached symbol queries so render state persists across
// keystrokes. We re-register the LSP callback on each invocation; outline
// panel re-registers its own when it's next opened.
let _qoDocSymbolsJson: string = '';
let _qoDocSymbolsActive: number = 0;
let _qoWsSymbolsJson: string = '';

function renderGoToFileDocSymbols(query: string): void {
  if (!goToFileResults) return;
  widgetClearChildren(goToFileResults);
  if (currentEditorFilePath.length < 1) {
    const hint = Text(t('Open a file to search its symbols.'));
    textSetFontSize(hint, 12);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(goToFileResults, hint);
    return;
  }
  if (lspIsReady() < 1) {
    const hint = Text(t('LSP not ready'));
    textSetFontSize(hint, 12);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(goToFileResults, hint);
    return;
  }
  if (_qoDocSymbolsActive < 1) {
    setDocumentSymbolsCallback((json: string) => { _qoDocSymbolsJson = json; renderDocSymbolsList(query); });
    _qoDocSymbolsActive = 1;
    lspDocumentSymbols(currentEditorFilePath);
    const hint = Text(t('Loading symbols…'));
    textSetFontSize(hint, 12);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(goToFileResults, hint);
    return;
  }
  // Already have a result — re-filter against the new query without refetching.
  renderDocSymbolsList(query);
}

function renderDocSymbolsList(query: string): void {
  if (!goToFileResults) return;
  widgetClearChildren(goToFileResults);
  const symbols = extractFlatSymbols(_qoDocSymbolsJson);
  if (symbols.length === 0) {
    const hint = Text(t('No symbols found.'));
    textSetFontSize(hint, 12);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(goToFileResults, hint);
    return;
  }
  const q = query.toLowerCase();
  let shown = 0;
  for (let i = 0; i < symbols.length && shown < 100; i++) {
    const s = symbols[i];
    if (q.length > 0) {
      const lower = s.name.toLowerCase();
      if (lower.indexOf(q) < 0) continue;
    }
    const lineNum = s.line + 1;
    const label = s.name + '  ' + t('Line') + ' ' + String(lineNum);
    const tline = s.line;
    const tcol = s.character;
    const btn = Button(label, () => { jumpToSymbolInActiveEditor(tline, tcol); });
    setBtnFg(btn, getSideBarForeground());
    textSetFontSize(btn, 12);
    widgetAddChild(goToFileResults, btn);
    shown = shown + 1;
  }
}

function jumpToSymbolInActiveEditor(line: number, character: number): void {
  if (editorReady < 1) return;
  editorInstance.setCursorPosition(line, character);
  editorInstance.render();
}

function renderGoToFileWorkspaceSymbols(query: string): void {
  if (!goToFileResults) return;
  widgetClearChildren(goToFileResults);
  if (lspIsReady() < 1) {
    const hint = Text(t('LSP not ready'));
    textSetFontSize(hint, 12);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(goToFileResults, hint);
    return;
  }
  if (query.length < 2) {
    const hint = Text(t('Type 2+ chars after #'));
    textSetFontSize(hint, 12);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(goToFileResults, hint);
    return;
  }
  setWorkspaceSymbolsCallback((json: string) => { _qoWsSymbolsJson = json; renderWsSymbolsList(); });
  lspWorkspaceSymbols(query);
  const hint = Text(t('Searching workspace…'));
  textSetFontSize(hint, 12);
  setFg(hint, getSecondaryTextColor());
  widgetAddChild(goToFileResults, hint);
}

function renderWsSymbolsList(): void {
  if (!goToFileResults) return;
  widgetClearChildren(goToFileResults);
  const symbols = extractFlatSymbols(_qoWsSymbolsJson);
  if (symbols.length === 0) {
    const hint = Text(t('No symbols found.'));
    textSetFontSize(hint, 12);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(goToFileResults, hint);
    return;
  }
  for (let i = 0; i < symbols.length && i < 100; i++) {
    const s = symbols[i];
    const label = (s.location.length > 0 ? s.location + ':' : '') + s.name + '  ' + t('Line') + ' ' + String(s.line + 1);
    const tpath = s.location;
    const tline = s.line;
    const tcol = s.character;
    const btn = Button(label, () => { openSymbolAcrossFiles(tpath, tline, tcol); });
    setBtnFg(btn, getSideBarForeground());
    textSetFontSize(btn, 12);
    widgetAddChild(goToFileResults, btn);
  }
}

/**
 * Server-sent `file://` URI → OS-native path. Same minimal Windows-aware
 * logic as lsp-bridge.ts fileUriToPath (iters 103/104): byte-identical to
 * the old `slice(7)` for every non-Windows-drive shape (POSIX preserved
 * exactly, zero regression), diverging ONLY for the `/<letter>:` drive
 * pattern that a bare slice(7) turned into the unopenable `/C:/Users/x`.
 * Without this, server URIs broke cross-file symbol nav (here) and LSP
 * rename / code-action apply (applyWorkspaceEdit) on Windows — the latter
 * because `/C:/…` fails the workspace-confinement check so even legitimate
 * in-workspace refactors silently no-op.
 */
function stripFileUriToPath(uri: string): string {
  if (uri.length <= 7 || uri.slice(0, 7) !== 'file://') return uri;
  const rest = uri.slice(7);
  if (rest.length >= 3 && rest.charCodeAt(0) === 47) {
    const d = rest.charCodeAt(1);
    const isLetter = (d >= 65 && d <= 90) || (d >= 97 && d <= 122);
    if (isLetter && rest.charCodeAt(2) === 58) { // '<letter>' ':'
      const drivePart = rest.slice(1);
      let out = '';
      for (let i = 0; i < drivePart.length; i++) {
        if (drivePart.charCodeAt(i) === 47) out += '\\';
        else out += drivePart.charAt(i);
      }
      return out;
    }
  }
  return rest;
}

function openSymbolAcrossFiles(uriOrPath: string, line: number, character: number): void {
  if (uriOrPath.length < 1) return;
  // Strip `file://` prefix if present (Windows-aware: file:///C:/x → C:\x).
  const path = stripFileUriToPath(uriOrPath);
  openFileInEditor(path, '');
  setTimeout(() => {
    if (editorReady > 0) {
      editorInstance.setCursorPosition(line, character);
      editorInstance.render();
    }
  }, 64);
}

interface FlatSymbol {
  name: string;
  line: number;
  character: number;
  location: string;
}

// Lightweight extractor — handles both `DocumentSymbol[]` (hierarchical with
// `range`/`selectionRange` per node) and `SymbolInformation[]` (flat with
// `location.uri` + `location.range`). For workspace symbols we get the
// SymbolInformation form, so `location` populates from `location.uri`.
function extractFlatSymbols(json: string): FlatSymbol[] {
  const out: FlatSymbol[] = [];
  if (json.length === 0 || json === 'null' || json === '[]') return out;
  let pos = 0;
  while (pos < json.length) {
    const open = json.indexOf('{', pos);
    if (open < 0) break;
    const end = findClosingBrace(json, open);
    if (end < 0) break;
    const body = json.slice(open, end + 1);
    const name = extractJsonStringField(body, '"name"');
    let line = -1;
    let character = -1;
    // selectionRange (DocumentSymbol) preferred, then range, then location.range (SymbolInformation).
    const selIdx = body.indexOf('"selectionRange"');
    const rangeIdx = body.indexOf('"range"');
    const useIdx = selIdx >= 0 ? selIdx : rangeIdx;
    if (useIdx >= 0) {
      const slice = body.slice(useIdx);
      line = extractJsonNumberField(slice, '"line"');
      character = extractJsonNumberField(slice, '"character"');
    }
    let location = '';
    const locIdx = body.indexOf('"location"');
    if (locIdx >= 0) {
      const locSlice = body.slice(locIdx);
      location = extractJsonStringField(locSlice, '"uri"');
    }
    if (name.length > 0 && line >= 0) {
      out.push({ name: name, line: line, character: character, location: location });
    }
    pos = end + 1;
  }
  return out;
}

function findClosingBrace(s: string, openPos: number): number {
  let depth = 0;
  let inStr = 0;
  let escape = 0;
  for (let i = openPos; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (escape > 0) { escape = 0; continue; }
    if (inStr > 0) {
      if (c === 92) escape = 1;
      else if (c === 34) inStr = 0;
      continue;
    }
    if (c === 34) inStr = 1;
    else if (c === 123) depth = depth + 1;
    else if (c === 125) {
      depth = depth - 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractJsonStringField(body: string, key: string): string {
  const idx = body.indexOf(key);
  if (idx < 0) return '';
  // Find the colon, then the opening quote.
  let p = idx + key.length;
  while (p < body.length && body.charCodeAt(p) !== 58) p++;
  if (p >= body.length) return '';
  p = p + 1; // past ':'
  while (p < body.length && (body.charCodeAt(p) === 32 || body.charCodeAt(p) === 9)) p++;
  if (p >= body.length || body.charCodeAt(p) !== 34) return '';
  p = p + 1;
  let out = '';
  while (p < body.length) {
    const c = body.charCodeAt(p);
    if (c === 92 && p + 1 < body.length) {
      const nxt = body.charAt(p + 1);
      out += nxt;
      p = p + 2;
      continue;
    }
    if (c === 34) break;
    out += body.charAt(p);
    p = p + 1;
  }
  return out;
}

function extractJsonNumberField(body: string, key: string): number {
  const idx = body.indexOf(key);
  if (idx < 0) return -1;
  let p = idx + key.length;
  while (p < body.length && body.charCodeAt(p) !== 58) p++;
  if (p >= body.length) return -1;
  p = p + 1;
  while (p < body.length && (body.charCodeAt(p) === 32 || body.charCodeAt(p) === 9)) p++;
  let n = 0;
  let seen = 0;
  while (p < body.length) {
    const c = body.charCodeAt(p);
    if (c < 48 || c > 57) break;
    n = n * 10 + (c - 48);
    seen = 1;
    p = p + 1;
  }
  return seen > 0 ? n : -1;
}

function renderGoToFileLineJump(numberText: string): void {
  if (!goToFileResults) return;
  widgetClearChildren(goToFileResults);
  // Parse a positive integer. Empty input → render an instructional hint.
  if (numberText.length === 0) {
    const hint = Text(t('Type a line number after :'));
    textSetFontSize(hint, 12);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(goToFileResults, hint);
    return;
  }
  let n = 0;
  for (let i = 0; i < numberText.length; i++) {
    const c = numberText.charCodeAt(i);
    if (c < 48 || c > 57) { n = -1; break; }
    n = n * 10 + (c - 48);
  }
  if (n < 1) {
    const hint = Text(t('Not a valid line number.'));
    textSetFontSize(hint, 12);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(goToFileResults, hint);
    return;
  }
  const target = n - 1;
  const btn = Button(t('Go to line') + ' ' + String(n), () => { jumpToLineInActiveEditor(target); });
  setBtnFg(btn, getSideBarForeground());
  widgetAddChild(goToFileResults, btn);
}

function jumpToLineInActiveEditor(line: number): void {
  if (editorReady < 1) return;
  const col = 0;
  editorInstance.setCursorPosition(line, col);
  editorInstance.render();
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
    const noResults = Text(t('No matching files'));
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
  // SHIP-V1-GAPS.md #43: snapshot cursor + scroll for session restore. Runs on
  // the 500ms dirty-poll tick to avoid a per-keystroke setting write storm.
  persistEditorCursorState();
  // SHIP-V1-GAPS.md #24: sticky-scroll context line refresh on the same tick
  // so the parent-scope display tracks cursor moves without a dedicated poll.
  updateStickyScroll();
  // SHIP-V1-GAPS.md #44: detect and update the merge-conflict toolbar.
  detectConflicts();
  // SHIP-V1-GAPS.md #71: auto-save evaluation on the same tick.
  checkAutoSave(content.length);
  // SHIP-V1-GAPS.md #86: every 4 ticks (2s), reconcile the active file with
  // disk. Cheaper than mtime polling on filesystems where mtime resolution is
  // 1s — and it works without a Perry stat FFI.
  _externalCheckPending = _externalCheckPending + 1;
  if (_externalCheckPending >= 4) {
    _externalCheckPending = 0;
    checkExternalDiskChange();
  }
}

// SHIP-V1-GAPS.md #86: DJB2 hash over a string. Same flavour as `pathId` in
// ui-helpers, but full-string instead of sampled positions.
function djb2Hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33 + s.charCodeAt(i)) | 0;
  }
  return h;
}

function checkExternalDiskChange(): void {
  if (currentEditorFilePath.length === 0) return;
  // Virtual paths (settings/update/welcome) start with __.
  if (currentEditorFilePath.charCodeAt(0) === 95) return;
  const fresh = safeReadFile(currentEditorFilePath);
  if (fresh.length === 0 && _externalFileHash === 0) return;
  const freshHash = djb2Hash(fresh);
  if (freshHash === _externalFileHash) return;
  // Disk content changed since last read.
  const tabIdx = getActiveTabIdx();
  if (isTabDirty(tabIdx) > 0) {
    // Conflict — surface but don't auto-reload.
    showNotification(t('This file changed on disk while you have unsaved edits.'), 'warning');
    // Adopt the new hash so we don't keep firing every 2s. The user resolves
    // by saving (overwrite disk) or discarding (manual reload).
    _externalFileHash = freshHash;
  } else {
    // Clean tab — reload silently and notify so the user sees it.
    // Strip a leading BOM the same way the open path does, else a BOM file
    // reloaded from disk shows the phantom U+FEFF char again.
    let freshBody = fresh;
    _currentHadBOM = 0;
    if (freshBody.length > 0 && freshBody.charCodeAt(0) === 0xFEFF) {
      _currentHadBOM = 1;
      freshBody = freshBody.slice(1);
    }
    // Reload loads the FULL fresh content (no 5000-line truncation), so a
    // subsequent save is safe — clear any stale truncation flag from open.
    _currentFileTruncated = 0;
    // Re-evaluate binary on reload (a file could have become binary, or an
    // already-binary file changed). Keep the placeholder + binary guard so
    // we never dump raw bytes into the editor on reload either.
    _currentFileIsBinary = 0;
    let _rbScan = freshBody.length < 8000 ? freshBody.length : 8000;
    for (let rbi = 0; rbi < _rbScan; rbi++) {
      if (freshBody.charCodeAt(rbi) === 0) { _currentFileIsBinary = 1; break; }
    }
    if (_currentFileIsBinary > 0) {
      editorInstance.setContent(t('This file is not displayed because it is binary or uses an unsupported encoding.'));
      markTabSaved(editorInstance.getContent().length);
      editorInstance.render();
      _externalFileHash = freshHash;
      showNotification(t('File changed on disk (binary — shown read-only).'), 'info');
      return;
    }
    editorInstance.setContent(freshBody);
    // markTabSaved must use the editor's NORMALIZED (\n) length, not the raw
    // disk byte-length: the editor buffer normalizes CRLF→\n on setContent,
    // so a CRLF file's `fresh.length` is larger than `getContent().length`
    // and the dirty-poll would instantly flag the just-reloaded tab dirty.
    // (Same correctness detail as the iter-62 save fix.)
    markTabSaved(editorInstance.getContent().length);
    editorInstance.render();
    _externalFileHash = freshHash;
    // Re-detect EOL from the new disk bytes (BOM-stripped) — an external
    // tool may have converted line endings; without this the next save would
    // restore the stale (pre-change) EOL via restoreEolForSave.
    _currentEol = detectEolStyle(freshBody);
    updateStatusBarEolImpl(_currentEol);
    showNotification(t('File reloaded from disk.'), 'info');
  }
}

// SHIP-V1-GAPS.md #71: auto-save tracking. Snapshot the content length each
// tick; once it has been unchanged for `filesAutoSaveDelay` ms while the tab
// is dirty, trigger save. Modes: 'off' (default) / 'afterDelay' / 'onFocusChange'
// / 'onWindowChange'. v1 supports 'off' and 'afterDelay'; the other two need
// Perry window/focus FFI hooks that haven't been wired (queued for v1.1).
let _lastAutoSaveLen: number = -1;
let _autoSaveQuietTicks: number = 0; // ticks (500ms each) with unchanged content

function checkAutoSave(currentLen: number): void {
  const s = getWorkbenchSettings();
  // Skip when off / on unsupported mode / no file path.
  if (s.filesAutoSave.length === 0) return;
  if (s.filesAutoSave.charCodeAt(0) !== 97) return; // 'a' for 'afterDelay'
  if (currentEditorFilePath.length === 0) return;
  if (isUntitledFile() > 0) return;
  if (isTabDirty(getActiveTabIdx()) < 1) {
    _autoSaveQuietTicks = 0;
    _lastAutoSaveLen = currentLen;
    return;
  }
  if (currentLen === _lastAutoSaveLen) {
    _autoSaveQuietTicks = _autoSaveQuietTicks + 1;
  } else {
    _autoSaveQuietTicks = 0;
    _lastAutoSaveLen = currentLen;
  }
  // 500ms per tick. Delay default is 1000ms; quietTicks=2 covers it.
  const delayMs = s.filesAutoSaveDelay > 0 ? s.filesAutoSaveDelay : 1000;
  const requiredTicks = Math.max(1, Math.ceil(delayMs / 500));
  if (_autoSaveQuietTicks >= requiredTicks) {
    _autoSaveQuietTicks = 0;
    saveFileAction();
  }
}

// Last-known cursor snapshot — only writes settings when something changes so
// the 500ms tick doesn't churn the settings file.
let _lastSnapCursorLine: number = -1;
let _lastSnapCursorCol: number = -1;
let _lastSnapScrollTop: number = -1;

// ---------------------------------------------------------------------------
// Close-dirty-tab confirm (SHIP-V1-GAPS.md #91)
//
// Tab-bar invokes `onBeforeTabClose(idx, path)` synchronously on every close
// attempt. If the tab is dirty, we throw up a native NSAlert via `osascript`
// asking Save / Don't Save / Cancel, then force-close after the user picks
// one of the non-cancel options. Cancel returns 1 to the tab-bar so the
// in-flight close is aborted before any state mutation.
// ---------------------------------------------------------------------------

function escapeAppleScriptString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 92) { out += '\\\\'; continue; } // backslash
    if (c === 34) { out += '\\"'; continue; }  // double-quote
    if (c === 10) { out += '\\n'; continue; }
    out += s.charAt(i);
  }
  return out;
}

function shortFileName(path: string): string {
  let lastSlash = -1;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 47 || c === 92) lastSlash = i;
  }
  if (lastSlash >= 0) return path.slice(lastSlash + 1);
  return path;
}

/**
 * Show a native Save / Don't Save / Cancel dialog. Returns:
 *   0 = save and close
 *   1 = discard and close
 *   2 = cancel
 */
// Returns: 0 = Save, 1 = Don't Save, 2 = Cancel.
function promptCloseDirtyTab(filePath: string): number {
  if (__platform__ === 3) return promptCloseDirtyTabWindows(filePath);
  if (__platform__ === 0) return promptCloseDirtyTabMacos(filePath);
  // iOS / Linux / web — no native dialog yet. Default to Save so we don't
  // silently discard the user's work.
  return 0;
}

function promptCloseDirtyTabMacos(filePath: string): number {
  const name = escapeAppleScriptString(shortFileName(filePath));
  // AppleScript: `display dialog` returns the button title in `button returned`.
  // We echo a numeric token so we don't have to parse localized button names.
  let script = 'try\n';
  script += '  set choice to button returned of (display dialog "Do you want to save the changes you made to \\"';
  script += name;
  script += '\\"?" buttons {"Don\'t Save", "Cancel", "Save"} default button "Save" cancel button "Cancel" with icon caution)\n';
  script += '  if choice is "Save" then return "0"\n';
  script += '  if choice is "Don\'t Save" then return "1"\n';
  script += '  return "2"\n';
  script += 'on error number -128\n'; // user hit Cancel / Escape
  script += '  return "2"\n';
  script += 'end try\n';
  try {
    const r = spawnSync('osascript', ['-e', script]);
    if (r.status !== 0) return 2;
    const out = r.stdout.length > 0 ? r.stdout.charAt(0) : '';
    if (out === '0') return 0;
    if (out === '1') return 1;
    return 2;
  } catch (_e: any) {
    return 1;
  }
}

// SHIP-V1-GAPS.md (followup §5). Windows MessageBox via PowerShell. The
// YesNoCancel dialog maps to Save/Don't Save/Cancel.
function promptCloseDirtyTabWindows(filePath: string): number {
  const name = shortFileName(filePath).split('"').join('""'); // escape `"` for PS single-quoted string
  let ps = '[void][System.Reflection.Assembly]::LoadWithPartialName(\'System.Windows.Forms\');';
  ps += '$r = [System.Windows.Forms.MessageBox]::Show(';
  ps += '\'Save changes to ' + name + '?\',\'Hone\',\'YesNoCancel\',\'Question\');';
  ps += 'if ($r -eq \'Yes\') { [Console]::Out.Write(\'0\') } elseif ($r -eq \'No\') { [Console]::Out.Write(\'1\') } else { [Console]::Out.Write(\'2\') }';
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    if (r.status !== 0) return 2;
    const out = r.stdout.length > 0 ? r.stdout.charAt(0) : '';
    if (out === '0') return 0;
    if (out === '1') return 1;
    return 2;
  } catch (_e: any) {
    return 0; // safe default: Save on Windows if MessageBox failed
  }
}

function onBeforeTabCloseImpl(idx: number, path: string): number {
  // Notify the language server the document is closing — without this it
  // treats every file opened this session as still-open forever (unbounded
  // server-side memory growth + stale diagnostics + LSP spec violation).
  // CRITICAL: only when the close actually proceeds. The dirty branch below
  // also `return 1`s on the CANCEL choice; sending didClose there would
  // tell the server a still-open doc is gone, breaking its diagnostics/
  // hover/completion until the next didChange. Virtual tabs (leading `_`:
  // __settings__/__update__/__welcome__) and empties were never didOpen'd,
  // so a didClose for them is a spurious unknown-doc notification — skip.
  if (isTabDirty(idx) < 1) {
    if (path.length > 0 && path.charCodeAt(0) !== 95) lspDidClose(path);
    return 0;
  }
  // For non-active tabs we can't easily save the right content (the editor
  // only holds one document at a time). v1 limitation: only the active tab
  // benefits from the Save path; for non-active dirty tabs we still confirm
  // but Save becomes Discard since we lack the buffered content.
  const isActive = idx === getActiveTabIdx();
  const choice = promptCloseDirtyTab(path);
  if (choice === 2) return 1; // cancel — do NOT didClose (doc stays open)
  if (choice === 0 && isActive) {
    saveFileAction();
  }
  // Close is now confirmed (saved or discarded) — notify the LSP server.
  if (path.length > 0 && path.charCodeAt(0) !== 95) lspDidClose(path);
  // Defer the actual close one tick so the save flush completes first.
  setTimeout(() => { forceCloseTab(idx); }, 0);
  return 1; // tell tab-bar to abort the synchronous path; we already scheduled forceCloseTab
}

// ---------------------------------------------------------------------------
// Editor context-menu handlers (SHIP-V1-GAPS.md #88)
//
// Each operates on the current editor cursor + active file. Results land in
// the registered LSP callbacks (`onReferencesResult`, etc.) which surface
// them as notifications for v1. Proper peek-view UIs are a follow-up; the
// hooks below at least make every menu item *do something visible* the user
// can verify works.
// ---------------------------------------------------------------------------

function findAllReferencesFromCursor(): void {
  if (editorReady < 1 || currentEditorFilePath.length === 0) return;
  if (lspIsReady() < 1) {
    showNotification(t('LSP not ready'), 'warning');
    return;
  }
  const line = editorInstance.getCursorLine();
  const col = editorInstance.getCursorColumn();
  lspReferences(currentEditorFilePath, line, col, 1);
  showNotification(t('Finding references…'), 'info');
}

function renameSymbolFromCursor(): void {
  if (editorReady < 1 || currentEditorFilePath.length === 0) return;
  if (lspIsReady() < 1) {
    showNotification(t('LSP not ready'), 'warning');
    return;
  }
  const newName = promptForRename();
  if (newName.length === 0) return;
  const line = editorInstance.getCursorLine();
  const col = editorInstance.getCursorColumn();
  lspRename(currentEditorFilePath, line, col, newName);
}

// SHIP-V1-GAPS.md #107: extract a window of source around the cursor line so
// AI prompts can reason about local context, not just the bare line.
function getEditorContextWindow(targetLine: number, halfWindow: number): string {
  if (editorReady < 1) return '';
  const content = editorInstance.getContent();
  // Walk to find line offsets without allocating a full split.
  let startLine = targetLine - halfWindow;
  if (startLine < 0) startLine = 0;
  const endLine = targetLine + halfWindow;
  let currentLine = 0;
  let startOff = -1;
  let endOff = content.length;
  if (startLine === 0) startOff = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      currentLine = currentLine + 1;
      if (currentLine === startLine) startOff = i + 1;
      if (currentLine === endLine + 1) { endOff = i; break; }
    }
  }
  if (startOff < 0) return '';
  return content.slice(startOff, endOff);
}

// SHIP-V1-GAPS.md #107: collect diagnostics on a specific line of the active
// file so the "Fix with AI" prompt can include the error message verbatim.
function collectDiagnosticsForLine(filePath: string, line: number): string {
  const files = getDiagFiles();
  const lines = getDiagLines();
  const messages = getDiagMessages();
  const severities = getDiagSeverities();
  const n = getDiagCount();
  let out = '';
  for (let i = 0; i < n; i++) {
    if (files[i] === filePath && lines[i] === line) {
      if (out.length > 0) out += '\n';
      out += '- [' + severities[i] + '] ' + messages[i];
    }
  }
  return out;
}

function fixWithAIFromCursor(): void {
  if (editorReady < 1 || currentEditorFilePath.length === 0) return;
  const line = editorInstance.getCursorLine();
  const context = getEditorContextWindow(line, 10);
  if (context.length < 1) {
    showNotification(t('No code context to fix.'), 'warning');
    return;
  }
  const diagnostics = collectDiagnosticsForLine(currentEditorFilePath, line);
  let prompt = 'Fix the following code. Return only the corrected code as a single block — no preamble.\n\nFile: ';
  prompt += currentEditorFilePath;
  prompt += '\nCursor line (0-indexed): ';
  prompt += line + '';
  if (diagnostics.length > 0) {
    prompt += '\n\nDiagnostics on this line:\n';
    prompt += diagnostics;
  }
  prompt += '\n\nCode:\n```\n';
  prompt += context;
  prompt += '\n```';
  pendingActivityIdx = 4; // AI Chat slot
  setTimeout(() => { onActivityClickDeferred(); }, 0);
  setTimeout(() => { prefillChatInput(prompt); }, 64);
  showNotification(t('Fix prompt prepared in AI Chat. Press Enter to send.'), 'info');
}

function explainWithAIFromCursor(): void {
  if (editorReady < 1 || currentEditorFilePath.length === 0) return;
  const line = editorInstance.getCursorLine();
  const context = getEditorContextWindow(line, 10);
  if (context.length < 1) {
    showNotification(t('No code context to explain.'), 'warning');
    return;
  }
  let prompt = 'Explain what the following code does. Focus on intent, side effects, and any non-obvious behavior. Keep the explanation under 200 words.\n\nFile: ';
  prompt += currentEditorFilePath;
  prompt += '\n\nCode:\n```\n';
  prompt += context;
  prompt += '\n```';
  pendingActivityIdx = 4;
  setTimeout(() => { onActivityClickDeferred(); }, 0);
  setTimeout(() => { prefillChatInput(prompt); }, 64);
  showNotification(t('Explain prompt prepared in AI Chat. Press Enter to send.'), 'info');
}

function showCodeActionsFromCursor(): void {
  if (editorReady < 1 || currentEditorFilePath.length === 0) return;
  if (lspIsReady() < 1) {
    showNotification(t('LSP not ready'), 'warning');
    return;
  }
  const line = editorInstance.getCursorLine();
  const col = editorInstance.getCursorColumn();
  // Pass an empty range (start == end) — the server resolves actions around
  // the cursor position. Diagnostics context is left empty until the editor
  // tracks per-cursor diagnostics.
  lspCodeActions(currentEditorFilePath, line, col, line, col, '');
}

/** Cross-platform text prompt. Returns the user's input, or '' if cancelled.
 *  Mac: AppleScript `display dialog`. Windows: PowerShell `InputBox`. Other
 *  platforms (iOS/Linux/web): no input → return '' so callers degrade
 *  gracefully (a perry/ui modal text-input widget is the v1.1 follow-up). */
function promptForRename(): string {
  if (__platform__ === 3) return promptForRenameWindows();
  if (__platform__ === 0) return promptForRenameMacos();
  return '';
}

function promptForRenameMacos(): string {
  let script = 'try\n';
  script += '  set result to text returned of (display dialog "New name:" default answer "" buttons {"Cancel", "Rename"} default button "Rename" cancel button "Cancel")\n';
  script += '  return result\n';
  script += 'on error number -128\n';
  script += '  return ""\n';
  script += 'end try\n';
  try {
    const r = spawnSync('osascript', ['-e', script]);
    if (r.status !== 0) return '';
    let out = r.stdout;
    let end = out.length;
    while (end > 0 && (out.charCodeAt(end - 1) === 10 || out.charCodeAt(end - 1) === 13)) end--;
    return out.slice(0, end);
  } catch (_e: any) {
    return '';
  }
}

// SHIP-V1-GAPS.md (followup §5 — Windows prompt fallback).
// PowerShell loads the VisualBasic assembly to show a native InputBox.
// Empty input → user clicked Cancel (InputBox returns '' on cancel).
function promptForRenameWindows(): string {
  let ps = '$r = [Microsoft.VisualBasic.Interaction]::InputBox(\'New name:\',\'Rename\',\'\');';
  ps = '[void][System.Reflection.Assembly]::LoadWithPartialName(\'Microsoft.VisualBasic\');' + ps;
  ps += '[Console]::Out.Write($r)';
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    if (r.status !== 0) return '';
    let out = r.stdout;
    let end = out.length;
    while (end > 0 && (out.charCodeAt(end - 1) === 10 || out.charCodeAt(end - 1) === 13)) end--;
    return out.slice(0, end);
  } catch (_e: any) {
    return '';
  }
}

function onReferencesResult(json: string): void {
  // Mount the peek panel in the sidebar and render the JSON. The panel renders
  // its own empty state, so we always defer to it instead of branching on
  // empty input here.
  if (!sidebarContainer) return;
  setTimeout(() => { showReferencesPeekDeferred(json); }, 0);
}

function showReferencesPeekDeferred(json: string): void {
  if (!sidebarContainer) return;
  if (sidebarToggleReady > 0 && sidebarVisible < 1) {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    widgetSetHidden(sidebarBorderWidget, 0);
  }
  resetSearchPanelReady();
  renderReferencesPeek(sidebarContainer, getActiveTheme() as any);
  showReferencesFromJson(json);
}

function onRenameResult(json: string): void {
  // SHIP-V1-GAPS.md #28 follow-up: actually apply the WorkspaceEdit. Reuses
  // the shared `applyWorkspaceEdit` helper which iterates every URI in
  // `changes` and applies each TextEdit in reverse offset order.
  if (json.length === 0 || json === 'null') {
    showNotification(t('No rename changes returned.'), 'info');
    return;
  }
  const r = applyWorkspaceEdit(json);
  if (r.appliedFiles === 0) {
    showNotification(t('Rename returned no applicable edits.'), 'warning');
    return;
  }
  let msg = t('Rename applied') + ': ' + String(r.appliedEdits);
  msg += ' ' + t('edits across') + ' ' + String(r.appliedFiles) + ' ';
  msg += r.appliedFiles === 1 ? t('file') : t('files');
  if (r.skippedFiles > 0) {
    msg += ' (' + String(r.skippedFiles) + ' ' + t('skipped') + ')';
  }
  showNotification(msg, 'info');
}

// SHIP-V1-GAPS.md #28 / #29: apply an LSP WorkspaceEdit. Accepts either the
// outer envelope `{ changes: {...} }` (rename returns this directly) or the
// inner `changes` object (call sites that pre-extracted it). Returns counts
// for the caller to surface.
interface WorkspaceEditResult { appliedFiles: number; appliedEdits: number; skippedFiles: number; }

function applyWorkspaceEdit(json: string): WorkspaceEditResult {
  let appliedFiles = 0;
  let appliedEdits = 0;
  let skippedFiles = 0;
  if (json.length < 1) return { appliedFiles: 0, appliedEdits: 0, skippedFiles: 0 };

  // Find `"changes":` — when the input already begins with `{` of a top-level
  // WorkspaceEdit, this descends one level.
  const changesIdx = json.indexOf('"changes"');
  if (changesIdx < 0) {
    return { appliedFiles: 0, appliedEdits: 0, skippedFiles: 0 };
  }
  const changesBraceOpen = json.indexOf('{', changesIdx);
  if (changesBraceOpen < 0) return { appliedFiles: 0, appliedEdits: 0, skippedFiles: 0 };
  const changesBraceClose = findClosingBrace(json, changesBraceOpen);
  if (changesBraceClose < 0) return { appliedFiles: 0, appliedEdits: 0, skippedFiles: 0 };
  const changesBody = json.slice(changesBraceOpen + 1, changesBraceClose);

  // Walk URIs. Each URI key is followed by `:[...]` of TextEdits.
  let pos = 0;
  while (pos < changesBody.length) {
    // Find next quoted key.
    let q1 = -1;
    let scanning = pos;
    while (scanning < changesBody.length) {
      if (changesBody.charCodeAt(scanning) === 34) { q1 = scanning; break; }
      scanning = scanning + 1;
    }
    if (q1 < 0) break;
    const q2 = changesBody.indexOf('"', q1 + 1);
    if (q2 < 0) break;
    const uri = changesBody.slice(q1 + 1, q2);
    // Find `[`
    const arrOpen = changesBody.indexOf('[', q2);
    if (arrOpen < 0) break;
    const arrEnd = findClosingBracket(changesBody, arrOpen);
    if (arrEnd < 0) break;
    const arrBody = changesBody.slice(arrOpen + 1, arrEnd);

    // Translate URI → path (Windows-aware: file:///C:/x → C:\x — the bare
    // slice(7) yielded /C:/x which failed the workspace-confinement check
    // below, silently no-op'ing legitimate LSP rename/code-action edits).
    let path = stripFileUriToPath(uri);

    // SECURITY: the URI comes from the language server's WorkspaceEdit. A
    // compromised / typo-squatted LSP binary (or a benign one driven by
    // malicious project config) could return an edit targeting a file
    // OUTSIDE the workspace — e.g. file:///home/<u>/.bashrc — and the
    // write-back below would happily readFileSync+writeFileSync it with
    // attacker-chosen newText (→ code-exec on next shell). Confine
    // non-active-buffer edits to the workspace subtree. The active-buffer
    // branch is exempt: it only edits the in-memory editor of the file the
    // user already has open, never an arbitrary disk path.
    if (path !== currentEditorFilePath && isPathInsideWorkspace(path) < 1) {
      skippedFiles = skippedFiles + 1;
      pos = arrEnd + 1;
      continue;
    }

    // Parse TextEdits from arrBody.
    interface TEdit { startLine: number; startChar: number; endLine: number; endChar: number; newText: string; }
    const edits: TEdit[] = [];
    let ep = 0;
    while (ep < arrBody.length) {
      const o = arrBody.indexOf('{', ep);
      if (o < 0) break;
      const c = findClosingBrace(arrBody, o);
      if (c < 0) break;
      const item = arrBody.slice(o, c + 1);
      const newText = extractJsonStringField(item, '"newText"');
      const startIdx = item.indexOf('"start"');
      let startLine = -1;
      let startChar = -1;
      if (startIdx >= 0) {
        const startSlice = item.slice(startIdx);
        startLine = extractJsonNumberField(startSlice, '"line"');
        startChar = extractJsonNumberField(startSlice, '"character"');
      }
      const endIdxKey = item.indexOf('"end"');
      let endLine = -1;
      let endChar = -1;
      if (endIdxKey >= 0) {
        const endSlice = item.slice(endIdxKey);
        endLine = extractJsonNumberField(endSlice, '"line"');
        endChar = extractJsonNumberField(endSlice, '"character"');
      }
      if (startLine >= 0 && endLine >= 0) {
        edits.push({ startLine: startLine, startChar: startChar, endLine: endLine, endChar: endChar, newText: newText });
      }
      ep = c + 1;
    }
    if (edits.length === 0) {
      skippedFiles = skippedFiles + 1;
      pos = arrEnd + 1;
      continue;
    }

    // Read file content (active buffer takes precedence).
    let content = '';
    const isActiveBuffer = path === currentEditorFilePath ? 1 : 0;
    if (isActiveBuffer > 0 && editorReady > 0) {
      content = editorInstance.getContent();
    } else {
      try { content = readFileSync(path); } catch (_e: any) { content = ''; }
    }
    if (content.length < 1) {
      skippedFiles = skippedFiles + 1;
      pos = arrEnd + 1;
      continue;
    }
    // Sort edits in reverse so offsets don't shift.
    edits.sort((a, b) => {
      if (a.startLine !== b.startLine) return b.startLine - a.startLine;
      return b.startChar - a.startChar;
    });
    const lineOffsets: number[] = [0];
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) lineOffsets.push(i + 1);
    }
    let next = content;
    let editsAppliedHere = 0;
    for (let i = 0; i < edits.length; i++) {
      const e = edits[i];
      if (e.startLine >= lineOffsets.length || e.endLine >= lineOffsets.length) continue;
      const startOff = lineOffsets[e.startLine] + e.startChar;
      const endOff = lineOffsets[e.endLine] + e.endChar;
      if (startOff < 0 || endOff > next.length || startOff > endOff) continue;
      next = next.slice(0, startOff) + e.newText + next.slice(endOff);
      editsAppliedHere = editsAppliedHere + 1;
    }
    if (editsAppliedHere === 0) {
      skippedFiles = skippedFiles + 1;
      pos = arrEnd + 1;
      continue;
    }
    // Write back.
    if (isActiveBuffer > 0 && editorReady > 0) {
      editorInstance.setContent(next);
    } else {
      try { writeFileSync(path, next); } catch (_e: any) {
        skippedFiles = skippedFiles + 1;
        pos = arrEnd + 1;
        continue;
      }
    }
    appliedFiles = appliedFiles + 1;
    appliedEdits = appliedEdits + editsAppliedHere;
    pos = arrEnd + 1;
  }
  return { appliedFiles: appliedFiles, appliedEdits: appliedEdits, skippedFiles: skippedFiles };
}

// SHIP-V1-GAPS.md #29: cached actions for the picker. Parsed lazily — title +
// the slice of the original JSON for that action so we can re-extract `edit`
// when the user picks it. Indexed alongside `_codeActionTitles` so click
// closures can pass an idx into the source array.
let _codeActionTitles: string[] = [];
let _codeActionBodies: string[] = [];

function onCodeActionsResult(json: string): void {
  if (json.length === 0 || json === 'null' || json === '[]') {
    showNotification(t('No quick fixes available'), 'info');
    return;
  }
  _codeActionTitles = [];
  _codeActionBodies = [];
  // Walk the top-level array of CodeAction / Command objects. We don't have a
  // robust JSON parser, but findClosingBrace already exists for symbols (#36).
  let pos = 0;
  while (pos < json.length) {
    const open = json.indexOf('{', pos);
    if (open < 0) break;
    const end = findClosingBrace(json, open);
    if (end < 0) break;
    const body = json.slice(open, end + 1);
    const title = extractJsonStringField(body, '"title"');
    if (title.length > 0) {
      _codeActionTitles.push(title);
      _codeActionBodies.push(body);
    }
    pos = end + 1;
  }
  if (_codeActionTitles.length === 0) {
    showNotification(t('No quick fixes available'), 'info');
    return;
  }
  // Render into the sidebar via the existing takeover pattern.
  showCodeActionsPicker();
}

function showCodeActionsPicker(): void {
  if (!sidebarContainer) return;
  if (sidebarToggleReady > 0 && sidebarVisible < 1) {
    sidebarVisible = 1;
    widgetSetHidden(sidebarWidget, 0);
    widgetSetHidden(sidebarBorderWidget, 0);
  }
  resetSearchPanelReady();
  widgetClearChildren(sidebarContainer);
  const title = Text(t('CODE ACTIONS'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(sidebarContainer, title);

  for (let i = 0; i < _codeActionTitles.length; i++) {
    const idx = i;
    const t1 = _codeActionTitles[i];
    const btn = Button(t1, () => { applyCodeAction(idx); });
    setBtnFg(btn, getSideBarForeground());
    textSetFontSize(btn, 12);
    widgetAddChild(sidebarContainer, btn);
  }
}

// SHIP-V1-GAPS.md #29: apply a single code action. Honors `edit.changes`
// across one or more files via the shared `applyWorkspaceEdit` helper.
// Command-driven actions (no inline `edit`) surface a v1.1 hint — they need
// `workspace/executeCommand` to be wired into the LSP bridge.
function applyCodeAction(idx: number): void {
  if (idx < 0 || idx >= _codeActionBodies.length) return;
  const body = _codeActionBodies[idx];
  const editIdx = body.indexOf('"edit"');
  if (editIdx < 0) {
    showNotification(t('Action requires command execution — v1.1.'), 'info');
    return;
  }
  const editBraceOpen = body.indexOf('{', editIdx);
  if (editBraceOpen < 0) {
    showNotification(t('Action has no inline edit.'), 'info');
    return;
  }
  const editBraceClose = findClosingBrace(body, editBraceOpen);
  if (editBraceClose < 0) {
    showNotification(t('Action edit is malformed.'), 'warning');
    return;
  }
  const editBlock = body.slice(editBraceOpen, editBraceClose + 1);
  const r = applyWorkspaceEdit(editBlock);
  if (r.appliedFiles === 0) {
    if (editBlock.indexOf('"documentChanges"') >= 0) {
      showNotification(t('Action uses documentChanges — v1.1.'), 'info');
    } else {
      showNotification(t('Action has no applicable edits.'), 'info');
    }
    return;
  }
  let msg = t('Applied: ') + _codeActionTitles[idx];
  msg += ' (' + String(r.appliedEdits) + ' ' + t('edits') + ')';
  showNotification(msg, 'info');
}

function findClosingBracket(s: string, openPos: number): number {
  let depth = 0;
  let inStr = 0;
  let escape = 0;
  for (let i = openPos; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (escape > 0) { escape = 0; continue; }
    if (inStr > 0) {
      if (c === 92) escape = 1;
      else if (c === 34) inStr = 0;
      continue;
    }
    if (c === 34) inStr = 1;
    else if (c === 91) depth = depth + 1;
    else if (c === 93) {
      depth = depth - 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Status-bar branch click — opens the Source Control sidebar panel. */
/**
 * SHIP-V1-GAPS.md #63: read git diff for the current workspace and pre-fill
 * the AI chat input with a commit-message prompt. The chat handles streaming.
 * Caps the diff to keep the prompt small.
 */
function onGenerateCommitMessageImpl(): void {
  if (workspaceRoot.length === 0) {
    showNotification(t('No workspace open.'), 'warning');
    return;
  }
  // Prefer staged diff; fall back to working tree if nothing is staged.
  let diff = '';
  try {
    const r = spawnSync('git', ['-C', workspaceRoot, 'diff', '--cached', '--no-color', '--stat=80,80']);
    if (r.status === 0) diff = r.stdout;
  } catch (_e: any) {}
  if (diff.length < 5) {
    try {
      const r = spawnSync('git', ['-C', workspaceRoot, 'diff', '--no-color', '--stat=80,80']);
      if (r.status === 0) diff = r.stdout;
    } catch (_e: any) {}
  }
  if (diff.length < 5) {
    showNotification(t('No git changes to summarize.'), 'info');
    return;
  }
  // Include the patch body too, capped at ~6KB so we don't blow the context.
  let body = '';
  try {
    const r = spawnSync('git', ['-C', workspaceRoot, 'diff', '--cached', '--no-color', '-U2']);
    if (r.status === 0) body = r.stdout;
  } catch (_e: any) {}
  if (body.length < 5) {
    try {
      const r = spawnSync('git', ['-C', workspaceRoot, 'diff', '--no-color', '-U2']);
      if (r.status === 0) body = r.stdout;
    } catch (_e: any) {}
  }
  if (body.length > 6000) body = body.slice(0, 6000) + '\n[…truncated]';

  let prompt = 'Write a concise conventional-commit message (max 72 chars on the subject line) for the following diff. Reply with only the commit message — no preamble, no code fences.\n\nFile summary:\n';
  prompt += diff;
  prompt += '\n\nPatch:\n';
  prompt += body;

  // Switch the right panel to AI Chat and pre-fill.
  pendingActivityIdx = 4; // AI Chat slot
  setTimeout(() => { onActivityClickDeferred(); }, 0);
  setTimeout(() => { prefillChatInput(prompt); }, 64);
  showNotification(t('Commit-message prompt prepared in AI Chat. Press Enter to generate.'), 'info');
}

/**
 * SHIP-V1-GAPS.md #108 — generate a PR description.
 *
 * Mirrors onGenerateCommitMessageImpl: collects the commits and diff between
 * the current branch and its merge-base with `main` (falls back to `master`,
 * then to `origin/HEAD`), builds a structured prompt, and pre-fills AI Chat
 * so the user can review/submit. Output is left for the user to paste into
 * the PR body — the chat panel already supports copy via Markdown export.
 */
function onGeneratePRDescriptionImpl(): void {
  if (workspaceRoot.length === 0) {
    showNotification(t('No workspace open.'), 'warning');
    return;
  }

  // Resolve the base ref.
  let baseRef = '';
  try {
    const r = spawnSync('git', ['-C', workspaceRoot, 'rev-parse', '--verify', 'main']);
    if (r.status === 0) baseRef = 'main';
  } catch (_e: any) {}
  if (baseRef.length === 0) {
    try {
      const r = spawnSync('git', ['-C', workspaceRoot, 'rev-parse', '--verify', 'master']);
      if (r.status === 0) baseRef = 'master';
    } catch (_e: any) {}
  }
  if (baseRef.length === 0) {
    try {
      const r = spawnSync('git', ['-C', workspaceRoot, 'rev-parse', '--abbrev-ref', 'origin/HEAD']);
      if (r.status === 0) {
        // Output is e.g. "origin/main\n" — slice off the "origin/" prefix.
        let s = r.stdout;
        let end = s.length;
        while (end > 0 && (s.charCodeAt(end - 1) === 10 || s.charCodeAt(end - 1) === 13)) end--;
        s = s.slice(0, end);
        if (s.length > 7 && s.slice(0, 7) === 'origin/') baseRef = s.slice(7);
      }
    } catch (_e: any) {}
  }
  if (baseRef.length === 0) {
    showNotification(t('Could not determine the base branch (no main/master).'), 'warning');
    return;
  }

  // Current branch — used in the prompt header.
  let branch = '';
  try {
    const r = spawnSync('git', ['-C', workspaceRoot, 'rev-parse', '--abbrev-ref', 'HEAD']);
    if (r.status === 0) {
      branch = r.stdout;
      let end = branch.length;
      while (end > 0 && (branch.charCodeAt(end - 1) === 10 || branch.charCodeAt(end - 1) === 13)) end--;
      branch = branch.slice(0, end);
    }
  } catch (_e: any) {}

  // Don't run on the base branch itself — there are no commits to summarize.
  if (branch.length > 0 && branch.length === baseRef.length) {
    let same = 1;
    for (let i = 0; i < branch.length; i++) {
      if (branch.charCodeAt(i) !== baseRef.charCodeAt(i)) { same = 0; break; }
    }
    if (same > 0) {
      showNotification(t('Switch to a feature branch first.'), 'info');
      return;
    }
  }

  const range = baseRef + '...HEAD';

  let log = '';
  try {
    const r = spawnSync('git', ['-C', workspaceRoot, 'log', '--no-color', '--pretty=%h %s', range]);
    if (r.status === 0) log = r.stdout;
  } catch (_e: any) {}
  if (log.length < 1) {
    showNotification(t('No commits ahead of') + ' ' + baseRef + '.', 'info');
    return;
  }

  let stat = '';
  try {
    const r = spawnSync('git', ['-C', workspaceRoot, 'diff', '--no-color', '--stat=80,80', range]);
    if (r.status === 0) stat = r.stdout;
  } catch (_e: any) {}

  let body = '';
  try {
    const r = spawnSync('git', ['-C', workspaceRoot, 'diff', '--no-color', '-U2', range]);
    if (r.status === 0) body = r.stdout;
  } catch (_e: any) {}
  if (body.length > 8000) body = body.slice(0, 8000) + '\n[…truncated]';

  let prompt = 'Write a pull-request description for the changes below.\n';
  prompt += 'Format: a Markdown title line (no leading "#"), a blank line, then a brief\n';
  prompt += '"## Summary" section (3–5 bullets) and a "## Test plan" section (checklist).\n';
  prompt += 'Reply with only the PR body — no preamble, no code fences.\n\n';
  if (branch.length > 0) {
    prompt += 'Branch: ';
    prompt += branch;
    prompt += ' → ';
    prompt += baseRef;
    prompt += '\n\n';
  }
  prompt += 'Commits:\n';
  prompt += log;
  if (stat.length > 0) {
    prompt += '\nFile summary:\n';
    prompt += stat;
  }
  prompt += '\nPatch:\n';
  prompt += body;

  pendingActivityIdx = 4; // AI Chat slot
  setTimeout(() => { onActivityClickDeferred(); }, 0);
  setTimeout(() => { prefillChatInput(prompt); }, 64);
  showNotification(t('PR description prompt prepared in AI Chat. Press Enter to generate.'), 'info');
}

function onStatusBranchClick(): void {
  pendingActivityIdx = 2; // git activity index
  setTimeout(() => { onActivityClickDeferred(); }, 0);
}

/**
 * Update the sticky-scroll context line (SHIP-V1-GAPS.md #24). Cheap heuristic:
 * walk up from the current cursor line and pin the most recent line whose
 * indent is strictly less than the cursor line's indent. That's usually the
 * enclosing function/class/block header. Hides the row when there's no scope.
 */
function updateStickyScroll(): void {
  if (stickyScrollRow === null || stickyScrollLabel === null) return;
  if (editorReady < 1) {
    widgetSetHidden(stickyScrollRow, 1);
    _lastStickyLine = -1;
    return;
  }
  const cursorLine = editorInstance.getCursorLine();
  if (cursorLine < 1) {
    widgetSetHidden(stickyScrollRow, 1);
    _lastStickyLine = -1;
    return;
  }
  const content = editorInstance.getContent();
  // Tokenize lines lazily — find the byte offsets of newlines up to cursorLine.
  let lineStart: number[] = [0];
  let lc = 0;
  for (let i = 0; i < content.length && lc <= cursorLine; i++) {
    if (content.charCodeAt(i) === 10) {
      lc = lc + 1;
      lineStart.push(i + 1);
    }
  }
  if (cursorLine >= lineStart.length) {
    widgetSetHidden(stickyScrollRow, 1);
    _lastStickyLine = -1;
    return;
  }
  // Indent of the cursor line.
  const curStart = lineStart[cursorLine];
  let curIndent = 0;
  while (curStart + curIndent < content.length) {
    const c = content.charCodeAt(curStart + curIndent);
    if (c === 32 || c === 9) curIndent = curIndent + 1; else break;
  }
  // If cursor line is at column 0 indent there's no parent scope.
  if (curIndent === 0) {
    widgetSetHidden(stickyScrollRow, 1);
    _lastStickyLine = -1;
    return;
  }
  // Walk up and find the first line with smaller indent + non-blank.
  let foundLine = -1;
  for (let li = cursorLine - 1; li >= 0; li--) {
    const ls = lineStart[li];
    let le = li + 1 < lineStart.length ? lineStart[li + 1] - 1 : content.length;
    if (ls >= content.length) continue;
    // Compute indent.
    let ind = 0;
    while (ls + ind < le) {
      const c = content.charCodeAt(ls + ind);
      if (c === 32 || c === 9) ind = ind + 1; else break;
    }
    if (ls + ind >= le) continue; // blank line — skip
    if (ind < curIndent) { foundLine = li; break; }
  }
  if (foundLine < 0) {
    widgetSetHidden(stickyScrollRow, 1);
    _lastStickyLine = -1;
    return;
  }
  if (foundLine === _lastStickyLine) return; // no change
  _lastStickyLine = foundLine;
  const sStart = lineStart[foundLine];
  let sEnd = foundLine + 1 < lineStart.length ? lineStart[foundLine + 1] - 1 : content.length;
  if (sEnd > content.length) sEnd = content.length;
  const sliced = content.slice(sStart, sEnd);
  // Cap displayed length so a giant signature doesn't overflow.
  let displayed = sliced;
  if (displayed.length > 120) displayed = displayed.slice(0, 120) + '…';
  textSetString(stickyScrollLabel, displayed);
  widgetSetHidden(stickyScrollRow, 0);
}

/**
 * Scan the active buffer for git merge conflict markers and update the
 * conflict toolbar. SHIP-V1-GAPS.md #44.
 *
 * A conflict looks like:
 *   <<<<<<< HEAD
 *   current side
 *   =======
 *   incoming side
 *   >>>>>>> theirs
 *
 * We track the byte offsets of each `<`, `=`, `>` triple in parallel arrays
 * so the Accept handlers can splice the buffer without re-scanning.
 */
function detectConflicts(): void {
  if (conflictBar === null || conflictLabel === null) return;
  if (editorReady < 1) {
    widgetSetHidden(conflictBar, 1);
    _conflictCount = 0;
    return;
  }
  const content = editorInstance.getContent();
  // Cheap early-out — most files have no '<' at line start. Sample first.
  if (content.indexOf('<<<<<<<') < 0) {
    if (_conflictCount !== 0) {
      _conflictCount = 0;
      _conflictStartOffsets = [];
      _conflictSepOffsets = [];
      _conflictEndOffsets = [];
      widgetSetHidden(conflictBar, 1);
      _lastConflictSig = '';
    }
    return;
  }

  const starts: number[] = [];
  const seps: number[] = [];
  const ends: number[] = [];
  let p = 0;
  while (p < content.length) {
    // <<<<<<< must be at line start
    const lt = content.indexOf('<<<<<<<', p);
    if (lt < 0) break;
    if (lt > 0 && content.charCodeAt(lt - 1) !== 10) { p = lt + 7; continue; }
    const eq = content.indexOf('\n=======', lt);
    if (eq < 0) break;
    const gt = content.indexOf('\n>>>>>>>', eq);
    if (gt < 0) break;
    starts.push(lt);
    seps.push(eq + 1); // offset of the '=' itself
    ends.push(gt + 1); // offset of the '>' itself
    p = gt + 8;
  }

  // Build a signature so we skip a tree of redundant UI updates when the
  // detected set hasn't changed.
  let sig = '';
  for (let i = 0; i < starts.length; i++) {
    sig += String(starts[i]);
    sig += ',';
  }
  if (sig === _lastConflictSig) return;
  _lastConflictSig = sig;

  _conflictStartOffsets = starts;
  _conflictSepOffsets = seps;
  _conflictEndOffsets = ends;
  _conflictCount = starts.length;

  if (_conflictCount === 0) {
    widgetSetHidden(conflictBar, 1);
    return;
  }
  let label = String(_conflictCount);
  label += ' ';
  label += _conflictCount === 1 ? t('merge conflict') : t('merge conflicts');
  textSetString(conflictLabel, label);
  widgetSetHidden(conflictBar, 0);
}

/**
 * Resolve the conflict nearest the cursor. `choice`:
 *   0 = keep current side (between `<<<<<<<` and `=======`)
 *   1 = keep incoming side (between `=======` and `>>>>>>>`)
 *   2 = keep both
 */
function resolveConflict(choice: number): void {
  if (_conflictCount === 0 || editorReady < 1) return;
  const content = editorInstance.getContent();

  // Find the conflict closest to the cursor's byte offset.
  const cursorLine = editorInstance.getCursorLine();
  // Convert cursorLine to byte offset (line start). Walk newlines.
  let cursorByte = 0;
  let lc = 0;
  for (let i = 0; i < content.length; i++) {
    if (lc >= cursorLine) break;
    if (content.charCodeAt(i) === 10) lc = lc + 1;
    cursorByte = i + 1;
  }
  let bestIdx = 0;
  let bestDist = -1;
  for (let i = 0; i < _conflictCount; i++) {
    const s = _conflictStartOffsets[i];
    const e = _conflictEndOffsets[i];
    let dist = 0;
    if (cursorByte < s) dist = s - cursorByte;
    else if (cursorByte > e) dist = cursorByte - e;
    else dist = 0;
    if (bestDist < 0 || dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  const startOff = _conflictStartOffsets[bestIdx];
  const sepOff = _conflictSepOffsets[bestIdx];
  const endOff = _conflictEndOffsets[bestIdx];

  // Slice out the marker lines themselves. Each marker occupies until the
  // next '\n'. The "current" body is between the line *after* `<<<<<<<` and
  // the line containing `=======`. The "incoming" body is between the line
  // *after* `=======` and the line containing `>>>>>>>`.
  const startLineEnd = findEndOfLine(content, startOff);
  const sepLineEnd = findEndOfLine(content, sepOff);
  const endLineEnd = findEndOfLine(content, endOff);
  const currentBody = content.slice(startLineEnd + 1, sepOff);   // ends just before "=======" line
  const incomingBody = content.slice(sepLineEnd + 1, endOff);    // ends just before ">>>>>>>" line

  let replacement = '';
  if (choice === 0) replacement = currentBody;
  else if (choice === 1) replacement = incomingBody;
  else replacement = currentBody + incomingBody;

  const before = content.slice(0, startOff);
  const after = endLineEnd + 1 <= content.length ? content.slice(endLineEnd + 1) : '';
  const next = before + replacement + after;
  editorInstance.setContent(next);
  editorInstance.render();
  // Re-detect on next tick — the toolbar will hide itself when no markers remain.
  _lastConflictSig = '';
  setTimeout(() => { detectConflicts(); }, 32);
}

function findEndOfLine(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) return i;
  }
  return s.length;
}

function persistEditorCursorState(): void {
  if (currentEditorFilePath.length < 1) return;
  if (isUntitledFile() > 0) return; // untitled files don't survive restart
  const line = editorInstance.getCursorLine();
  const col = editorInstance.getCursorColumn();
  const scrollTop = editorInstance.getScrollTop();
  if (line === _lastSnapCursorLine && col === _lastSnapCursorCol && scrollTop === _lastSnapScrollTop) return;
  _lastSnapCursorLine = line;
  _lastSnapCursorCol = col;
  _lastSnapScrollTop = scrollTop;
  setNumberSetting('lastActiveCursorLine', line);
  setNumberSetting('lastActiveCursorCol', col);
  setNumberSetting('lastActiveScrollTop', scrollTop);
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
    if (isDirectory(filePath)) return '';
    content = readFileSync(filePath);
  } catch (e) {
    return '';
  }
  return content;
}

// SHIP-V1-GAPS.md #73: detect line endings from buffer content. Returns
// 'LF' (just `\n`), 'CRLF' (any `\r\n` pair seen), or 'CR' (Mac classic;
// `\r` without a following `\n`). We report whichever is dominant; on tie
// or empty we default to LF (matches `git config core.autocrlf=input`).
function detectEolStyle(content: string): string {
  let lf = 0;
  let crlf = 0;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    if (c === 13) {
      if (i + 1 < content.length && content.charCodeAt(i + 1) === 10) {
        crlf = crlf + 1;
        i = i + 1; // skip the LF half of the pair
      }
      // bare CR — Mac classic — fall through; we treat as LF for v1.
    } else if (c === 10) {
      lf = lf + 1;
    }
  }
  if (crlf > lf) return 'CRLF';
  return 'LF';
}

// SHIP-V1-GAPS.md #73: detect encoding by BOM. JS strings preserve U+FEFF at
// offset 0 when the file had a UTF-8 BOM (0xEF 0xBB 0xBF). UTF-16 with BOM
// would also appear as U+FEFF but the raw file would not be readable as UTF-8
// text by Perry's readFileSync; if we got readable content with a BOM, it's
// most likely UTF-8 BOM. Returns the human label for the status bar.
function detectEncoding(content: string): string {
  if (content.length > 0 && content.charCodeAt(0) === 0xFEFF) return 'UTF-8 BOM';
  return 'UTF-8';
}

let _currentEol: string = 'LF';
// 1 if the currently-open file began with a UTF-8 BOM (U+FEFF). The BOM is
// stripped from the editor buffer so it isn't a phantom leading char, and
// re-prepended on save via restoreEolForSave so BOM files round-trip.
let _currentHadBOM: number = 0;
// 1 if the currently-open file is binary (contains a NUL byte). We show a
// placeholder instead of dumping raw bytes into the editor, and saveFileAction
// refuses to write so the user can't overwrite the binary with the placeholder.
let _currentFileIsBinary: number = 0;
// 1 if the currently-open file was truncated for display (>100KB, only first
// 5000 lines loaded). saveFileAction hard-refuses so a save can't overwrite
// the full on-disk file with just the visible first-5000-lines slice.
let _currentFileTruncated: number = 0;

// Prepare editor content (always pure \n, BOM-stripped — see displayFileContent)
// for writing to disk: restore the file's original EOL and re-prepend a UTF-8
// BOM if the file had one. Without EOL restore, every save of a Windows-default
// CRLF file silently rewrites it as LF (whole-file git churn). Without BOM
// re-add, every save of a Notepad/Visual-Studio/PowerShell-authored UTF-8-BOM
// file silently strips the BOM (also whole-file git churn + can break tools
// that require the BOM). `_currentEol`/`_currentHadBOM` are set from the raw
// bytes at file-open in displayFileContent (and refreshed on external reload).
function restoreEolForSave(content: string): string {
  let body = content;
  if (_currentEol.length === 4) { // CRLF
    let out = '';
    for (let i = 0; i < content.length; i++) {
      const c = content.charCodeAt(i);
      if (c === 10) {
        // Guard against a stray pre-existing \r so we never emit \r\r\n.
        if (i > 0 && content.charCodeAt(i - 1) === 13) {
          out += '\n';
        } else {
          out += '\r\n';
        }
      } else {
        out += content.charAt(i);
      }
    }
    body = out;
  }
  // Re-prepend the UTF-8 BOM the file was opened with (stripped for editing).
  if (_currentHadBOM > 0 && (body.length === 0 || body.charCodeAt(0) !== 0xFEFF)) {
    body = String.fromCharCode(0xFEFF) + body;
  }
  return body;
}

function cycleEolAction(): void {
  if (editorReady < 1) return;
  if (currentEditorFilePath.length < 1) return;
  const content = editorInstance.getContent();
  let next = '';
  if (_currentEol.length === 4) {
    // CRLF → LF. Replace every \r\n pair with \n.
    for (let i = 0; i < content.length; i++) {
      const c = content.charCodeAt(i);
      if (c === 13 && i + 1 < content.length && content.charCodeAt(i + 1) === 10) {
        next += '\n';
        i = i + 1;
      } else {
        next += content.charAt(i);
      }
    }
    _currentEol = 'LF';
  } else {
    // LF → CRLF. Replace every bare \n with \r\n.
    for (let i = 0; i < content.length; i++) {
      const c = content.charCodeAt(i);
      if (c === 10) {
        // Skip if preceded by \r (already CRLF).
        if (i > 0 && content.charCodeAt(i - 1) === 13) {
          next += '\n';
        } else {
          next += '\r\n';
        }
      } else {
        next += content.charAt(i);
      }
    }
    _currentEol = 'CRLF';
  }
  editorInstance.setContent(next);
  updateStatusBarEolImpl(_currentEol);
  showNotification(t('Line endings set to') + ' ' + _currentEol, 'info');
}

// Module-level refs for diff widgets currently in editorPane
let activeDiffHeader: unknown = null;
let activeDiffEditors: unknown = null;

// Module-level ref for settings tab widget in editorPane
let activeSettingsWidget: unknown = null;
let settingsTabCreated: number = 0;

// Module-level ref for update tab widget in editorPane
let activeUpdateWidget: unknown = null;
let updateTabCreated: number = 0;

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

/** Show the update tab in the editor pane. */
function showUpdateInEditorPane(): void {
  if (!editorPaneWidget) return;
  if (activeDiffEditors) hideDiffView();
  if (activeSettingsWidget) hideSettingsInEditorPane();
  if (editorWidget) widgetSetHidden(editorWidget, 1);
  if (activeUpdateWidget) {
    widgetSetHidden(activeUpdateWidget, 0);
    return;
  }
  const updateCtr = VStack(0, []);
  widgetSetHugging(updateCtr, 1);
  renderUpdateTab(updateCtr);
  widgetAddChild(editorPaneWidget, updateCtr);
  activeUpdateWidget = updateCtr;
}

/** Hide the update tab from the editor pane. */
function hideUpdateInEditorPane(): void {
  if (!activeUpdateWidget) return;
  widgetSetHidden(activeUpdateWidget, 1);
  if (editorWidget) widgetSetHidden(editorWidget, 0);
}

function displayFileContent(filePath: string): void {
  const t0 = Date.now();
  // Virtual paths (__settings__, __update__, __welcome__) — don't read file
  if (filePath.length > 2 && filePath.charCodeAt(0) === 95 && filePath.charCodeAt(1) === 95) {
    if (filePath.length === 12 && filePath.charCodeAt(2) === 115) {
      showSettingsInEditorPane();
    }
    if (filePath.length === 10 && filePath.charCodeAt(2) === 117) {
      showUpdateInEditorPane();
    }
    return;
  }
  // Switching away from virtual tabs — hide them
  if (activeSettingsWidget) hideSettingsInEditorPane();
  if (activeUpdateWidget) hideUpdateInEditorPane();
  currentEditorFilePath = filePath;
  setSidebarCurrentEditorPath(filePath);
  revealFileInExplorer(filePath);
  pendingSidebarRefresh = 1;
  const t1 = Date.now();
  updateBreadcrumb();
  const t2 = Date.now();
  updateStatusBarLanguageImpl(filePath);
  const t4 = Date.now();
  if (editorReady < 1) return;
  const lang = detectLanguage(filePath);
  editorInstance.setLanguage(lang);
  const content = safeReadFile(filePath);
  // Strip a leading UTF-8 BOM (U+FEFF) before it reaches the editor. Windows
  // tools (Notepad, older Visual Studio, PowerShell `Out-File`/`>` default)
  // write UTF-8 with a BOM. Left in the buffer it's a phantom zero-width
  // leading char: line-1 columns shift by one, the charCodeAt(0) LFS
  // heuristic below breaks, and the first syntax token absorbs U+FEFF.
  // We remember it (`_currentHadBOM`) and restoreEolForSave re-prepends it
  // so the file round-trips byte-identical. `content` (raw, BOM included) is
  // still used for `_externalFileHash` because the disk-watcher reads raw
  // file bytes and must hash-match.
  _currentHadBOM = 0;
  let body = content;
  if (body.length > 0 && body.charCodeAt(0) === 0xFEFF) {
    _currentHadBOM = 1;
    body = body.slice(1);
  }
  // Binary-file guard. Opening a PNG/exe/zip used to dump raw bytes into the
  // editor: mojibake render, very slow for large binaries, and — worst —
  // saving round-tripped the bytes through the \n-normalizing buffer +
  // EOL-restore and silently corrupted the binary. Detect via a NUL byte in
  // the first 8000 chars (the same heuristic git uses). On binary: show a
  // placeholder, notify, seed the disk-watcher baseline, and bail before
  // setContent(rawBytes)/LSP/indent. saveFileAction also hard-refuses to
  // write a binary tab (see guard there) so the placeholder can't clobber it.
  _currentFileIsBinary = 0;
  let _binScan = body.length < 8000 ? body.length : 8000;
  for (let bi = 0; bi < _binScan; bi++) {
    if (body.charCodeAt(bi) === 0) { _currentFileIsBinary = 1; break; }
  }
  if (_currentFileIsBinary > 0) {
    editorInstance.setContent(t('This file is not displayed because it is binary or uses an unsupported encoding.'));
    markTabSaved(editorInstance.getContent().length);
    _externalFileHash = djb2Hash(content);
    _externalCheckPending = 0;
    _currentEol = 'LF';
    _currentHadBOM = 0;
    _currentFileTruncated = 0;
    updateStatusBarEolImpl(_currentEol);
    updateStatusBarEncodingImpl(t('Binary'));
    showNotification(t('Binary file opened read-only — edits will not be saved.'), 'warning');
    editorInstance.render();
    return;
  }
  // SHIP-V1-GAPS.md #102: LFS warning. Git-LFS stores tiny pointer files in
  // place of large binaries — opening one looks fine but you're editing the
  // pointer, not the asset. The file always starts with `version https://git-lfs.github.com/spec/`.
  // Surface a notification so the user doesn't accidentally commit garbage.
  if (body.length > 30 && body.length < 1024
      && body.charCodeAt(0) === 118 && body.charCodeAt(1) === 101
      && body.indexOf('git-lfs.github.com/spec/') > 0) {
    showNotification(t('LFS pointer file. The actual asset is on the LFS server — install git-lfs and run `git lfs pull` to fetch.'), 'warning');
  }
  const t6 = Date.now();
  // Large files (>100KB): load first 5000 lines for instant display.
  // CRITICAL: when truncated, the editor only holds the first 5000 lines.
  // Without a save guard, editing + save (or auto-save) would do
  // getContent() (5000 lines) → writeFileSync → PERMANENTLY DESTROY every
  // line after 5000 on disk. A user fixing a typo in a 200KB log/data file
  // would silently lose ~75% of it. So a truncated tab is treated like a
  // binary tab: viewable, but hard read-only (saveFileAction refuses).
  // Full large-file editing needs windowed/virtualized save — v1.1.
  _currentFileTruncated = 0;
  let displayContent = body;
  if (body.length > 100000) {
    let nlCount = 0;
    let cutoff = body.length;
    for (let ci = 0; ci < body.length; ci++) {
      if (body.charCodeAt(ci) === 10) {
        nlCount = nlCount + 1;
        if (nlCount >= 5000) { cutoff = ci; break; }
      }
    }
    if (cutoff < body.length) {
      displayContent = body.slice(0, cutoff);
      _currentFileTruncated = 1;
      showNotification(t('Large file: showing first 5000 lines, read-only (editing the full file lands in v1.1).'), 'warning');
    }
  }
  editorInstance.setContent(displayContent);
  // Mark saved immediately so pollDirtyState doesn't flag it as dirty
  const editorLen = editorInstance.getContent().length;
  markTabSaved(editorLen);
  // SHIP-V1-GAPS.md #86: seed the disk-watcher with the just-read content
  // hash so the next poll has a baseline to compare against. Raw `content`
  // (BOM included) — the watcher reads raw file bytes.
  _externalFileHash = djb2Hash(content);
  _externalCheckPending = 0;
  // SHIP-V1-GAPS.md #73: refresh EOL + encoding status-bar labels for the
  // just-opened file. Encoding is detection-only in v1 — changing it is a
  // data-destructive op that needs a confirm dialog. EOL detected from the
  // BOM-stripped body so a BOM doesn't skew first-line detection.
  _currentEol = detectEolStyle(body);
  updateStatusBarEolImpl(_currentEol);
  updateStatusBarEncodingImpl(detectEncoding(content));
  const t7 = Date.now();
  editorInstance.render();
  const t8 = Date.now();
  applyDetectedIndentation(content);
  const t9 = Date.now();
  lspDidOpen(filePath, lang, content);
  const t10 = Date.now();
  // SHIP-V1-GAPS.md #30/#84: keep the outline view in sync with the active
  // file. setOutlineActiveFile triggers an `lspDocumentSymbols` request; the
  // result lands via setDocumentSymbolsCallback (registered in app init).
  setOutlineActiveFile(filePath);
  // SHIP-V1-GAPS.md #85: keep the timeline view in sync with the active file.
  setTimelineActiveFile(filePath);
  // Write timing log
  let log = 'TIMING displayFileContent:\n';
  log += '  setSidebarPath: '; log += String(t1 - t0); log += 'ms\n';
  log += '  updateBreadcrumb: '; log += String(t2 - t1); log += 'ms\n';
  log += '  updateStatusBar: '; log += String(t3 - t2); log += 'ms\n';
  log += '  updateSidebarSel: '; log += String(t4 - t3); log += 'ms\n';
  log += '  detectLanguage: '; log += String(t5 - t4); log += 'ms\n';
  log += '  readFile: '; log += String(t6 - t5); log += 'ms\n';
  log += '  setContent: '; log += String(t7 - t6); log += 'ms\n';
  log += '  render: '; log += String(t8 - t7); log += 'ms\n';
  log += '  detectIndent: '; log += String(t9 - t8); log += 'ms\n';
  log += '  lspDidOpen: '; log += String(t10 - t9); log += 'ms\n';
  log += '  TOTAL: '; log += String(t10 - t0); log += 'ms\n';
  // SHIP-V1-GAPS.md followup §5: route debug-log writes through the
  // platform-aware temp dir so Windows doesn't silently swallow them.
  try { writeFileSync(getTempDir() + '/hone-timing.log', log); } catch (e: any) {}
}

function openFileInEditor(filePath: string, fileName: string): void {
  const ot0 = Date.now();
  // Close diff view BEFORE modifying the tab bar — the tab rebuild triggers
  // a layout pass that crashes if diff editor NSViews are still in the hierarchy.
  if (isDiffActive() > 0) {
    hideDiffView();
  }
  const ot1 = Date.now();
  openTab(filePath, fileName);
  const ot2 = Date.now();
  displayFileContent(filePath);
  const ot3 = Date.now();
  telemetryTrackFileOpen();
  const ot4 = Date.now();
  let olog = 'TIMING openFileInEditor:\n';
  olog += '  diffCheck: '; olog += String(ot1 - ot0); olog += 'ms\n';
  olog += '  openTab: '; olog += String(ot2 - ot1); olog += 'ms\n';
  olog += '  displayFileContent: '; olog += String(ot3 - ot2); olog += 'ms\n';
  olog += '  telemetry: '; olog += String(ot4 - ot3); olog += 'ms\n';
  olog += '  TOTAL: '; olog += String(ot4 - ot0); olog += 'ms\n';
  try { writeFileSync(getTempDir() + '/hone-timing-open.log', olog); } catch (e: any) {}
  // Track in recent items — skip virtual paths (__*) and untitled files
  if (filePath.length > 2 && filePath.charCodeAt(0) !== 95) {
    if (isUntitledFile() < 1) {
      addRecentFile(filePath);
    }
  }
  // Dispatch onDocumentOpen hook to plugins
  if (isPluginSystemEnabled() > 0) {
    let eventJson = '{"filePath":"';
    eventJson += filePath;
    eventJson += '"}';
    dispatchPluginHook('onDocumentOpen', eventJson);
  }
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
  if (editorInstance === null) return null;
  try {
    const vm = editorInstance.viewModel;
    if (vm === null || vm === undefined) return null;
    const cursors = vm.cursors;
    if (cursors === null || cursors === undefined) return null;
    if (cursors.length < 1) return null;
    return cursors[0];
  } catch (e: any) {
    return null;
  }
}

/** Called by tab bar when the active tab changes. */
function onTabDisplay(path: string): void {
  if (path.length < 1) {
    currentEditorFilePath = '';
    setSidebarCurrentEditorPath('');
    if (editorReady > 0) {
      editorInstance.setContent('');
      editorInstance.render();
    }
    updateBreadcrumb();
    return;
  }
  displayFileContent(path);
}

/** Called by sidebar explorer when a file is clicked. */
function onSidebarFileClick(path: string, name: string): void {
  openFileInEditor(path, name);
}

/** Called by context menu to refresh the sidebar after file operations. */
function onContextMenuRefresh(): void {
  refreshSidebarContent();
}

/** Called by context menu to open a terminal at a specific directory. */
function onContextMenuTerminalOpen(dir: string): void {
  setTerminalCwd(dir);
  // Show terminal panel if hidden
  if (terminalVisible < 1) {
    toggleTerminalAction();
  }
}

/** Called by search panel when a file is opened from results. */
function openFileFromSearchPanel(path: string, name: string): void {
  openFileInEditor(path, name);
}

/** Called by search panel to reload editor after replace. */
/** Module-level callback for plugin decoration changes — re-renders editor. Perry-safe. */
function onDecorationChanged(): void {
  if (editorReady > 0) {
    editorInstance.render();
  }
}

// ---------------------------------------------------------------------------
// Indentation detection — auto-detect tab size from file content
// ---------------------------------------------------------------------------

/** Detect indentation from file content and update editor tab size. */
function applyDetectedIndentation(content: string): void {
  // Scan first 100 lines for indentation pattern
  let tabCount = 0;
  let spaceCount = 0;
  let indent2 = 0;
  let indent4 = 0;
  let lineStart = 0;
  let lineNum = 0;

  for (let i = 0; i <= content.length; i = i + 1) {
    if (i === content.length || content.charCodeAt(i) === 10) {
      if (lineNum >= 100) break;
      if (i > lineStart) {
        const firstChar = content.charCodeAt(lineStart);
        if (firstChar === 9) {
          tabCount = tabCount + 1;
        } else if (firstChar === 32) {
          let spaces = 0;
          let j = lineStart;
          while (j < i && content.charCodeAt(j) === 32) {
            spaces = spaces + 1;
            j = j + 1;
          }
          if (j < i && content.charCodeAt(j) !== 9) {
            spaceCount = spaceCount + 1;
            if (spaces % 4 === 0) indent4 = indent4 + 1;
            if (spaces % 2 === 0) indent2 = indent2 + 1;
          }
        }
      }
      lineStart = i + 1;
      lineNum = lineNum + 1;
    }
  }

  if (tabCount === 0 && spaceCount === 0) return;

  let detectedSize = 2;
  if (spaceCount > 0 && indent4 === spaceCount) {
    detectedSize = 4;
  }

  // Update status bar with detected indent info
  updateStatusBarIndent(detectedSize, tabCount > spaceCount);
}

// ---------------------------------------------------------------------------
// Go-to-next-error (F8) / Go-to-previous-error (Shift+F8)
// ---------------------------------------------------------------------------

let nextErrorIdx: number = 0;

/** Jump to the next diagnostic in the current file. */
export function goToNextErrorAction(): void {
  if (editorReady < 1) return;
  if (currentEditorFilePath.length < 1) return;

  const diagCount = getDiagCount();
  if (diagCount < 1) return;

  const dFiles = getDiagFiles();
  const dLines = getDiagLines();

  // Collect diagnostics for current file
  let fileDiagLines: number[] = [];
  let fileDiagCount = 0;

  for (let i = 0; i < diagCount; i = i + 1) {
    const df = dFiles[i];
    if (df.length !== currentEditorFilePath.length) continue;
    let pathMatch = 1;
    for (let c = 0; c < df.length; c = c + 1) {
      if (df.charCodeAt(c) !== currentEditorFilePath.charCodeAt(c)) {
        pathMatch = 0;
        break;
      }
    }
    if (pathMatch < 1) continue;
    fileDiagLines[fileDiagCount] = dLines[i];
    fileDiagCount = fileDiagCount + 1;
  }

  if (fileDiagCount < 1) return;

  // Cycle through diagnostics
  if (nextErrorIdx >= fileDiagCount) nextErrorIdx = 0;
  const targetLine = fileDiagLines[nextErrorIdx];
  nextErrorIdx = nextErrorIdx + 1;

  // Scroll editor to the target line
  // For now, just update cursor position — full scroll integration needs viewport sync
}

// ---------------------------------------------------------------------------
// Format Document — 3-tier formatting pipeline
// ---------------------------------------------------------------------------

/** Format the current document (menu/shortcut entry point). */
export function formatDocumentAction(): void {
  formatCurrentDocument();
}

/** Core formatting pipeline: LSP first (async), then built-in (sync). */
export function formatCurrentDocument(): void {
  if (currentEditorFilePath.length < 1 || editorReady < 1) return;
  const s = getWorkbenchSettings();

  // Try LSP first (async — result arrives via onLspFormatResult callback)
  if (lspIsReady() > 0) {
    lspFormatDocument(currentEditorFilePath, s.editorTabSize, s.editorInsertSpaces ? 1 : 0);
    return;
  }

  // Fall back to built-in formatter (sync)
  applyBuiltinFormat();
}

/**
 * Apply built-in formatting rules to the current editor content.
 * Perry-safe inline implementation — same algorithm as hone-core/formatting-rules.ts.
 */
function applyBuiltinFormat(): void {
  const content = editorInstance.getContent();
  if (content.length < 1) return;
  const s = getWorkbenchSettings();
  const result = applyBuiltinFormatToString(content, s);
  if (result !== content) {
    editorInstance.setContent(result);
    editorInstance.render();
  }
}

/**
 * Format a string using built-in rules. Returns the formatted string.
 * Perry-safe: uses charCodeAt loops, no regex.
 */
function applyBuiltinFormatToString(content: string, s: any): string {
  // Preserve the file's existing EOL. Splitting only on \n leaves a trailing
  // \r on every line in a CRLF file, which silently breaks trailing-whitespace
  // trimming (the \r blocks the space/tab scan) and could mangle indentation.
  // Detect once, strip \r from each split line, rejoin with the original EOL.
  const isCRLF = detectEolStyle(content) === 'CRLF';
  // Split by \n
  const lines: string[] = [];
  let lineStart = 0;
  for (let i = 0; i <= content.length; i++) {
    if (i === content.length || content.charCodeAt(i) === 10) {
      let seg = content.slice(lineStart, i);
      // Drop a trailing \r so processing operates on clean content.
      if (seg.length > 0 && seg.charCodeAt(seg.length - 1) === 13) {
        seg = seg.slice(0, seg.length - 1);
      }
      lines.push(seg);
      lineStart = i + 1;
    }
  }

  // Process each line
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Trim trailing whitespace
    if (s.filesTrimTrailingWhitespace || s.editorFormatOnSave) {
      let end = line.length;
      while (end > 0) {
        const ch = line.charCodeAt(end - 1);
        if (ch === 32 || ch === 9) { end = end - 1; } else { break; }
      }
      if (end < line.length) line = line.slice(0, end);
    }

    // Normalize indentation
    if (s.editorFormatNormalizeIndent) {
      let spaces = 0;
      let idx = 0;
      while (idx < line.length) {
        const ch = line.charCodeAt(idx);
        if (ch === 32) { spaces = spaces + 1; idx = idx + 1; }
        else if (ch === 9) { spaces = spaces + s.editorTabSize; idx = idx + 1; }
        else { break; }
      }
      if (idx > 0) {
        const rest = line.slice(idx);
        let indent = '';
        if (s.editorInsertSpaces) {
          for (let j = 0; j < spaces; j++) { indent += ' '; }
        } else {
          const tabs = (spaces / s.editorTabSize) | 0;
          const rem = spaces - tabs * s.editorTabSize;
          for (let j = 0; j < tabs; j++) { indent += '\t'; }
          for (let j = 0; j < rem; j++) { indent += ' '; }
        }
        line = indent + rest;
      }
    }

    lines[i] = line;
  }

  // Trim final blank lines
  if (s.editorTrimFinalNewlines) {
    while (lines.length > 1 && lines[lines.length - 1].length === 0) {
      lines.pop();
    }
  }

  // Rejoin using the original EOL so a CRLF file stays CRLF.
  let eol = '\n';
  if (isCRLF) eol = '\r\n';
  let formatted = '';
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) formatted += eol;
    formatted += lines[i];
  }

  // Insert final newline (in the file's own EOL style). The "already ends
  // with newline" check looks at the last char — \n for both LF and CRLF
  // since CRLF ends in \n too.
  if (s.editorInsertFinalNewline) {
    if (formatted.length === 0 || formatted.charCodeAt(formatted.length - 1) !== 10) {
      formatted += eol;
    }
  }

  return formatted;
}

/**
 * Trim trailing whitespace from each line (no other formatting).
 * Used when trim-on-save is enabled but format-on-save is not.
 */
function inlineTrimTrailingWhitespace(content: string): string {
  // Same CRLF caveat as applyBuiltinFormatToString (iter 60): split only on
  // \n leaves a trailing \r on CRLF lines that blocks the space/tab trim
  // scan, so trailing whitespace before the \r is never removed on
  // Windows-default files. Strip \r on split, rejoin with the original EOL.
  const isCRLF = detectEolStyle(content) === 'CRLF';
  const lines: string[] = [];
  let lineStart = 0;
  for (let i = 0; i <= content.length; i++) {
    if (i === content.length || content.charCodeAt(i) === 10) {
      let line = content.slice(lineStart, i);
      if (line.length > 0 && line.charCodeAt(line.length - 1) === 13) {
        line = line.slice(0, line.length - 1);
      }
      let end = line.length;
      while (end > 0) {
        const ch = line.charCodeAt(end - 1);
        if (ch === 32 || ch === 9) { end = end - 1; } else { break; }
      }
      if (end < line.length) line = line.slice(0, end);
      lines.push(line);
      lineStart = i + 1;
    }
  }
  let eol = '\n';
  if (isCRLF) eol = '\r\n';
  let result = '';
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) result += eol;
    result += lines[i];
  }
  return result;
}

/** Handle LSP formatting response — apply TextEdits to editor. */
function onLspFormatResult(editsJson: string): void {
  if (editorReady < 1) return;

  // The editsJson is the "result" portion of the JSON-RPC response.
  // Format: "result":[{"range":{"start":{"line":0,"character":0},"end":{"line":N,"character":M}},"newText":"..."}]
  // For simplicity, if we got a result array, apply full-document replacement.
  // Most formatters return a single edit covering the whole document.
  const newTextIdx = editsJson.indexOf('"newText":"');
  if (newTextIdx < 0) return;

  // Extract newText value (unescape basic sequences)
  let text = '';
  let i = newTextIdx + 11; // skip '"newText":"'
  while (i < editsJson.length) {
    const ch = editsJson.charCodeAt(i);
    if (ch === 34) break; // closing quote
    if (ch === 92 && i + 1 < editsJson.length) {
      const next = editsJson.charCodeAt(i + 1);
      if (next === 110) { text += '\n'; i = i + 2; continue; } // \n
      if (next === 116) { text += '\t'; i = i + 2; continue; } // \t
      if (next === 34) { text += '"'; i = i + 2; continue; }   // \"
      if (next === 92) { text += '\\'; i = i + 2; continue; }  // \\
    }
    text += editsJson.charAt(i);
    i = i + 1;
  }

  if (text.length > 0) {
    editorInstance.setContent(text);
    editorInstance.render();
  }
}

// Deferred context menu actions (Perry callback safety)
function formatDocumentDeferred(): void { setTimeout(() => { formatCurrentDocument(); }, 0); }
function goToDefinitionDeferred(): void { setTimeout(() => { goToDefinitionAction(); }, 0); }

/**
 * App-wide Undo. SHIP-V1-GAPS.md #92 — Cmd+Z worked in editor key-handling but
 * the Edit menu's Undo and the registered `edit.undo` command were no-ops.
 * Routes through the editor VM's command system when the editor is ready.
 */
export function undoAction(): void {
  if (editorReady < 1) return;
  editorInstance.executeCommand('editor.action.undo');
  editorInstance.render();
}

export function redoAction(): void {
  if (editorReady < 1) return;
  editorInstance.executeCommand('editor.action.redo');
  editorInstance.render();
}

/**
 * Update status bar indent indicator. SHIP-V1-GAPS.md #96 — finally honors
 * tabSize + useTabs args instead of leaving the hardcoded "Spaces: 2" label.
 */
function updateStatusBarIndent(tabSize: number, useTabs: boolean): void {
  // useTabs=true means tabs are being inserted; widget label says "Tab Size: N".
  // useTabs=false means spaces are being inserted; widget label says "Spaces: N".
  statusBarUpdateIndent(tabSize, useTabs ? 0 : 1);
}

/** Sync all editor decorations — diagnostics + hover. Perry-safe. */
function syncEditorDecorations(): void {
  syncDiagnosticDecorations();
  syncHoverRequest();
  // Find highlights are NOT polled — updated on-demand via findBarPushDecorations callback
}

/** Push find match line highlights. Same-module to avoid Perry cross-module call issues. */
let lastFindHighlightCount: number = 0;
let lastFindHighlightHash: number = 0;
// Track previously highlighted lines so we can un-highlight them without clearing all
let prevHighlightedLines: number[] = [];
let prevHighlightedCount: number = 0;

function syncFindHighlights(): void {
  if (editorReady < 1) return;

  if (isFindBarVisible() < 1) {
    if (lastFindHighlightCount > 0) {
      // Remove old highlights by setting them to fully transparent
      for (let i = 0; i < prevHighlightedCount; i++) {
        editorInstance.setLineBackground(prevHighlightedLines[i], 0.0, 0.0, 0.0, 0.0);
      }
      editorInstance.clearFindHighlights();
      lastFindHighlightCount = 0;
      lastFindHighlightHash = 0;
      prevHighlightedCount = 0;
    }
    return;
  }

  const matchCount = getFindMatchCount();
  if (matchCount < 1) {
    if (lastFindHighlightCount > 0) {
      for (let i = 0; i < prevHighlightedCount; i++) {
        editorInstance.setLineBackground(prevHighlightedLines[i], 0.0, 0.0, 0.0, 0.0);
      }
      editorInstance.clearFindHighlights();
      lastFindHighlightCount = 0;
      lastFindHighlightHash = 0;
      prevHighlightedCount = 0;
    }
    return;
  }

  // Quick hash to skip redundant updates
  const curIdx = getFindCurrentMatch();
  const hash = matchCount * 10000 + curIdx;
  if (hash === lastFindHighlightHash) return;
  lastFindHighlightHash = hash;

  // Get current match line
  let currentLine = -1;
  if (curIdx >= 0 && curIdx < matchCount) {
    currentLine = getFindMatchLine(curIdx);
  }

  // Build new highlighted lines list and set colors (overwrites existing entries)
  const newLines: number[] = [];
  let newCount = 0;
  let prevLine = -1;
  const limit = matchCount < 200 ? matchCount : 200;
  for (let i = 0; i < limit; i++) {
    const line = getFindMatchLine(i);
    if (line === prevLine) continue;
    if (line < 0) continue;
    prevLine = line;
    const lineNum = line + 1;
    if (line === currentLine) {
      editorInstance.setLineBackground(lineNum, 0.91, 0.67, 0.33, 0.28);
    } else {
      editorInstance.setLineBackground(lineNum, 0.89, 0.76, 0.33, 0.15);
    }
    newLines.push(lineNum);
    newCount = newCount + 1;
  }

  // Clear lines that were highlighted before but aren't anymore
  for (let i = 0; i < prevHighlightedCount; i++) {
    const oldLine = prevHighlightedLines[i];
    let stillHighlighted = 0;
    for (let j = 0; j < newCount; j++) {
      if (newLines[j] === oldLine) { stillHighlighted = 1; break; }
    }
    if (stillHighlighted < 1) {
      editorInstance.setLineBackground(oldLine, 0.0, 0.0, 0.0, 0.0);
    }
  }

  prevHighlightedLines = newLines;
  prevHighlightedCount = newCount;

  // Character-precise highlight for current match only
  if (curIdx >= 0 && curIdx < matchCount) {
    let json = '[{"line":';
    json += String(getFindMatchLine(curIdx));
    json += ',"col":';
    json += String(getFindMatchCol(curIdx));
    json += ',"len":';
    json += String(getFindMatchLen(curIdx));
    json += ',"current":1}]';
    editorInstance.setFindHighlights(json);
  }

  lastFindHighlightCount = limit;
}

// ---------------------------------------------------------------------------
// Hover dwell tracking — request hover after cursor dwells 500ms
// ---------------------------------------------------------------------------

let lastHoverLine: number = -1;
let lastHoverCol: number = -1;
let hoverDwellTicks: number = 0;
let hoverRequested: number = 0;

/** Track cursor position for hover requests. Called every 250ms. */
function syncHoverRequest(): void {
  if (editorReady < 1) return;
  if (currentEditorFilePath.length < 1) return;

  const curLine = editorInstance.getCursorLine();
  const curCol = editorInstance.getCursorColumn();

  // Cursor moved — reset dwell timer, hide hover
  if (curLine !== lastHoverLine || curCol !== lastHoverCol) {
    lastHoverLine = curLine;
    lastHoverCol = curCol;
    hoverDwellTicks = 0;
    hoverRequested = 0;
    if (isHoverVisible() > 0) {
      hideHoverPopup();
    }
    if (isSignatureVisible() > 0) {
      hideSignaturePopup();
    }
    return;
  }

  // Cursor hasn't moved — increment dwell counter
  hoverDwellTicks = hoverDwellTicks + 1;

  // After ~500ms (2 ticks at 250ms), request hover
  if (hoverDwellTicks === 2 && hoverRequested < 1) {
    hoverRequested = 1;
    lspHover(currentEditorFilePath, curLine, curCol);
  }
}

// ---------------------------------------------------------------------------
// Go-to-definition — Cmd+Click on a symbol
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LSP result callbacks (module-level, Perry-safe)
// ---------------------------------------------------------------------------

/** Called when hover result arrives from LSP. */
function onLspHoverResult(text: string): void {
  if (text.length > 0) {
    showHoverPopup(text);
  }
}

/** Called when definition result arrives from LSP. */
function onLspDefinitionResult(filePath: string, line: number): void {
  if (filePath.length < 1) return;

  // Extract file name from path
  let lastSlash = -1;
  for (let i = filePath.length - 1; i >= 0; i = i - 1) {
    if (filePath.charCodeAt(i) === 47) { lastSlash = i; break; }
  }
  let name = filePath;
  if (lastSlash >= 0) {
    name = filePath.slice(lastSlash + 1);
  }

  openFileInEditor(filePath, name);

  // SHIP-V1-GAPS.md #88 follow-up: jump to the target line after the file
  // finishes loading. Same 32ms deferral as references / outline jumps to
  // let the editor compute its layout before we ask it to move the cursor.
  setTimeout(() => {
    if (editorReady < 1) return;
    editorInstance.setCursorPosition(line, 0);
    editorInstance.render();
  }, 32);
}

/** Called when signature help result arrives from LSP. */
function onLspSignatureResult(label: string, activeParam: number, doc: string): void {
  if (label.length > 0) {
    showSignaturePopup(label, activeParam, doc);
  }
}

// ---------------------------------------------------------------------------
// Git inline blame — show blame annotation at end of current line
// ---------------------------------------------------------------------------

let lastBlameLine: number = -1;
let blameText: string = '';
let blameWidget: unknown = null;
let blameInFlight: number = 0;
let blameGeneration: number = 0;

/** Initialize the blame overlay widget. Called once during render setup. */
function initBlameWidget(parent: unknown): void {
  // Blame is shown as a faded Text widget in the breadcrumb area
  // For now, update the status bar or a dedicated label
}

/** Async blame annotation for current cursor line. Called every 250ms. */
function syncInlineBlame(): void {
  if (editorReady < 1) return;
  if (currentEditorFilePath.length < 1) return;
  if (blameInFlight > 0) return; // don't stack blame requests

  const curLine = editorInstance.getCursorLine();
  if (curLine === lastBlameLine) return;
  lastBlameLine = curLine;

  // Run git blame on a background thread
  const lineNum = curLine + 1;
  const filePath = currentEditorFilePath;
  blameGeneration = blameGeneration + 1;
  const gen = blameGeneration;
  blameInFlight = 1;

  spawn(() => {
    // SHIP-V1-GAPS.md #1: argv-form spawn — filePath can contain spaces or
    // shell metacharacters; shell concat would either fail or be exploitable.
    const range = String(lineNum) + ',' + String(lineNum);
    let output = '';
    try {
      const r = spawnSync('git', ['blame', '-L', range, '--porcelain', '--', filePath]);
      if (r.status === 0) output = r.stdout;
    } catch (e) {
      return '';
    }

    if (output.length < 10) return '';

    // Parse porcelain blame output — extract author + summary + time
    let author = '';
    let summary = '';
    let authorTime = 0;
    let lineStart = 0;
    for (let i = 0; i <= output.length; i = i + 1) {
      if (i === output.length || output.charCodeAt(i) === 10) {
        if (i > lineStart) {
          const line = output.slice(lineStart, i);
          if (line.indexOf('author ') === 0) {
            author = line.slice(7);
          }
          if (line.indexOf('summary ') === 0) {
            summary = line.slice(8);
          }
          if (line.indexOf('author-time ') === 0) {
            authorTime = parseInt(line.slice(12));
          }
        }
        lineStart = i + 1;
      }
    }

    if (author.length < 1) return '';

    // Build relative time string
    let timeStr = '';
    if (authorTime > 0) {
      const now = Math.floor(Date.now() / 1000);
      const diff = now - authorTime;
      if (diff < 60) timeStr = t('just now');
      else if (diff < 3600) {
        timeStr = String(Math.floor(diff / 60));
        timeStr += ' ' + t('min ago');
      } else if (diff < 86400) {
        timeStr = String(Math.floor(diff / 3600));
        timeStr += ' ' + t('hours ago');
      } else if (diff < 2592000) {
        timeStr = String(Math.floor(diff / 86400));
        timeStr += ' ' + t('days ago');
      } else {
        timeStr = String(Math.floor(diff / 2592000));
        timeStr += ' ' + t('months ago');
      }
    }

    let result = author;
    if (timeStr.length > 0) {
      result += ', ';
      result += timeStr;
    }
    if (summary.length > 0) {
      result += ' — ';
      result += summary;
    }
    return result;
  }).then((result) => { applyBlameResult(result, gen); });
}

function applyBlameResult(text: string, gen: number): void {
  blameInFlight = 0;
  if (gen !== blameGeneration) return; // stale
  blameText = text;
  if (blameText.length > 0) {
    updateStatusBarBlame(blameText);
  }
}

/** Show blame text in the status bar (or a dedicated blame label). */
function updateStatusBarBlame(_text: string): void {
  // Status bar blame is informational — will be wired to a visible label
  // in the breadcrumb or end-of-line decoration when the Rust renderer supports it
}

/** Navigate to definition at cursor position. Exported for keybinding/menu. */
export function goToDefinitionAction(): void {
  if (editorReady < 1) return;
  if (currentEditorFilePath.length < 1) return;

  const curLine = editorInstance.getCursorLine();
  const curCol = editorInstance.getCursorColumn();
  lspDefinition(currentEditorFilePath, curLine, curCol);
}

// ---------------------------------------------------------------------------
// Diagnostic decoration sync — push diagnostic underlines to editor
// ---------------------------------------------------------------------------

let lastDiagSyncHash: number = 0;

/**
 * Sync diagnostic data to the Rust editor renderer.
 * Uses the new hone_editor_set_line_diagnostics FFI for Error Lens-style
 * inline messages + gutter severity icons.
 * Format: "line:severity:color:message\n..."
 */
function syncDiagnosticDecorations(): void {
  if (editorReady < 1) return;
  if (currentEditorFilePath.length < 1) return;

  const diagCount = getDiagCount();

  const dFiles = getDiagFiles();
  const dLines = getDiagLines();
  const dMessages = getDiagMessages();
  const dSeverities = getDiagSeverities();

  // Build packed diagnostic string for Rust: line:severity:color:message\n
  let packed = '';
  let count = 0;

  for (let i = 0; i < diagCount; i = i + 1) {
    // Compare file paths — Perry string === is unreliable
    const df = dFiles[i];
    if (df.length !== currentEditorFilePath.length) continue;
    let pathMatch = 1;
    for (let c = 0; c < df.length; c = c + 1) {
      if (df.charCodeAt(c) !== currentEditorFilePath.charCodeAt(c)) {
        pathMatch = 0;
        break;
      }
    }
    if (pathMatch < 1) continue;

    const line = dLines[i];
    const msg = dMessages[i];
    const sev = dSeverities[i];

    // Map severity string to number + color
    let sevNum = 3; // info
    let color = '#4fc1ff';
    if (sev.charCodeAt(0) === 101) { sevNum = 1; color = '#f44747'; } // error
    if (sev.charCodeAt(0) === 119) { sevNum = 2; color = '#cca700'; } // warning

    // Append: line:severity:color:message\n
    packed += String(line);
    packed += ':';
    packed += String(sevNum);
    packed += ':';
    packed += color;
    packed += ':';
    packed += msg;
    packed += '\n';
    count = count + 1;
  }

  // Quick hash to avoid redundant FFI calls
  let hash = count * 1000;
  for (let i = 0; i < packed.length && i < 100; i = i + 1) {
    hash = ((hash * 31) + packed.charCodeAt(i)) | 0;
  }
  if (hash === lastDiagSyncHash) return;
  lastDiagSyncHash = hash;

  if (count > 0) {
    editorInstance.setLineDiagnostics(packed);
  } else {
    editorInstance.clearDiagnostics();
  }
}

// ---------------------------------------------------------------------------
// Bracket matching — highlight matching bracket near cursor
// ---------------------------------------------------------------------------

/** Find and highlight matching bracket at cursor position. Perry-safe. */
function syncBracketMatchDecoration(): void {
  if (editorReady < 1) return;
  if (currentEditorFilePath.length < 1) return;

  const cursorLine = editorInstance.getCursorLine();
  const cursorCol = editorInstance.getCursorColumn();

  // Get the line content to check for bracket at cursor
  const content = editorInstance.getContent();
  let lineStart = 0;
  let lineIdx = 0;
  for (let i = 0; i < content.length; i = i + 1) {
    if (lineIdx === cursorLine) break;
    if (content.charCodeAt(i) === 10) {
      lineIdx = lineIdx + 1;
      lineStart = i + 1;
    }
  }

  // Check char at cursor and char before cursor
  const offset = lineStart + cursorCol;
  let bracketChar = 0;
  let bracketOffset = -1;

  if (offset < content.length) {
    const ch = content.charCodeAt(offset);
    // ( ) [ ] { }
    if (ch === 40 || ch === 41 || ch === 91 || ch === 93 || ch === 123 || ch === 125) {
      bracketChar = ch;
      bracketOffset = offset;
    }
  }
  if (bracketChar === 0 && offset > 0) {
    const ch = content.charCodeAt(offset - 1);
    if (ch === 40 || ch === 41 || ch === 91 || ch === 93 || ch === 123 || ch === 125) {
      bracketChar = ch;
      bracketOffset = offset - 1;
    }
  }

  if (bracketChar === 0) return;

  // Find matching bracket
  let matchOffset = -1;
  const isOpen = bracketChar === 40 || bracketChar === 91 || bracketChar === 123;
  let closeChar = 0;
  if (bracketChar === 40) closeChar = 41;
  if (bracketChar === 41) closeChar = 40;
  if (bracketChar === 91) closeChar = 93;
  if (bracketChar === 93) closeChar = 91;
  if (bracketChar === 123) closeChar = 125;
  if (bracketChar === 125) closeChar = 123;

  let depth = 0;
  if (isOpen) {
    // Search forward
    for (let i = bracketOffset + 1; i < content.length; i = i + 1) {
      const ch = content.charCodeAt(i);
      if (ch === bracketChar) depth = depth + 1;
      if (ch === closeChar) {
        if (depth === 0) { matchOffset = i; break; }
        depth = depth - 1;
      }
    }
  } else {
    // Search backward
    for (let i = bracketOffset - 1; i >= 0; i = i - 1) {
      const ch = content.charCodeAt(i);
      if (ch === bracketChar) depth = depth + 1;
      if (ch === closeChar) {
        if (depth === 0) { matchOffset = i; break; }
        depth = depth - 1;
      }
    }
  }

  if (matchOffset < 0) return;

  // Convert match offset to line/column for pixel position
  let matchLine = 0;
  let matchLineStart = 0;
  for (let i = 0; i < matchOffset; i = i + 1) {
    if (content.charCodeAt(i) === 10) {
      matchLine = matchLine + 1;
      matchLineStart = i + 1;
    }
  }
  const matchCol = matchOffset - matchLineStart;

  const charWidth = editorInstance.getCharWidth();
  if (charWidth < 1) return;
  const lineHeight = 20;
  const gutterWidth = 48;

  // Highlight both the bracket at cursor and its match
  let json = '[{"x":';
  json += String(gutterWidth + bracketOffset - lineStart);
  // Simpler: just highlight match bracket
  json = '[{"x":';
  json += String(gutterWidth + matchCol * charWidth);
  json += ',"y":';
  json += String(matchLine * lineHeight);
  json += ',"w":';
  json += String(charWidth);
  json += ',"h":';
  json += String(lineHeight);
  json += ',"color":"#3a3d41","type":"background"}]';

  editorInstance.pushDecorations(json);
}

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

/** Called by debug panel to get current editor file path. */
function getDebugEditorPath(): string {
  return currentEditorFilePath;
}

/** Called by debug panel when a stack frame or breakpoint is clicked. */
function openFileFromDebugPanel(file: string, line: number): void {
  // Extract filename from full path
  let lastSlash = -1;
  for (let i = file.length - 1; i >= 0; i = i - 1) {
    if (file.charCodeAt(i) === 47) { lastSlash = i; break; }
  }
  let name = file;
  if (lastSlash >= 0) name = file.slice(lastSlash + 1);
  openFileInEditor(file, name);
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
  if (idx >= 0 && idx <= 5 && idx !== 4) {
    updateSettings({ activePanelIndex: idx });
  }
}

function switchSidebarPanel(idx: number): void {
  if (sidebarToggleReady < 1) return;
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

  if (idx === 5) {
    resetDebugPanelReady();
    renderDebugPanelImpl(sidebarContainer, null as any);
    return;
  }
}

// ---------------------------------------------------------------------------
// Activity bar
// ---------------------------------------------------------------------------

function renderActivityBarDesktop(): unknown {
  activityButtons = [];
  activityIndicators = [];

  // Icons: 0=Files, 1=Search, 2=Git, 3=Sync, 4=AI Chat, 5=Debug
  // On web: skip Git (idx 2) — execSync not available
  const icons = ['doc.on.doc', 'magnifyingglass', 'arrow.triangle.branch', 'arrow.triangle.2.circlepath', 'sparkles', 'ladybug'];
  // SHIP-V1-GAPS.md #89 — tooltips with shortcut hints. Mac uses ⌘ glyph;
  // other platforms use "Ctrl+". (Activity slots 0–3 are also bound to
  // Cmd+1..Cmd+4 on iPad — see keybindings.ts #114.)
  const isMacLike = __platform__ === 0 || __platform__ === 1;
  const modSym = isMacLike ? '⌘' : 'Ctrl+';
  const altSym = isMacLike ? '⌥' : 'Alt+';
  const tooltips = [
    t('Explorer') + ' (' + modSym + (isMacLike ? '⇧E' : 'Shift+E') + ')',
    t('Search') + ' (' + modSym + (isMacLike ? '⇧F' : 'Shift+F') + ')',
    t('Source Control') + ' (' + modSym + (isMacLike ? '⌃G' : 'Ctrl+G') + ')',
    t('Sync'),
    t('AI Chat') + ' (' + modSym + (isMacLike ? '⌃A' : 'Ctrl+A') + ')',
    t('Run and Debug') + ' (' + modSym + (isMacLike ? '⇧D' : 'Shift+D') + ')',
  ];
  const _isWeb = isWebPlatform();

  for (let i = 0; i < 6; i++) {
    // Skip git panel on web
    if (_isWeb > 0 && i === 2) continue;

    const idx = i;
    const btn = Button('', () => { onActivityClick(idx); });
    buttonSetBordered(btn, 0);
    setIconButton(btn, icons[i]);
    buttonSetImagePosition(btn, 1);
    textSetFontSize(btn, 20);
    setBtnTint(btn, getActivityBarForeground());
    widgetSetTooltip(btn, tooltips[i]);
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
  setIconButton(settingsBtn, 'gearshape');
  buttonSetImagePosition(settingsBtn, 1);
  textSetFontSize(settingsBtn, 20);
  setBtnTint(settingsBtn, getActivityBarInactiveForeground());
  widgetSetTooltip(settingsBtn, t('Settings') + ' (' + modSym + (isMacLike ? ',' : ',') + ')');
  widgetAddChild(bar, settingsBtn);

  activityBarWidget = bar;
  return bar;
}

function renderActivityBarCompact(): unknown {
  const icons = ['folder', 'doc.text', 'sparkles', 'terminal'];
  // SHIP-V1-GAPS.md #89 — tooltips on compact icons (iPhone landscape /
  // narrow window). Hover/long-press on iPad surfaces the label.
  const labels = [t('Files'), t('Editor'), t('AI'), t('Terminal')];
  activityButtons = [];

  for (let i = 0; i < icons.length; i++) {
    const idx = i;
    const btn = Button('', () => { onActivityClick(idx); });
    buttonSetBordered(btn, 0);
    setIconButton(btn, icons[i]);
    buttonSetImagePosition(btn, 1);
    textSetFontSize(btn, 20);
    setBtnTint(btn, getActivityBarForeground());
    widgetSetTooltip(btn, labels[i]);
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

  setIconButton(filesBtn, 'folder');
  setIconButton(searchBtn, 'magnifyingglass');
  setIconButton(aiBtn, 'sparkles');
  setIconButton(syncBtn, 'arrow.triangle.2.circlepath');
  setIconButton(settingsBtn, 'gearshape');

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
  const inner = VStackWithInsets(0, 0, 8, 0, 8);
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
  // Restore saved tabs, or fall back to src/app.ts
  const savedTabs = getLastOpenTabs();
  const savedActiveIdx = getLastActiveTab();
  let defaultFile = '';
  let defaultName = '';

  // Check if we have saved tabs that still exist
  let restoredCount = 0;
  let restorePaths: string[] = [];
  if (savedTabs.length > 2) {
    // Split on pipe — Perry-safe (no for...of, manual split)
    let start = 0;
    for (let ci = 0; ci <= savedTabs.length; ci++) {
      if (ci === savedTabs.length || savedTabs.charCodeAt(ci) === 124) { // '|'
        if (ci > start) {
          const p = savedTabs.slice(start, ci);
          if (existsSync(p)) {
            restorePaths.push(p);
            restoredCount = restoredCount + 1;
          }
        }
        start = ci + 1;
      }
    }
  }

  if (restoredCount > 0) {
    defaultFile = restorePaths[0];
    // Extract filename from path
    let lastSlash = -1;
    for (let fi = 0; fi < defaultFile.length; fi++) {
      if (defaultFile.charCodeAt(fi) === 47 || defaultFile.charCodeAt(fi) === 92) lastSlash = fi;
    }
    if (lastSlash >= 0) {
      defaultName = defaultFile.slice(lastSlash + 1);
    } else {
      defaultName = defaultFile;
    }
  } else {
    defaultFile += workspaceRoot;
    if (__platform__ === 3) {
      defaultFile += '\\src\\app.ts';
    } else {
      defaultFile += '/src/app.ts';
    }
    defaultName = 'app.ts';
  }

  const tbc = HStack(1, []);
  widgetSetHeight(tbc, 35);
  widgetSetHugging(tbc, 750);
  setTabBarRestoring(1);
  initTabBar(tbc, null as any, defaultFile, defaultName);

  // Open remaining restored tabs (first one was opened by initTabBar)
  for (let ri = 1; ri < restoredCount; ri++) {
    const rPath = restorePaths[ri];
    let rLastSlash = -1;
    for (let fi = 0; fi < rPath.length; fi++) {
      if (rPath.charCodeAt(fi) === 47 || rPath.charCodeAt(fi) === 92) rLastSlash = fi;
    }
    let rName = rPath;
    if (rLastSlash >= 0) {
      rName = rPath.slice(rLastSlash + 1);
    }
    openTab(rPath, rName);
  }

  // Restore active tab index
  if (restoredCount > 1 && savedActiveIdx >= 0 && savedActiveIdx < restoredCount) {
    setActiveTabByIndex(savedActiveIdx);
  }
  // SHIP-V1-GAPS.md #26: restore pin state. The mask is '1'/'0' chars in the
  // same order as `lastOpenTabs`. Iterate and pin matching slots. The mask
  // can be shorter than the restored count (if pin state was added later) —
  // that's fine; missing slots stay unpinned.
  const pinMask = getLastPinnedTabs();
  if (pinMask.length > 0) {
    for (let pi = 0; pi < restoredCount && pi < pinMask.length; pi++) {
      if (pinMask.charCodeAt(pi) === 49) { // '1'
        pinTabImpl(pi);
      }
    }
  }
  setTabBarRestoring(0);

  const ed = new Editor(800, 600);
  editorInstance = ed;
  editorNativeHandle = ed.nativeHandle as number;
  editorReady = 1;

  // Apply the editor font from settings. This was never wired — the
  // Settings → Font Family / Font Size rows persisted to settings.ini and
  // showed in the UI but had zero effect on the editor (setFont was never
  // called, so the editor used its internal default). Also: the settings
  // default `editorFontFamily` is the macOS-only 'Menlo'; on Windows/Linux
  // substitute the platform mono font (Consolas / DejaVu Sans Mono) via the
  // monoFont() helper so a fresh install on Windows gets a real monospace
  // face instead of a serif/proportional system fallback.
  const _edFontSettings = getWorkbenchSettings();
  let _edFam = _edFontSettings.editorFontFamily;
  if (_edFam.length === 0) _edFam = monoFont();
  // 'Menlo' is the unconfigured default; only honor it on macOS.
  if (_edFam === 'Menlo' && __platform__ !== 0) _edFam = monoFont();
  let _edSize = _edFontSettings.editorFontSize;
  if (_edSize < 6 || _edSize > 96) _edSize = 13;
  try { ed.setFont(_edFam, _edSize); } catch (_e: any) {}
  _lastEditorFontFamily = _edFam;
  _lastEditorFontSize = _edSize;

  // Set syntax token colors based on current theme
  if (isCurrentThemeDark() > 0) {
    ed.setThemeMode(0);
  } else {
    ed.setThemeMode(1);
  }

  const nsviewPtr = hone_editor_nsview(ed.nativeHandle as number);
  editorWidget = embedNSView(nsviewPtr);

  // Wire plugin decoration render callback — re-renders editor when decorations change
  if (isPluginSystemEnabled() > 0) {
    setDecorationRenderCallback(onDecorationChanged);
  }

  // Display the active tab's file
  const activeFile = getActiveTabPath();
  if (activeFile.length > 0) {
    displayFileContent(activeFile);
  } else {
    displayFileContent(defaultFile);
  }

  // SHIP-V1-GAPS.md #43: restore cursor + scroll for the active tab.
  // Deferred one tick so the editor finishes its initial layout (line height,
  // viewport bounds) before we ask it to jump.
  const _restoreSettings = getWorkbenchSettings();
  const _restoreLine = _restoreSettings.lastActiveCursorLine;
  const _restoreCol = _restoreSettings.lastActiveCursorCol;
  const _restoreScroll = _restoreSettings.lastActiveScrollTop;
  if (_restoreLine > 0 || _restoreCol > 0 || _restoreScroll > 0) {
    setTimeout(() => {
      if (editorReady < 1) return;
      editorInstance.setCursorPosition(_restoreLine, _restoreCol);
      if (_restoreScroll > 0) editorInstance.setScrollTop(_restoreScroll);
      editorInstance.render();
    }, 32);
  }

  // Apply native editor view colors AFTER content is displayed
  applyEditorColors();

  // Poll cursor position for status bar + sync decorations + blame
  setInterval(() => { pollCursorPositionImpl(); syncEditorDecorations(); syncInlineBlame(); }, 250);
  setInterval(() => { pollDirtyState(); }, 500);

  // Wire AI inline completion — ghost text after cursor dwell
  setInlineEditorAccess(inlineGetCursorLine, inlineGetCursorCol, inlineGetLineContent, inlineSetGhostText, inlineClearGhostText);
  setInlineContextProviders(inlineGetFileContent, inlineGetFilePath);
  setInlineInsertCallback(inlineInsertText);
  initInlineCompletion();

  // Breadcrumb bar — fully opaque background to cover editor behind
  breadcrumbContainer = HStackWithInsets(4, 4, 8, 4, 8);
  setBg(breadcrumbContainer, getEditorBackground());
  widgetSetHeight(breadcrumbContainer, 24);
  widgetSetHugging(breadcrumbContainer, 750);
  breadcrumbReady = 1;
  updateBreadcrumb();

  // SHIP-V1-GAPS.md #24: sticky scroll context line. Sits between the
  // breadcrumb and the editor view, displays the parent scope of the line at
  // the current cursor (cheap heuristic: nearest line above with smaller
  // indent). Hidden when no scope is detected so the editor reclaims the row.
  stickyScrollLabel = Text('');
  textSetFontSize(stickyScrollLabel, 11);
  textSetFontFamily(stickyScrollLabel, 11, monoFont());
  setFg(stickyScrollLabel, getSecondaryTextColor());
  stickyScrollRow = HStackWithInsets(4, 2, 12, 2, 12);
  setBg(stickyScrollRow, getEditorBackground());
  widgetAddChild(stickyScrollRow, stickyScrollLabel);
  widgetSetHeight(stickyScrollRow, 20);
  widgetSetHugging(stickyScrollRow, 750);
  widgetSetHidden(stickyScrollRow, 1);

  // SHIP-V1-GAPS.md #44: merge conflict resolver toolbar. Appears when the
  // buffer contains `<<<<<<<`, `=======`, `>>>>>>>` markers; provides
  // Accept Current / Incoming / Both. Resolution rewrites the buffer.
  conflictLabel = Text('');
  textSetFontSize(conflictLabel, 11);
  setFg(conflictLabel, '#FAB387');
  const conflictCurrentBtn = Button(t('Accept Current'), () => { resolveConflict(0); });
  const conflictIncomingBtn = Button(t('Accept Incoming'), () => { resolveConflict(1); });
  const conflictBothBtn = Button(t('Accept Both'), () => { resolveConflict(2); });
  buttonSetBordered(conflictCurrentBtn, 0);
  buttonSetBordered(conflictIncomingBtn, 0);
  buttonSetBordered(conflictBothBtn, 0);
  setBtnFg(conflictCurrentBtn, '#A6E3A1');
  setBtnFg(conflictIncomingBtn, '#89B4FA');
  setBtnFg(conflictBothBtn, '#CDD6F4');
  conflictBar = HStackWithInsets(8, 4, 12, 4, 12);
  setBg(conflictBar, '#3a2a2a');
  widgetAddChild(conflictBar, conflictLabel);
  widgetAddChild(conflictBar, Spacer());
  widgetAddChild(conflictBar, conflictCurrentBtn);
  widgetAddChild(conflictBar, conflictIncomingBtn);
  widgetAddChild(conflictBar, conflictBothBtn);
  widgetSetHeight(conflictBar, 28);
  widgetSetHugging(conflictBar, 750);
  widgetSetHidden(conflictBar, 1);

  widgetSetHugging(editorWidget, 1);
  tabBarContainer = tbc;

  // Create LSP popups (hover, signature)
  const colors = null as any; // Will use theme colors from getters
  const hoverPopup = createHoverPopup(colors);
  const signaturePopup = createSignaturePopup(colors);

  // Create find bar (starts hidden via widgetSetHidden)
  const findBar = createFindBar();
  findBarWidget = findBar;
  widgetSetHidden(findBar, 1);
  setFindEditorCallbacks(findBarGetContent, findBarSetContent, findBarScrollToLine, findBarRenderEditor, findBarPushDecorations, findBarGetCharWidth, findBarGetViewportStart, findBarSetLineBg, findBarClearLineBgs);


  const editorPane = VStack(0, [tbc, breadcrumbContainer, conflictBar, stickyScrollRow, findBar, hoverPopup, signaturePopup, editorWidget]);
  stackSetDetachesHidden(editorPane, 1);
  setBg(editorPane, getEditorBackground());
  widgetSetHugging(editorPane, 1); // editor pane stretches in mainRow
  // Pin children to fill VStack's width
  widgetMatchParentWidth(editorWidget);
  widgetMatchParentWidth(tbc);
  widgetMatchParentWidth(breadcrumbContainer);
  widgetMatchParentWidth(conflictBar);
  widgetMatchParentWidth(stickyScrollRow);
  widgetMatchParentWidth(findBar);
  editorPaneWidget = editorPane;

  // Wire LSP callbacks
  setHoverCallback(onLspHoverResult);
  setDefinitionCallback(onLspDefinitionResult);
  setSignatureCallback(onLspSignatureResult);
  setFormatCallback(onLspFormatResult);
  // SHIP-V1-GAPS.md #88: consumers for the Phase 2 LSP requests exposed by
  // the right-click editor menu. v1 surfaces references in a dedicated peek
  // panel that takes over the sidebar; rename + code-actions still surface
  // as notifications until their pickers land in v1.1.
  setReferencesCallback((json: string) => { onReferencesResult(json); });
  setReferencesJumpHandler((filePath: string, line: number, col: number) => {
    // Reuse displayFileContent for the file load, then jump after layout.
    openFileInEditor(filePath, shortFileName(filePath));
    setTimeout(() => {
      if (editorReady < 1) return;
      editorInstance.setCursorPosition(line, col);
      editorInstance.render();
    }, 32);
  });
  // Outline panel jumps within the active file.
  setOutlineJumpHandler((filePath: string, line: number, col: number) => {
    if (filePath !== currentEditorFilePath) {
      openFileInEditor(filePath, shortFileName(filePath));
    }
    setTimeout(() => {
      if (editorReady < 1) return;
      editorInstance.setCursorPosition(line, col);
      editorInstance.render();
    }, 32);
  });
  setRenameCallback((json: string) => { onRenameResult(json); });
  setCodeActionsCallback((json: string) => { onCodeActionsResult(json); });

  // Editor right-click context menu (SHIP-V1-GAPS.md #88). Expanded in Phase 3
  // to cover the most-used VS Code editor menu items now that the LSP request
  // layer is wired. Items that depend on selection coordinates are stubbed
  // here and will pick up the editor's current cursor when invoked.
  const editorMenu = menuCreate();
  // Clipboard — handled via standard selectors elsewhere, but a menu entry
  // covers the case where the user wants explicit affordances.
  menuAddItem(editorMenu, t('Cut'), () => { /* standard selector handles this via NSMenu */ });
  menuAddItem(editorMenu, t('Copy'), () => { /* same */ });
  menuAddItem(editorMenu, t('Paste'), () => { /* same */ });
  menuAddSeparator(editorMenu);
  menuAddItem(editorMenu, t('Find…'), () => { findAction(); });
  menuAddItem(editorMenu, t('Replace…'), () => { replaceAction(); });
  menuAddSeparator(editorMenu);
  menuAddItem(editorMenu, t('Go to Definition'), () => { goToDefinitionDeferred(); });
  menuAddItem(editorMenu, t('Find All References'), () => { findAllReferencesFromCursor(); });
  menuAddItem(editorMenu, t('Rename Symbol…'), () => { renameSymbolFromCursor(); });
  menuAddItem(editorMenu, t('Quick Fix…'), () => { showCodeActionsFromCursor(); });
  menuAddSeparator(editorMenu);
  // SHIP-V1-GAPS.md #107: route current-line context (+ diagnostics for Fix)
  // into AI Chat. Full gutter-lightbulb widget needs Rust draw support; this
  // menu path covers the same intent on every platform.
  menuAddItem(editorMenu, t('Fix with AI'), () => { fixWithAIFromCursor(); });
  menuAddItem(editorMenu, t('Explain with AI'), () => { explainWithAIFromCursor(); });
  menuAddSeparator(editorMenu);
  menuAddItem(editorMenu, t('Format Document'), () => { formatDocumentDeferred(); });
  widgetSetContextMenu(editorWidget, editorMenu);

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
  // SHIP-V1-GAPS.md #70: spec is Files / Search / Git / Chat / Settings.
  // Previous order swapped Git for Sync — restored. Sync moves into the
  // Settings panel where users actually toggle it.
  const filesBtn = Button('', () => { onBottomBarFiles(); });
  const searchBtn = Button('', () => { onBottomBarSearch(); });
  const gitBtn = Button('', () => { onBottomBarGit(); });
  const aiBtn = Button('', () => { onBottomBarAI(); });
  const settingsBtn = Button('', () => { onBottomBarSettings(); });

  setIconButton(filesBtn, 'folder');
  setIconButton(searchBtn, 'magnifyingglass');
  setIconButton(gitBtn, 'arrow.triangle.branch');
  setIconButton(aiBtn, 'sparkles');
  setIconButton(settingsBtn, 'gearshape');
  buttonSetImagePosition(filesBtn, 1);
  buttonSetImagePosition(searchBtn, 1);
  buttonSetImagePosition(gitBtn, 1);
  buttonSetImagePosition(aiBtn, 1);
  buttonSetImagePosition(settingsBtn, 1);

  const allBtns = [filesBtn, searchBtn, gitBtn, aiBtn, settingsBtn];
  for (let i = 0; i < allBtns.length; i++) {
    buttonSetBordered(allBtns[i], 0);
    setBtnTint(allBtns[i], getActivityBarForeground());
    // Enforce minimum touch target (44pt Apple HIG)
    widgetSetWidth(allBtns[i], 44);
    widgetSetHeight(allBtns[i], 44);
  }

  const bar = HStack(0, [filesBtn, Spacer(), searchBtn, Spacer(), gitBtn, Spacer(), aiBtn, Spacer(), settingsBtn]);
  setBg(bar, getActivityBarBackground());
  widgetSetHeight(bar, 49); // 44pt buttons + 5pt padding
  return bar;
}

function onBottomBarGit(): void {
  pendingActivityIdx = 2; // git activity index
  setTimeout(() => { onActivityClickDeferred(); }, 0);
}

// ---------------------------------------------------------------------------
// Live theme recoloring
// ---------------------------------------------------------------------------

/** Apply theme colors to the embedded editor NSView (background, gutter, text, selection, cursor). */
function applyEditorColors(): void {
  if (editorReady < 1) return;
  const h = editorNativeHandle;
  if (isCurrentThemeDark() > 0) {
    editorSetBgColor(h, 0.118, 0.118, 0.18);
    editorSetFgColor(h, 0.804, 0.839, 0.957);
    editorSetGutterFgColor(h, 0.525, 0.525, 0.525);
    editorSetSelectionColor(h, 0.153, 0.306, 0.482, 0.4);
    editorSetCursorColor(h, 0.918, 0.918, 0.918);
  } else {
    editorSetBgColor(h, 1.0, 1.0, 1.0);
    editorSetFgColor(h, 0.2, 0.2, 0.2);
    editorSetGutterFgColor(h, 0.59, 0.59, 0.59);
    editorSetSelectionColor(h, 0.68, 0.82, 1.0, 0.5);
    editorSetCursorColor(h, 0.0, 0.0, 0.0);
  }
}

/** Re-apply theme colors to all stored widget refs. Called after theme switch. */
function recolorUI(): void {
  // Shell backgrounds
  if (shellWidget) setBg(shellWidget, getEditorBackground());
  if (leftContentWidget) setBg(leftContentWidget, getEditorBackground());
  if (activityBarWidget) setBg(activityBarWidget, getActivityBarBackground());
  if (sidebarContainer) setBg(sidebarContainer, getSideBarBackground());
  if (editorPaneWidget) setBg(editorPaneWidget, getEditorBackground());
  if (breadcrumbContainer) setBg(breadcrumbContainer, getEditorBackground());
  if (termPanelWidget) setBg(termPanelWidget, getEditorBackground());
  if (termBorderWidget) setBg(termBorderWidget, getPanelBorder());
  if (sidebarBorderWidget) setBg(sidebarBorderWidget, getPanelBorder());
  if (rightPanelBorder) setBg(rightPanelBorder, getPanelBorder());
  if (rightPanelWidget) setBg(rightPanelWidget, getSideBarBackground());

  // Status bar
  recolorStatusBar(null as any);

  // Tab bar colors
  setTabThemeColors(null as any);
  applyAllTabColors();

  // Diff view
  setDiffThemeColors(null as any);

  // Activity bar icon colors
  for (let i = 0; i < activityButtons.length; i++) {
    if (activityButtons[i]) {
      if (i === activeActivityIdx) {
        setBtnTint(activityButtons[i], getActivityBarForeground());
      } else {
        setBtnTint(activityButtons[i], getActivityBarInactiveForeground());
      }
    }
  }

  // Editor colors
  applyEditorColors();
  if (editorReady > 0) {
    if (isCurrentThemeDark() > 0) {
      editorInstance.setThemeMode(0);
    } else {
      editorInstance.setThemeMode(1);
    }
  }

  // Sidebar rebuild — deferred to avoid crash during button callback context
  setTimeout(() => { switchSidebarPanel(activeActivityIdx); }, 200);
}

/** Open the Settings tab in the editor pane. */
export function openSettingsAction(): void {
  setTimeout(() => { openSettingsDeferred(); }, 0);
}

function openSettingsDeferred(): void {
  if (settingsTabCreated < 1) {
    openTab('__settings__', t('Settings'));
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

/** Open the Update tab in the editor pane. */
export function openUpdateAction(): void {
  setTimeout(() => { openUpdateDeferred(); }, 0);
}

function openUpdateDeferred(): void {
  if (updateTabCreated < 1) {
    openTab('__update__', t('Update'));
    updateTabCreated = 1;
  } else {
    activateUpdateTab();
  }
  showUpdateInEditorPane();
}

function activateUpdateTab(): void {
  // __update__ (length 10, starts with __)
  for (let i = 0; i < getOpenTabCount(); i++) {
    const p = getOpenTabPath(i);
    if (p.length === 10 && p.charCodeAt(0) === 95 && p.charCodeAt(2) === 117) {
      setActiveTabByIndex(i);
      return;
    }
  }
}

/** Called when update checker finds a new version. */
function onUpdateFound(): void {
  const ver = getLatestVersion();
  showUpdateIndicator(ver);
}

/** Manual check for updates — called from menu. */
export function checkForUpdatesAction(): void {
  checkForUpdatesManual();
}

// Listen for settings changes — detect theme toggle and apply live
let _lastThemeName = '';
let _lastSettingsVersion: number = 0;

/** Poll-based settings change detection (fallback for platforms where
 *  array-of-closures listener pattern doesn't work in Perry codegen). */
function pollSettingsVersion(): void {
  if (pendingSidebarRefresh > 0) {
    pendingSidebarRefresh = 0;
    // Only refresh explorer tree when explorer panel is active (idx=0)
    if (activeActivityIdx === 0) {
      refreshSidebarSelection();
    }
  }
  const v = getSettingsVersion();
  if (v !== _lastSettingsVersion) {
    _lastSettingsVersion = v;
    onSettingsChanged();
  }
}

function onSettingsChanged(): void {
  const s = getWorkbenchSettings();
  // SHIP-V1-GAPS.md #95: push hidden-files toggle to the explorer + refresh.
  setSidebarShowHiddenFiles(s.explorerShowHiddenFiles ? 1 : 0);
  // SHIP-V1-GAPS.md #50: push gitignore-respect toggle.
  setSidebarRespectGitignore(s.explorerRespectGitignore ? 1 : 0);
  refreshSidebarContent();
  // Live-apply editor font changes (family/size). Without this, changing
  // Font Family or Font Size in Settings did nothing until an app restart.
  // Done BEFORE the theme early-return below so a font-only change still
  // takes effect (the theme guard returns early when the theme is unchanged).
  if (editorReady > 0) {
    let fam = s.editorFontFamily;
    if (fam.length === 0) fam = monoFont();
    if (fam === 'Menlo' && __platform__ !== 0) fam = monoFont();
    let sz = s.editorFontSize;
    if (sz < 6 || sz > 96) sz = 13;
    if (fam !== _lastEditorFontFamily || sz !== _lastEditorFontSize) {
      _lastEditorFontFamily = fam;
      _lastEditorFontSize = sz;
      try { editorInstance.setFont(fam, sz); editorInstance.render(); } catch (_e: any) {}
    }
  }
  const newTheme = s.colorTheme;
  if (newTheme.length < 1) return;
  // Check if theme changed — compare 6th char: 'D' (68) for Dark, 'L' (76) for Light
  if (_lastThemeName.length > 0) {
    if (_lastThemeName.charCodeAt(5) === newTheme.charCodeAt(5)) return; // same theme
  }
  applyThemeChangeImpl(newTheme);
}

/** Direct theme switch — callable cross-module from settings panel.
 *  isDark: 1 for dark, 0 for light. */
export function applyThemeSwitch(isDark: number): void {
  if (isDark > 0) {
    applyDarkColors();
    _lastThemeName = 'Hone Dark';
    setActiveTheme('Hone Dark');
  } else {
    applyLightColors();
    _lastThemeName = 'Hone Light';
    setActiveTheme('Hone Light');
  }
  recolorUI();
}

function applyThemeChangeImpl(newTheme: string): void {
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
// 0 = host, 1 = guest (set during pairing / auto-pair / session restore)
let syncIsGuest: number = 0;
let fileTreeReceived: number = 0;
let fileTreeRetries: number = 0;
// Relay URL — inline to avoid cross-module string return issues in Perry
let syncRelayUrl = 'wss://sync.hone.codes/ws';
// Persistent connection state
let syncPairedRoomId = '';
let syncPairedDeviceName = '';
// Last received seq from relay — used for delta catch-up on reconnect
let syncLastSeq: number = 0;
// Auth token for relay (set externally or loaded from session)
let syncAuthToken = '';
// Inline pairing code (avoid cross-module string returns)
const PAIR_CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
let localPairingCode = '';
let localPairingExpiry: number = 0;

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

// Bounded sync debug log — keeps only last 50 lines to prevent O(n^2) memory growth.
// Previous approach read entire log + concatenated + wrote back on every call,
// creating ever-larger strings that Perry's AOT runtime never freed.
let syncLogLines: string[] = [];
let syncLogCount: number = 0;
let syncLogDirty: number = 0;

function syncDebugLog(msg: string): void {
  syncLogLines.push(msg);
  syncLogCount = syncLogCount + 1;
  syncLogDirty = 1;
  // Keep only last 50 lines in memory
  if (syncLogCount > 50) {
    const trimmed: string[] = [];
    for (let i = syncLogCount - 50; i < syncLogCount; i++) {
      trimmed.push(syncLogLines[i]);
    }
    syncLogLines = trimmed;
    syncLogCount = 50;
  }
}

function flushSyncDebugLog(): void {
  if (syncLogDirty < 1) return;
  syncLogDirty = 0;
  try {
    let logFile = getTempDir();
    logFile += '/hone-sync-';
    logFile += syncDeviceId.substring(0, 8);
    logFile += '.log';
    let out = '';
    for (let i = 0; i < syncLogCount; i++) {
      out += syncLogLines[i];
      out += '\n';
    }
    writeFileSync(logFile, out);
  } catch (e: any) {}
}

function saveSyncSession(roomId: string, partnerName: string): void {
  // Save to ~/.hone/sync-session so we can auto-restore on restart.
  // Format: roomId\npartnerName\nrole\nlastSeq\nprojectKey (role = 'host' or 'guest')
  // The project key is required to keep E2E encryption working across restarts —
  // without it we'd reconnect to the room but be unable to decrypt incoming deltas.
  let path = getAppDataDir();
  path += '/sync-session';
  let role = 'host';
  let projectKey = '';
  if (syncIsGuest > 0) {
    role = 'guest';
    projectKey = getGuestProjectKey();
  } else {
    projectKey = hostGetProjectKey();
  }
  let data = roomId;
  data += '\n';
  data += partnerName;
  data += '\n';
  data += role;
  data += '\n';
  data += String(syncLastSeq);
  data += '\n';
  data += projectKey;
  try { writeFileSync(path, data); } catch (e: any) {}
  syncDebugLog('Saved sync session: room=' + roomId + ' partner=' + partnerName + ' role=' + role + ' lastSeq=' + String(syncLastSeq) + ' key=' + (projectKey.length > 0 ? 'set' : 'missing'));
}

function clearSyncSession(): void {
  let path = getAppDataDir();
  path += '/sync-session';
  try { unlinkSync(path); } catch (e: any) {}
}

// 0 = host, 1 = guest (restored from session)
let syncRestoredRole: number = 0;

function tryRestoreSyncSession(): void {
  let path = getAppDataDir();
  path += '/sync-session';
  try {
    if (!existsSync(path)) { return; }
    const data = readFileSync(path);
    if (data.length < 3) return;
    // Parse: roomId\npartnerName\nrole\nlastSeq
    // Find newlines (Perry nested-if-in-for bug: use separate loops)
    let nlIdx1 = -1;
    for (let i = 0; i < data.length; i++) {
      if (data.charCodeAt(i) === 10) { nlIdx1 = i; break; }
    }
    if (nlIdx1 < 1) return;
    // Find second newline (start after first)
    let nlIdx2 = -1;
    for (let j = nlIdx1 + 1; j < data.length; j++) {
      if (data.charCodeAt(j) === 10) { nlIdx2 = j; break; }
    }
    // Find third newline (lastSeq)
    let nlIdx3 = -1;
    if (nlIdx2 > 0) {
      for (let k = nlIdx2 + 1; k < data.length; k++) {
        if (data.charCodeAt(k) === 10) { nlIdx3 = k; break; }
      }
    }
    // Find fourth newline (projectKey separator)
    let nlIdx4 = -1;
    if (nlIdx3 > 0) {
      for (let m = nlIdx3 + 1; m < data.length; m++) {
        if (data.charCodeAt(m) === 10) { nlIdx4 = m; break; }
      }
    }
    const roomId = data.substring(0, nlIdx1);
    // Validate room ID — must be non-empty and at least 4 chars
    if (roomId.length < 4) return;
    let partnerName = '';
    let role = '';
    let projectKey = '';
    if (nlIdx2 > 0) {
      partnerName = data.substring(nlIdx1 + 1, nlIdx2);
      if (nlIdx3 > 0) {
        role = data.substring(nlIdx2 + 1, nlIdx3);
        // lastSeq lives between nlIdx3 and either nlIdx4 (new format) or EOF (legacy)
        let seqStr = '';
        if (nlIdx4 > 0) {
          seqStr = data.substring(nlIdx3 + 1, nlIdx4);
          projectKey = data.substring(nlIdx4 + 1);
        } else {
          seqStr = data.substring(nlIdx3 + 1);
        }
        if (seqStr.length > 0) {
          const parsedSeq = Number(seqStr);
          // Guard against NaN — NaN lastSeq causes relay to send ALL historical deltas
          if (parsedSeq > 0) {
            syncLastSeq = parsedSeq;
          }
        }
      } else {
        role = data.substring(nlIdx2 + 1);
      }
    } else {
      partnerName = data.substring(nlIdx1 + 1);
    }
    // role starts with 'g' (103) = guest
    if (role.length > 0 && role.charCodeAt(0) === 103) {
      syncRestoredRole = 1;
      syncIsGuest = 1;
    }
    syncDebugLog('Restoring sync session: room=' + roomId + ' partner=' + partnerName + ' role=' + role + ' lastSeq=' + String(syncLastSeq) + ' key=' + (projectKey.length > 0 ? 'present' : 'missing'));
    syncPairedRoomId = roomId;
    syncPairedDeviceName = partnerName;

    // Restore E2E project key + transport crypto before connecting.
    // If no key was persisted (legacy session) we leave encryption off and the
    // peer will need to re-pair to send anything.
    if (projectKey.length > 0) {
      if (syncIsGuest > 0) {
        setGuestProjectKey(projectKey);
        setPayloadCrypto(guestEncryptDelta, guestDecryptDelta);
      } else {
        hostSetProjectKey(projectKey);
        setPayloadCrypto(hostEncryptDelta, hostDecryptDelta);
      }
      setEncryptionReady(1);
    }

    // Set token + lastSeq on transport before connecting
    if (syncAuthToken.length > 0) {
      setRelayToken(syncAuthToken);
    }
    setRelayLastSeq(syncLastSeq);
    // Reconnect to the same relay room
    connectToRelay(syncRelayUrl, roomId, syncDeviceId);
    addSyncDevice(partnerName, 'reconnecting');
    // After connecting, request fresh file tree (for guests)
    if (syncRestoredRole > 0) {
      setTimeout(() => { requestFileTreeAfterRestore(); }, 2000);
    }
  } catch (e: any) { syncDebugLog('restore: ERROR'); }
}

function requestFileTreeAfterRestore(): void {
  if (isRelayConnected() < 1) {
    // Retry after a bit if not connected yet
    setTimeout(() => { requestFileTreeAfterRestoreRetry(); }, 3000);
    return;
  }
  onRestoredConnection();
}

function requestFileTreeAfterRestoreRetry(): void {
  if (isRelayConnected() < 1) {
    setSyncStatusText(t('Reconnect failed — try Pair Device'));
    removeSyncDevice(syncPairedDeviceName);
    return;
  }
  onRestoredConnection();
}

function onRestoredConnection(): void {
  // Update device status
  removeSyncDevice(syncPairedDeviceName);
  addSyncDevice(syncPairedDeviceName, 'connected');
  setSyncStatusText(t('Reconnected'));
  // Guest: request file tree from host (use saved role, not deviceClass — desktop can be guest)
  if (syncRestoredRole > 0) {
    sendToRelay('FILE_TREE_REQ');
    setSyncStatusText(t('Requesting files...'));
    fileTreeRetries = 0;
    setInterval(() => { retryFileTreeReq(); }, 3000);
  }
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

  // SHIP-V1-GAPS.md #66: enable the reconnect orchestrator. Connection drops
  // trigger exponential-backoff retries up to the per-session attempt cap;
  // resetReconnectAttempts fires on a successful (re)connect.
  setReconnectEnabled(1);

  // Throttle sync message processing on mobile to prevent UI thread starvation
  // __platform__: 1=iOS, 2=Android
  if (__platform__ === 1 || __platform__ === 2) {
    setMaxMessagesPerPoll(3);
  }

  // Wire remote file click callback (for sync guest)
  setRemoteFileClickCallback(onRemoteFileClicked);

  // Try to restore a previous sync session
  tryRestoreSyncSession();

  // Debug auto-pair: if <tempDir>/hone-auto-pair exists, auto-connect to debug room
  // (tempDir is /tmp on POSIX, %TEMP% on Windows — touch this file before launch)
  if (syncPairedRoomId.length < 1) {
    let autoPair = 0;
    try {
      if (existsSync(getTempDir() + '/hone-auto-pair')) autoPair = 1;
    } catch (e: any) {}
    if (autoPair > 0) {
      syncDebugLog('Auto-pair: connecting to debug room');
      // To detect guest: check if <tempDir>/hone-auto-pair-guest contains OUR device ID
      // (avoids race condition where host reads guest file before its own initSyncSystem)
      let isGuest = 0;
      try {
        if (existsSync(getTempDir() + '/hone-auto-pair-guest')) {
          const guestContent = readFileSync(getTempDir() + '/hone-auto-pair-guest');
          if (guestContent.length < 2) {
            // Empty file = old-style flag: check if our device ID matches the guest's device-id file
            // Use heuristic: guest has HOME env pointing to a temp dir
            // Safest: check if file content matches our device ID prefix
            isGuest = 0; // Don't auto-detect without explicit ID
          } else {
            // File contains a device ID — match against ours
            if (guestContent.length >= 8 && syncDeviceId.length >= 8) {
              let match = 1;
              for (let ci = 0; ci < 8; ci++) {
                if (guestContent.charCodeAt(ci) !== syncDeviceId.charCodeAt(ci)) { match = 0; break; }
              }
              if (match > 0) isGuest = 1;
            }
          }
        }
      } catch (e: any) {}
      if (isGuest > 0) {
        syncAutoJoinPending = 1;
        syncIsGuest = 1;
      }
      autoConnectDebug();
    } else {
      setSyncStatusText(t('Ready — click Pair Device or Join'));
    }
  }

  // Poll sync panel refresh every 5s + flush sync debug log
  setInterval(() => { refreshSyncPanelDeferred(); flushSyncDebugLog(); }, 5000);

  // (debug ticker removed)
}

function autoConnectDebug(): void {
  const debugRoom = 'pair-DEBUG2';
  const relayUrl = syncRelayUrl;
  // Disconnect first if a stale session restore already connected to a different room
  disconnectFromRelay();
  syncPairedRoomId = debugRoom;
  syncDebugLog('autoConnectDebug: room=' + debugRoom);
  connectToRelay(relayUrl, debugRoom, syncDeviceId);
}

function sendAutoJoinDebug(): void {
  // Auto-join: skip pairing, just request file tree directly
  setSyncStatusText(t('Requesting file tree...'));
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
  // Generate 12-char pairing code inline (avoid cross-module string return).
  // 34^12 ≈ 2.4e18 permutations makes brute-force infeasible even without rate limiting.
  // TODO(SHIP-V1-GAPS.md #4): architectural fix in Phase 7 — UUID room + code as auth-only
  // secret, exchanged via a relay-mediated pair lobby. Requires QR codegen for the same-net
  // UX, which is also Phase 7 (gap #67).
  let code = '';
  for (let i = 0; i < 12; i++) {
    const idx = Math.floor(Math.random() * PAIR_CHARS.length);
    code += PAIR_CHARS.charAt(idx);
  }
  localPairingCode = code;
  localPairingExpiry = Date.now() + 300000; // 5 minutes
  setSyncPairingCode(code);

  let roomId = 'pair-';
  roomId += code;

  // Track room for persistent session
  syncPairedRoomId = roomId;

  // Disconnect any existing connection, then connect with code-based room
  disconnectFromRelay();
  connectToRelay(syncRelayUrl, roomId, syncDeviceId);

  syncStatusOverride = t('Waiting for guest...');
  setSyncStatusText(t('Waiting for guest...'));
}

function onSyncJoinClicked(code: string): void {
  let dbg = 'onSyncJoinClicked code=[';
  dbg += code;
  dbg += '] len=';
  dbg += String(code.length);
  setSyncStatusText(dbg);
  if (code.length < 1) {
    setSyncStatusText(t('EMPTY code, aborting'));
    return;
  }
  const upper = code.toUpperCase();
  let roomId = 'pair-';
  roomId += upper;

  // Track room for persistent session
  syncPairedRoomId = roomId;

  // Connect to the same room as the host
  disconnectFromRelay();
  const relayUrl = syncRelayUrl;
  let dbg2 = 'Connecting to ';
  dbg2 += relayUrl;
  dbg2 += ' room=';
  dbg2 += roomId;
  setSyncStatusText(dbg2);
  connectToRelay(relayUrl, roomId, syncDeviceId);

  syncStatusOverride = t('Joining...');

  // Send pair request after a short delay (wait for WS connect)
  setTimeout(() => { sendPairRequest(upper); }, 1500);
}

function sendPairRequest(code: string): void {
  // Start an X25519 key exchange — guest generates an ephemeral keypair and
  // sends its public key alongside the pairing code. The host will reply with
  // its own public key plus the project key encrypted under the shared secret.
  startGuestKeyExchange();
  const guestPubKey = getGuestDhPublicKey();
  // Format: PAIR_REQ|code|deviceId|deviceName|guestPubKey
  let msg = 'PAIR_REQ|';
  msg += code;
  msg += '|';
  msg += syncDeviceId;
  msg += '|';
  msg += syncDeviceName;
  msg += '|';
  msg += guestPubKey;
  sendToRelay(msg);
}

function onSyncGuestConnected(deviceId: string, deviceName: string): void {
  addSyncDevice(deviceName, 'connected');
  syncStatusOverride = '';
  setSyncStatusText(t('Guest connected'));
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

  // Find claude binary. SHIP-V1-GAPS.md followup §5: `which` is POSIX-only;
  // Windows uses `where`. Both return the full path on success, multi-line
  // when there are multiple matches.
  let claudeBin = '';
  try {
    const cmd = __platform__ === 3 ? 'where' : 'which';
    const r = spawnSync(cmd, ['claude']);
    if (r.status === 0 && r.stdout.length > 0) {
      for (let i = 0; i < r.stdout.length; i++) {
        const ch = r.stdout.charCodeAt(i);
        if (ch === 10 || ch === 13) break;
        claudeBin += r.stdout.slice(i, i + 1);
      }
    }
  } catch (e) {}

  if (claudeBin.length < 3) {
    // Send error back to guest
    sendClaudeRelayError(t('Claude Code not found on host. Install: npm install -g @anthropic-ai/claude-code'));
    return;
  }

  // Clean up previous relay session
  if (claudeRelayPollTimer > 0) {
    clearInterval(claudeRelayPollTimer);
    claudeRelayPollTimer = 0;
  }
  if (claudeRelayPid > 0) {
    // SHIP-V1-GAPS.md followup §5: `kill <pid>` is POSIX-only; Windows uses
    // `taskkill /F /PID <pid>`. Both via argv-form spawnSync so user PIDs
    // can't influence the command parse.
    try {
      const pidStr = String(claudeRelayPid);
      if (__platform__ === 3) {
        spawnSync('taskkill', ['/F', '/PID', pidStr]);
      } else {
        spawnSync('kill', [pidStr]);
      }
    } catch (e) {}
  }

  // Build log file path. SHIP-V1-GAPS.md followup §5: use cross-platform
  // getHomeDir() instead of `echo $HOME` which is POSIX-only.
  let logPath = '';
  try { logPath = getHomeDir(); } catch (_e: any) {}
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
    sendClaudeRelayError(t('Failed to write prompt file on host'));
    return;
  }

  // Build shell command — same platform-branch as claude-process.ts.
  // POSIX: `unset CLAUDECODE` + `$(cat <file>)` to avoid argv-size limits.
  // Windows: `set "VAR="` + inline prompt via shellEscapeRelay (double-quoted).
  // cmd.exe argv cap is ~8192 chars total; typical chat prompts fit fine.
  let cmd = '';
  if (__platform__ === 3) {
    cmd = 'set "CLAUDECODE=" && ';
    cmd += claudeBin;
    cmd += ' -p ';
    cmd += shellEscapeRelay(prompt);
  } else {
    cmd = 'unset CLAUDECODE; ';
    cmd += claudeBin;
    cmd += ' -p "$(cat ';
    cmd += shellEscapeRelay(promptFile);
    cmd += ')"';
  }
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

  // SHIP-V1-GAPS.md followup §5: per-platform shell + null-device path.
  // Windows: cmd.exe + `NUL`. Unix: /bin/sh + /dev/null. The `cmd` string
  // already uses POSIX `>` for redirect which `cmd /c` also accepts.
  const shellBin = __platform__ === 3 ? 'cmd.exe' : '/bin/sh';
  const shellArg = __platform__ === 3 ? '/c' : '-c';
  const nullDev = __platform__ === 3 ? 'NUL' : '/dev/null';
  const result = spawnBackground(shellBin, [shellArg, cmd], nullDev);
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

// SHIP-V1-GAPS.md followup §5: per-platform quoting. POSIX wraps in single
// quotes; Windows cmd.exe has no single-quote semantics so we wrap in double
// quotes and double-escape any embedded `"`. The resulting string is piped
// through `cmd.exe /c` on Windows.
function shellEscapeRelay(s: string): string {
  if (__platform__ === 3) {
    let result = '"';
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      if (ch === 34) result += '""';
      else result += s.slice(i, i + 1);
    }
    result += '"';
    return result;
  }
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
      // SHIP-V1-GAPS.md followup §5: same liveness-check fix as chat-panel.
      // POSIX `kill -0 <pid>` → exit 0 if alive. Windows: `tasklist /FI
      // "PID eq <pid>" /NH` prints `INFO: No tasks...` when no match.
      let gone: number = 0;
      try {
        const pidStr = String(claudeRelayPid);
        if (__platform__ === 3) {
          const r = spawnSync('tasklist', ['/FI', 'PID eq ' + pidStr, '/NH']);
          if (r.status !== 0) gone = 1;
          else if (r.stdout.length >= 5 && r.stdout.charCodeAt(0) === 73 && r.stdout.charCodeAt(1) === 78) gone = 1;
        } else {
          const r = spawnSync('kill', ['-0', pidStr]);
          if (r.status !== 0) gone = 1;
        }
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
    // SHIP-V1-GAPS.md followup §5: cross-platform kill.
    try {
      const pidStr = String(claudeRelayPid);
      if (__platform__ === 3) {
        spawnSync('taskkill', ['/F', '/PID', pidStr]);
      } else {
        spawnSync('kill', [pidStr]);
      }
    } catch (e) {}
    claudeRelayPid = 0;
  }
}

function onRelayConnectedImpl(): void {
  if (syncStatusOverride.length === 0) {
    setSyncStatusText(t('Connected to relay'));
  }
  syncDebugLog('onRelayConnectedImpl fired');
  // SHIP-V1-GAPS.md #66: reset the backoff counter on a successful connect
  // so a future drop doesn't immediately hit the attempt cap.
  resetReconnectAttempts();
  refreshSyncPanelDeferred();
  // If auto-join is pending (debug mode), request file tree now
  if (syncAutoJoinPending > 0) {
    syncAutoJoinPending = 0;
    setSyncStatusText(t('Connected! Requesting files...'));
    setTimeout(() => { sendAutoJoinDebug(); }, 500);
  }
}

function onRelayDisconnectedImpl(): void {
  // SHIP-V1-GAPS.md #66: wire the orphaned reconnect orchestrator. The
  // hardcoded 2s retry is replaced with `getReconnectDelay()` (exponential
  // backoff + jitter, capped at 30s) and the attempt counter respects the
  // 10-attempt limit via `shouldReconnect()`.
  syncDebugLog('WS disconnected — lastSeq=' + String(syncLastSeq) + ', attempt=' + String(getReconnectAttempts()));
  // Persist lastSeq so reconnect can resume from where we left off
  if (syncPairedRoomId.length > 0 && syncPairedDeviceName.length > 0) {
    saveSyncSession(syncPairedRoomId, syncPairedDeviceName);
  }
  setSyncStatusText(t('Reconnecting...'));
  syncStatusOverride = '';
  refreshSyncPanelDeferred();

  // Use the orchestrator's exponential backoff. It returns early if
  // reconnects are disabled or the attempt cap is reached.
  if (shouldReconnect() < 1) {
    setSyncStatusText(t('Reconnect limit reached. Tap retry to try again.'));
    return;
  }
  markReconnectAttempt();
  const delay = getReconnectDelay();
  setTimeout(() => { attemptReconnect(); }, delay);
}

function attemptReconnect(): void {
  if (isRelayConnected() > 0) return; // already reconnected
  if (syncPairedRoomId.length < 1) return;
  syncDebugLog('Auto-reconnecting to room ' + syncPairedRoomId + ' lastSeq=' + String(syncLastSeq) + ' attempt=' + String(getReconnectAttempts()));
  if (syncAuthToken.length > 0) {
    setRelayToken(syncAuthToken);
  }
  setRelayLastSeq(syncLastSeq);
  connectToRelay(syncRelayUrl, syncPairedRoomId, syncDeviceId);
}

/** Handle {"type":"deltas","room":"...","deltas":[{"seq":N,"payload":"..."},...]} from relay. */
function handleDeltasBatch(data: string): void {
  // Each delta in the batch has a "payload" field — extract and process each one
  // The relay sends deltas as a JSON array embedded in the message
  syncDebugLog('Processing deltas batch');
  // Find the "deltas":[ portion
  const arrStart = data.indexOf('"deltas":[');
  if (arrStart < 0) return;
  let pos = arrStart + 10; // skip past "deltas":[

  // Walk through each delta object in the array
  // Each is: {"seq":N,"deviceId":"...","payload":"...","createdAt":N}
  let deltaCount = 0;
  while (pos < data.length) {
    // Skip whitespace and commas
    while (pos < data.length) {
      const ch = data.charCodeAt(pos);
      if (ch === 32 || ch === 44 || ch === 10 || ch === 13 || ch === 9) { pos = pos + 1; }
      else { break; }
    }
    if (pos >= data.length) break;
    // End of array?
    if (data.charCodeAt(pos) === 93) break; // ]
    // Must be start of object {
    if (data.charCodeAt(pos) !== 123) break;

    // Find end of this delta object — match braces
    let braceDepth = 0;
    let objStart = pos;
    let inString = 0;
    while (pos < data.length) {
      const ch = data.charCodeAt(pos);
      if (inString > 0) {
        if (ch === 92) { pos = pos + 1; } // backslash — skip next
        else if (ch === 34) { inString = 0; }
      } else {
        if (ch === 34) { inString = 1; }
        else if (ch === 123) { braceDepth = braceDepth + 1; }
        else if (ch === 125) {
          braceDepth = braceDepth - 1;
          if (braceDepth === 0) { pos = pos + 1; break; }
        }
      }
      pos = pos + 1;
    }
    const deltaObj = data.substring(objStart, pos);

    // Extract "seq" from this delta to update our tracking
    const dSeqIdx = deltaObj.indexOf('"seq"');
    if (dSeqIdx >= 0) {
      let dsStart = dSeqIdx + 5;
      while (dsStart < deltaObj.length && (deltaObj.charCodeAt(dsStart) === 58 || deltaObj.charCodeAt(dsStart) === 32)) dsStart = dsStart + 1;
      let dsEnd = dsStart;
      while (dsEnd < deltaObj.length && deltaObj.charCodeAt(dsEnd) >= 48 && deltaObj.charCodeAt(dsEnd) <= 57) dsEnd = dsEnd + 1;
      if (dsEnd > dsStart) {
        const dSeq = Number(deltaObj.substring(dsStart, dsEnd));
        if (dSeq > syncLastSeq) syncLastSeq = dSeq;
      }
    }

    // Extract "payload" string from this delta and re-dispatch it
    const dpkIdx = deltaObj.indexOf('"payload"');
    if (dpkIdx >= 0) {
      let dpStart = dpkIdx + 9;
      while (dpStart < deltaObj.length && (deltaObj.charCodeAt(dpStart) === 58 || deltaObj.charCodeAt(dpStart) === 32)) dpStart = dpStart + 1;
      if (dpStart < deltaObj.length && deltaObj.charCodeAt(dpStart) === 34) {
        dpStart = dpStart + 1;
        // The payload is the original routed message — it's a full relay envelope
        // Find closing unescaped quote
        let dpEnd = dpStart;
        while (dpEnd < deltaObj.length) {
          if (deltaObj.charCodeAt(dpEnd) === 92) { dpEnd = dpEnd + 2; }
          else if (deltaObj.charCodeAt(dpEnd) === 34) { break; }
          else { dpEnd = dpEnd + 1; }
        }
        const rawPayload = deltaObj.substring(dpStart, dpEnd);
        // Unescape
        let unescaped = '';
        for (let ui = 0; ui < rawPayload.length; ui++) {
          if (rawPayload.charCodeAt(ui) === 92 && ui + 1 < rawPayload.length) {
            const nc = rawPayload.charCodeAt(ui + 1);
            if (nc === 110) { unescaped += '\n'; ui = ui + 1; }
            else if (nc === 114) { unescaped += '\r'; ui = ui + 1; }
            else if (nc === 34) { unescaped += '"'; ui = ui + 1; }
            else if (nc === 92) { unescaped += '\\'; ui = ui + 1; }
            else { unescaped += rawPayload.charAt(ui); }
          } else {
            unescaped += rawPayload.charAt(ui);
          }
        }
        // Re-dispatch this stored message through the normal handler
        if (unescaped.length > 2) {
          onRelayMessageImpl(unescaped);
          deltaCount = deltaCount + 1;
        }
      }
    }
  }
  syncDebugLog('Processed ' + String(deltaCount) + ' deltas from batch, lastSeq now ' + String(syncLastSeq));
  // Save updated lastSeq
  if (syncPairedRoomId.length > 0 && syncPairedDeviceName.length > 0) {
    saveSyncSession(syncPairedRoomId, syncPairedDeviceName);
  }
}

function onRelayMessageImpl(data: string): void {
  syncDebugLog('RECV: ' + data.substring(0, 200));

  // Track seq for delta catch-up — extract "seq":N from envelope
  const seqKeyIdx = data.indexOf('"seq"');
  if (seqKeyIdx >= 0) {
    let sStart = seqKeyIdx + 5;
    // Skip : and whitespace
    while (sStart < data.length && (data.charCodeAt(sStart) === 58 || data.charCodeAt(sStart) === 32)) sStart = sStart + 1;
    let sEnd = sStart;
    while (sEnd < data.length && data.charCodeAt(sEnd) >= 48 && data.charCodeAt(sEnd) <= 57) sEnd = sEnd + 1;
    if (sEnd > sStart) {
      const msgSeq = Number(data.substring(sStart, sEnd));
      if (msgSeq > syncLastSeq) {
        syncLastSeq = msgSeq;
      }
    }
  }

  // Handle relay system messages ("type":"joined", "type":"deltas")
  // These don't have a "payload" field in the relay envelope
  const typeIdx = data.indexOf('"type"');
  if (typeIdx >= 0) {
    // Check for "deltas" batch: {"type":"deltas","room":"...","deltas":[...]}
    if (data.indexOf('"deltas"') >= 0 && data.indexOf('"type":"deltas"') >= 0) {
      handleDeltasBatch(data);
      return;
    }
    // "joined" confirmation — just log it, no payload to process
    if (data.indexOf('"joined"') >= 0) {
      syncDebugLog('Joined room confirmed');
      return;
    }
  }

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
  // Use charCodeAt comparison — Perry '===' unreliable for dynamically-sliced strings
  let isSelf = 0;
  if (msgFrom.length === syncDeviceId.length && msgFrom.length > 0) {
    let selfMatch = 1;
    for (let si = 0; si < msgFrom.length; si++) {
      if (msgFrom.charCodeAt(si) !== syncDeviceId.charCodeAt(si)) { selfMatch = 0; break; }
    }
    if (selfMatch > 0) isSelf = 1;
  }

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

  // E2E: if the envelope is encrypted, decrypt the payload before dispatching.
  // The pairing handshake (PAIR_REQ / PAIR_OK / PAIR_NO) is exempt by definition —
  // those messages bootstrap the project key and ship cleartext on both sides.
  let isEncrypted = 0;
  const encKeyIdx = data.indexOf('"encrypted"');
  if (encKeyIdx >= 0) {
    // After "encrypted": find first non-whitespace after the colon
    let ePos = encKeyIdx + 11;
    while (ePos < data.length && (data.charCodeAt(ePos) === 58 || data.charCodeAt(ePos) === 32)) ePos = ePos + 1;
    // "true" begins with 't' (116)
    if (ePos < data.length && data.charCodeAt(ePos) === 116) isEncrypted = 1;
  }
  if (isEncrypted > 0) {
    payload = decryptIncomingPayload(payload, 1);
  }

  // Handle PAIR_REQ|code|deviceId|deviceName|guestPubKey (only from others)
  if (payload.indexOf('PAIR_REQ|') === 0) {
    if (isSelf < 1) handlePairRequest(payload);
    return;
  }
  // Handle PAIR_OK|deviceId|deviceName (only from others)
  if (payload.indexOf('PAIR_OK|') === 0) {
    if (isSelf < 1) handlePairAccepted(payload);
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
      setSyncStatusText(t('Receiving files') + ': 0/' + countStr);
    }
    return;
  }
  // Handle BULK_SYNC_END — host finished bulk push
  if (payload.indexOf('BULK_SYNC_END') === 0) {
    if (isSelf < 1) {
      bulkSyncDone = 1;
      let doneMsg = t('Synced') + ' ';
      doneMsg += String(fileCacheCount);
      doneMsg += ' ' + t('files');
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
  // Parse: PAIR_REQ|code|deviceId|deviceName|guestPubKey
  const sep1 = payload.indexOf('|');
  const rest1 = payload.substring(sep1 + 1);
  const sep2 = rest1.indexOf('|');
  const code = rest1.substring(0, sep2);
  const rest2 = rest1.substring(sep2 + 1);
  const sep3 = rest2.indexOf('|');
  const guestDeviceId = rest2.substring(0, sep3);
  const rest3 = rest2.substring(sep3 + 1);
  const sep4 = rest3.indexOf('|');
  let guestName = '';
  let guestPubKey = '';
  if (sep4 >= 0) {
    guestName = rest3.substring(0, sep4);
    guestPubKey = rest3.substring(sep4 + 1);
  } else {
    // Legacy format without pubkey — refuse to pair to avoid silently downgrading to cleartext.
    guestName = rest3;
  }

  // Validate the code inline (avoid cross-module string comparison issues)
  let codeValid = 0;
  if (localPairingCode.length > 0 && Date.now() < localPairingExpiry) {
    const upperCode = code.toUpperCase();
    if (upperCode.length === localPairingCode.length) {
      let codeMatch = 1;
      for (let ci = 0; ci < upperCode.length; ci++) {
        if (upperCode.charCodeAt(ci) !== localPairingCode.charCodeAt(ci)) { codeMatch = 0; break; }
      }
      if (codeMatch > 0) codeValid = 1;
    }
  }
  if (codeValid < 1) {
    sendToRelay('PAIR_NO|invalid code');
    return;
  }
  if (guestPubKey.length < 32) {
    // No E2E key material in the request — refuse rather than ship cleartext.
    sendToRelay('PAIR_NO|encryption required');
    return;
  }

  // Mark code as used
  localPairingCode = '';
  localPairingExpiry = 0;

  // Complete X25519 key exchange:
  //   1. Generate (or reuse) a project key — symmetric AES key for all future deltas.
  //   2. Generate ephemeral host keypair.
  //   3. Wrap the project key under the X25519 shared secret with the guest.
  //   4. Send our public key + wrapped project key in PAIR_OK.
  if (hostGetProjectKey().length === 0) hostGenerateProjectKey();
  hostStartKeyExchange();
  const hostPubKey = hostGetDhPublicKey();
  const wrappedProjectKey = hostCompleteKeyExchange(guestPubKey);

  // Accept — add guest and send confirmation
  addGuest(guestDeviceId, guestName);
  addSyncDevice(guestName, 'connected');
  syncStatusOverride = '';
  setSyncStatusText(t('Paired!'));
  setSyncPairingCode('');

  // Send acceptance: PAIR_OK|deviceId|deviceName|hostPubKey|wrappedProjectKey
  // PAIR_OK ships cleartext (transport whitelists pairing handshake) — but the
  // project key is wrapped under the X25519 shared secret, so the relay never
  // sees it in the clear.
  let msg = 'PAIR_OK|';
  msg += syncDeviceId;
  msg += '|Hone Desktop|';
  msg += hostPubKey;
  msg += '|';
  msg += wrappedProjectKey;
  sendToRelay(msg);
  refreshSyncPanelDeferred();

  // Wire transport encryption — every payload from now on is AES-256-GCM under the project key.
  setPayloadCrypto(hostEncryptDelta, hostDecryptDelta);
  setEncryptionReady(1);

  // Save session for auto-restore on restart
  syncPairedDeviceName = guestName;
  saveSyncSession(syncPairedRoomId, guestName);
}

function handlePairAccepted(payload: string): void {
  // Parse: PAIR_OK|deviceId|deviceName|hostPubKey|wrappedProjectKey
  const sep1 = payload.indexOf('|');
  const rest1 = payload.substring(sep1 + 1);
  const sep2 = rest1.indexOf('|');
  const hostDeviceId = rest1.substring(0, sep2);
  const rest2 = rest1.substring(sep2 + 1);
  const sep3 = rest2.indexOf('|');
  let hostName = '';
  let hostPubKey = '';
  let wrappedProjectKey = '';
  if (sep3 >= 0) {
    hostName = rest2.substring(0, sep3);
    const rest3 = rest2.substring(sep3 + 1);
    const sep4 = rest3.indexOf('|');
    if (sep4 >= 0) {
      hostPubKey = rest3.substring(0, sep4);
      wrappedProjectKey = rest3.substring(sep4 + 1);
    } else {
      hostName = rest2; // legacy — no key material
    }
  } else {
    hostName = rest2; // legacy
  }

  // Without key material we'd be ciphertext-incapable; refuse to pair.
  if (hostPubKey.length < 32 || wrappedProjectKey.length < 32) {
    setSyncStatusText(t('Pair refused: host did not provide encryption keys.'));
    return;
  }

  // Unwrap the project key using our X25519 secret + the host's public key.
  guestReceiveProjectKey(hostPubKey, wrappedProjectKey);

  // Wire transport encryption — every payload from now on is AES-256-GCM under the project key.
  setPayloadCrypto(guestEncryptDelta, guestDecryptDelta);
  setEncryptionReady(1);

  addSyncDevice(hostName, 'connected');
  syncStatusOverride = '';
  setSyncStatusText(t('Paired!'));
  syncIsGuest = 1; // This device is the guest (received PAIR_OK from host)
  refreshSyncPanelDeferred();

  // Save session for auto-restore on restart
  syncPairedDeviceName = hostName;
  saveSyncSession(syncPairedRoomId, hostName);

  // Guest: request file tree from host after pairing
  setTimeout(() => { requestFileTreeFromHost(); }, 500);
}

// ---------------------------------------------------------------------------
// File sync protocol
// ---------------------------------------------------------------------------

function requestFileTreeFromHost(): void {
  sendToRelay('FILE_TREE_REQ');
  setSyncStatusText(t('Requesting files...'));
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
  setSyncStatusText(t('Sent file tree'));

  // Save host session for persistent restore
  if (syncPairedRoomId.length > 0 && syncPairedDeviceName.length < 1) {
    syncPairedDeviceName = 'Device';
  }
  if (syncPairedRoomId.length > 0) {
    saveSyncSession(syncPairedRoomId, syncPairedDeviceName);
  }

  // --- Bulk sync: send all text/source files after the tree ---
  // Collect file relPaths from the tree entries (capped at 200 files)
  // Pre-filter: only include files that are text AND within size limit
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
      // Pre-check file size to ensure announced count matches sent count
      let fullPath = workspaceRoot;
      fullPath += '/';
      fullPath += relPath;
      const content = safeReadFile(fullPath);
      if (content.length > 0 && content.length <= BULK_FILE_MAX_SIZE) {
        textFiles.push(relPath);
        textFileCount = textFileCount + 1;
      }
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
    setSyncStatusText(t('Syncing') + ' ' + String(textFileCount) + ' ' + t('files') + '...');
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
const BULK_FILE_MAX_SIZE = 262144; // 256KB per file (covers render.ts at 124KB, chat-panel.ts at 100KB)
const BULK_SYNC_TOTAL_MAX = 10485760; // 10MB total cap

function bulkSyncTick(): void {
  // Stop early if total size cap exceeded
  if (bulkSyncTotalSent >= BULK_SYNC_TOTAL_MAX) {
    clearInterval(bulkSyncTimerId);
    sendToRelay('BULK_SYNC_END');
    setSyncStatusText(t('Sync capped') + ' (' + String(bulkSyncIdx) + ' ' + t('files') + ', 5MB ' + t('limit') + ')');
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
    setSyncStatusText(t('Sync complete') + ' (' + String(bulkSyncFileCount) + ' ' + t('files') + ')');
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
    if (ext === 'kt') return 1;
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
  // Only process the first FILE_TREE response (relay may replay old deltas)
  if (fileTreeReceived > 0) return;
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

  // Remaining parts are entries — classify D vs F HERE (same module that created the strings)
  // Perry charCodeAt on cross-module substring arrays is unreliable, so extract paths+types locally
  // Encode type as 2-char prefix in path: "D/" for dir, "F/" for file
  // This avoids Perry's cross-module number[] read-back bug (0 values read as >0)
  let taggedPaths: string[] = [];
  let entryCount = 0;
  let firstFile = '';
  for (let i = 1; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 3) continue;
    const tc = e.charCodeAt(0);
    const relPath = e.substring(2);
    if (tc === 68) { // 'D'
      let tagged = 'D/';
      tagged += relPath;
      taggedPaths.push(tagged);
    } else {
      let tagged = 'F/';
      tagged += relPath;
      taggedPaths.push(tagged);
      // Track first file for auto-open (prefer .ts)
      if (firstFile.length === 0) firstFile = relPath;
      if (relPath.length > 3 && relPath.charCodeAt(relPath.length - 3) === 46 && relPath.charCodeAt(relPath.length - 2) === 116 && relPath.charCodeAt(relPath.length - 1) === 115) {
        firstFile = relPath;
      }
    }
    entryCount = entryCount + 1;
  }

  let dbgMsg = 'Tree: ';
  dbgMsg += String(entryCount);
  dbgMsg += ' entries from ';
  dbgMsg += rootName;
  setSyncStatusText(dbgMsg);
  syncDebugLog(dbgMsg);
  setRemoteFileTree(rootName, taggedPaths, entryCount);
  // Auto-switch to explorer panel to show the remote file tree
  switchSidebarPanel(0);

  // Save session so persistent restore works (guest received tree = paired + syncing)
  if (syncIsGuest > 0 && syncPairedRoomId.length > 0 && syncPairedDeviceName.length < 1) {
    // Auto-pair debug path: set partner name + save session
    syncPairedDeviceName = 'Debug Host';
    saveSyncSession(syncPairedRoomId, syncPairedDeviceName);
  }

  // Auto-open the first source file
  if (firstFile.length > 0) {
    onRemoteFileClicked(firstFile);
  }

  // Auto-test: if <tempDir>/hone-auto-test exists, run programmatic tests
  // (tempDir is /tmp on POSIX, %TEMP% on Windows — touch this file before launch)
  let doAutoTest = 0;
  try { if (existsSync(getTempDir() + '/hone-auto-test')) doAutoTest = 1; } catch (e: any) {}
  if (doAutoTest > 0) {
    setTimeout(() => { runAutoTest(taggedPaths, entryCount); }, 2000);
  }
}

function runAutoTest(taggedPaths: string[], entryCount: number): void {
  let log = 'AUTO-TEST START\n';
  log += 'entryCount=' + String(entryCount) + '\n';

  // Find directories and files to test
  let testDir = '';
  let testFile = '';
  let testFile2 = '';
  let dirCount = 0;
  let fileCount = 0;
  for (let i = 0; i < entryCount; i++) {
    const tagged = taggedPaths[i];
    if (tagged.length < 3) continue;
    const tag = tagged.charCodeAt(0);
    const relPath = tagged.substring(2);
    if (tag === 68) {
      dirCount = dirCount + 1;
      if (testDir.length === 0) testDir = relPath;
    }
    if (tag === 70) {
      fileCount = fileCount + 1;
      if (testFile.length === 0) testFile = relPath;
      else if (testFile2.length === 0) testFile2 = relPath;
    }
  }
  log += 'dirs=' + String(dirCount) + ' files=' + String(fileCount) + '\n';
  log += 'testDir=' + testDir + '\n';
  log += 'testFile=' + testFile + '\n';
  log += 'testFile2=' + testFile2 + '\n';

  // Test 1: isRemoteExplorerMode
  const remoteMode = isRemoteExplorerMode();
  log += 'TEST1-remoteMode: ' + String(remoteMode) + (remoteMode > 0 ? ' PASS' : ' FAIL') + '\n';

  // Test 2: File click via onRemoteFileClicked
  if (testFile2.length > 0) {
    log += 'TEST2-fileClick: clicking ' + testFile2 + '\n';
    onRemoteFileClicked(testFile2);
  }

  // Test 3: Visible file count (only root-level files visible initially — dirs are collapsed)
  const visFiles = getVisibleFileCount();
  log += 'TEST3-visibleFiles: ' + String(visFiles) + '\n';

  // Test 4: Expanded dir count (should be 0 initially)
  const expDirs = getExpandedDirCount();
  log += 'TEST4-expandedDirs: ' + String(expDirs) + (expDirs === 0 ? ' PASS (all collapsed)' : ' NOTE (' + String(expDirs) + ' expanded)') + '\n';

  try { writeFileSync(getTempDir() + '/hone-auto-test-result.log', log); } catch (e: any) {}

  // Test 5: Expand a directory
  if (testDir.length > 0) {
    setTimeout(() => { runAutoTestExpand(testDir, testFile2); }, 1500);
  }
}

function runAutoTestExpand(dirPath: string, testFile2: string): void {
  let log = '';
  try { log = readFileSync(getTempDir() + '/hone-auto-test-result.log'); } catch (e: any) {}

  // Verify file click from test 2 completed
  log += 'TEST2-result: currentEditorFilePath=' + currentEditorFilePath + '\n';
  if (currentEditorFilePath.length > 0) {
    log += 'TEST2-result: PASS — file loaded in editor\n';
  } else {
    log += 'TEST2-result: FAIL — no file in editor\n';
  }

  // Test 5: Expand a directory
  const beforeCount = getVisibleFileCount();
  log += 'TEST5-expand: before visibleFiles=' + String(beforeCount) + '\n';
  const toggled = toggleRemoteDir(dirPath);
  log += 'TEST5-expand: toggleRemoteDir returned ' + String(toggled) + '\n';

  try { writeFileSync(getTempDir() + '/hone-auto-test-result.log', log); } catch (e: any) {}

  // Wait for refresh then check
  setTimeout(() => { runAutoTestExpandCheck(dirPath, beforeCount); }, 500);
}

function runAutoTestExpandCheck(dirPath: string, beforeCount: number): void {
  let log = '';
  try { log = readFileSync(getTempDir() + '/hone-auto-test-result.log'); } catch (e: any) {}

  const afterCount = getVisibleFileCount();
  const expDirs = getExpandedDirCount();
  log += 'TEST5-expand: after visibleFiles=' + String(afterCount) + ' expandedDirs=' + String(expDirs) + '\n';
  if (afterCount > beforeCount) {
    log += 'TEST5-expand: PASS — dir expanded (files: ' + String(beforeCount) + ' -> ' + String(afterCount) + ')\n';
  } else if (afterCount === beforeCount) {
    log += 'TEST5-expand: NOTE — same file count (dir may have no files)\n';
  } else {
    log += 'TEST5-expand: UNEXPECTED — fewer files after expand\n';
  }

  // Test 6: Collapse the directory back
  toggleRemoteDir(dirPath);

  try { writeFileSync(getTempDir() + '/hone-auto-test-result.log', log); } catch (e: any) {}
  setTimeout(() => { runAutoTestCollapse(dirPath, afterCount); }, 500);
}

function runAutoTestCollapse(dirPath: string, expandedCount: number): void {
  let log = '';
  try { log = readFileSync(getTempDir() + '/hone-auto-test-result.log'); } catch (e: any) {}

  const afterCollapse = getVisibleFileCount();
  const expDirs = getExpandedDirCount();
  log += 'TEST6-collapse: visibleFiles=' + String(afterCollapse) + ' expandedDirs=' + String(expDirs) + '\n';
  if (afterCollapse < expandedCount) {
    log += 'TEST6-collapse: PASS — dir collapsed (files: ' + String(expandedCount) + ' -> ' + String(afterCollapse) + ')\n';
  } else {
    log += 'TEST6-collapse: NOTE — same or more files after collapse\n';
  }

  // Test 7: Click a file inside a directory (programmatically)
  // Use clickRemoteFile to test the sidebar-to-editor path
  log += 'TEST7-clickRemoteFile: clicking src/app.ts\n';
  const clickResult = clickRemoteFile('src/app.ts');
  log += 'TEST7-clickRemoteFile: returned ' + String(clickResult) + '\n';

  try { writeFileSync(getTempDir() + '/hone-auto-test-result.log', log); } catch (e: any) {}
  setTimeout(() => { runAutoTestFinal(); }, 1500);
}

function runAutoTestFinal(): void {
  let log = '';
  try { log = readFileSync(getTempDir() + '/hone-auto-test-result.log'); } catch (e: any) {}

  log += 'TEST7-result: currentEditorFilePath=' + currentEditorFilePath + '\n';

  // Check if file was loaded
  let fileMatch = 0;
  const expected = 'src/app.ts';
  if (currentEditorFilePath.length === expected.length) {
    fileMatch = 1;
    for (let i = 0; i < expected.length; i++) {
      if (currentEditorFilePath.charCodeAt(i) !== expected.charCodeAt(i)) { fileMatch = 0; break; }
    }
  }
  if (fileMatch > 0) {
    log += 'TEST7-result: PASS — src/app.ts loaded\n';
  } else {
    log += 'TEST7-result: NOTE — different file loaded: ' + currentEditorFilePath + '\n';
  }

  // Summary
  log += '\n--- SUMMARY ---\n';
  log += 'Remote mode: ' + String(isRemoteExplorerMode()) + '\n';
  log += 'File cache: ' + String(fileCacheCount) + ' entries\n';
  log += 'Editor ready: ' + String(editorReady) + '\n';
  log += 'Current file: ' + currentEditorFilePath + '\n';
  log += 'AUTO-TEST END\n';
  try { writeFileSync(getTempDir() + '/hone-auto-test-result.log', log); } catch (e: any) {}
}

/** Host: guest sent an edited file to save to disk. */
// Returns 1 if `abs` is an absolute path that lies inside the current
// workspace subtree (used to confine LSP-supplied WorkspaceEdit targets).
// Conservative: no open workspace → not inside (reject). Requires the
// workspaceRoot prefix followed by a path separator, and rejects any `..`
// segment so a prefix-matching-but-escaping path can't slip through.
function isPathInsideWorkspace(abs: string): number {
  if (workspaceRoot.length < 1) return 0;
  if (abs.length < workspaceRoot.length) return 0;
  for (let i = 0; i < workspaceRoot.length; i++) {
    if (abs.charCodeAt(i) !== workspaceRoot.charCodeAt(i)) return 0;
  }
  if (abs.length > workspaceRoot.length) {
    const sep = abs.charCodeAt(workspaceRoot.length);
    if (sep !== 47 && sep !== 92) return 0; // must be '/' or '\' boundary
  }
  // Reject any `..` path segment (split on '/' and '\').
  let segStart = 0;
  for (let i = 0; i <= abs.length; i++) {
    let atEnd = i === abs.length;
    let isSep = 0;
    if (!atEnd) {
      const ch = abs.charCodeAt(i);
      if (ch === 47 || ch === 92) isSep = 1;
    }
    if (atEnd || isSep > 0) {
      if (i - segStart === 2 && abs.charCodeAt(segStart) === 46 && abs.charCodeAt(segStart + 1) === 46) {
        return 0;
      }
      segStart = i + 1;
    }
  }
  return 1;
}

// Returns 1 if `rel` must NOT be trusted as a workspace-relative path:
// absolute, drive-qualified, UNC, contains a `..` traversal segment, or a
// NUL byte. Perry-safe (charCodeAt / explicit segment scan, no regex).
function isUnsafeRelPath(rel: string): number {
  if (rel.length < 1) return 1;
  const c0 = rel.charCodeAt(0);
  // Absolute / UNC: leading '/' (47) or '\' (92).
  if (c0 === 47 || c0 === 92) return 1;
  // Windows drive letter: "X:" at offset 0-1 (':' = 58).
  if (rel.length >= 2 && rel.charCodeAt(1) === 58) return 1;
  // NUL byte anywhere.
  for (let i = 0; i < rel.length; i++) {
    if (rel.charCodeAt(i) === 0) return 1;
  }
  // `..` as a whole path segment. Walk segments split on '/' or '\'.
  let segStart = 0;
  for (let i = 0; i <= rel.length; i++) {
    let atEnd = i === rel.length;
    let sep = 0;
    if (!atEnd) {
      const ch = rel.charCodeAt(i);
      if (ch === 47 || ch === 92) sep = 1;
    }
    if (atEnd || sep > 0) {
      const segLen = i - segStart;
      if (segLen === 2 && rel.charCodeAt(segStart) === 46 && rel.charCodeAt(segStart + 1) === 46) {
        return 1; // a ".." segment
      }
      segStart = i + 1;
    }
  }
  return 0;
}

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
  // SECURITY: relPath comes from a paired remote device over the relay.
  // Sender spoofing isn't blocked (gap #3) and the pairing code is weak
  // (gap #4), so a hostile/buggy peer could send `../../.ssh/authorized_keys`
  // (traversal) or an absolute path and the host would writeFileSync ANY
  // file the process can reach. Reject anything that isn't a clean
  // workspace-relative path before building fullPath.
  if (isUnsafeRelPath(relPath) > 0) {
    syncDebugLog('REJECTED unsafe FILE_SAVE relPath: ' + relPath);
    setSyncStatusText(t('Rejected unsafe file path from peer'));
    return;
  }
  let fullPath = workspaceRoot;
  fullPath += '/';
  fullPath += relPath;
  writeFileSync(fullPath, content);
  // Confirm to guest
  let okMsg = 'FILE_SAVE_OK|';
  okMsg += relPath;
  sendToRelay(okMsg);
  let statusMsg = t('Guest saved') + ': ';
  statusMsg += relPath;
  setSyncStatusText(statusMsg);
  syncDebugLog(statusMsg);
}

/** Guest: host confirmed the file was saved. */
function handleFileSaveOk(payload: string): void {
  // FILE_SAVE_OK|relPath
  const relPath = payload.substring(13); // "FILE_SAVE_OK|".length
  let statusMsg = t('Saved') + ': ';
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
  // SECURITY: same untrusted-peer-relPath problem as handleFileSave but for
  // READ — an unsafe relPath here lets a peer exfiltrate ANY host file the
  // process can read (`../../.ssh/id_rsa`, etc.) back over the relay.
  if (isUnsafeRelPath(relPath) > 0) {
    syncDebugLog('REJECTED unsafe FILE_REQ relPath: ' + relPath);
    return;
  }
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

  // Update bulk sync progress (throttle UI updates to every 5th file)
  if (bulkSyncDone < 1 && bulkSyncTotal > 0) {
    bulkSyncReceived = bulkSyncReceived + 1;
    if (bulkSyncReceived % 5 === 0 || bulkSyncReceived === bulkSyncTotal) {
      let progressMsg = t('Syncing') + ': ';
      progressMsg += String(bulkSyncReceived);
      progressMsg += '/';
      progressMsg += String(bulkSyncTotal);
      setSyncStatusText(progressMsg);
    }
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
  setSyncStatusText(t('Loaded') + ': ' + relPath);
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
  syncDebugLog('onRemoteFileClicked: ' + relPath);
  setSyncStatusText(t('Opening') + ': ' + relPath);
  // Check local cache first — instant open if already synced
  if (fileCacheHas(relPath) > 0) {
    syncDebugLog('Found in cache');
    const content = fileCacheGet(relPath);
    displayFileFromCache(relPath, content);
    return;
  }
  // Not cached — request from host
  syncDebugLog('Not in cache, requesting');
  setSyncStatusText(t('Loading') + ': ' + relPath);
  pendingOpenPath = relPath;
  let msg = 'FILE_REQ|';
  msg += relPath;
  sendToRelay(msg);
}

function refreshSyncPanelDeferred(): void {
  if (isRelayConnected() > 0) {
    if (syncStatusOverride.length === 0) {
      setSyncStatusText(t('Connected to relay'));
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
  registerCommand('workbench.action.newEditor', t('New Editor'), newFileAction, { showInPalette: false });
  // Wire the command-dispatch path to the actual palette opener. The native
  // menu path (native-menu.ts) already calls showCommandPaletteAction
  // directly, but the keybinding path goes view.commandPalette →
  // executeCommand('workbench.action.showCommandPalette'), which was a no-op
  // stub in commands.ts. Without this override, Cmd+Shift+P via any keyboard
  // path silently did nothing.
  //
  // The same stub-handler pattern existed for 4 other workbench.action.*
  // commands. The native-menu path called the actual functions directly
  // (showOutlineAction et al.), but ANY invocation through the command
  // palette (which dispatches via executeCommand at command-palette.ts:164)
  // hit empty handlers and silently did nothing. Override them all here.
  registerCommand('workbench.action.showCommandPalette', t('Show Command Palette'), showCommandPaletteAction, { showInPalette: false });
  registerCommand('workbench.action.showOutline', t('Show Outline'), showOutlineAction, { showInPalette: false });
  registerCommand('workbench.action.showTimeline', t('Show Timeline'), showTimelineAction, { showInPalette: false });
  registerCommand('workbench.action.showTasks', t('Show Tasks'), showTasksAction, { showInPalette: false });
  registerCommand('workbench.action.runBuildTask', t('Run Build Task'), runBuildTaskAction, { showInPalette: false });
  // Direct-action palette commands. The native menu's `keyEquivalent`
  // dispatch already covers these for keyboard shortcuts; this wiring
  // covers the command-palette dispatch path. Items NOT wired here
  // (edit.undo/redo/cut/copy/paste, view.zoomIn/Out, etc.) rely on the
  // OS responder chain — invoking them from the palette without an
  // active text-input focus is undefined, so leaving those as no-ops
  // until a focused-element check is added.
  registerCommand('file.save', t('Save'), saveFileAction, { category: t('File') });
  registerCommand('file.saveAs', t('Save As...'), saveFileAsAction, { category: t('File') });
  registerCommand('view.toggleSidebar', t('Toggle Sidebar'), toggleSidebarAction, { category: t('View') });
  registerCommand('workbench.action.closeActiveEditor', t('Close Editor'), closeEditorAction, { category: t('View') });
  registerCommand('edit.find', t('Find'), findAction, { category: t('Edit') });
  registerCommand('edit.replace', t('Replace'), replaceAction, { category: t('Edit') });
  registerCommand('view.toggleTerminal', t('Toggle Terminal'), toggleTerminalAction, { category: t('View') });
  registerCommand('file.openFile', t('Open File...'), openFileAction, { category: t('File') });
  registerCommand('file.openFolder', t('Open Folder...'), openFolderAction, { category: t('File') });
  registerCommand('edit.formatDocument', t('Format Document'), formatDocumentAction, { category: t('Edit') });
  registerCommand('editor.action.revealDefinition', t('Go to Definition'), goToDefinitionAction, { category: t('Go') });
  registerCommand('view.zoomIn', t('Zoom In'), zoomInAction, { category: t('View') });
  registerCommand('view.zoomOut', t('Zoom Out'), zoomOutAction, { category: t('View') });
  registerCommand('view.resetZoom', t('Reset Zoom'), zoomResetAction, { category: t('View') });
  registerCommand('workbench.action.quickOpen', t('Go to File...'), goToFileAction, { showInPalette: false });
  // Trust commands target the currently-open workspace implicitly. Without
  // an open folder they're a no-op (no scope to trust). The "Workspaces:"
  // prefix on the user-facing IDs in commands.ts is the palette-friendly
  // entry; these workbench.action.* IDs are the canonical action handles.
  registerCommand('workbench.action.trustWorkspace', t('Trust Workspace'), () => {
    if (workspaceRoot.length > 0) trustWorkspace(workspaceRoot);
  }, { showInPalette: false });
  registerCommand('workbench.action.revokeWorkspaceTrust', t('Revoke Workspace Trust'), () => {
    if (workspaceRoot.length > 0) revokeWorkspaceTrust(workspaceRoot);
  }, { showInPalette: false });
  // Close-all uses the existing closeAllOpenTabs helper that the close-all
  // tab-bar gesture already routes through. No prompt for dirty tabs in v1
  // — that's the next polish step (per #25 follow-up).
  registerCommand('workbench.action.closeAllEditors', t('Close All Editors'), () => { closeAllOpenTabs(); }, { category: t('View') });
  // Go to Symbol opens quick-open; the existing `@`-prefix mode (iter-25 work
  // on #36) handles document symbols once the user types `@`. Pre-filling the
  // textfield needs a Perry TextField setText FFI — pending v1.1; today the
  // user types `@` themselves. Aliased under both VS Code names.
  registerCommand('editor.action.goToSymbol', t('Go to Symbol in Editor...'), goToFileAction, { category: t('Go') });
  registerCommand('workbench.action.gotoSymbol', t('Go to Symbol in Editor...'), goToFileAction, { showInPalette: false });
  // "Bottom Panel" is the terminal area in v1 — no separate problems pane
  // (diagnostics live in the lsp-bridge popups). Alias to toggleTerminal.
  registerCommand('view.toggleBottomPanel', t('Toggle Bottom Panel'), toggleTerminalAction, { category: t('View') });
  // Activity-panel switchers — palette-discoverable so "Show File Explorer"
  // and the like are findable by typing in the palette. Today the
  // matchKeybinding dispatcher isn't wired (see iter-49 note), so
  // `view.activity.files` keybindings (Cmd+1..4 on iPad) only fire if some
  // future dispatcher reaches them; the palette path is the working route.
  // Indices come from switchSidebarPanel: 0=Files, 1=Search, 2=Git, 3=Sync.
  // AI Chat (idx 4) lives in the right panel and toggles separately.
  registerCommand('view.activity.files', t('Show File Explorer'), () => { switchSidebarPanel(0); }, { category: t('View') });
  registerCommand('view.activity.search', t('Show Search'), () => { switchSidebarPanel(1); }, { category: t('View') });
  registerCommand('view.activity.git', t('Show Source Control'), () => { switchSidebarPanel(2); }, { category: t('View') });
  registerCommand('view.activity.sync', t('Show Sync'), () => { switchSidebarPanel(3); }, { category: t('View') });
  // Color Theme: the theme-loader is Perry-stubbed to a single loaded theme
  // and the runtime palette is the hardcoded Hone Dark / Hone Light pair in
  // render.ts (applyDarkColors / applyLightColors). A full 15-theme picker
  // needs the theme infrastructure to actually load tokenColors at runtime
  // (#17/#18/#20 — a big-bucket item). Until then this command honestly
  // toggles between the two themes the IDE can actually render, routing
  // through updateSettings so the existing settings-poll → applyThemeChangeImpl
  // pipeline applies it (same path the Settings panel cycle uses).
  registerCommand('workbench.action.selectTheme', t('Color Theme (toggle dark/light)'), () => {
    const cs = getWorkbenchSettings();
    // 'Hone Dark' has 'D'(68) at index 5; anything else → switch to dark.
    let nextTheme = 'Hone Dark';
    if (cs.colorTheme.length > 5 && cs.colorTheme.charCodeAt(5) === 68) nextTheme = 'Hone Light';
    updateSettings({ colorTheme: nextTheme });
  }, { category: t('Preferences') });
  // Docs / About — both were menu-referenced (menu.ts) but had no action
  // function anywhere, so they were dead menu items AND palette-invisible.
  registerCommand('workbench.action.openDocs', t('Documentation'), () => {
    openExternalUrl('https://hone.codes/docs');
  }, { category: t('Help') });
  registerCommand('workbench.action.showAbout', t('About Hone'), () => {
    let msg = 'Hone IDE ';
    msg += HONE_VERSION;
    showNotification(msg, 'info');
  }, { category: t('Help') });
  // Palette-discoverable wrappers around the existing menu-only actions.
  // commands.ts doesn't register these, so they were unreachable from the
  // command palette. Each has a working render.ts function — just needs a
  // palette entry. (`workbench.action.openDocs` and `showAbout` skipped —
  // no underlying action function in render.ts yet.)
  registerCommand('editor.action.goToLine', t('Go to Line...'), goToLineAction, { category: t('Go') });
  registerCommand('workbench.action.openSettings', t('Open Settings'), openSettingsAction, { category: t('Preferences') });
  registerCommand('workbench.action.checkForUpdates', t('Check for Updates'), checkForUpdatesAction, { category: t('Help') });
  registerCommand('workbench.action.showWelcome', t('Welcome'), showWelcomeAction, { category: t('Help') });

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

  // Initialize recent items store (also called in buildRecentSubmenu for menu bar)
  initRecentItems();

  // SHIP-V1-GAPS.md #42: apply workspace settings overlay before any panel
  // touches the live settings snapshot.
  if (workspaceRoot.length > 0) applyWorkspaceOverlay(workspaceRoot);

  // Wire up extracted panel callbacks
  setSidebarWorkspaceRoot(workspaceRoot);
  setSidebarFileClickCallback(onSidebarFileClick);
  // SHIP-V1-GAPS.md #95: push hidden-files setting; refresh on change via
  // settings listener below.
  setSidebarShowHiddenFiles(getWorkbenchSettings().explorerShowHiddenFiles ? 1 : 0);
  // SHIP-V1-GAPS.md #50: gitignore-aware explorer.
  setSidebarRespectGitignore(getWorkbenchSettings().explorerRespectGitignore ? 1 : 0);
  setSidebarOpenFolderCallback(openFolderAction);
  setSidebarNewFileCallback(newFileAction);
  setSidebarCurrentEditorPath(currentEditorFilePath);
  setContextMenuWorkspaceRoot(workspaceRoot);
  setContextMenuRefreshCallback(onContextMenuRefresh);
  setContextMenuFileOpener(onSidebarFileClick);
  setContextMenuTerminalOpener(onContextMenuTerminalOpen);
  setTabDisplayCallback(onTabDisplay);
  setStatusBarCursorGetter(getCursorPosition);
  setSearchWorkspaceRoot(workspaceRoot);
  setSearchFileOpener(openFileFromSearchPanel);
  setSearchEditorReloader(reloadEditorContent);
  setSearchCurrentEditorPath(getCurrentEditorPath);
  setGitWorkspaceRoot(workspaceRoot);
  setGitFileOpener(openFileFromGitPanel);
  // SHIP-V1-GAPS.md #63: Generate commit message. Reads the staged + working
  // diff, opens the AI Chat panel, pre-fills the input. User reviews and
  // submits; the chat panel's streaming flow produces the message. The
  // produced message is left for the user to copy back into the commit
  // field (one-tap copy/paste between panels is the v1.1 polish).
  setGenerateCommitMessageHandler(() => { onGenerateCommitMessageImpl(); });
  // SHIP-V1-GAPS.md #108: AI-generated PR description.
  setGeneratePRDescriptionHandler(() => { onGeneratePRDescriptionImpl(); });
  setGitDiffOpener(onGitDiffOpen);
  setGitStatusBarUpdater(updateStatusBarBranchLabelImpl);
  setTerminalCwd(workspaceRoot);
  setChatWorkspaceRoot(workspaceRoot);
  setChatFilePathGetter(() => { return getCurrentEditorPathForChat(); });
  setDebugWorkspaceRoot(workspaceRoot);
  setDebugCurrentFilePath(() => { return getDebugEditorPath(); });
  setDebugFileOpener(openFileFromDebugPanel);
  setWelcomeActions(openFolderAction, openFileAction, openFileAction);
  setWelcomeRecentCallback(openRecentItem);

  // Wire LSP bridge
  setLspWorkspaceRoot(workspaceRoot);
  initLspBridge();
  setDiagnosticsFileOpener(openFileFromSearchPanel);
  setAutocompleteAcceptHandler(onAutocompleteAccept);
  setDiagnosticsStatusUpdater(updateStatusBarDiagnosticsImpl);

  // Initialize anonymous telemetry (opt-in, privacy-first)
  initTelemetry();

  // SHIP-V1-GAPS.md #91: confirm before closing a dirty tab.
  setOnBeforeTabClose((idx: number, path: string) => onBeforeTabCloseImpl(idx, path));

  // SHIP-V1-GAPS.md #105: tasks panel wiring. Workspace root is set on
  // onFolderOpened; for the initial workspace, wire it once here. Run-start
  // / run-done surface as notifications so the user knows the task fired.
  setTasksWorkspaceRoot(workspaceRoot);
  setTasksAppDataDir(getAppDataDir());
  setOnTaskRunStart((label: string) => { showNotification(t('Running task') + ': ' + label, 'info'); });
  setOnTaskRunDone((label: string, exitCode: number) => {
    if (exitCode === 0) {
      showNotification(t('Task launched') + ': ' + label, 'info');
    } else {
      showNotification(t('Task failed to launch') + ': ' + label, 'error');
    }
  });

  // SHIP-V1-GAPS.md #97: clickable status bar items. v1 routes to the Git
  // panel for the branch (so the user lands somewhere actionable) and to a
  // "coming soon" notification for the per-file pickers we haven't built yet.
  setOnBranchClick(() => { onStatusBranchClick(); });
  setOnLanguageClick(() => { showNotification(t('Language picker coming in v1.1.'), 'info'); });
  // SHIP-V1-GAPS.md #73: encoding change is data-destructive — defer the
  // picker until perry/ui exposes a confirm dialog. Display-only for now.
  setOnEncodingClick(() => { showNotification(t('Encoding shown is detected. Conversion picker arrives in v1.1.'), 'info'); });
  setOnEolClick(() => { cycleEolAction(); });
  setOnIndentClick(() => { showNotification(t('Indent picker coming in v1.1.'), 'info'); });

  // Initialize auto-update checker (desktop only)
  setOnUpdateAvailable(() => { onUpdateFound(); });
  setUpdateBtnClickHandler(() => { openUpdateAction(); });
  initUpdateChecker();

  // Initialize git state for status bar (async — doesn't block startup)
  refreshGitStateAsync();

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
    _lastSettingsVersion = getSettingsVersion();
    onSettingsChange(() => { onSettingsChanged(); });
    setInterval(() => { pollSettingsVersion(); }, 250);

    telemetryTrackStartup(Date.now() - _renderStartMs);
    return shell;
  }

  // Desktop (full) layout
  const settings = getWorkbenchSettings();

  const activityBar = renderActivityBarDesktop();
  const sidebar = renderSidebar();
  const editorArea = renderEditorArea();
  const statusBar = renderStatusBarImpl(null as any);

  // SHIP-V1-GAPS.md #88: right-click menu on the status bar. Mirrors
  // VS Code's "Hide Status Bar" + quick jumps to common pickers.
  const statusMenu = menuCreate();
  menuAddItem(statusMenu, t('Open Settings'), () => { openSettingsAction(); });
  menuAddItem(statusMenu, t('Source Control'), () => { onStatusBranchClick(); });
  menuAddSeparator(statusMenu);
  menuAddItem(statusMenu, t('Copy Branch Name'), () => { copyBranchNameToClipboard(); });
  menuAddItem(statusMenu, t('Copy File Path'), () => { copyEditorPathToClipboard(); });
  widgetSetContextMenu(statusBar, statusMenu);

  // Right-click menu on the activity bar — quick path to settings + hide.
  const activityMenu = menuCreate();
  menuAddItem(activityMenu, t('Open Settings'), () => { openSettingsAction(); });
  menuAddItem(activityMenu, t('Toggle Sidebar'), () => { toggleSidebarAction(); });
  widgetSetContextMenu(activityBar, activityMenu);

  // Right-click menu on the sidebar — move to other side / hide.
  const sidebarMenu = menuCreate();
  menuAddItem(sidebarMenu, t('Hide Sidebar'), () => { toggleSidebarAction(); });
  menuAddItem(sidebarMenu, t('Move Sidebar Right'), () => { toggleSidebarLocation(); });
  widgetSetContextMenu(sidebar, sidebarMenu);

  widgetSetWidth(activityBar, 48);
  widgetSetHugging(activityBar, 750);
  // SHIP-V1-GAPS.md #37: sidebar width is settings-driven (default 220).
  // Mouse-drag handle on the divider is queued for v1.1 once Perry exposes
  // drag-event FFI for widget edges.
  widgetSetWidth(sidebar, settings.sidebarWidth);
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

  // SHIP-V1-GAPS.md #39 + #38: honor sidebarLocation + activityBarLocation.
  // v1 supports: sidebar = 'left' | 'right'; activity bar = 'side' (default)
  // or 'hidden'. Top/bottom positions need a perpendicular activity bar
  // widget — deferred to a follow-up since the desktop activity bar widget
  // is built vertically.
  const _sidebarOnRight = settings.sidebarLocation.length > 0 && settings.sidebarLocation.charCodeAt(0) === 114; // 'r'
  const _activityBarHidden = settings.activityBarLocation.length > 0 && settings.activityBarLocation.charCodeAt(0) === 104; // 'h'idden
  let _activityBarChild: unknown = activityBar;
  if (_activityBarHidden) {
    // Hide via setHidden so child references still resolve and we can flip
    // back without rebuilding the HStack.
    widgetSetHidden(activityBar, 1);
  }
  const mainRow = _sidebarOnRight
    ? HStack(0, [_activityBarChild, editorArea, sidebarBorder, sidebar])
    : HStack(0, [_activityBarChild, sidebar, sidebarBorder, editorArea]);
  mainRowWidget = mainRow;

  widgetSetHugging(mainRow, 1);
  widgetSetHugging(statusBar, 750);

  // Platform context for responsive sizing
  const ctx = getPlatformContext();

  // Terminal bottom panel (skip on web — no PTY available)
  const termPanel = VStack(0, []);
  setBg(termPanel, getEditorBackground());
  widgetSetHidden(termPanel, 1);
  if (isWebPlatform() < 1) {
    let termHeight = Math.floor(ctx.screen.height * 0.25);
    if (termHeight < 150) termHeight = 150;
    if (termHeight > 250) termHeight = 250;
    widgetSetHeight(termPanel, termHeight);
    widgetSetHugging(termPanel, 750);
    setTerminalCloseCallback(toggleTerminalAction);
    setTerminalProblemsFileOpener(openFileFromSearchPanel);
    renderTerminalPanel(termPanel, null as any);
    if (settings.terminalVisible === true) {
      widgetSetHidden(termPanel, 0);
      terminalVisible = 1;
    }
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
  // Command palette takes over the sidebar when opened; on close it asks us
  // to restore whatever panel was active before (default: file explorer).
  initCommandPalette(sidebarContainer, () => { restoreSidebarAfterPalette(); });
  // SHIP-V1-GAPS.md #58: workspace trust registry. v1.0 ships the storage
  // (`~/.hone/trusted-workspaces.ini`) + `workspace.trust*` commands. Plugin
  // host gating on `isWorkspaceTrusted(workspaceRoot)` lands with the
  // `@honeide/api` runtime in v1.1.
  initWorkspaceTrust(getAppDataDir());

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
  _lastSettingsVersion = getSettingsVersion();
  onSettingsChange(() => { onSettingsChanged(); });
  setInterval(() => { pollSettingsVersion(); }, 250);

  // Poll for files opened via macOS "Open With" or command-line args
  setInterval(checkOpenFileRequests, 500);

  telemetryTrackStartup(Date.now() - _renderStartMs);
  return shell;
}

