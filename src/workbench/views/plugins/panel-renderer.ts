/**
 * Declarative UI renderer — converts PanelElement[] to Perry widgets.
 *
 * Plugins return declarative PanelElement arrays; this module maps them
 * to native Perry widgets. Perry-safe: for-loops, no closures on `this`.
 */

import {
  VStack, HStack, Text, Button, Spacer, TextField,
  textSetColor, textSetFontSize, textSetFontWeight, textSetFontFamily,
  buttonSetBordered,
  widgetAddChild, widgetSetWidth, widgetSetHeight, widgetSetBackgroundColor,
} from 'perry/ui';
import { setFg, setBg, setBtnFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

// PanelElement types (mirroring @honeide/sdk types inline for Perry compilation)
// Perry can't import from external packages in compiled mode, so we redefine.

export interface TextElement { type: 'text'; value: string; bold?: number; italic?: number; color?: string; fontSize?: number; }
export interface HeadingElement { type: 'heading'; value: string; level: number; }
export interface ListElement { type: 'list'; items: string[]; ordered?: number; }
export interface ButtonElement { type: 'button'; label: string; variant?: string; commandId?: string; }
export interface SeparatorElement { type: 'separator'; }
export interface ProgressElement { type: 'progress'; value: number; max: number; label?: string; }
export interface CodeBlockElement { type: 'codeBlock'; code: string; language?: string; }
export interface InputElement { type: 'input'; id: string; placeholder?: string; value?: string; }
export interface GroupElement { type: 'group'; direction: string; children: PluginPanelElement[]; gap?: number; }

export type PluginPanelElement =
  | TextElement
  | HeadingElement
  | ListElement
  | ButtonElement
  | SeparatorElement
  | ProgressElement
  | CodeBlockElement
  | InputElement
  | GroupElement;

// Module-level state for command callbacks
let commandCallbacks: Map<string, () => void> = new Map();

/** Register a command callback (called by plugin-commands.ts). */
export function registerCommandCallback(commandId: string, handler: () => void): void {
  commandCallbacks.set(commandId, handler);
}

/** Render an array of PanelElements into a parent container. */
export function renderPanelElements(
  parent: unknown,
  elements: PluginPanelElement[],
  colors: ResolvedUIColors,
): void {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const widget = renderElement(el, colors);
    if (widget !== null) {
      widgetAddChild(parent, widget);
    }
  }
}

/** Render a single PanelElement to a Perry widget. */
function renderElement(el: PluginPanelElement, colors: ResolvedUIColors): unknown {
  if (el.type === 'text') {
    return renderText(el as TextElement, colors);
  }
  if (el.type === 'heading') {
    return renderHeading(el as HeadingElement, colors);
  }
  if (el.type === 'list') {
    return renderList(el as ListElement, colors);
  }
  if (el.type === 'button') {
    return renderButton(el as ButtonElement, colors);
  }
  if (el.type === 'separator') {
    return renderSeparator(colors);
  }
  if (el.type === 'progress') {
    return renderProgress(el as ProgressElement, colors);
  }
  if (el.type === 'codeBlock') {
    return renderCodeBlock(el as CodeBlockElement, colors);
  }
  if (el.type === 'input') {
    return renderInput(el as InputElement, colors);
  }
  if (el.type === 'group') {
    return renderGroup(el as GroupElement, colors);
  }
  return null;
}

function renderText(el: TextElement, colors: ResolvedUIColors): unknown {
  const t = Text(el.value);
  const fontSize = el.fontSize !== undefined ? el.fontSize : 13;
  textSetFontSize(t, fontSize);
  if (el.bold !== undefined && el.bold > 0) {
    textSetFontWeight(t, fontSize, 0.7);
  }
  if (el.color !== undefined) {
    setFg(t, el.color);
  } else {
    setFg(t, colors.sideBarForeground);
  }
  return t;
}

function renderHeading(el: HeadingElement, colors: ResolvedUIColors): unknown {
  const t = Text(el.value);
  let fontSize = 16;
  let weight = 0.7;
  if (el.level === 1) { fontSize = 20; weight = 0.8; }
  if (el.level === 2) { fontSize = 16; weight = 0.7; }
  if (el.level === 3) { fontSize = 14; weight = 0.6; }
  textSetFontSize(t, fontSize);
  textSetFontWeight(t, fontSize, weight);
  setFg(t, colors.sideBarForeground);
  return t;
}

function renderList(el: ListElement, colors: ResolvedUIColors): unknown {
  const stack = VStack(2, []);
  for (let i = 0; i < el.items.length; i++) {
    let prefix = '  ';
    if (el.ordered !== undefined && el.ordered > 0) {
      prefix = String(i + 1);
      prefix += '. ';
    } else {
      prefix = '  ';
    }
    const item = Text(prefix + el.items[i]);
    textSetFontSize(item, 13);
    setFg(item, colors.sideBarForeground);
    widgetAddChild(stack, item);
  }
  return stack;
}

function renderButton(el: ButtonElement, colors: ResolvedUIColors): unknown {
  const cmdId = el.commandId;
  const btn = Button(el.label, () => { onPluginButtonClick(cmdId); });
  buttonSetBordered(btn, 1);
  textSetFontSize(btn, 13);
  if (el.variant === 'danger') {
    setBtnFg(btn, '#FF4444');
  } else if (el.variant === 'primary') {
    setBtnFg(btn, colors.sideBarForeground);
  } else {
    setBtnFg(btn, colors.sideBarForeground);
  }
  return btn;
}

function renderSeparator(colors: ResolvedUIColors): unknown {
  const sep = Text('');
  widgetSetHeight(sep, 1);
  setBg(sep, colors.sideBarForeground);
  return sep;
}

function renderProgress(el: ProgressElement, colors: ResolvedUIColors): unknown {
  const stack = VStack(2, []);
  if (el.label !== undefined) {
    const label = Text(el.label);
    textSetFontSize(label, 11);
    setFg(label, colors.sideBarForeground);
    widgetAddChild(stack, label);
  }
  // Simple text-based progress bar
  const pct = el.max > 0 ? Math.round((el.value / el.max) * 100) : 0;
  let barText = '[';
  const filled = Math.round(pct / 5);
  for (let i = 0; i < 20; i++) {
    if (i < filled) {
      barText += '#';
    } else {
      barText += '-';
    }
  }
  barText += '] ';
  barText += String(pct);
  barText += '%';
  const bar = Text(barText);
  textSetFontSize(bar, 11);
  textSetFontFamily(bar, 'Menlo');
  setFg(bar, colors.sideBarForeground);
  widgetAddChild(stack, bar);
  return stack;
}

function renderCodeBlock(el: CodeBlockElement, colors: ResolvedUIColors): unknown {
  const block = VStack(0, []);
  widgetSetBackgroundColor(block, 0.15, 0.15, 0.15, 1.0);
  const code = Text(el.code);
  textSetFontSize(code, 12);
  textSetFontFamily(code, 'Menlo');
  setFg(code, '#CE9178');
  widgetAddChild(block, code);
  return block;
}

function renderInput(el: InputElement, _colors: ResolvedUIColors): unknown {
  const placeholder = el.placeholder !== undefined ? el.placeholder : '';
  const field = TextField(placeholder, (_text: string) => {});
  return field;
}

function renderGroup(el: GroupElement, colors: ResolvedUIColors): unknown {
  const gap = el.gap !== undefined ? el.gap : 4;
  let container: unknown;
  if (el.direction === 'row') {
    container = HStack(gap, []);
  } else {
    container = VStack(gap, []);
  }
  renderPanelElements(container, el.children, colors);
  return container;
}

/** Module-level function for button click callbacks. Perry-safe. */
function onPluginButtonClick(commandId: string | undefined): void {
  if (commandId === undefined) return;
  const handler = commandCallbacks.get(commandId);
  if (handler !== undefined) {
    handler();
  }
}
