/**
 * Settings tab — full editor-pane settings UI with all 24 settings.
 *
 * All callbacks use module-level functions (Perry captures closures by value).
 * Toggle/cycle/stepper buttons update their label via module-level handle refs.
 * Search filters settings by label/description using charCodeAt case-insensitive match.
 */
import {
  VStack, VStackWithInsets, HStack, HStackWithInsets, Text, Button, Spacer, TextField,
  ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight, textSetString,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetSetWidth, widgetSetHeight,
  widgetClearChildren, widgetSetHugging,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import {
  getWorkbenchSettings, setStringSetting, setNumberSetting, setBoolSetting,
} from '../../settings';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getEditorForeground, getEditorBackground, getPanelBorder, getButtonBackground, getInputPlaceholderForeground } from '../../theme/theme-colors';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _colors: ResolvedUIColors | null = null;
let _contentContainer: unknown = null;
let _searchText: string = '';

// Widget handles — Editor
let _hEdFontSizeVal: unknown = null;
let _hEdTabSizeVal: unknown = null;
let _hEdInsertSpacesBtn: unknown = null;
let _hEdWordWrapBtn: unknown = null;
let _hEdLineNumBtn: unknown = null;
let _hEdCursorStyleBtn: unknown = null;
let _hEdMinimapBtn: unknown = null;
let _hEdFormatOnSaveBtn: unknown = null;

// Widget handles — Workbench
let _hThemeBtn: unknown = null;
let _hSidebarLocBtn: unknown = null;
let _hStatusBarBtn: unknown = null;
let _hActivityBarBtn: unknown = null;

// Widget handles — Files
let _hAutoSaveBtn: unknown = null;
let _hAutoSaveDelayVal: unknown = null;
let _hTrimWsBtn: unknown = null;

// Widget handles — Terminal
let _hTermFontSizeVal: unknown = null;
let _hTermCursorBtn: unknown = null;

// Widget handles — AI
let _hAiInlineBtn: unknown = null;
let _hAiInlineDelayVal: unknown = null;

// Widget handles — Search
let _hSearchIgnoreBtn: unknown = null;
let _hSearchSymlinksBtn: unknown = null;

// Deferred action
let _pendingAction: number = -1;

// ---------------------------------------------------------------------------
// Action callbacks (module-level functions for Perry)
// ---------------------------------------------------------------------------

function onThemeCycle(): void { _pendingAction = 1; setTimeout(() => { deferredAction(); }, 0); }
function onSidebarLocCycle(): void { _pendingAction = 2; setTimeout(() => { deferredAction(); }, 0); }
function onStatusBarToggle(): void { _pendingAction = 3; setTimeout(() => { deferredAction(); }, 0); }
function onActivityBarCycle(): void { _pendingAction = 4; setTimeout(() => { deferredAction(); }, 0); }
function onLineNumCycle(): void { _pendingAction = 5; setTimeout(() => { deferredAction(); }, 0); }
function onEdFontSizeUp(): void { _pendingAction = 6; setTimeout(() => { deferredAction(); }, 0); }
function onEdFontSizeDown(): void { _pendingAction = 7; setTimeout(() => { deferredAction(); }, 0); }
function onEdTabSizeUp(): void { _pendingAction = 8; setTimeout(() => { deferredAction(); }, 0); }
function onEdTabSizeDown(): void { _pendingAction = 9; setTimeout(() => { deferredAction(); }, 0); }
function onInsertSpacesToggle(): void { _pendingAction = 10; setTimeout(() => { deferredAction(); }, 0); }
function onWordWrapCycle(): void { _pendingAction = 11; setTimeout(() => { deferredAction(); }, 0); }
function onCursorStyleCycle(): void { _pendingAction = 12; setTimeout(() => { deferredAction(); }, 0); }
function onMinimapToggle(): void { _pendingAction = 13; setTimeout(() => { deferredAction(); }, 0); }
function onFormatOnSaveToggle(): void { _pendingAction = 14; setTimeout(() => { deferredAction(); }, 0); }
function onAutoSaveCycle(): void { _pendingAction = 15; setTimeout(() => { deferredAction(); }, 0); }
function onAutoSaveDelayUp(): void { _pendingAction = 16; setTimeout(() => { deferredAction(); }, 0); }
function onAutoSaveDelayDown(): void { _pendingAction = 17; setTimeout(() => { deferredAction(); }, 0); }
function onTrimWsToggle(): void { _pendingAction = 18; setTimeout(() => { deferredAction(); }, 0); }
function onTermFontSizeUp(): void { _pendingAction = 19; setTimeout(() => { deferredAction(); }, 0); }
function onTermFontSizeDown(): void { _pendingAction = 20; setTimeout(() => { deferredAction(); }, 0); }
function onTermCursorCycle(): void { _pendingAction = 21; setTimeout(() => { deferredAction(); }, 0); }
function onAiInlineToggle(): void { _pendingAction = 22; setTimeout(() => { deferredAction(); }, 0); }
function onAiInlineDelayUp(): void { _pendingAction = 23; setTimeout(() => { deferredAction(); }, 0); }
function onAiInlineDelayDown(): void { _pendingAction = 24; setTimeout(() => { deferredAction(); }, 0); }
function onSearchIgnoreToggle(): void { _pendingAction = 25; setTimeout(() => { deferredAction(); }, 0); }
function onSearchSymlinksToggle(): void { _pendingAction = 26; setTimeout(() => { deferredAction(); }, 0); }

// ---------------------------------------------------------------------------
// Cycle helpers
// ---------------------------------------------------------------------------

function cycleWordWrap(c: string): string {
  if (c.charCodeAt(0) === 111 && c.length === 3) return 'on';
  if (c.charCodeAt(0) === 111 && c.length === 2) return 'wordWrapColumn';
  if (c.charCodeAt(0) === 119) return 'bounded';
  return 'off';
}

function cycleLineNumbers(c: string): string {
  if (c.charCodeAt(0) === 111 && c.length === 2) return 'off';
  if (c.charCodeAt(0) === 111 && c.length === 3) return 'relative';
  if (c.charCodeAt(0) === 114) return 'interval';
  return 'on';
}

function cycleCursorStyle(c: string): string {
  if (c.charCodeAt(0) === 108 && c.length === 4) return 'block';
  if (c.charCodeAt(0) === 98 && c.length === 5) return 'underline';
  if (c.charCodeAt(0) === 117 && c.length === 9) return 'line-thin';
  if (c.charCodeAt(0) === 108 && c.length === 9) return 'block-outline';
  if (c.charCodeAt(0) === 98 && c.length === 13) return 'underline-thin';
  return 'line';
}

function cycleActivityBar(c: string): string {
  if (c.charCodeAt(0) === 115) return 'top';
  if (c.charCodeAt(0) === 116) return 'bottom';
  if (c.charCodeAt(0) === 98) return 'hidden';
  return 'side';
}

function cycleAutoSave(c: string): string {
  if (c.charCodeAt(0) === 111 && c.length === 3) return 'afterDelay';
  if (c.charCodeAt(0) === 97) return 'onFocusChange';
  if (c.charCodeAt(0) === 111 && c.length === 13) return 'onWindowChange';
  return 'off';
}

function cycleTermCursor(c: string): string {
  if (c.charCodeAt(0) === 98) return 'underline';
  if (c.charCodeAt(0) === 117) return 'line';
  return 'block';
}


// ---------------------------------------------------------------------------
// Deferred action handler
// ---------------------------------------------------------------------------

function deferredAction(): void {
  const action = _pendingAction;
  _pendingAction = -1;
  if (action < 0) return;

  const s = getWorkbenchSettings();

  if (action === 1) {
    const next = s.colorTheme.charCodeAt(5) === 68 ? 'Hone Light' : 'Hone Dark';
    setStringSetting('colorTheme', next);
    if (_hThemeBtn) buttonSetTitle(_hThemeBtn, next);
  }
  if (action === 2) {
    const next = s.sidebarLocation.charCodeAt(0) === 108 ? 'right' : 'left';
    setStringSetting('sidebarLocation', next);
    if (_hSidebarLocBtn) buttonSetTitle(_hSidebarLocBtn, next.charCodeAt(0) === 108 ? 'Left' : 'Right');
  }
  if (action === 3) {
    const next = s.statusBarVisible ? 0 : 1;
    setBoolSetting('statusBarVisible', next);
    if (_hStatusBarBtn) buttonSetTitle(_hStatusBarBtn, next > 0 ? 'Visible' : 'Hidden');
  }
  if (action === 4) {
    const next = cycleActivityBar(s.activityBarLocation);
    setStringSetting('activityBarLocation', next);
    if (_hActivityBarBtn) buttonSetTitle(_hActivityBarBtn, next);
  }
  if (action === 5) {
    const next = cycleLineNumbers(s.editorLineNumbers);
    setStringSetting('editorLineNumbers', next);
    if (_hEdLineNumBtn) buttonSetTitle(_hEdLineNumBtn, next);
  }
  if (action === 6) {
    const next = s.editorFontSize + 1;
    if (next <= 72) {
      setNumberSetting('editorFontSize', next);
      if (_hEdFontSizeVal) textSetString(_hEdFontSizeVal, next.toString());
    }
  }
  if (action === 7) {
    const next = s.editorFontSize - 1;
    if (next >= 8) {
      setNumberSetting('editorFontSize', next);
      if (_hEdFontSizeVal) textSetString(_hEdFontSizeVal, next.toString());
    }
  }
  if (action === 8) {
    const next = s.editorTabSize + 1;
    if (next <= 16) {
      setNumberSetting('editorTabSize', next);
      if (_hEdTabSizeVal) textSetString(_hEdTabSizeVal, next.toString());
    }
  }
  if (action === 9) {
    const next = s.editorTabSize - 1;
    if (next >= 1) {
      setNumberSetting('editorTabSize', next);
      if (_hEdTabSizeVal) textSetString(_hEdTabSizeVal, next.toString());
    }
  }
  if (action === 10) {
    const next = s.editorInsertSpaces ? 0 : 1;
    setBoolSetting('editorInsertSpaces', next);
    if (_hEdInsertSpacesBtn) buttonSetTitle(_hEdInsertSpacesBtn, next > 0 ? 'On' : 'Off');
  }
  if (action === 11) {
    const next = cycleWordWrap(s.editorWordWrap);
    setStringSetting('editorWordWrap', next);
    if (_hEdWordWrapBtn) buttonSetTitle(_hEdWordWrapBtn, next);
  }
  if (action === 12) {
    const next = cycleCursorStyle(s.editorCursorStyle);
    setStringSetting('editorCursorStyle', next);
    if (_hEdCursorStyleBtn) buttonSetTitle(_hEdCursorStyleBtn, next);
  }
  if (action === 13) {
    const next = s.editorMinimapEnabled ? 0 : 1;
    setBoolSetting('editorMinimapEnabled', next);
    if (_hEdMinimapBtn) buttonSetTitle(_hEdMinimapBtn, next > 0 ? 'On' : 'Off');
  }
  if (action === 14) {
    const next = s.editorFormatOnSave ? 0 : 1;
    setBoolSetting('editorFormatOnSave', next);
    if (_hEdFormatOnSaveBtn) buttonSetTitle(_hEdFormatOnSaveBtn, next > 0 ? 'On' : 'Off');
  }
  if (action === 15) {
    const next = cycleAutoSave(s.filesAutoSave);
    setStringSetting('filesAutoSave', next);
    if (_hAutoSaveBtn) buttonSetTitle(_hAutoSaveBtn, next);
  }
  if (action === 16) {
    const next = s.filesAutoSaveDelay + 100;
    setNumberSetting('filesAutoSaveDelay', next);
    if (_hAutoSaveDelayVal) textSetString(_hAutoSaveDelayVal, next.toString());
  }
  if (action === 17) {
    const next = s.filesAutoSaveDelay - 100;
    if (next >= 0) {
      setNumberSetting('filesAutoSaveDelay', next);
      if (_hAutoSaveDelayVal) textSetString(_hAutoSaveDelayVal, next.toString());
    }
  }
  if (action === 18) {
    const next = s.filesTrimTrailingWhitespace ? 0 : 1;
    setBoolSetting('filesTrimTrailingWhitespace', next);
    if (_hTrimWsBtn) buttonSetTitle(_hTrimWsBtn, next > 0 ? 'On' : 'Off');
  }
  if (action === 19) {
    const next = s.terminalFontSize + 1;
    if (next <= 72) {
      setNumberSetting('terminalFontSize', next);
      if (_hTermFontSizeVal) textSetString(_hTermFontSizeVal, next.toString());
    }
  }
  if (action === 20) {
    const next = s.terminalFontSize - 1;
    if (next >= 6) {
      setNumberSetting('terminalFontSize', next);
      if (_hTermFontSizeVal) textSetString(_hTermFontSizeVal, next.toString());
    }
  }
  if (action === 21) {
    const next = cycleTermCursor(s.terminalCursorStyle);
    setStringSetting('terminalCursorStyle', next);
    if (_hTermCursorBtn) buttonSetTitle(_hTermCursorBtn, next);
  }
  if (action === 22) {
    const next = s.aiInlineCompletionEnabled ? 0 : 1;
    setBoolSetting('aiInlineCompletionEnabled', next);
    if (_hAiInlineBtn) buttonSetTitle(_hAiInlineBtn, next > 0 ? 'On' : 'Off');
  }
  if (action === 23) {
    const next = s.aiInlineCompletionDelay + 50;
    if (next <= 5000) {
      setNumberSetting('aiInlineCompletionDelay', next);
      if (_hAiInlineDelayVal) textSetString(_hAiInlineDelayVal, next.toString());
    }
  }
  if (action === 24) {
    const next = s.aiInlineCompletionDelay - 50;
    if (next >= 0) {
      setNumberSetting('aiInlineCompletionDelay', next);
      if (_hAiInlineDelayVal) textSetString(_hAiInlineDelayVal, next.toString());
    }
  }
  if (action === 25) {
    const next = s.searchUseIgnoreFiles ? 0 : 1;
    setBoolSetting('searchUseIgnoreFiles', next);
    if (_hSearchIgnoreBtn) buttonSetTitle(_hSearchIgnoreBtn, next > 0 ? 'On' : 'Off');
  }
  if (action === 26) {
    const next = s.searchFollowSymlinks ? 0 : 1;
    setBoolSetting('searchFollowSymlinks', next);
    if (_hSearchSymlinksBtn) buttonSetTitle(_hSearchSymlinksBtn, next > 0 ? 'On' : 'Off');
  }
}

// ---------------------------------------------------------------------------
// Text field callbacks (module-level for Perry)
// ---------------------------------------------------------------------------

function onFontFamilyChange(text: string): void {
  if (text.length > 0) setStringSetting('editorFontFamily', text);
}

function onAiModelChange(text: string): void {
  if (text.length > 0) setStringSetting('aiModel', text);
}

function onAiApiKeyChange(text: string): void {
  // Only save keys that look like real API keys (at least 20 chars, starts with 'sk-')
  if (text.length > 20) setStringSetting('aiApiKey', text);
}

// Per-provider key callbacks (module-level for Perry)
function onAiKeyAnthropicChange(text: string): void {
  if (text.length > 10) {
    setStringSetting('aiKeyAnthropic', text);
    setStringSetting('aiApiKey', text); // keep legacy in sync
  }
}
function onAiKeyOpenaiChange(text: string): void {
  if (text.length > 10) setStringSetting('aiKeyOpenai', text);
}
function onAiKeyGoogleChange(text: string): void {
  if (text.length > 10) setStringSetting('aiKeyGoogle', text);
}
function onAiKeyDeepseekChange(text: string): void {
  if (text.length > 10) setStringSetting('aiKeyDeepseek', text);
}
function onAiKeyXaiChange(text: string): void {
  if (text.length > 10) setStringSetting('aiKeyXai', text);
}
function onAiOllamaUrlChange(text: string): void {
  if (text.length > 3) setStringSetting('aiOllamaUrl', text);
}
function onAiOllamaModelChange(text: string): void {
  if (text.length > 0) setStringSetting('aiOllamaModel', text);
}
function onAiCustomUrlChange(text: string): void {
  if (text.length > 3) setStringSetting('aiCustomUrl', text);
}
function onAiCustomKeyChange(text: string): void {
  if (text.length > 5) setStringSetting('aiCustomKey', text);
}
function onAiCustomModelChange(text: string): void {
  if (text.length > 0) setStringSetting('aiCustomModel', text);
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

function containsCI(haystack: string, needle: string): number {
  if (needle.length < 1) return 1;
  if (haystack.length < needle.length) return 0;
  const limit = haystack.length - needle.length + 1;
  for (let i = 0; i < limit; i++) {
    let match = 1;
    for (let j = 0; j < needle.length; j++) {
      let a = haystack.charCodeAt(i + j);
      let b = needle.charCodeAt(j);
      if (a >= 65 && a <= 90) a = a + 32;
      if (b >= 65 && b <= 90) b = b + 32;
      if (a !== b) { match = 0; break; }
    }
    if (match > 0) return 1;
  }
  return 0;
}

function matchesSearch(label: string, desc: string): number {
  if (_searchText.length < 1) return 1;
  if (containsCI(label, _searchText) > 0) return 1;
  if (containsCI(desc, _searchText) > 0) return 1;
  return 0;
}

function onSearchChange(text: string): void {
  _searchText = text;
  rebuildContent();
}

// ---------------------------------------------------------------------------
// Row builder helpers
// ---------------------------------------------------------------------------

function makeSection(ctr: unknown, colors: ResolvedUIColors, title: string): void {
  const spacer = VStack(0, []);
  widgetSetHeight(spacer, 8);
  widgetAddChild(ctr, spacer);

  const header = Text(title);
  textSetFontSize(header, 13);
  textSetFontWeight(header, 13, 0.7);
  setFg(header, getEditorForeground());
  widgetAddChild(ctr, header);

  const sep = VStack(0, []);
  widgetSetHeight(sep, 1);
  setBg(sep, getPanelBorder());
  widgetAddChild(ctr, sep);
}

function makeToggleRow(
  ctr: unknown, colors: ResolvedUIColors,
  label: string, desc: string, currentOn: number,
  onClick: () => void,
): unknown {
  const lbl = Text(label);
  textSetFontSize(lbl, 13);
  textSetFontWeight(lbl, 13, 0.5);
  setFg(lbl, getEditorForeground());

  const btn = Button(currentOn > 0 ? 'On' : 'Off', onClick);
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 12);
  setBtnFg(btn, getButtonBackground());
  widgetSetWidth(btn, 70);

  const topRow = HStack(8, [lbl, Spacer(), btn]);

  const descText = Text(desc);
  textSetFontSize(descText, 11);
  setFg(descText, getInputPlaceholderForeground());

  const row = VStackWithInsets(2, 4, 0, 4, 0);
  widgetAddChild(row, topRow);
  widgetAddChild(row, descText);
  widgetAddChild(ctr, row);
  return btn;
}

function makeToggleRowAlt(
  ctr: unknown, colors: ResolvedUIColors,
  label: string, desc: string, onLabel: string, offLabel: string, currentOn: number,
  onClick: () => void,
): unknown {
  const lbl = Text(label);
  textSetFontSize(lbl, 13);
  textSetFontWeight(lbl, 13, 0.5);
  setFg(lbl, getEditorForeground());

  const btn = Button(currentOn > 0 ? onLabel : offLabel, onClick);
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 12);
  setBtnFg(btn, getButtonBackground());
  widgetSetWidth(btn, 70);

  const topRow = HStack(8, [lbl, Spacer(), btn]);

  const descText = Text(desc);
  textSetFontSize(descText, 11);
  setFg(descText, getInputPlaceholderForeground());

  const row = VStackWithInsets(2, 4, 0, 4, 0);
  widgetAddChild(row, topRow);
  widgetAddChild(row, descText);
  widgetAddChild(ctr, row);
  return btn;
}

function makeCycleRow(
  ctr: unknown, colors: ResolvedUIColors,
  label: string, desc: string, currentValue: string,
  onClick: () => void,
): unknown {
  const lbl = Text(label);
  textSetFontSize(lbl, 13);
  textSetFontWeight(lbl, 13, 0.5);
  setFg(lbl, getEditorForeground());

  const btn = Button(currentValue, onClick);
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 12);
  setBtnFg(btn, getButtonBackground());
  widgetSetWidth(btn, 130);

  const topRow = HStack(8, [lbl, Spacer(), btn]);

  const descText = Text(desc);
  textSetFontSize(descText, 11);
  setFg(descText, getInputPlaceholderForeground());

  const row = VStackWithInsets(2, 4, 0, 4, 0);
  widgetAddChild(row, topRow);
  widgetAddChild(row, descText);
  widgetAddChild(ctr, row);
  return btn;
}

function makeStepperRow(
  ctr: unknown, colors: ResolvedUIColors,
  label: string, desc: string, currentValue: number,
  onDown: () => void, onUp: () => void,
): unknown {
  const lbl = Text(label);
  textSetFontSize(lbl, 13);
  textSetFontWeight(lbl, 13, 0.5);
  setFg(lbl, getEditorForeground());

  const downBtn = Button('-', onDown);
  buttonSetBordered(downBtn, 0);
  textSetFontSize(downBtn, 13);
  setBtnFg(downBtn, getEditorForeground());

  const valLabel = Text(currentValue.toString());
  textSetFontSize(valLabel, 12);
  setFg(valLabel, getEditorForeground());
  widgetSetWidth(valLabel, 40);

  const upBtn = Button('+', onUp);
  buttonSetBordered(upBtn, 0);
  textSetFontSize(upBtn, 13);
  setBtnFg(upBtn, getEditorForeground());

  const controls = HStack(4, [downBtn, valLabel, upBtn]);
  const topRow = HStack(8, [lbl, Spacer(), controls]);

  const descText = Text(desc);
  textSetFontSize(descText, 11);
  setFg(descText, getInputPlaceholderForeground());

  const row = VStackWithInsets(2, 4, 0, 4, 0);
  widgetAddChild(row, topRow);
  widgetAddChild(row, descText);
  widgetAddChild(ctr, row);
  return valLabel;
}

function makeTextRow(
  ctr: unknown, colors: ResolvedUIColors,
  label: string, desc: string, value: string,
  onChange: (text: string) => void,
): void {
  const lbl = Text(label);
  textSetFontSize(lbl, 13);
  textSetFontWeight(lbl, 13, 0.5);
  setFg(lbl, getEditorForeground());

  const field = TextField(value, onChange);
  widgetSetWidth(field, 160);

  const topRow = HStack(8, [lbl, Spacer(), field]);

  const descText = Text(desc);
  textSetFontSize(descText, 11);
  setFg(descText, getInputPlaceholderForeground());

  const row = VStackWithInsets(2, 4, 0, 4, 0);
  widgetAddChild(row, topRow);
  widgetAddChild(row, descText);
  widgetAddChild(ctr, row);
}

// ---------------------------------------------------------------------------
// Content builder (called on init and on search change)
// ---------------------------------------------------------------------------

function resetHandles(): void {
  _hEdFontSizeVal = null;
  _hEdTabSizeVal = null;
  _hEdInsertSpacesBtn = null;
  _hEdWordWrapBtn = null;
  _hEdLineNumBtn = null;
  _hEdCursorStyleBtn = null;
  _hEdMinimapBtn = null;
  _hEdFormatOnSaveBtn = null;
  _hThemeBtn = null;
  _hSidebarLocBtn = null;
  _hStatusBarBtn = null;
  _hActivityBarBtn = null;
  _hAutoSaveBtn = null;
  _hAutoSaveDelayVal = null;
  _hTrimWsBtn = null;
  _hTermFontSizeVal = null;
  _hTermCursorBtn = null;
  _hAiInlineBtn = null;
  _hAiInlineDelayVal = null;
  _hSearchIgnoreBtn = null;
  _hSearchSymlinksBtn = null;
}

function rebuildContent(): void {
  if (!_contentContainer || !_colors) return;
  widgetClearChildren(_contentContainer);
  resetHandles();
  buildContent(_contentContainer, _colors);
}

function buildContent(ctr: unknown, colors: ResolvedUIColors): void {
  const s = getWorkbenchSettings();
  let hasEditor = 0;
  let hasWorkbench = 0;
  let hasFiles = 0;
  let hasTerminal = 0;
  let hasAi = 0;
  let hasSearch = 0;

  // ---- Editor ----
  if (matchesSearch('Font Size', 'Controls the font size in pixels') > 0) hasEditor = 1;
  if (matchesSearch('Font Family', 'Controls the font family') > 0) hasEditor = 1;
  if (matchesSearch('Tab Size', 'The number of spaces a tab is equal to') > 0) hasEditor = 1;
  if (matchesSearch('Insert Spaces', 'Insert spaces when pressing Tab') > 0) hasEditor = 1;
  if (matchesSearch('Word Wrap', 'Controls how lines should wrap') > 0) hasEditor = 1;
  if (matchesSearch('Line Numbers', 'Controls the display of line numbers') > 0) hasEditor = 1;
  if (matchesSearch('Cursor Style', 'Controls the cursor style in the editor') > 0) hasEditor = 1;
  if (matchesSearch('Minimap', 'Controls whether the minimap is shown') > 0) hasEditor = 1;
  if (matchesSearch('Format on Save', 'Format the file on save') > 0) hasEditor = 1;

  if (hasEditor > 0) {
    makeSection(ctr, colors, 'Editor');
    if (matchesSearch('Font Size', 'Controls the font size in pixels') > 0)
      _hEdFontSizeVal = makeStepperRow(ctr, colors, 'Font Size', 'Controls the font size in pixels', s.editorFontSize, () => { onEdFontSizeDown(); }, () => { onEdFontSizeUp(); });
    if (matchesSearch('Font Family', 'Controls the font family') > 0)
      makeTextRow(ctr, colors, 'Font Family', 'Controls the font family', s.editorFontFamily, onFontFamilyChange);
    if (matchesSearch('Tab Size', 'The number of spaces a tab is equal to') > 0)
      _hEdTabSizeVal = makeStepperRow(ctr, colors, 'Tab Size', 'The number of spaces a tab is equal to', s.editorTabSize, () => { onEdTabSizeDown(); }, () => { onEdTabSizeUp(); });
    if (matchesSearch('Insert Spaces', 'Insert spaces when pressing Tab') > 0)
      _hEdInsertSpacesBtn = makeToggleRow(ctr, colors, 'Insert Spaces', 'Insert spaces when pressing Tab', s.editorInsertSpaces ? 1 : 0, () => { onInsertSpacesToggle(); });
    if (matchesSearch('Word Wrap', 'Controls how lines should wrap') > 0)
      _hEdWordWrapBtn = makeCycleRow(ctr, colors, 'Word Wrap', 'Controls how lines should wrap', s.editorWordWrap, () => { onWordWrapCycle(); });
    if (matchesSearch('Line Numbers', 'Controls the display of line numbers') > 0)
      _hEdLineNumBtn = makeCycleRow(ctr, colors, 'Line Numbers', 'Controls the display of line numbers', s.editorLineNumbers, () => { onLineNumCycle(); });
    if (matchesSearch('Cursor Style', 'Controls the cursor style in the editor') > 0)
      _hEdCursorStyleBtn = makeCycleRow(ctr, colors, 'Cursor Style', 'Controls the cursor style in the editor', s.editorCursorStyle, () => { onCursorStyleCycle(); });
    if (matchesSearch('Minimap', 'Controls whether the minimap is shown') > 0)
      _hEdMinimapBtn = makeToggleRow(ctr, colors, 'Minimap', 'Controls whether the minimap is shown', s.editorMinimapEnabled ? 1 : 0, () => { onMinimapToggle(); });
    if (matchesSearch('Format on Save', 'Format the file on save') > 0)
      _hEdFormatOnSaveBtn = makeToggleRow(ctr, colors, 'Format on Save', 'Format the file on save', s.editorFormatOnSave ? 1 : 0, () => { onFormatOnSaveToggle(); });
  }

  // ---- Workbench ----
  if (matchesSearch('Color Theme', 'Specifies the color theme') > 0) hasWorkbench = 1;
  if (matchesSearch('Sidebar Location', 'Controls the location of the sidebar') > 0) hasWorkbench = 1;
  if (matchesSearch('Status Bar', 'Controls the visibility of the status bar') > 0) hasWorkbench = 1;
  if (matchesSearch('Activity Bar', 'Controls the position of the activity bar') > 0) hasWorkbench = 1;

  if (hasWorkbench > 0) {
    makeSection(ctr, colors, 'Workbench');
    if (matchesSearch('Color Theme', 'Specifies the color theme') > 0)
      _hThemeBtn = makeCycleRow(ctr, colors, 'Color Theme', 'Specifies the color theme', s.colorTheme, () => { onThemeCycle(); });
    if (matchesSearch('Sidebar Location', 'Controls the location of the sidebar') > 0)
      _hSidebarLocBtn = makeCycleRow(ctr, colors, 'Sidebar Location', 'Controls the location of the sidebar', s.sidebarLocation.charCodeAt(0) === 108 ? 'Left' : 'Right', () => { onSidebarLocCycle(); });
    if (matchesSearch('Status Bar', 'Controls the visibility of the status bar') > 0)
      _hStatusBarBtn = makeToggleRowAlt(ctr, colors, 'Status Bar', 'Controls the visibility of the status bar', 'Visible', 'Hidden', s.statusBarVisible ? 1 : 0, () => { onStatusBarToggle(); });
    if (matchesSearch('Activity Bar', 'Controls the position of the activity bar') > 0)
      _hActivityBarBtn = makeCycleRow(ctr, colors, 'Activity Bar', 'Controls the position of the activity bar', s.activityBarLocation, () => { onActivityBarCycle(); });
  }

  // ---- Files ----
  if (matchesSearch('Auto Save', 'Controls auto save of editors') > 0) hasFiles = 1;
  if (matchesSearch('Auto Save Delay', 'Delay in ms after which a file is auto saved') > 0) hasFiles = 1;
  if (matchesSearch('Trim Trailing Whitespace', 'Remove trailing whitespace on save') > 0) hasFiles = 1;

  if (hasFiles > 0) {
    makeSection(ctr, colors, 'Files');
    if (matchesSearch('Auto Save', 'Controls auto save of editors') > 0)
      _hAutoSaveBtn = makeCycleRow(ctr, colors, 'Auto Save', 'Controls auto save of editors', s.filesAutoSave, () => { onAutoSaveCycle(); });
    if (matchesSearch('Auto Save Delay', 'Delay in ms after which a file is auto saved') > 0)
      _hAutoSaveDelayVal = makeStepperRow(ctr, colors, 'Auto Save Delay', 'Delay in ms after which a file is auto saved', s.filesAutoSaveDelay, () => { onAutoSaveDelayDown(); }, () => { onAutoSaveDelayUp(); });
    if (matchesSearch('Trim Trailing Whitespace', 'Remove trailing whitespace on save') > 0)
      _hTrimWsBtn = makeToggleRow(ctr, colors, 'Trim Trailing Whitespace', 'Remove trailing whitespace on save', s.filesTrimTrailingWhitespace ? 1 : 0, () => { onTrimWsToggle(); });
  }

  // ---- Terminal ----
  if (matchesSearch('Terminal Font Size', 'Controls the font size of the terminal') > 0) hasTerminal = 1;
  if (matchesSearch('Terminal Cursor Style', 'Controls the cursor style of the terminal') > 0) hasTerminal = 1;

  if (hasTerminal > 0) {
    makeSection(ctr, colors, 'Terminal');
    if (matchesSearch('Terminal Font Size', 'Controls the font size of the terminal') > 0)
      _hTermFontSizeVal = makeStepperRow(ctr, colors, 'Terminal Font Size', 'Controls the font size of the terminal', s.terminalFontSize, () => { onTermFontSizeDown(); }, () => { onTermFontSizeUp(); });
    if (matchesSearch('Terminal Cursor Style', 'Controls the cursor style of the terminal') > 0)
      _hTermCursorBtn = makeCycleRow(ctr, colors, 'Terminal Cursor Style', 'Controls the cursor style of the terminal', s.terminalCursorStyle, () => { onTermCursorCycle(); });
  }

  // ---- AI ----
  if (matchesSearch('Anthropic', 'API key for Anthropic Claude models') > 0) hasAi = 1;
  if (matchesSearch('OpenAI', 'API key for OpenAI GPT models') > 0) hasAi = 1;
  if (matchesSearch('Google', 'API key for Google Gemini models') > 0) hasAi = 1;
  if (matchesSearch('DeepSeek', 'API key for DeepSeek models') > 0) hasAi = 1;
  if (matchesSearch('xAI', 'API key for xAI Grok models') > 0) hasAi = 1;
  if (matchesSearch('Ollama', 'Local Ollama server') > 0) hasAi = 1;
  if (matchesSearch('Custom', 'Custom OpenAI-compatible endpoint') > 0) hasAi = 1;
  if (matchesSearch('Inline Completion', 'Enable AI inline code completions') > 0) hasAi = 1;
  if (matchesSearch('Inline Completion Delay', 'Delay in ms before showing completions') > 0) hasAi = 1;

  if (hasAi > 0) {
    makeSection(ctr, colors, 'AI Provider Keys');
    if (matchesSearch('Anthropic', 'API key for Anthropic Claude models') > 0)
      makeTextRow(ctr, colors, 'Anthropic API Key', 'API key for Anthropic Claude models', s.aiKeyAnthropic.length > 8 ? 'sk-...set' : '', onAiKeyAnthropicChange);
    if (matchesSearch('OpenAI', 'API key for OpenAI GPT models') > 0)
      makeTextRow(ctr, colors, 'OpenAI API Key', 'API key for OpenAI GPT models', s.aiKeyOpenai.length > 8 ? 'sk-...set' : '', onAiKeyOpenaiChange);
    if (matchesSearch('Google', 'API key for Google Gemini models') > 0)
      makeTextRow(ctr, colors, 'Google AI API Key', 'API key for Google Gemini models', s.aiKeyGoogle.length > 8 ? '...set' : '', onAiKeyGoogleChange);
    if (matchesSearch('DeepSeek', 'API key for DeepSeek models') > 0)
      makeTextRow(ctr, colors, 'DeepSeek API Key', 'API key for DeepSeek models', s.aiKeyDeepseek.length > 8 ? '...set' : '', onAiKeyDeepseekChange);
    if (matchesSearch('xAI', 'API key for xAI Grok models') > 0)
      makeTextRow(ctr, colors, 'xAI API Key', 'API key for xAI Grok models', s.aiKeyXai.length > 8 ? '...set' : '', onAiKeyXaiChange);

    makeSection(ctr, colors, 'Local / Custom');
    if (matchesSearch('Ollama', 'Local Ollama server') > 0) {
      makeTextRow(ctr, colors, 'Ollama URL', 'URL for local Ollama server', s.aiOllamaUrl, onAiOllamaUrlChange);
      makeTextRow(ctr, colors, 'Ollama Model', 'Model name for Ollama (e.g., llama3:8b)', s.aiOllamaModel, onAiOllamaModelChange);
    }
    if (matchesSearch('Custom', 'Custom OpenAI-compatible endpoint') > 0) {
      makeTextRow(ctr, colors, 'Custom URL', 'Custom OpenAI-compatible API endpoint', s.aiCustomUrl, onAiCustomUrlChange);
      makeTextRow(ctr, colors, 'Custom API Key', 'API key for custom endpoint', s.aiCustomKey.length > 5 ? '...set' : '', onAiCustomKeyChange);
      makeTextRow(ctr, colors, 'Custom Model', 'Model name for custom endpoint', s.aiCustomModel, onAiCustomModelChange);
    }

    makeSection(ctr, colors, 'AI Features');
    if (matchesSearch('Inline Completion', 'Enable AI inline code completions') > 0)
      _hAiInlineBtn = makeToggleRow(ctr, colors, 'Inline Completion', 'Enable AI inline code completions', s.aiInlineCompletionEnabled ? 1 : 0, () => { onAiInlineToggle(); });
    if (matchesSearch('Inline Completion Delay', 'Delay in ms before showing completions') > 0)
      _hAiInlineDelayVal = makeStepperRow(ctr, colors, 'Inline Completion Delay', 'Delay in ms before showing completions', s.aiInlineCompletionDelay, () => { onAiInlineDelayDown(); }, () => { onAiInlineDelayUp(); });
  }

  // ---- Search ----
  if (matchesSearch('Use Ignore Files', 'Use .gitignore files when searching') > 0) hasSearch = 1;
  if (matchesSearch('Follow Symlinks', 'Follow symbolic links while searching') > 0) hasSearch = 1;

  if (hasSearch > 0) {
    makeSection(ctr, colors, 'Search');
    if (matchesSearch('Use Ignore Files', 'Use .gitignore files when searching') > 0)
      _hSearchIgnoreBtn = makeToggleRow(ctr, colors, 'Use Ignore Files', 'Use .gitignore files when searching', s.searchUseIgnoreFiles ? 1 : 0, () => { onSearchIgnoreToggle(); });
    if (matchesSearch('Follow Symlinks', 'Follow symbolic links while searching') > 0)
      _hSearchSymlinksBtn = makeToggleRow(ctr, colors, 'Follow Symlinks', 'Follow symbolic links while searching', s.searchFollowSymlinks ? 1 : 0, () => { onSearchSymlinksToggle(); });
  }
}

// ---------------------------------------------------------------------------
// Main render (exported — replaces old renderSettingsPanel)
// ---------------------------------------------------------------------------

export function renderSettingsTab(container: unknown, colors: ResolvedUIColors): void {
  _colors = colors;
  _searchText = '';

  // Header
  const titleText = Text('Settings');
  textSetFontSize(titleText, 18);
  textSetFontWeight(titleText, 18, 0.6);
  setFg(titleText, getEditorForeground());

  const searchField = TextField('Search settings...', onSearchChange);
  widgetSetWidth(searchField, 220);

  const header = HStackWithInsets(8, 12, 16, 12, 16);
  widgetAddChild(header, titleText);
  widgetAddChild(header, Spacer());
  widgetAddChild(header, searchField);

  // Scrollable content area
  const content = VStackWithInsets(6, 0, 12, 0, 12);
  _contentContainer = content;
  buildContent(content, colors);

  const scroll = ScrollView();
  // Perry: scrollViewSetChild compiles to no-op, use widgetAddChild workaround
  widgetAddChild(scroll, content);
  widgetSetHugging(scroll, 1);

  // Outer container
  const outer = VStack(0, [header, scroll]);
  setBg(outer, getEditorBackground());
  widgetSetHugging(outer, 1);
  widgetAddChild(container, outer);
}
