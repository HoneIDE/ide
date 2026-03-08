/**
 * Terminal panel — real PTY-backed interactive terminal.
 * Embeds a native NSView that renders the terminal grid and routes
 * keyboard input directly to the shell via the PTY master fd.
 * TypeScript only polls for redraws every 16ms.
 *
 * Two tabs: PROBLEMS and TERMINAL.
 */
import {
  VStack, HStack, Text, Button, Spacer,
  ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  buttonSetBordered, buttonSetImage, buttonSetImagePosition,
  widgetAddChild, widgetClearChildren, widgetSetHugging, widgetSetHeight, widgetSetWidth,
  widgetSetHidden,
  widgetSetBackgroundColor,
  embedNSView,
} from 'perry/ui';
// Import triggers Perry to discover @honeide/terminal package.json FFI manifest
import { TERMINAL_LIVE } from '@honeide/terminal/perry/live';
import { hexToRGBA, setBg, setFg, setBtnFg, setBtnTint } from '../../ui-helpers';
import { getWorkbenchSettings } from '../../settings';
import {
  getDiagFiles, getDiagLines, getDiagMessages, getDiagSeverities, getDiagCount,
  onDiagnosticsUpdate,
} from '../lsp/diagnostics-panel';
import { getFileName } from '../../ui-helpers';
import { getEditorForeground, getSideBarForeground, getPanelBackground, getPanelBorder } from '../../theme/theme-colors';

// FFI declarations — LiveTerminal API
declare function hone_terminal_open(rows: number, cols: number, shell: number, cwd: number): number;
declare function hone_terminal_nsview(handle: number): number;
declare function hone_terminal_poll(handle: number): number;
declare function hone_terminal_write(handle: number, data: number): number;
declare function hone_terminal_resize(handle: number, rows: number, cols: number): number;
declare function hone_terminal_close(handle: number): number;

// Module-level state (Perry closures capture by value)
let termHandle: number = 0;
let termView: unknown = null;
let pollInterval: number = 0;
let termCwd: string = '';
let termContainer: unknown = null;
let termStarted: number = 0;

// Header tab buttons
let headerTabBtns: unknown[] = [];
let activeHeaderTab: number = 1; // TERMINAL active by default

// Problems view
let problemsContainer: unknown = null;
let problemsScrollContent: unknown = null;
let panelColors: any = null;

// File opener callback for clicking on problems
let _problemsFileOpener: (path: string, name: string) => void = () => {};

export function setTerminalProblemsFileOpener(fn: (path: string, name: string) => void): void {
  _problemsFileOpener = fn;
}

// External close callback
let _closeCallback: () => void = _noopClose;
function _noopClose(): void {}

export function setTerminalCloseCallback(fn: () => void): void {
  _closeCallback = fn;
}

export function setTerminalCwd(cwd: string): void {
  termCwd = cwd;
}

function doPoll(): void {
  if (termHandle === 0) return;
  hone_terminal_poll(termHandle);
}

function onHeaderTabClick(idx: number): void {
  activeHeaderTab = idx;
  updateTabContent();
  updateTabStyles();
}

function updateTabContent(): void {
  if (activeHeaderTab === 0) {
    // PROBLEMS
    if (termView) widgetSetHidden(termView, 1);
    if (problemsContainer) widgetSetHidden(problemsContainer, 0);
    refreshProblemsView();
  } else {
    // TERMINAL
    if (problemsContainer) widgetSetHidden(problemsContainer, 1);
    if (termView) widgetSetHidden(termView, 0);
  }
}

function updateTabStyles(): void {
  if (!panelColors) return;
  for (let i = 0; i < 2; i++) {
    if (i === activeHeaderTab) {
      setBtnFg(headerTabBtns[i], getEditorForeground());
    } else {
      let dimColor = getSideBarForeground();
      dimColor += '80';
      setBtnFg(headerTabBtns[i], dimColor);
    }
  }
}

function refreshProblemsView(): void {
  if (!problemsScrollContent || !panelColors) return;
  widgetClearChildren(problemsScrollContent);

  const count = getDiagCount();
  if (count < 1) {
    const hint = Text('No problems detected');
    textSetFontSize(hint, 12);
    setFg(hint, getSideBarForeground());
    widgetAddChild(problemsScrollContent, hint);
    return;
  }

  const files = getDiagFiles();
  const lines = getDiagLines();
  const messages = getDiagMessages();
  const severities = getDiagSeverities();

  for (let i = 0; i < count; i++) {
    if (i >= severities.length) break;
    const sev = severities[i];
    let severityColor = '#CCCCCC';
    let severityChar = '?';
    if (sev.length < 1) {
      severityChar = '?';
    } else if (sev.charCodeAt(0) === 101) { // 'e' for error
      severityColor = '#E57373';
      severityChar = 'E';
    } else if (sev.charCodeAt(0) === 119) { // 'w' for warning
      severityColor = '#E2C08D';
      severityChar = 'W';
    } else if (sev.charCodeAt(0) === 105) { // 'i' for info
      severityColor = '#73C991';
      severityChar = 'I';
    }

    const sevLabel = Text(severityChar);
    textSetFontSize(sevLabel, 11);
    textSetFontFamily(sevLabel, 11, 'Menlo');
    setFg(sevLabel, severityColor);

    const fname = getFileName(files[i]);
    const filePath = files[i];
    const lineNum = lines[i];
    let locLabel = fname;
    locLabel += ':';
    // Convert line number to string — build digits array then assemble
    let digits: string[] = [];
    let tmp = lineNum;
    if (tmp < 1) { digits[0] = '0'; }
    else {
      let dIdx = 0;
      while (tmp > 0) {
        digits[dIdx] = String.fromCharCode(48 + (tmp % 10));
        dIdx = dIdx + 1;
        tmp = Math.floor(tmp / 10);
      }
    }
    // Reverse-append digits
    for (let d = digits.length - 1; d >= 0; d--) {
      locLabel += digits[d];
    }

    const msgBtn = Button(locLabel, () => { openProblemFile(filePath, fname); });
    buttonSetBordered(msgBtn, 0);
    textSetFontSize(msgBtn, 11);
    setBtnFg(msgBtn, getSideBarForeground());

    const msgText = Text(messages[i]);
    textSetFontSize(msgText, 11);
    setFg(msgText, getSideBarForeground());

    const row = HStack(4, [sevLabel, msgBtn, msgText]);
    widgetAddChild(problemsScrollContent, row);
  }
}

let pendingProblemPath = '';
let pendingProblemName = '';

function openProblemFile(path: string, name: string): void {
  pendingProblemPath = path;
  pendingProblemName = name;
  setTimeout(() => { openProblemFileDeferred(); }, 0);
}

function openProblemFileDeferred(): void {
  if (pendingProblemPath.length < 1) return;
  const p = pendingProblemPath;
  const n = pendingProblemName;
  pendingProblemPath = '';
  pendingProblemName = '';
  _problemsFileOpener(p, n);
}

function onDiagsUpdated(): void {
  if (activeHeaderTab === 0) {
    refreshProblemsView();
  }
}

function onMaximizeClick(): void {
  // Placeholder for maximize behavior
}

function onCloseClick(): void {
  _closeCallback();
}

function buildTerminalHeader(colors: any): unknown {
  const tabNames = ['PROBLEMS', 'TERMINAL'];
  headerTabBtns = [];
  panelColors = colors;

  const row = HStack(0, []);
  setBg(row, getPanelBackground());

  for (let i = 0; i < 2; i++) {
    const idx = i;
    const btn = Button(tabNames[i], () => { onHeaderTabClick(idx); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 11);
    if (i === activeHeaderTab) {
      setBtnFg(btn, getEditorForeground());
    } else {
      let dimColor = getSideBarForeground();
      dimColor += '80';
      setBtnFg(btn, dimColor);
    }
    headerTabBtns[i] = btn;
    widgetAddChild(row, btn);
  }

  widgetAddChild(row, Spacer());

  // Maximize button
  const maxBtn = Button('', () => { onMaximizeClick(); });
  buttonSetBordered(maxBtn, 0);
  buttonSetImage(maxBtn, 'arrow.up.left.and.arrow.down.right');
  buttonSetImagePosition(maxBtn, 1);
  textSetFontSize(maxBtn, 10);
  setBtnTint(maxBtn, getSideBarForeground());
  widgetAddChild(row, maxBtn);

  // Close button
  const closeBtn = Button('', () => { onCloseClick(); });
  buttonSetBordered(closeBtn, 0);
  buttonSetImage(closeBtn, 'xmark');
  buttonSetImagePosition(closeBtn, 1);
  textSetFontSize(closeBtn, 10);
  setBtnTint(closeBtn, getSideBarForeground());
  widgetAddChild(row, closeBtn);

  widgetSetHeight(row, 32);
  widgetSetHugging(row, 750);

  // Top border line
  const topBorder = HStack(0, []);
  setBg(topBorder, getPanelBorder());
  widgetSetHeight(topBorder, 1);
  widgetSetHugging(topBorder, 750);

  const header = VStack(0, [topBorder, row]);
  widgetSetHugging(header, 750);

  return header;
}

export function renderTerminalPanel(container: unknown, colors: any): void {
  termContainer = container;
  panelColors = colors;

  // Build header bar
  const header = buildTerminalHeader(colors);
  widgetAddChild(container, header);

  // Problems container (hidden by default since TERMINAL is active)
  problemsScrollContent = VStack(2, []);
  const probScroll = ScrollView();
  scrollViewSetChild(probScroll, problemsScrollContent);
  problemsContainer = probScroll;
  widgetSetHugging(problemsContainer, 1);
  widgetSetHidden(problemsContainer, 1);
  widgetAddChild(container, problemsContainer);

  // Register diagnostics update callback
  onDiagnosticsUpdate(() => { onDiagsUpdated(); });

  // Get CWD from workspace settings
  let cwd = termCwd;
  if (cwd.length < 1) {
    const s = getWorkbenchSettings();
    if (s.lastOpenFolder.length > 0) {
      cwd = s.lastOpenFolder;
    }
  }
  if (cwd.length < 1) {
    cwd = '/Users/amlug';
  }

  // Open terminal: 14 rows x 80 cols
  const shell = '/bin/zsh';
  termHandle = hone_terminal_open(14, 80, shell as any, cwd as any);

  // Get the NSView and embed it
  const nsview = hone_terminal_nsview(termHandle);
  termView = embedNSView(nsview);
  widgetSetHugging(termView, 1);
  widgetAddChild(container, termView);

  // Poll every 16ms for PTY output
  pollInterval = setInterval(() => { doPoll(); }, 16);
}

export function destroyTerminalPanel(): void {
  if (pollInterval !== 0) {
    clearInterval(pollInterval);
    pollInterval = 0;
  }
  if (termHandle !== 0) {
    hone_terminal_close(termHandle);
    termHandle = 0;
  }
  termView = null;
  termContainer = null;
}
