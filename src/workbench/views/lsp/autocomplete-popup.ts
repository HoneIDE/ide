/**
 * Autocomplete popup — floating completion list triggered by LSP.
 */
import {
  VStack, Text, Button, Spacer,
  textSetFontSize, textSetFontFamily,
  buttonSetBordered,
  widgetAddChild, widgetClearChildren, widgetSetWidth, widgetSetHidden,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getEditorBackground, getEditorForeground } from '../../theme/theme-colors';

let popupWidget: unknown = null;
let popupReady: number = 0;
let popupColors: ResolvedUIColors = null as any;

let _onAccept: (text: string) => void = () => {};

export function setAutocompleteAcceptHandler(fn: (text: string) => void): void {
  _onAccept = fn;
}

function onItemClick(text: string): void {
  _onAccept(text);
  hideAutocomplete();
}

export function createAutocompletePopup(colors: ResolvedUIColors): unknown {
  popupColors = colors;
  const popup = VStack(1, []);
  setBg(popup, getEditorBackground());
  widgetSetWidth(popup, 250);
  widgetSetHidden(popup, 1);
  popupWidget = popup;
  popupReady = 1;
  return popup;
}

export function showAutocomplete(items: string[]): void {
  if (popupReady < 1 || !popupWidget) return;
  widgetClearChildren(popupWidget);
  for (let i = 0; i < items.length; i++) {
    const text = items[i];
    const btn = Button(text, () => { onItemClick(text); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 12);
    textSetFontFamily(btn, 12, 'Menlo');
    if (popupColors) setBtnFg(btn, getEditorForeground());
    widgetAddChild(popupWidget, btn);
  }
  widgetSetHidden(popupWidget, 0);
}

export function hideAutocomplete(): void {
  if (popupWidget) {
    widgetSetHidden(popupWidget, 1);
  }
}
