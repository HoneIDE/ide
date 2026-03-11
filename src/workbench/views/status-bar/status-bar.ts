/**
 * Status bar — extracted from render.ts.
 *
 * Renders the bottom status bar (branch, diagnostics, cursor, encoding, language).
 * All state is module-level (Perry closures capture by value).
 */
import {
  HStack, Text, Button, Spacer,
  HStackWithInsets,
  textSetFontSize,
  textSetString,
  buttonSetBordered, buttonSetImage, buttonSetImagePosition,
  widgetAddChild, widgetSetHeight,
} from 'perry/ui';
import { setBg, setFg, setBtnTint, detectLanguage } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getStatusBarForeground, getStatusBarBackground } from '../../theme/theme-colors';

// ---------------------------------------------------------------------------
// Module-level state (must be declared BEFORE any function — Perry no-hoist)
// ---------------------------------------------------------------------------

let panelColors: ResolvedUIColors = null as any;

let statusBarBranchLabel: unknown = null;
let statusBarDiagLabel: unknown = null;
let statusBarCursorLabel: unknown = null;
let statusBarEncodingLabel: unknown = null;
let statusBarLangLabel: unknown = null;
let statusBarWidget: unknown = null;

let lastStatusCursorLine: number = -1;
let lastStatusCursorCol: number = -1;

// Cursor position getter callback
let _getCursorPos: () => { line: number; column: number } | null = _noopCursor;

function _noopCursor(): null { return null; }

// ---------------------------------------------------------------------------
// Setter functions
// ---------------------------------------------------------------------------

export function setStatusBarCursorGetter(cb: () => { line: number; column: number } | null): void {
  _getCursorPos = cb;
}

// ---------------------------------------------------------------------------
// Update functions
// ---------------------------------------------------------------------------

export function updateStatusBarBranchLabel(branch: string): void {
  if (statusBarBranchLabel) {
    textSetString(statusBarBranchLabel, branch);
  }
}

export function updateStatusBarDiagnostics(errors: number, warnings: number): void {
  if (statusBarDiagLabel) {
    if (errors > 0 || warnings > 0) {
      textSetString(statusBarDiagLabel, errors + ' errors, ' + warnings + ' warnings');
    } else {
      textSetString(statusBarDiagLabel, '');
    }
  }
}

export function updateStatusBarLanguage(filePath: string): void {
  if (!statusBarLangLabel) return;
  const lang = detectLanguage(filePath);
  let display = lang;
  // Perry: use length + charCodeAt matching (no === on dynamic strings in Perry AOT)
  if (lang.length === 10 && lang.charCodeAt(0) === 116) display = 'TypeScript';
  else if (lang.length === 10 && lang.charCodeAt(0) === 106) display = 'JavaScript';
  else if (lang.length === 6 && lang.charCodeAt(0) === 112) display = 'Python';
  else if (lang.length === 4 && lang.charCodeAt(0) === 114 && lang.charCodeAt(2) === 115) display = 'Rust';
  else if (lang.length === 4 && lang.charCodeAt(0) === 104) display = 'HTML';
  else if (lang.length === 3 && lang.charCodeAt(0) === 99 && lang.charCodeAt(1) === 115) display = 'CSS';
  else if (lang.length === 4 && lang.charCodeAt(0) === 106 && lang.charCodeAt(1) === 115) display = 'JSON';
  else if (lang.length === 8 && lang.charCodeAt(0) === 109) display = 'Markdown';
  else if (lang.length === 1 && lang.charCodeAt(0) === 99) display = 'C';
  else if (lang.length === 3 && lang.charCodeAt(0) === 99 && lang.charCodeAt(1) === 112) display = 'C++';
  else if (lang.length === 2 && lang.charCodeAt(0) === 103) display = 'Go';
  else if (lang.length === 4 && lang.charCodeAt(0) === 106 && lang.charCodeAt(1) === 97) display = 'Java';
  else if (lang.length === 5 && lang.charCodeAt(0) === 115 && lang.charCodeAt(1) === 119) display = 'Swift';
  else if (lang.length === 5 && lang.charCodeAt(0) === 115 && lang.charCodeAt(1) === 104) display = 'Shell';
  else if (lang.length === 4 && lang.charCodeAt(0) === 114 && lang.charCodeAt(2) === 98) display = 'Ruby';
  else if (lang.length === 3 && lang.charCodeAt(0) === 112) display = 'PHP';
  else if (lang.length === 4 && lang.charCodeAt(0) === 121) display = 'YAML';
  else if (lang.length === 4 && lang.charCodeAt(0) === 116 && lang.charCodeAt(1) === 111) display = 'TOML';
  else if (lang.length === 3 && lang.charCodeAt(0) === 115 && lang.charCodeAt(1) === 113) display = 'SQL';
  else if (lang.length === 3 && lang.charCodeAt(0) === 120) display = 'XML';
  else display = 'Plain Text';
  textSetString(statusBarLangLabel, display + ' ');
}

/** Poll cursor position and update status bar label. Called via setInterval. */
export function pollCursorPosition(): void {
  if (!statusBarCursorLabel) return;
  const pos = _getCursorPos();
  if (!pos) return;
  const line = pos.line;
  const col = pos.column;
  if (line === lastStatusCursorLine && col === lastStatusCursorCol) return;
  lastStatusCursorLine = line;
  lastStatusCursorCol = col;
  const lnStr = 'Ln ' + (line + 1) + ', Col ' + (col + 1);
  textSetString(statusBarCursorLabel, lnStr);
}

/** Recolor all status bar labels after a theme switch. */
export function recolorStatusBar(c: ResolvedUIColors): void {
  panelColors = c;
  if (statusBarWidget) setBg(statusBarWidget, getStatusBarBackground());
  if (statusBarBranchLabel) setFg(statusBarBranchLabel, getStatusBarForeground());
  if (statusBarDiagLabel) setFg(statusBarDiagLabel, getStatusBarForeground());
  if (statusBarCursorLabel) setFg(statusBarCursorLabel, getStatusBarForeground());
  if (statusBarEncodingLabel) setFg(statusBarEncodingLabel, getStatusBarForeground());
  if (statusBarLangLabel) setFg(statusBarLangLabel, getStatusBarForeground());
}

/** Get the status bar widget ref (for recoloring from render.ts). */
export function getStatusBarWidget(): unknown {
  return statusBarWidget;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderStatusBar(colors: ResolvedUIColors): unknown {
  panelColors = colors;

  // Branch icon + label
  const branchBtn = Button('', () => {});
  buttonSetBordered(branchBtn, 0);
  buttonSetImage(branchBtn, 'arrow.triangle.branch');
  buttonSetImagePosition(branchBtn, 1);
  textSetFontSize(branchBtn, 10);
  setBtnTint(branchBtn, getStatusBarForeground());

  const branch = Text('main');
  textSetFontSize(branch, 11);
  setFg(branch, getStatusBarForeground());
  statusBarBranchLabel = branch;

  const branchRow = HStack(2, [branchBtn, branch]);

  // Diagnostics
  const diagLabel = Text('');
  textSetFontSize(diagLabel, 11);
  setFg(diagLabel, getStatusBarForeground());
  statusBarDiagLabel = diagLabel;

  // Cursor position
  const cursorLabel = Text('Ln 1, Col 1');
  textSetFontSize(cursorLabel, 11);
  setFg(cursorLabel, getStatusBarForeground());
  statusBarCursorLabel = cursorLabel;

  // Indent size
  const indentLabel = Text('Spaces: 2');
  textSetFontSize(indentLabel, 11);
  setFg(indentLabel, getStatusBarForeground());

  // Encoding
  const encodingLabel = Text('UTF-8');
  textSetFontSize(encodingLabel, 11);
  setFg(encodingLabel, getStatusBarForeground());
  statusBarEncodingLabel = encodingLabel;

  // Line endings
  const eolLabel = Text('LF');
  textSetFontSize(eolLabel, 11);
  setFg(eolLabel, getStatusBarForeground());

  // Language
  const lang = Text('TypeScript');
  textSetFontSize(lang, 11);
  setFg(lang, getStatusBarForeground());
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
  setBg(bar, getStatusBarBackground());
  widgetSetHeight(bar, 25);
  statusBarWidget = bar;

  return bar;
}

