/**
 * Settings UI panel — displays editable settings with working controls.
 *
 * All callbacks use module-level functions (Perry captures closures by value).
 * Toggle buttons update their own label via module-level handle references.
 */
import {
  VStack, VStackWithInsets, HStack, HStackWithInsets, Text, Button, Spacer, TextField,
  ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight, textSetString,
  buttonSetBordered, buttonSetTitle, buttonSetTextColor,
  widgetAddChild, widgetSetWidth, widgetSetBackgroundColor,
} from 'perry/ui';
import { setFg, setBtnFg, setBg, hexToRGBA } from '../../ui-helpers';
import { getWorkbenchSettings, updateSettings } from '../../settings';
import type { ResolvedUIColors } from '../../theme/theme-loader';

// Module-level widget handles for live updates
let _themeBtn: unknown = null;
let _sidebarLocBtn: unknown = null;
let _statusBarBtn: unknown = null;
let _lineNumBtn: unknown = null;
let _aiInlineBtn: unknown = null;
let _fontSizeLabel: unknown = null;
let _tabSizeLabel: unknown = null;
let _colors: ResolvedUIColors | null = null;

// Deferred action pattern (Perry RefCell safety)
let _pendingAction: number = -1;

function onThemeToggle(): void {
  _pendingAction = 1;
  setTimeout(() => { deferredAction(); }, 0);
}
function onSidebarLocToggle(): void {
  _pendingAction = 2;
  setTimeout(() => { deferredAction(); }, 0);
}
function onStatusBarToggle(): void {
  _pendingAction = 3;
  setTimeout(() => { deferredAction(); }, 0);
}
function onLineNumToggle(): void {
  _pendingAction = 4;
  setTimeout(() => { deferredAction(); }, 0);
}
function onAiInlineToggle(): void {
  _pendingAction = 5;
  setTimeout(() => { deferredAction(); }, 0);
}
function onFontSizeUp(): void {
  _pendingAction = 6;
  setTimeout(() => { deferredAction(); }, 0);
}
function onFontSizeDown(): void {
  _pendingAction = 7;
  setTimeout(() => { deferredAction(); }, 0);
}
function onTabSizeUp(): void {
  _pendingAction = 8;
  setTimeout(() => { deferredAction(); }, 0);
}
function onTabSizeDown(): void {
  _pendingAction = 9;
  setTimeout(() => { deferredAction(); }, 0);
}

function deferredAction(): void {
  const action = _pendingAction;
  _pendingAction = -1;
  if (action < 0) return;

  const s = getWorkbenchSettings();

  if (action === 1) {
    // Toggle theme
    if (s.colorTheme.charCodeAt(5) === 68) { // 'D' in "Hone Dark"
      updateSettings({ colorTheme: 'Hone Light' });
      if (_themeBtn) buttonSetTitle(_themeBtn, 'Hone Light');
    } else {
      updateSettings({ colorTheme: 'Hone Dark' });
      if (_themeBtn) buttonSetTitle(_themeBtn, 'Hone Dark');
    }
  }
  if (action === 2) {
    // Toggle sidebar location
    if (s.sidebarLocation.charCodeAt(0) === 108) { // 'l'
      updateSettings({ sidebarLocation: 'right' });
      if (_sidebarLocBtn) buttonSetTitle(_sidebarLocBtn, 'Right');
    } else {
      updateSettings({ sidebarLocation: 'left' });
      if (_sidebarLocBtn) buttonSetTitle(_sidebarLocBtn, 'Left');
    }
  }
  if (action === 3) {
    // Toggle status bar
    updateSettings({ statusBarVisible: !s.statusBarVisible });
    if (_statusBarBtn) buttonSetTitle(_statusBarBtn, s.statusBarVisible ? 'Hidden' : 'Visible');
  }
  if (action === 4) {
    // Toggle line numbers
    if (s.editorLineNumbers.charCodeAt(1) === 110) { // 'n' in "on"
      updateSettings({ editorLineNumbers: 'off' });
      if (_lineNumBtn) buttonSetTitle(_lineNumBtn, 'Off');
    } else if (s.editorLineNumbers.charCodeAt(1) === 102) { // 'f' in "off"
      updateSettings({ editorLineNumbers: 'relative' });
      if (_lineNumBtn) buttonSetTitle(_lineNumBtn, 'Relative');
    } else {
      updateSettings({ editorLineNumbers: 'on' });
      if (_lineNumBtn) buttonSetTitle(_lineNumBtn, 'On');
    }
  }
  if (action === 5) {
    // Toggle AI inline
    updateSettings({ aiInlineCompletionEnabled: !s.aiInlineCompletionEnabled });
    if (_aiInlineBtn) buttonSetTitle(_aiInlineBtn, s.aiInlineCompletionEnabled ? 'Off' : 'On');
  }
  if (action === 6) {
    // Font size up
    const next = s.editorFontSize + 1;
    if (next <= 32) {
      updateSettings({ editorFontSize: next });
      if (_fontSizeLabel) textSetString(_fontSizeLabel, next.toString());
    }
  }
  if (action === 7) {
    // Font size down
    const next = s.editorFontSize - 1;
    if (next >= 8) {
      updateSettings({ editorFontSize: next });
      if (_fontSizeLabel) textSetString(_fontSizeLabel, next.toString());
    }
  }
  if (action === 8) {
    // Tab size up
    const next = s.editorTabSize + 1;
    if (next <= 8) {
      updateSettings({ editorTabSize: next });
      if (_tabSizeLabel) textSetString(_tabSizeLabel, next.toString());
    }
  }
  if (action === 9) {
    // Tab size down
    const next = s.editorTabSize - 1;
    if (next >= 1) {
      updateSettings({ editorTabSize: next });
      if (_tabSizeLabel) textSetString(_tabSizeLabel, next.toString());
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSection(container: unknown, colors: ResolvedUIColors, title: string): void {
  const spacer = VStack(0, []);
  widgetSetWidth(spacer, 1);
  widgetAddChild(container, spacer);

  const header = Text(title);
  textSetFontSize(header, 12);
  textSetFontWeight(header, 12, 0.6);
  setFg(header, colors.sideBarForeground);
  widgetAddChild(container, header);
}

function makeToggleRow(
  container: unknown,
  colors: ResolvedUIColors,
  label: string,
  currentValue: string,
  onClick: () => void,
): unknown {
  const lbl = Text(label);
  textSetFontSize(lbl, 12);
  setFg(lbl, colors.sideBarForeground);

  const btn = Button(currentValue, onClick);
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 12);
  setBtnFg(btn, colors.buttonBackground);

  const row = HStack(8, [lbl, Spacer(), btn]);
  widgetAddChild(container, row);
  return btn;
}

function makeStepperRow(
  container: unknown,
  colors: ResolvedUIColors,
  label: string,
  currentValue: number,
  onDown: () => void,
  onUp: () => void,
): unknown {
  const lbl = Text(label);
  textSetFontSize(lbl, 12);
  setFg(lbl, colors.sideBarForeground);

  const downBtn = Button('-', onDown);
  buttonSetBordered(downBtn, 0);
  textSetFontSize(downBtn, 13);
  setBtnFg(downBtn, colors.sideBarForeground);

  const valLabel = Text(currentValue.toString());
  textSetFontSize(valLabel, 12);
  setFg(valLabel, colors.sideBarForeground);
  widgetSetWidth(valLabel, 24);

  const upBtn = Button('+', onUp);
  buttonSetBordered(upBtn, 0);
  textSetFontSize(upBtn, 13);
  setBtnFg(upBtn, colors.sideBarForeground);

  const controls = HStack(4, [downBtn, valLabel, upBtn]);
  const row = HStack(8, [lbl, Spacer(), controls]);
  widgetAddChild(container, row);
  return valLabel;
}

function makeTextRow(
  container: unknown,
  colors: ResolvedUIColors,
  label: string,
  value: string,
  onChange: (text: string) => void,
): void {
  const lbl = Text(label);
  textSetFontSize(lbl, 12);
  setFg(lbl, colors.sideBarForeground);

  const field = TextField(value, onChange);
  widgetSetWidth(field, 140);

  const row = HStack(8, [lbl, Spacer(), field]);
  widgetAddChild(container, row);
}

function makeInfoRow(container: unknown, colors: ResolvedUIColors, label: string, value: string): void {
  const lbl = Text(label);
  textSetFontSize(lbl, 12);
  setFg(lbl, colors.sideBarForeground);

  const val = Text(value);
  textSetFontSize(val, 12);
  setFg(val, colors.sideBarForeground);

  const row = HStack(8, [lbl, Spacer(), val]);
  widgetAddChild(container, row);
}

// ---------------------------------------------------------------------------
// Module-level callbacks for text fields (Perry value capture)
// ---------------------------------------------------------------------------

function onFontFamilyChange(text: string): void {
  if (text.length > 0) {
    updateSettings({ editorFontFamily: text });
  }
}

function onAiProviderChange(text: string): void {
  if (text.length > 0) {
    updateSettings({ aiProvider: text });
  }
}

function onAiModelChange(text: string): void {
  if (text.length > 0) {
    updateSettings({ aiModel: text });
  }
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderSettingsPanel(container: unknown, colors: ResolvedUIColors): void {
  _colors = colors;
  const s = getWorkbenchSettings();

  const title = Text('SETTINGS');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  const content = VStackWithInsets(6, 0, 8, 0, 8);

  // ---- Appearance ----
  makeSection(content, colors, 'Appearance');

  let themeLabel = 'Hone Dark';
  if (s.colorTheme.length > 5 && s.colorTheme.charCodeAt(5) === 76) themeLabel = 'Hone Light'; // 'L'
  _themeBtn = makeToggleRow(content, colors, 'Color Theme', themeLabel, () => { onThemeToggle(); });

  let locLabel = 'Left';
  if (s.sidebarLocation.charCodeAt(0) === 114) locLabel = 'Right'; // 'r'
  _sidebarLocBtn = makeToggleRow(content, colors, 'Sidebar', locLabel, () => { onSidebarLocToggle(); });

  _statusBarBtn = makeToggleRow(content, colors, 'Status Bar', s.statusBarVisible ? 'Visible' : 'Hidden', () => { onStatusBarToggle(); });

  // ---- Editor ----
  makeSection(content, colors, 'Editor');

  _fontSizeLabel = makeStepperRow(content, colors, 'Font Size', s.editorFontSize, () => { onFontSizeDown(); }, () => { onFontSizeUp(); });
  _tabSizeLabel = makeStepperRow(content, colors, 'Tab Size', s.editorTabSize, () => { onTabSizeDown(); }, () => { onTabSizeUp(); });

  makeTextRow(content, colors, 'Font Family', s.editorFontFamily, onFontFamilyChange);

  let lnLabel = 'On';
  if (s.editorLineNumbers.charCodeAt(1) === 102) lnLabel = 'Off'; // 'f' in "off"
  if (s.editorLineNumbers.length > 3) lnLabel = 'Relative';
  _lineNumBtn = makeToggleRow(content, colors, 'Line Numbers', lnLabel, () => { onLineNumToggle(); });

  // ---- AI ----
  makeSection(content, colors, 'AI');

  makeTextRow(content, colors, 'Provider', s.aiProvider, onAiProviderChange);
  makeTextRow(content, colors, 'Model', s.aiModel, onAiModelChange);
  _aiInlineBtn = makeToggleRow(content, colors, 'Inline Completion', s.aiInlineCompletionEnabled ? 'On' : 'Off', () => { onAiInlineToggle(); });

  widgetAddChild(container, content);
}
