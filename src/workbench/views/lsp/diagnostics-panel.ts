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
import { setFg, setBtnFg, getFileName } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground } from '../../theme/theme-colors';

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

  const title = Text('PROBLEMS');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(container, title);

  const hint = Text('No problems detected');
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

  const title = Text('PROBLEMS');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  if (diagColors) setFg(title, getSideBarForeground());
  widgetAddChild(diagContainer, title);

  if (_dCount < 1) {
    const hint = Text('No problems detected');
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
    let severityColor = '#CCCCCC';
    let severityChar = '?';
    if (sev.charCodeAt(0) === 101) { // 'e' for error
      severityColor = '#E57373';
      severityChar = 'E';
    }
    if (sev.charCodeAt(0) === 119) { // 'w' for warning
      severityColor = '#E2C08D';
      severityChar = 'W';
    }
    if (sev.charCodeAt(0) === 105) { // 'i' for info
      severityColor = '#73C991';
      severityChar = 'I';
    }

    const severityLabel = Text(severityChar);
    textSetFontSize(severityLabel, 11);
    textSetFontFamily(severityLabel, 11, 'Menlo');
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
