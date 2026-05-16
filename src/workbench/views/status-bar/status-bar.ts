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
  buttonSetBordered, buttonSetImagePosition, buttonSetTitle,
  widgetAddChild, widgetSetHeight, widgetSetHidden,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { setBg, setFg, setBtnTint, setBtnFg, detectLanguage, setIconButton } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getStatusBarForeground, getStatusBarBackground } from '../../theme/theme-colors';

// ---------------------------------------------------------------------------
// Module-level state (must be declared BEFORE any function — Perry no-hoist)
// ---------------------------------------------------------------------------

let panelColors: ResolvedUIColors = null as any;

// SHIP-V1-GAPS.md #98 — extension-contributed status-bar items.
// 8 fixed slots (Perry can't dynamically iterate widget arrays cleanly).
// Slots 0–3 sit on the LEFT row (after branch), 4–7 on the RIGHT row
// (before language). Each slot is a pre-allocated borderless Button that
// starts hidden; `registerStatusBarItem` finds the next free slot for the
// requested alignment, configures the button, and shows it.
let customBtn0: unknown = null;
let customBtn1: unknown = null;
let customBtn2: unknown = null;
let customBtn3: unknown = null;
let customBtn4: unknown = null;
let customBtn5: unknown = null;
let customBtn6: unknown = null;
let customBtn7: unknown = null;
let customUsed0: number = 0;
let customUsed1: number = 0;
let customUsed2: number = 0;
let customUsed3: number = 0;
let customUsed4: number = 0;
let customUsed5: number = 0;
let customUsed6: number = 0;
let customUsed7: number = 0;
let customClick0: (() => void) | null = null;
let customClick1: (() => void) | null = null;
let customClick2: (() => void) | null = null;
let customClick3: (() => void) | null = null;
let customClick4: (() => void) | null = null;
let customClick5: (() => void) | null = null;
let customClick6: (() => void) | null = null;
let customClick7: (() => void) | null = null;

let statusBarBranchLabel: unknown = null;
let statusBarDiagLabel: unknown = null;
let statusBarCursorLabel: unknown = null;
let statusBarEncodingLabel: unknown = null;
let statusBarLangLabel: unknown = null;
let statusBarIndentLabel: unknown = null;
let statusBarWidget: unknown = null;
let statusBarUpdateBtn: unknown = null;

/** Format the indent indicator the way VS Code does ("Spaces: 4" / "Tab Size: 4"). */
function formatIndentLabel(tabSize: number, insertSpaces: number): string {
  const prefix = insertSpaces > 0 ? t('Spaces') : t('Tab Size');
  let out = prefix;
  out += ': ';
  out += String(tabSize);
  return out;
}

/**
 * Refresh the status-bar indent indicator from live settings.
 * SHIP-V1-GAPS.md #96 — replaces the hardcoded "Spaces: 2".
 */
export function updateStatusBarIndent(tabSize: number, insertSpaces: number): void {
  const label = formatIndentLabel(tabSize, insertSpaces);
  if (statusBarIndentBtn) {
    buttonSetTitle(statusBarIndentBtn, label);
  } else if (statusBarIndentLabel) {
    textSetString(statusBarIndentLabel, label);
  }
}
let _updateBtnVisible: number = 0;
let _onUpdateBtnClick: (() => void) | null = null;

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
  if (statusBarBranchBtn) {
    buttonSetTitle(statusBarBranchBtn, branch);
  } else if (statusBarBranchLabel) {
    textSetString(statusBarBranchLabel, branch);
  }
}

export function updateStatusBarDiagnostics(errors: number, warnings: number): void {
  if (statusBarDiagLabel) {
    if (errors > 0 || warnings > 0) {
      textSetString(statusBarDiagLabel, errors + ' ' + t('errors') + ', ' + warnings + ' ' + t('warnings'));
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
  else display = t('Plain Text');
  if (statusBarLangBtn) {
    buttonSetTitle(statusBarLangBtn, display);
  } else if (statusBarLangLabel) {
    textSetString(statusBarLangLabel, display);
  }
}

/** SHIP-V1-GAPS.md #73: refresh the EOL label ("LF" or "CRLF"). */
export function updateStatusBarEol(label: string): void {
  if (statusBarEolBtn) {
    buttonSetTitle(statusBarEolBtn, label);
  }
}

/** SHIP-V1-GAPS.md #73: refresh the encoding label (e.g. "UTF-8", "UTF-16 LE"). */
export function updateStatusBarEncoding(label: string): void {
  if (statusBarEncodingBtn) {
    buttonSetTitle(statusBarEncodingBtn, label);
  } else if (statusBarEncodingLabel) {
    textSetString(statusBarEncodingLabel, label);
  }
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
  const lnStr = t('Ln') + ' ' + (line + 1) + ', ' + t('Col') + ' ' + (col + 1);
  textSetString(statusBarCursorLabel, lnStr);
}

/** Show the update indicator button with the new version string. */
export function showUpdateIndicator(version: string): void {
  if (!statusBarUpdateBtn) return;
  let label = t('Update') + ' v';
  label += version;
  textSetString(statusBarUpdateBtn, label);
  widgetSetHidden(statusBarUpdateBtn, 0);
  _updateBtnVisible = 1;
}

/** Set callback for when the update button is clicked. */
export function setUpdateBtnClickHandler(fn: () => void): void {
  _onUpdateBtnClick = fn;
}

function onUpdateBtnClicked(): void {
  if (_onUpdateBtnClick !== null) {
    _onUpdateBtnClick();
  }
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
  if (statusBarUpdateBtn) setBtnTint(statusBarUpdateBtn, getStatusBarForeground());
}

/** Get the status bar widget ref (for recoloring from render.ts). */
export function getStatusBarWidget(): unknown {
  return statusBarWidget;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Clickable status bar items (SHIP-V1-GAPS.md #97).
//
// Each interactive label fires a callback the host can register. v1 wires
// the branch and language slots; encoding/EOL/indent pickers can use the
// same pattern once their picker UIs land.
// ---------------------------------------------------------------------------

let _onBranchClick: () => void = _noopVoid;
let _onLanguageClick: () => void = _noopVoid;
let _onEncodingClick: () => void = _noopVoid;
let _onEolClick: () => void = _noopVoid;
let _onIndentClick: () => void = _noopVoid;
function _noopVoid(): void {}

export function setOnBranchClick(fn: () => void): void { _onBranchClick = fn; }
export function setOnLanguageClick(fn: () => void): void { _onLanguageClick = fn; }
export function setOnEncodingClick(fn: () => void): void { _onEncodingClick = fn; }
export function setOnEolClick(fn: () => void): void { _onEolClick = fn; }
export function setOnIndentClick(fn: () => void): void { _onIndentClick = fn; }

let statusBarBranchBtn: unknown = null;
let statusBarLangBtn: unknown = null;
let statusBarEncodingBtn: unknown = null;
let statusBarEolBtn: unknown = null;
let statusBarIndentBtn: unknown = null;

// ---------------------------------------------------------------------------
// Custom status-bar items (SHIP-V1-GAPS.md #98)
// ---------------------------------------------------------------------------

function getCustomBtn(idx: number): unknown {
  if (idx === 0) return customBtn0;
  if (idx === 1) return customBtn1;
  if (idx === 2) return customBtn2;
  if (idx === 3) return customBtn3;
  if (idx === 4) return customBtn4;
  if (idx === 5) return customBtn5;
  if (idx === 6) return customBtn6;
  if (idx === 7) return customBtn7;
  return null;
}

function getCustomUsed(idx: number): number {
  if (idx === 0) return customUsed0;
  if (idx === 1) return customUsed1;
  if (idx === 2) return customUsed2;
  if (idx === 3) return customUsed3;
  if (idx === 4) return customUsed4;
  if (idx === 5) return customUsed5;
  if (idx === 6) return customUsed6;
  if (idx === 7) return customUsed7;
  return 0;
}

function setCustomUsed(idx: number, used: number): void {
  if (idx === 0) customUsed0 = used;
  if (idx === 1) customUsed1 = used;
  if (idx === 2) customUsed2 = used;
  if (idx === 3) customUsed3 = used;
  if (idx === 4) customUsed4 = used;
  if (idx === 5) customUsed5 = used;
  if (idx === 6) customUsed6 = used;
  if (idx === 7) customUsed7 = used;
}

function setCustomClick(idx: number, fn: (() => void) | null): void {
  if (idx === 0) customClick0 = fn;
  if (idx === 1) customClick1 = fn;
  if (idx === 2) customClick2 = fn;
  if (idx === 3) customClick3 = fn;
  if (idx === 4) customClick4 = fn;
  if (idx === 5) customClick5 = fn;
  if (idx === 6) customClick6 = fn;
  if (idx === 7) customClick7 = fn;
}

function onCustomClick0(): void { if (customClick0) customClick0(); }
function onCustomClick1(): void { if (customClick1) customClick1(); }
function onCustomClick2(): void { if (customClick2) customClick2(); }
function onCustomClick3(): void { if (customClick3) customClick3(); }
function onCustomClick4(): void { if (customClick4) customClick4(); }
function onCustomClick5(): void { if (customClick5) customClick5(); }
function onCustomClick6(): void { if (customClick6) customClick6(); }
function onCustomClick7(): void { if (customClick7) customClick7(); }

/**
 * Register a custom status-bar item.
 *   alignment: 1 = Left (slots 0–3), 2 = Right (slots 4–7).
 *   Returns slot index 0–7, or -1 if no free slot for that alignment.
 */
export function registerStatusBarItem(
  alignment: number, text: string, onClick: (() => void) | null
): number {
  const start = alignment === 2 ? 4 : 0;
  const end = alignment === 2 ? 8 : 4;
  for (let i = start; i < end; i++) {
    if (getCustomUsed(i) < 1) {
      const btn = getCustomBtn(i);
      if (!btn) return -1;
      buttonSetTitle(btn, text);
      setCustomClick(i, onClick);
      setCustomUsed(i, 1);
      widgetSetHidden(btn, 0);
      return i;
    }
  }
  return -1;
}

/** Update text on a previously-registered item. */
export function updateStatusBarItemText(idx: number, text: string): void {
  const btn = getCustomBtn(idx);
  if (!btn) return;
  if (getCustomUsed(idx) < 1) return;
  buttonSetTitle(btn, text);
}

/** Release a slot — hides the button and clears its click handler. */
export function disposeStatusBarItem(idx: number): void {
  const btn = getCustomBtn(idx);
  if (!btn) return;
  widgetSetHidden(btn, 1);
  setCustomClick(idx, null);
  setCustomUsed(idx, 0);
}

function buildCustomBtn(idx: number, colors: ResolvedUIColors): unknown {
  let cb: () => void = onCustomClick0;
  if (idx === 1) cb = onCustomClick1;
  if (idx === 2) cb = onCustomClick2;
  if (idx === 3) cb = onCustomClick3;
  if (idx === 4) cb = onCustomClick4;
  if (idx === 5) cb = onCustomClick5;
  if (idx === 6) cb = onCustomClick6;
  if (idx === 7) cb = onCustomClick7;
  const btn = Button('', () => { cb(); });
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 11);
  setBtnFg(btn, getStatusBarForeground());
  widgetSetHidden(btn, 1);
  return btn;
}

export function renderStatusBar(colors: ResolvedUIColors): unknown {
  panelColors = colors;

  // Branch icon + label — single borderless button so the whole row is clickable.
  const branchBtn = Button(t('main'), () => { _onBranchClick(); });
  buttonSetBordered(branchBtn, 0);
  setIconButton(branchBtn, 'arrow.triangle.branch');
  buttonSetImagePosition(branchBtn, 1);
  textSetFontSize(branchBtn, 11);
  setBtnTint(branchBtn, getStatusBarForeground());
  setBtnFg(branchBtn, getStatusBarForeground());
  statusBarBranchBtn = branchBtn;
  statusBarBranchLabel = branchBtn; // updateStatusBarBranchLabel uses textSetString — Button supports it via setTitle

  const branchRow = HStack(2, [branchBtn]);

  // Diagnostics
  const diagLabel = Text('');
  textSetFontSize(diagLabel, 11);
  setFg(diagLabel, getStatusBarForeground());
  statusBarDiagLabel = diagLabel;

  // Cursor position
  const cursorLabel = Text(t('Ln') + ' 1, ' + t('Col') + ' 1');
  textSetFontSize(cursorLabel, 11);
  setFg(cursorLabel, getStatusBarForeground());
  statusBarCursorLabel = cursorLabel;

  // Indent size — initial label reflects current settings; refreshed via
  // `updateStatusBarIndent` when settings change. SHIP-V1-GAPS.md #96.
  const indentLabel = Text(formatIndentLabel(2, 1));
  textSetFontSize(indentLabel, 11);
  setFg(indentLabel, getStatusBarForeground());
  statusBarIndentLabel = indentLabel;

  // Encoding (clickable: SHIP-V1-GAPS.md #97)
  const encodingBtn = Button('UTF-8', () => { _onEncodingClick(); });
  buttonSetBordered(encodingBtn, 0);
  textSetFontSize(encodingBtn, 11);
  setBtnFg(encodingBtn, getStatusBarForeground());
  statusBarEncodingBtn = encodingBtn;
  statusBarEncodingLabel = encodingBtn;

  // Line endings (clickable)
  const eolBtn = Button('LF', () => { _onEolClick(); });
  buttonSetBordered(eolBtn, 0);
  textSetFontSize(eolBtn, 11);
  setBtnFg(eolBtn, getStatusBarForeground());
  statusBarEolBtn = eolBtn;

  // Indent (clickable) — replaces the plain Text we created above
  // so the indent display becomes a picker target. The earlier Text widget
  // is kept in `statusBarIndentLabel` as a fallback for environments where
  // Button title updates fail; update path prefers the Button when present.
  const indentBtn = Button(formatIndentLabel(2, 1), () => { _onIndentClick(); });
  buttonSetBordered(indentBtn, 0);
  textSetFontSize(indentBtn, 11);
  setBtnFg(indentBtn, getStatusBarForeground());
  statusBarIndentBtn = indentBtn;
  statusBarIndentLabel = indentBtn;

  // Language (clickable)
  const lang = Button(t('TypeScript'), () => { _onLanguageClick(); });
  buttonSetBordered(lang, 0);
  textSetFontSize(lang, 11);
  setBtnFg(lang, getStatusBarForeground());
  statusBarLangBtn = lang;
  statusBarLangLabel = lang;

  // Update indicator (hidden until update is available)
  const updateBtn = Button('', () => { onUpdateBtnClicked(); });
  buttonSetBordered(updateBtn, 0);
  textSetFontSize(updateBtn, 11);
  setBtnTint(updateBtn, '#4EC9B0');
  widgetSetHidden(updateBtn, 1);
  statusBarUpdateBtn = updateBtn;

  // Custom extension slots — 4 left-aligned after branch, 4 right-aligned before language.
  customBtn0 = buildCustomBtn(0, colors);
  customBtn1 = buildCustomBtn(1, colors);
  customBtn2 = buildCustomBtn(2, colors);
  customBtn3 = buildCustomBtn(3, colors);
  customBtn4 = buildCustomBtn(4, colors);
  customBtn5 = buildCustomBtn(5, colors);
  customBtn6 = buildCustomBtn(6, colors);
  customBtn7 = buildCustomBtn(7, colors);

  const bar = HStackWithInsets(12, 0, 8, 0, 8);
  widgetAddChild(bar, branchRow);
  widgetAddChild(bar, customBtn0);
  widgetAddChild(bar, customBtn1);
  widgetAddChild(bar, customBtn2);
  widgetAddChild(bar, customBtn3);
  widgetAddChild(bar, Spacer());
  widgetAddChild(bar, diagLabel);
  widgetAddChild(bar, cursorLabel);
  widgetAddChild(bar, indentBtn);
  widgetAddChild(bar, eolBtn);
  widgetAddChild(bar, encodingBtn);
  widgetAddChild(bar, customBtn4);
  widgetAddChild(bar, customBtn5);
  widgetAddChild(bar, customBtn6);
  widgetAddChild(bar, customBtn7);
  widgetAddChild(bar, updateBtn);
  widgetAddChild(bar, lang);
  setBg(bar, getStatusBarBackground());
  widgetSetHeight(bar, 25);
  statusBarWidget = bar;

  return bar;
}

