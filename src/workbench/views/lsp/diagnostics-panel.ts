/**
 * Diagnostics panel — Problems panel showing LSP diagnostics.
 */
import {
  VStack, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  buttonSetBordered,
  widgetAddChild, widgetClearChildren,
} from 'perry/ui';
import { setFg, setBtnFg, getFileName } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

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
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  const hint = Text('No problems detected');
  textSetFontSize(hint, 12);
  setFg(hint, colors.sideBarForeground);
  widgetAddChild(container, hint);

  widgetAddChild(container, Spacer());
}

export function updateDiagnostics(diagnostics: { file: string; line: number; message: string; severity: string }[]): void {
  if (diagReady < 1 || !diagContainer) return;
  widgetClearChildren(diagContainer);

  const title = Text('PROBLEMS');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  if (diagColors) setFg(title, diagColors.sideBarForeground);
  widgetAddChild(diagContainer, title);

  if (diagnostics.length < 1) {
    const hint = Text('No problems detected');
    textSetFontSize(hint, 12);
    if (diagColors) setFg(hint, diagColors.sideBarForeground);
    widgetAddChild(diagContainer, hint);
    return;
  }

  for (let i = 0; i < diagnostics.length; i++) {
    const d = diagnostics[i];
    const fname = getFileName(d.file);
    let severityColor = '#CCCCCC';
    if (d.severity === 'error') severityColor = '#E57373';
    if (d.severity === 'warning') severityColor = '#E2C08D';
    if (d.severity === 'info') severityColor = '#73C991';

    const severityLabel = Text(d.severity.charAt(0).toUpperCase());
    textSetFontSize(severityLabel, 11);
    textSetFontFamily(severityLabel, 11, 'Menlo');
    setFg(severityLabel, severityColor);

    const filePath = d.file;
    const msgBtn = Button(d.message, () => {
      _fileOpener(filePath, fname);
    });
    buttonSetBordered(msgBtn, 0);
    textSetFontSize(msgBtn, 11);
    if (diagColors) setBtnFg(msgBtn, diagColors.sideBarForeground);

    const row = HStack(4, [severityLabel, msgBtn]);
    widgetAddChild(diagContainer, row);
  }

  widgetAddChild(diagContainer, Spacer());
}
