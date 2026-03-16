/**
 * Hover popup — floating tooltip showing type info and documentation.
 * Triggered when cursor dwells on a symbol for 500ms.
 *
 * Perry-safe: module-level state, no closures on `this`.
 */
import {
  VStack, VStackWithInsets, Text,
  textSetFontSize, textSetFontFamily, textSetFontWeight,
  widgetAddChild, widgetClearChildren, widgetSetWidth, widgetSetHidden,
  widgetSetBackgroundColor,
} from 'perry/ui';
import { setFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getEditorBackground, getEditorForeground, getInputBorder } from '../../theme/theme-colors';

let hoverWidget: unknown = null;
let hoverReady: number = 0;
let hoverVisible: number = 0;

export function createHoverPopup(_colors: ResolvedUIColors): unknown {
  const popup = VStackWithInsets(4, 6, 8, 6, 8);
  widgetSetBackgroundColor(popup, 0.15, 0.15, 0.17, 0.97);
  widgetSetWidth(popup, 400);
  widgetSetHidden(popup, 1);
  hoverWidget = popup;
  hoverReady = 1;
  return popup;
}

export function showHoverPopup(content: string): void {
  if (hoverReady < 1 || !hoverWidget) return;
  if (content.length < 1) return;

  widgetClearChildren(hoverWidget);

  // Split content by newlines — first line is type/signature, rest is docs
  let firstNewline = -1;
  for (let i = 0; i < content.length; i = i + 1) {
    if (content.charCodeAt(i) === 10) {
      firstNewline = i;
      break;
    }
  }

  let typeLine = content;
  let docText = '';
  if (firstNewline > 0) {
    typeLine = content.slice(0, firstNewline);
    docText = content.slice(firstNewline + 1);
  }

  // Type/signature line — monospace, bold
  if (typeLine.length > 0) {
    const typeLabel = Text(typeLine);
    textSetFontSize(typeLabel, 12);
    textSetFontFamily(typeLabel, 12, 'Menlo');
    textSetFontWeight(typeLabel, 12, 0.5);
    setFg(typeLabel, '#e0e0e0');
    widgetAddChild(hoverWidget, typeLabel);
  }

  // Documentation text — regular font
  if (docText.length > 0) {
    // Trim leading/trailing whitespace from docText
    let trimmed = docText;
    while (trimmed.length > 0 && trimmed.charCodeAt(0) === 10) {
      trimmed = trimmed.slice(1);
    }
    if (trimmed.length > 0) {
      const docLabel = Text(trimmed);
      textSetFontSize(docLabel, 12);
      setFg(docLabel, '#a0a0a0');
      widgetAddChild(hoverWidget, docLabel);
    }
  }

  widgetSetHidden(hoverWidget, 0);
  hoverVisible = 1;
}

export function hideHoverPopup(): void {
  if (hoverWidget) {
    widgetSetHidden(hoverWidget, 1);
    hoverVisible = 0;
  }
}

export function isHoverVisible(): number {
  return hoverVisible;
}
