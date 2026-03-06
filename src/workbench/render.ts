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
  widgetSetContextMenu, menuCreate, menuAddItem, stackSetDetachesHidden, widgetMatchParentHeight,
  embedNSView,
  openFolderDialog, openFileDialog,
} from 'perry/ui';
import { Editor } from '@honeide/editor/perry';
import { getActiveTheme, setActiveTheme, type ResolvedUIColors } from './theme/theme-loader';
import type { LayoutMode } from '../platform';
import { getWorkbenchSettings, updateSettings, onSettingsChange } from './settings';
import { readFileSync, readdirSync, isDirectory, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Extracted modules
import { hexToRGBA, setBg, setFg, setBtnFg, setBtnTint, pathId, getFileName, strEq, toLowerCode, detectLanguage, isTextFile, getFileIcon, getFileIconColor, truncateName } from './ui-helpers';
import {
  renderSearchPanel as renderSearchPanelImpl,
  setSearchWorkspaceRoot, setSearchFileOpener, setSearchEditorReloader,
  setSearchCurrentEditorPath, resetSearchPanelReady,
} from './views/search/search-panel';
import {
  renderGitPanel as renderGitPanelImpl,
  setGitWorkspaceRoot, setGitFileOpener, setGitStatusBarUpdater,
  resetGitPanelReady, refreshGitState, updateStatusBarBranch,
  getGitFileStatus, getGitDirStatus,
} from './views/git/git-panel';
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
let fileRowWidgets: unknown[] = [];

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
let activityIndicators: unknown[] = [];
let activeActivityIdx = 0;

// Sidebar file tree
let fileTreeButtons: unknown[] = [];
let selectedFileIdx = -1;
let sidebarContainer: unknown = null;
let sidebarReady: number = 0;

// Editor tabs
let tabBarButtons: unknown[] = [];
let tabAccentBars: unknown[] = [];
let tabCloseButtons: unknown[] = [];
let tabDirty: number[] = [];
let tabSavedLengths: number[] = [];
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

// Status bar labels
let statusBarDiagLabel: unknown = null;
let statusBarCursorLabel: unknown = null;
let statusBarEncodingLabel: unknown = null;
let statusBarLangLabel: unknown = null;

// Cursor position polling state
let lastStatusCursorLine: number = -1;
let lastStatusCursorCol: number = -1;

// Shell-level widget refs for live theme recoloring
let shellWidget: unknown = null;
let leftContentWidget: unknown = null;
let activityBarWidget: unknown = null;
let statusBarWidget: unknown = null;
let editorPaneWidget: unknown = null;
let termPanelWidget: unknown = null;
let termBorderWidget: unknown = null;

// Deferred button actions (Perry button callbacks can't do structural UI mutations —
// widgetClearChildren/widgetAddChild inside a button callback causes RefCell panic)
let pendingActivityIdx: number = -1;
let pendingFileClickIdx: number = -1;
let pendingTabCloseIdx: number = -1;
let pendingTabClickIdx: number = -1;

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

function updateFileTree(): void {
  if (!themeColors) return;
  for (let i = 0; i < fileEntryCount; i++) {
    if (i < fileRowWidgets.length && fileRowWidgets[i]) {
      if (i === selectedFileIdx) {
        setBg(fileRowWidgets[i], themeColors.listActiveSelectionBackground);
      } else {
        setBg(fileRowWidgets[i], themeColors.sideBarBackground);
      }
    }
  }
}

function updateExplorerSelection(): void {
  if (!themeColors) return;
  // Clear old selection
  if (selectedFileIdx >= 0 && selectedFileIdx < fileRowWidgets.length && fileRowWidgets[selectedFileIdx]) {
    setBg(fileRowWidgets[selectedFileIdx], themeColors.sideBarBackground);
  }
  // Find new selection
  selectedFileIdx = -1;
  for (let i = 0; i < fileEntryCount; i++) {
    if (strEq(fileEntries[i].path, currentEditorFilePath)) {
      selectedFileIdx = i;
      if (i < fileRowWidgets.length && fileRowWidgets[i]) {
        setBg(fileRowWidgets[i], themeColors.listActiveSelectionBackground);
      }
      return;
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

/** Poll cursor position and update status bar label. Called via setInterval. */
function pollCursorPosition(): void {
  if (editorReady < 1) return;
  if (!statusBarCursorLabel) return;
  const vm = editorInstance.viewModel;
  const cursors = vm.cursors;
  if (cursors.length < 1) return;
  const c = cursors[0];
  const line = c.line;
  const col = c.column;
  if (line === lastStatusCursorLine && col === lastStatusCursorCol) return;
  lastStatusCursorLine = line;
  lastStatusCursorCol = col;
  // Display as 1-based
  const lnStr = 'Ln ' + (line + 1) + ', Col ' + (col + 1);
  textSetString(statusBarCursorLabel, lnStr);
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

function refreshSidebar(): void {
  if (sidebarReady < 1) return;
  widgetClearChildren(sidebarContainer);
  fileTreeButtons = [];
  selectedFileIdx = -1;
  fileEntries = [];
  fileEntryCount = 0;
  fileRowWidgets = [];

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

  // --- 1. EXPLORER title row (22px, thin text, left-padded 4px) ---
  const explorerLabel = Text('EXPLORER');
  textSetFontSize(explorerLabel, 11);
  textSetFontWeight(explorerLabel, 11, 0.4);
  if (themeColors) setFg(explorerLabel, themeColors.sideBarTitleForeground);
  const explorerRow = HStackWithInsets(0, 0, 4, 0, 4);
  widgetSetHeight(explorerRow, 22);
  widgetAddChild(explorerRow, explorerLabel);
  widgetAddChild(explorerRow, Spacer());
  widgetAddChild(sidebarContainer, explorerRow);

  // --- 2. FOLDERS section header (22px, bold, translucent bg) ---
  const foldersLabel = Text('FOLDERS');
  textSetFontSize(foldersLabel, 11);
  textSetFontWeight(foldersLabel, 11, 0.7);
  if (themeColors) setFg(foldersLabel, themeColors.sideBarForeground);
  const dotsBtn = Button('', () => {});
  buttonSetBordered(dotsBtn, 0);
  buttonSetImage(dotsBtn, 'ellipsis');
  buttonSetImagePosition(dotsBtn, 1);
  textSetFontSize(dotsBtn, 10);
  if (themeColors) setBtnTint(dotsBtn, themeColors.sideBarForeground);
  const foldersRow = HStackWithInsets(0, 0, 4, 0, 4);
  widgetSetHeight(foldersRow, 22);
  if (themeColors) setBg(foldersRow, themeColors.sideBarSectionHeaderBackground);
  widgetAddChild(foldersRow, foldersLabel);
  widgetAddChild(foldersRow, Spacer());
  widgetAddChild(foldersRow, dotsBtn);
  widgetAddChild(sidebarContainer, foldersRow);

  // --- 3. Root folder row (22px, bold uppercase, chevron + action buttons) ---
  const rootName = getFileName(workspaceRoot);
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
  if (themeColors) setFg(rootChevron, themeColors.sideBarForeground);
  const rootLabel = Text(rootDisplay);
  textSetFontSize(rootLabel, 11);
  textSetFontWeight(rootLabel, 11, 0.7);
  if (themeColors) setFg(rootLabel, themeColors.sideBarForeground);

  // New file button
  const newFileBtn = Button('', () => { newFileAction(); });
  buttonSetBordered(newFileBtn, 0);
  buttonSetImage(newFileBtn, 'doc.badge.plus');
  buttonSetImagePosition(newFileBtn, 1);
  textSetFontSize(newFileBtn, 10);
  if (themeColors) setBtnTint(newFileBtn, themeColors.sideBarForeground);

  // New folder button
  const newFolderBtn = Button('', () => {});
  buttonSetBordered(newFolderBtn, 0);
  buttonSetImage(newFolderBtn, 'folder.badge.plus');
  buttonSetImagePosition(newFolderBtn, 1);
  textSetFontSize(newFolderBtn, 10);
  if (themeColors) setBtnTint(newFolderBtn, themeColors.sideBarForeground);

  // Collapse all button
  const collapseBtn = Button('', () => { collapseAllDirs(); });
  buttonSetBordered(collapseBtn, 0);
  buttonSetImage(collapseBtn, 'arrow.down.right.and.arrow.up.left');
  buttonSetImagePosition(collapseBtn, 1);
  textSetFontSize(collapseBtn, 10);
  if (themeColors) setBtnTint(collapseBtn, themeColors.sideBarForeground);

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
  renderTreeLevel(workspaceRoot, 0);

  // --- 5. OUTLINE collapsed section ---
  const outlineChevron = Text('\u25B7');
  textSetFontSize(outlineChevron, 9);
  if (themeColors) setFg(outlineChevron, themeColors.sideBarForeground);
  const outlineLabel = Text('OUTLINE');
  textSetFontSize(outlineLabel, 11);
  textSetFontWeight(outlineLabel, 11, 0.7);
  if (themeColors) setFg(outlineLabel, themeColors.sideBarForeground);
  const outlineRow = HStackWithInsets(4, 0, 4, 0, 4);
  widgetSetHeight(outlineRow, 22);
  if (themeColors) setBg(outlineRow, themeColors.sideBarSectionHeaderBackground);
  widgetAddChild(outlineRow, outlineChevron);
  widgetAddChild(outlineRow, outlineLabel);
  widgetAddChild(sidebarContainer, outlineRow);

  // --- 6. TIMELINE collapsed section ---
  const timelineChevron = Text('\u25B7');
  textSetFontSize(timelineChevron, 9);
  if (themeColors) setFg(timelineChevron, themeColors.sideBarForeground);
  const timelineLabel = Text('TIMELINE');
  textSetFontSize(timelineLabel, 11);
  textSetFontWeight(timelineLabel, 11, 0.7);
  if (themeColors) setFg(timelineLabel, themeColors.sideBarForeground);
  const timelineRow = HStackWithInsets(4, 0, 4, 0, 4);
  widgetSetHeight(timelineRow, 22);
  if (themeColors) setBg(timelineRow, themeColors.sideBarSectionHeaderBackground);
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
    if (themeColors) setBtnTint(chevron, themeColors.sideBarForeground);
    widgetAddChild(row, chevron);

    // Name button (13px, no icon)
    const displayName = truncateName(name, 30);
    const btn = Button(displayName, () => { onDirToggle(id); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 13);
    if (themeColors) setBtnFg(btn, themeColors.sideBarForeground);
    widgetAddChild(row, btn);

    // Spacer absorbs extra width — keeps content left-aligned
    widgetAddChild(row, Spacer());

    // Git badge for directory
    if (workspaceRoot.length > 0 && full.length > workspaceRoot.length + 1) {
      const dirRelPath = full.slice(workspaceRoot.length + 1);
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
    if (themeColors) {
      const fColor = getFileIconColor(name);
      if (fColor.length > 0) {
        setBtnTint(iconBtn, fColor);
      } else {
        setBtnTint(iconBtn, themeColors.sideBarForeground);
      }
    }
    widgetAddChild(row, iconBtn);

    // Determine git status and color
    let fileColor = '';
    let gitLetter = '';
    let gitColor = '';
    if (themeColors) {
      fileColor = themeColors.sideBarForeground;
    }
    if (workspaceRoot.length > 0 && full.length > workspaceRoot.length + 1) {
      const relPath = full.slice(workspaceRoot.length + 1);
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
    if (themeColors && currentEditorFilePath.length > 0 && strEq(full, currentEditorFilePath)) {
      setBg(row, themeColors.listActiveSelectionBackground);
      selectedFileIdx = idx;
    }

    widgetAddChild(sidebarContainer, row);
  }
}

function onFolderOpened(folderPath: string): void {
  workspaceRoot = folderPath;
  setSearchWorkspaceRoot(folderPath);
  setGitWorkspaceRoot(folderPath);
  setTerminalCwd(folderPath);
  setLspWorkspaceRoot(folderPath);
  setChatWorkspaceRoot(folderPath);
  initLspBridge();
  refreshSidebar();
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

function debugAutoRenderChat(): void {
  if (rightPanelRendered > 0) return;
  rightPanelRendered = 1;
  try { writeFileSync('/tmp/hone-render-debug.txt', 'calling renderChatPanel'); } catch (e) {}
  renderChatPanel(rightPanelContainer, themeColors as ResolvedUIColors);
  try { writeFileSync('/tmp/hone-render-debug2.txt', 'renderChatPanel returned'); } catch (e) {}
}

export function closeEditorAction(): void {
  setTimeout(() => { closeEditorDeferred(); }, 0);
}

function closeEditorDeferred(): void {
  if (openTabCount < 1) return;
  onTabClose(activeTabIdx);
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
  // Clear dirty state for active tab
  if (activeTabIdx >= 0 && activeTabIdx < tabDirty.length) {
    tabDirty[activeTabIdx] = 0;
    tabSavedLengths[activeTabIdx] = content.length;
    if (activeTabIdx < tabCloseButtons.length) {
      buttonSetImage(tabCloseButtons[activeTabIdx], 'xmark');
    }
  }
}

function pollDirtyState(): void {
  if (editorReady < 1) return;
  if (activeTabIdx < 0 || activeTabIdx >= tabDirty.length) return;
  const content = editorInstance.getContent();
  const savedLen = tabSavedLengths[activeTabIdx];
  const wasDirty = tabDirty[activeTabIdx];
  if (content.length !== savedLen) {
    if (wasDirty < 1) {
      tabDirty[activeTabIdx] = 1;
      if (activeTabIdx < tabCloseButtons.length) {
        buttonSetImage(tabCloseButtons[activeTabIdx], 'circle.fill');
      }
    }
  } else {
    if (wasDirty > 0) {
      tabDirty[activeTabIdx] = 0;
      if (activeTabIdx < tabCloseButtons.length) {
        buttonSetImage(tabCloseButtons[activeTabIdx], 'xmark');
      }
    }
  }
}

function rebuildTabBar(): void {
  if (tabBarReady < 1) return;
  rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);
}

function rebuildTabBarDirect(count: number, names: string[], paths: string[], container: unknown): void {
  widgetClearChildren(container);
  tabBarButtons = [];
  tabAccentBars = [];
  tabCloseButtons = [];
  tabDirty = [];
  tabSavedLengths = [];
  for (let i = 0; i < count; i++) {
    const idx = i;
    const path = paths[i];
    const name = names[i];
    const tabGroup = HStackWithInsets(4, 0, 10, 0, 6);
    // File type icon
    const tabIcon = Button('', () => { onTabClickDirect(idx, path); });
    buttonSetBordered(tabIcon, 0);
    const tIcon = getFileIcon(name);
    buttonSetImage(tabIcon, tIcon);
    buttonSetImagePosition(tabIcon, 1);
    textSetFontSize(tabIcon, 11);
    const tabBtn = Button(name, () => { onTabClickDirect(idx, path); });
    buttonSetBordered(tabBtn, 0);
    textSetFontSize(tabBtn, 13);
    const closeBtn = Button('', () => { onTabClose(idx); });
    buttonSetBordered(closeBtn, 0);
    buttonSetImage(closeBtn, 'xmark');
    buttonSetImagePosition(closeBtn, 1);
    textSetFontSize(closeBtn, 9);
    widgetAddChild(tabGroup, tabIcon);
    widgetAddChild(tabGroup, tabBtn);
    widgetAddChild(tabGroup, closeBtn);

    // 2px accent bar at top of tab
    const accent = HStack(0, []);
    widgetSetHeight(accent, 2);
    widgetSetHugging(accent, 750);

    if (themeColors) {
      if (i === activeTabIdx) {
        setBtnFg(tabBtn, themeColors.tabActiveForeground);
        setBg(tabGroup, themeColors.tabActiveBackground);
        setBg(accent, themeColors.focusBorder);
      } else {
        setBtnFg(tabBtn, themeColors.tabInactiveForeground);
        setBg(tabGroup, themeColors.tabInactiveBackground);
        setBg(accent, themeColors.tabInactiveBackground);
      }
      setBtnFg(closeBtn, themeColors.tabActiveForeground);
      // Color the file icon
      const tColor = getFileIconColor(name);
      if (tColor.length > 0) {
        setBtnTint(tabIcon, tColor);
      } else {
        setBtnTint(tabIcon, themeColors.tabActiveForeground);
      }
    }

    // Wrap tab in VStack with accent bar on top
    const tabWrapper = VStack(0, [accent, tabGroup]);
    const tabMenu = menuCreate();
    menuAddItem(tabMenu, 'Close', () => { onTabClose(idx); });
    menuAddItem(tabMenu, 'Close Others', () => { closeOtherTabs(idx); });
    menuAddItem(tabMenu, 'Close All', () => { closeAllTabs(); });
    widgetSetContextMenu(tabWrapper, tabMenu);
    widgetAddChild(container, tabWrapper);
    tabBarButtons.push(tabGroup);
    tabAccentBars.push(accent);
    tabCloseButtons.push(closeBtn);
    tabDirty.push(0);
    // Initialize saved length: try to read the file length
    let savedLen = 0;
    try {
      const fc = readFileSync(path);
      savedLen = fc.length;
    } catch (e) {
      savedLen = 0;
    }
    tabSavedLengths.push(savedLen);
  }
}

function applyTabColors(count: number): void {
  if (!themeColors) return;
  for (let i = 0; i < count; i++) {
    if (i === activeTabIdx) {
      setBg(tabBarButtons[i], themeColors.tabActiveBackground);
      if (i < tabAccentBars.length) setBg(tabAccentBars[i], themeColors.focusBorder);
    } else {
      setBg(tabBarButtons[i], themeColors.tabInactiveBackground);
      if (i < tabAccentBars.length) setBg(tabAccentBars[i], themeColors.tabInactiveBackground);
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

function safeReadFile(filePath: string): string {
  let content = '';
  try {
    content = readFileSync(filePath);
  } catch (e) {
    return '';
  }
  return content;
}

function displayFileContent(filePath: string): void {
  currentEditorFilePath = filePath;
  updateBreadcrumb();
  updateStatusBarLanguage(filePath);
  if (editorReady < 1) return;
  const content = safeReadFile(filePath);
  editorInstance.setContent(content);
  editorInstance.render();
}

function updateStatusBarLanguage(filePath: string): void {
  if (!statusBarLangLabel) return;
  const lang = detectLanguage(filePath);
  // Capitalize first letter for display
  let display = lang;
  if (lang.length === 10 && lang.charCodeAt(0) === 116) display = 'TypeScript';
  else if (lang.length === 10 && lang.charCodeAt(0) === 106) display = 'JavaScript';
  else if (lang.length === 6 && lang.charCodeAt(0) === 112) display = 'Python';
  else if (lang.length === 4 && lang.charCodeAt(0) === 114) display = 'Rust';
  else if (lang.length === 4 && lang.charCodeAt(0) === 104) display = 'HTML';
  else if (lang.length === 3 && lang.charCodeAt(0) === 99 && lang.charCodeAt(1) === 115) display = 'CSS';
  else if (lang.length === 4 && lang.charCodeAt(0) === 106) display = 'JSON';
  else if (lang.length === 8 && lang.charCodeAt(0) === 109) display = 'Markdown';
  else if (lang.length === 1 && lang.charCodeAt(0) === 99) display = 'C';
  else if (lang.length === 3 && lang.charCodeAt(0) === 99) display = 'C++';
  else display = 'Plain Text';
  textSetString(statusBarLangLabel, display + ' ');
}

function openFileInEditor(filePath: string, fileName: string): void {
  // Check if file is already open — switch to that tab
  for (let i = 0; i < openTabCount; i++) {
    if (strEq(openTabs[i], filePath)) {
      activeTabIdx = i;
      currentEditorFilePath = filePath;
      updateBreadcrumb();
      if (tabBarReady > 0) {
        applyTabColors(openTabCount);
      }
      if (editorReady > 0) {
        const content = safeReadFile(filePath);
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
    const content = safeReadFile(filePath);
    editorInstance.setContent(content);
    editorInstance.render();
  }
}

function closeAllTabs(): void {
  setTimeout(() => { closeAllTabsDeferred(); }, 0);
}

function closeAllTabsDeferred(): void {
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

let pendingCloseOthersIdx: number = -1;

function closeOtherTabs(keepIdx: number): void {
  pendingCloseOthersIdx = keepIdx;
  setTimeout(() => { closeOtherTabsDeferred(); }, 0);
}

function closeOtherTabsDeferred(): void {
  const keepIdx = pendingCloseOthersIdx;
  if (keepIdx < 0) return;
  pendingCloseOthersIdx = -1;
  if (keepIdx >= openTabCount) return;
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
    const content = safeReadFile(keptPath);
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

function getCurrentEditorPathForChat(): string {
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
  if (sidebarReady < 1) return;
  if (idx === 0) {
    resetSearchPanelReady();
    refreshSidebar();
    return;
  }
  widgetClearChildren(sidebarContainer);
  fileTreeButtons = [];
  fileRowWidgets = [];
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

  // idx===4 (AI Chat) handled by toggleRightPanel, not here

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
  setTimeout(() => { deferredRefreshSidebar(); }, 0);
}

function deferredRefreshSidebar(): void {
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

function collapseAllDirs(): void {
  exp0 = -1; exp1 = -1; exp2 = -1; exp3 = -1;
  exp4 = -1; exp5 = -1; exp6 = -1; exp7 = -1;
  exp8 = -1; exp9 = -1; exp10 = -1; exp11 = -1;
  exp12 = -1; exp13 = -1; exp14 = -1; exp15 = -1;
  setTimeout(() => { refreshSidebar(); }, 0);
}

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
  openFileInEditor(entry.path, entry.label);
  updateExplorerSelection();
  if (compactShowingExplorer > 0) {
    hideExplorer();
  }
}

function onTabClick(idx: number): void {
  pendingTabClickIdx = idx;
  setTimeout(() => { onTabClickDeferred2(); }, 0);
}

function onTabClickDeferred2(): void {
  const idx = pendingTabClickIdx;
  if (idx < 0) return;
  pendingTabClickIdx = -1;
  activeTabIdx = idx;
  updateEditorTabs();
  if (idx < openTabCount) {
    displayFileContent(openTabs[idx]);
  }
  updateExplorerSelection();
}

function onTabClickDirect(idx: number, path: string): void {
  currentEditorFilePath = path;
  activeTabIdx = idx;
  updateBreadcrumb();
  if (tabBarButtons.length > 0) {
    applyTabColors(tabBarButtons.length);
  }
  if (editorReady > 0) {
    const content = safeReadFile(path);
    editorInstance.setContent(content);
    editorInstance.render();
  }
  updateExplorerSelection();
}

function onTabClose(idx: number): void {
  pendingTabCloseIdx = idx;
  setTimeout(() => { onTabCloseDeferred(); }, 0);
}

function onTabCloseDeferred(): void {
  const idx = pendingTabCloseIdx;
  if (idx < 0) return;
  pendingTabCloseIdx = -1;
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
    if (activeTabIdx >= newCount) activeTabIdx = newCount - 1;
  } else if (activeTabIdx > idx) {
    activeTabIdx = activeTabIdx - 1;
  }

  if (tabBarReady > 0) {
    rebuildTabBarDirect(newCount, newNames, newTabs, tabBarContainer);
  }
  if (editorReady > 0 && activeTabIdx >= 0) {
    currentEditorFilePath = newTabs[activeTabIdx];
    updateBreadcrumb();
    const content = safeReadFile(newTabs[activeTabIdx]);
    editorInstance.setContent(content);
    editorInstance.render();
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

  // Poll cursor position for status bar (every ~250ms)
  setInterval(() => { pollCursorPosition(); }, 250);
  // Poll dirty state every 500ms
  setInterval(() => { pollDirtyState(); }, 500);

  // Breadcrumb bar
  breadcrumbContainer = HStackWithInsets(4, 4, 8, 4, 8);
  setBg(breadcrumbContainer, colors.editorBackground);
  breadcrumbReady = 1;
  updateBreadcrumb();

  widgetSetHugging(editorWidget, 1); // editor stretches to fill available space

  const editorPane = VStack(0, [tabBarContainer, breadcrumbContainer, editorWidget]);
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
// Status bar
// ---------------------------------------------------------------------------

function renderStatusBar(colors: ResolvedUIColors): unknown {
  // Branch icon + label
  const branchBtn = Button('', () => {});
  buttonSetBordered(branchBtn, 0);
  buttonSetImage(branchBtn, 'arrow.triangle.branch');
  buttonSetImagePosition(branchBtn, 1);
  textSetFontSize(branchBtn, 10);
  setBtnTint(branchBtn, colors.statusBarForeground);

  const branch = Text('main');
  textSetFontSize(branch, 11);
  setFg(branch, colors.statusBarForeground);
  statusBarBranchLabel = branch;

  const branchRow = HStack(2, [branchBtn, branch]);

  // Diagnostics: error icon + warning icon
  const diagLabel = Text('');
  textSetFontSize(diagLabel, 11);
  setFg(diagLabel, colors.statusBarForeground);
  statusBarDiagLabel = diagLabel;

  // Cursor position
  const cursorLabel = Text('Ln 1, Col 1');
  textSetFontSize(cursorLabel, 11);
  setFg(cursorLabel, colors.statusBarForeground);
  statusBarCursorLabel = cursorLabel;

  // Indent size
  const indentLabel = Text('Spaces: 2');
  textSetFontSize(indentLabel, 11);
  setFg(indentLabel, colors.statusBarForeground);

  // Encoding
  const encodingLabel = Text('UTF-8');
  textSetFontSize(encodingLabel, 11);
  setFg(encodingLabel, colors.statusBarForeground);
  statusBarEncodingLabel = encodingLabel;

  // Line endings
  const eolLabel = Text('LF');
  textSetFontSize(eolLabel, 11);
  setFg(eolLabel, colors.statusBarForeground);

  // Language
  const lang = Text('TypeScript');
  textSetFontSize(lang, 11);
  setFg(lang, colors.statusBarForeground);
  statusBarLangLabel = lang;

  const bar = HStackWithInsets(12, 0, 8, 0, 8);
  widgetAddChild(bar, branchRow);
  widgetAddChild(bar, Spacer());
  widgetAddChild(bar, diagLabel);
  widgetAddChild(bar, cursorLabel);
  widgetAddChild(bar, indentLabel);
  widgetAddChild(bar, eolLabel);
  widgetAddChild(bar, encodingLabel);
  widgetAddChild(bar, lang);
  setBg(bar, colors.statusBarBackground);
  statusBarWidget = bar;

  // Initialize git state for status bar
  refreshGitState();
  updateStatusBarBranch();

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
  if (statusBarWidget) setBg(statusBarWidget, c.statusBarBackground);
  if (tabBarContainer) setBg(tabBarContainer, c.tabInactiveBackground);
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

  // Status bar labels
  if (statusBarBranchLabel) setFg(statusBarBranchLabel, c.statusBarForeground);
  if (statusBarDiagLabel) setFg(statusBarDiagLabel, c.statusBarForeground);
  if (statusBarCursorLabel) setFg(statusBarCursorLabel, c.statusBarForeground);
  if (statusBarEncodingLabel) setFg(statusBarEncodingLabel, c.statusBarForeground);
  if (statusBarLangLabel) setFg(statusBarLangLabel, c.statusBarForeground);

  // Tab bar
  applyTabColors(openTabCount);

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
  setSearchWorkspaceRoot(workspaceRoot);
  setSearchFileOpener(openFileFromSearchPanel);
  setSearchEditorReloader(reloadEditorContent);
  setSearchCurrentEditorPath(getCurrentEditorPath);
  setGitWorkspaceRoot(workspaceRoot);
  setGitFileOpener(openFileFromGitPanel);
  setGitStatusBarUpdater(updateStatusBarBranchLabel);
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
  // DEBUG: Start visible, auto-render after a delay
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

  // DEBUG: auto-render chat panel after delay
  setInterval(() => { debugAutoRenderChat(); }, 2000);

  return shell;
}
