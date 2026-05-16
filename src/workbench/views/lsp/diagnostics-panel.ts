/**
 * Diagnostics panel — Problems panel showing LSP diagnostics.
 * Uses parallel arrays (Perry-friendly — no object property access needed).
 */
import {
  VStack, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  buttonSetBordered,
  widgetAddChild, widgetClearChildren,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { setFg, setBtnFg, getFileName, monoFont } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getStatusAddedColor, getStatusModifiedColor, getStatusDeletedColor, getSecondaryTextColor } from '../../theme/theme-colors';

let diagContainer: unknown = null;
let diagColors: ResolvedUIColors = null as any;
let diagReady: number = 0;

// File opener callback
let _fileOpener: (path: string, name: string) => void = () => {};

export function setDiagnosticsFileOpener(fn: (path: string, name: string) => void): void {
  _fileOpener = fn;
}

export function renderDiagnosticsPanel(container: unknown, colors: ResolvedUIColors): void {
  diagColors = colors;
  diagContainer = container;
  diagReady = 1;

  const title = Text(t('PROBLEMS'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(container, title);

  const hint = Text(t('No problems detected'));
  textSetFontSize(hint, 12);
  setFg(hint, getSideBarForeground());
  widgetAddChild(container, hint);

  widgetAddChild(container, Spacer());
}

// Parallel arrays for diagnostic data
let _dFiles: string[] = [];
let _dLines: number[] = [];
let _dMessages: string[] = [];
let _dSeverities: string[] = [];
let _dCount: number = 0;

// Update callback registration
let _onUpdateCallback: (() => void) | null = null;

export function onDiagnosticsUpdate(fn: () => void): void {
  _onUpdateCallback = fn;
}

export function getDiagFiles(): string[] { return _dFiles; }
export function getDiagLines(): number[] { return _dLines; }
export function getDiagMessages(): string[] { return _dMessages; }
export function getDiagSeverities(): string[] { return _dSeverities; }
export function getDiagCount(): number { return _dCount; }

// Project-wide severity totals over the WHOLE aggregate (not one
// notification). Used by the status bar so its error/warning count reflects
// every file, not just whichever file the LSP server published last.
export function getDiagErrorCount(): number {
  let n = 0;
  for (let i = 0; i < _dCount; i++) {
    if (_dSeverities[i].length > 0 && _dSeverities[i].charCodeAt(0) === 101) n = n + 1; // 'e'
  }
  return n;
}
export function getDiagWarningCount(): number {
  let n = 0;
  for (let i = 0; i < _dCount; i++) {
    if (_dSeverities[i].length > 0 && _dSeverities[i].charCodeAt(0) === 119) n = n + 1; // 'w'
  }
  return n;
}

/**
 * Per-file diagnostics replace within the aggregate. LSP servers publish
 * diagnostics PER FILE (tsgo/tsserver stream them for the whole program one
 * file at a time). The old flow funnelled every per-file publish through
 * `updateDiagnostics`, a wholesale replace — so the Problems panel only ever
 * showed the LAST-published file's diagnostics (every other file's vanished)
 * and flickered as the server streamed. This replaces ONLY `filePath`'s
 * entries (drop all old ones for it, append the new set — which may be empty
 * to clear that file because it was fixed), keeping every other file's
 * diagnostics intact. The status bar then reads project-wide totals via
 * getDiagError/WarningCount. `updateDiagnostics` is retained as the
 * whole-replace primitive for the no-LSP fallback-tsc path (it emits the
 * entire project's diagnostics in one shot — whole-replace is correct there).
 */
export function setFileDiagnostics(
  filePath: string,
  lines: number[],
  messages: string[],
  severities: string[],
  count: number
): void {
  const nf: string[] = [];
  const nl: number[] = [];
  const nm: string[] = [];
  const ns: string[] = [];
  let nc = 0;
  // Keep every existing entry that belongs to a DIFFERENT file.
  for (let i = 0; i < _dCount; i++) {
    let same = 0;
    if (_dFiles[i].length === filePath.length) {
      same = 1;
      for (let j = 0; j < filePath.length; j++) {
        if (_dFiles[i].charCodeAt(j) !== filePath.charCodeAt(j)) { same = 0; break; }
      }
    }
    if (same < 1) {
      nf.push(_dFiles[i]);
      nl.push(_dLines[i]);
      nm.push(_dMessages[i]);
      ns.push(_dSeverities[i]);
      nc = nc + 1;
    }
  }
  // Append this file's new diagnostics (count may be 0 → pure clear).
  for (let k = 0; k < count; k++) {
    nf.push(filePath);
    nl.push(lines[k]);
    nm.push(messages[k]);
    ns.push(severities[k]);
    nc = nc + 1;
  }
  _dFiles = nf;
  _dLines = nl;
  _dMessages = nm;
  _dSeverities = ns;
  _dCount = nc;
  refreshDiagnosticsUI();
  if (_onUpdateCallback) _onUpdateCallback();
}

export function updateDiagnostics(
  files: string[],
  lines: number[],
  messages: string[],
  severities: string[],
  count: number
): void {
  _dFiles = files;
  _dLines = lines;
  _dMessages = messages;
  _dSeverities = severities;
  _dCount = count;
  refreshDiagnosticsUI();
  if (_onUpdateCallback) _onUpdateCallback();
}

function refreshDiagnosticsUI(): void {
  if (diagReady < 1 || !diagContainer) return;
  widgetClearChildren(diagContainer);

  const title = Text(t('PROBLEMS'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  if (diagColors) setFg(title, getSideBarForeground());
  widgetAddChild(diagContainer, title);

  if (_dCount < 1) {
    const hint = Text(t('No problems detected'));
    textSetFontSize(hint, 12);
    if (diagColors) setFg(hint, getSideBarForeground());
    widgetAddChild(diagContainer, hint);
    return;
  }

  for (let i = 0; i < _dCount; i++) {
    const sev = _dSeverities[i];
    const file = _dFiles[i];
    const msg = _dMessages[i];

    // Determine severity color using charCodeAt (Perry-reliable)
    let severityColor = getSecondaryTextColor();
    let severityChar = '?';
    if (sev.charCodeAt(0) === 101) { // 'e' for error
      severityColor = getStatusDeletedColor();
      severityChar = 'E';
    }
    if (sev.charCodeAt(0) === 119) { // 'w' for warning
      severityColor = getStatusModifiedColor();
      severityChar = 'W';
    }
    if (sev.charCodeAt(0) === 105) { // 'i' for info
      severityColor = getStatusAddedColor();
      severityChar = 'I';
    }

    const severityLabel = Text(severityChar);
    textSetFontSize(severityLabel, 11);
    textSetFontFamily(severityLabel, 11, monoFont());
    setFg(severityLabel, severityColor);

    const fname = getFileName(file);
    const filePath = file;
    const msgBtn = Button(msg, () => {
      openDiagFile(filePath, fname);
    });
    buttonSetBordered(msgBtn, 0);
    textSetFontSize(msgBtn, 11);
    if (diagColors) setBtnFg(msgBtn, getSideBarForeground());

    const row = HStack(4, [severityLabel, msgBtn]);
    widgetAddChild(diagContainer, row);
  }

  widgetAddChild(diagContainer, Spacer());
}

function openDiagFile(path: string, name: string): void {
  _fileOpener(path, name);
}
