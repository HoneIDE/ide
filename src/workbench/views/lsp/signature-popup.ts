/**
 * Signature help popup — shows function parameter info inline.
 * Triggered when typing '(' or ',' inside function arguments.
 *
 * Perry-safe: module-level state, no closures on `this`.
 */
import {
  VStack, HStack, VStackWithInsets, Text,
  textSetFontSize, textSetFontFamily, textSetFontWeight,
  widgetAddChild, widgetClearChildren, widgetSetWidth, widgetSetHidden,
  widgetSetBackgroundColor,
} from 'perry/ui';
import { setFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

let sigWidget: unknown = null;
let sigReady: number = 0;
let sigVisible: number = 0;

export function createSignaturePopup(_colors: ResolvedUIColors): unknown {
  const popup = VStackWithInsets(2, 6, 8, 6, 8);
  widgetSetBackgroundColor(popup, 0.15, 0.15, 0.17, 0.97);
  widgetSetWidth(popup, 450);
  widgetSetHidden(popup, 1);
  sigWidget = popup;
  sigReady = 1;
  return popup;
}

/**
 * Show signature help.
 * @param label Full signature string, e.g. "console.log(message: any, ...optionalParams: any[]): void"
 * @param activeParam 0-based index of the active parameter
 * @param documentation Optional function documentation
 */
export function showSignaturePopup(
  label: string,
  activeParam: number,
  documentation: string,
): void {
  if (sigReady < 1 || !sigWidget) return;

  widgetClearChildren(sigWidget);

  // Signature label — monospace
  const sigLabel = Text(label);
  textSetFontSize(sigLabel, 12);
  textSetFontFamily(sigLabel, 12, 'Menlo');
  setFg(sigLabel, '#e0e0e0');
  widgetAddChild(sigWidget, sigLabel);

  // Active parameter indicator
  if (activeParam >= 0) {
    let paramHint = 'Parameter ';
    paramHint += String(activeParam + 1);
    const paramLabel = Text(paramHint);
    textSetFontSize(paramLabel, 11);
    setFg(paramLabel, '#4fc1ff');
    widgetAddChild(sigWidget, paramLabel);
  }

  // Documentation
  if (documentation.length > 0) {
    const docLabel = Text(documentation);
    textSetFontSize(docLabel, 11);
    setFg(docLabel, '#a0a0a0');
    widgetAddChild(sigWidget, docLabel);
  }

  widgetSetHidden(sigWidget, 0);
  sigVisible = 1;
}

export function hideSignaturePopup(): void {
  if (sigWidget) {
    widgetSetHidden(sigWidget, 1);
    sigVisible = 0;
  }
}

export function isSignatureVisible(): number {
  return sigVisible;
}
