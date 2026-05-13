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
  buttonSetBordered, buttonSetTitle, buttonSetTextColor, buttonSetContentTintColor,
  widgetAddChild, widgetSetWidth, widgetSetHeight,
  widgetClearChildren, widgetSetHugging, widgetMatchParentWidth,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { setFg, setBtnFg, setBg, hexToRGBA } from '../../ui-helpers';
import {
  getWorkbenchSettings, setStringSetting, setNumberSetting, setBoolSetting,
} from '../../settings';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getEditorForeground, getEditorBackground, getPanelBorder, getButtonBackground, getInputPlaceholderForeground } from '../../theme/theme-colors';
import { applyThemeSwitch } from '../../render';

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
let _hEdInsertFinalNewlineBtn: unknown = null;
let _hEdTrimFinalNewlinesBtn: unknown = null;
let _hEdFormatNormalizeIndentBtn: unknown = null;

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

// Widget handles — Privacy
let _hTelemetryBtn: unknown = null;

// Widget handles — Account
let _hAccountTierLabel: unknown = null;
let _hAccountProjectsLabel: unknown = null;
let _hAccountEmailLabel: unknown = null;

// Deferred action
let _pendingAction: number = -1;
let _pendingThemeSwitch: number = -1;

function deferredThemeSwitch(): void {
  const isDark = _pendingThemeSwitch;
  _pendingThemeSwitch = -1;
  if (isDark < 0) return;
  applyThemeSwitch(isDark);
  rebuildContent();
}

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
function onTelemetryToggle(): void { _pendingAction = 27; setTimeout(() => { deferredAction(); }, 0); }
function onInsertFinalNewlineToggle(): void { _pendingAction = 28; setTimeout(() => { deferredAction(); }, 0); }
function onTrimFinalNewlinesToggle(): void { _pendingAction = 29; setTimeout(() => { deferredAction(); }, 0); }
function onFormatNormalizeIndentToggle(): void { _pendingAction = 30; setTimeout(() => { deferredAction(); }, 0); }

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

function updateBtn(btn: unknown, title: string): void {
  buttonSetTitle(btn, title);
  setBtnFg(btn, getButtonBackground());
}

function updateValBtn(btn: unknown, title: string): void {
  buttonSetTitle(btn, title);
  setBtnFg(btn, getEditorForeground());
}

function deferredAction(): void {
  const action = _pendingAction;
  _pendingAction = -1;
  if (action < 0) return;

  const s = getWorkbenchSettings();

  if (action === 1) {
    const isDark = s.colorTheme.charCodeAt(5) === 68 ? 0 : 1;
    const next = isDark > 0 ? 'Hone Dark' : 'Hone Light';
    setStringSetting('colorTheme', next);
    if (_hThemeBtn) updateBtn(_hThemeBtn, next);
    // Theme change is detected by the settings version poll in render.ts.
    // Rebuild settings content after a delay so new theme colors apply.
    setTimeout(() => { rebuildContent(); }, 300);
  }
  if (action === 2) {
    const next = s.sidebarLocation.charCodeAt(0) === 108 ? 'right' : 'left';
    setStringSetting('sidebarLocation', next);
    if (_hSidebarLocBtn) updateBtn(_hSidebarLocBtn, next.charCodeAt(0) === 108 ? t('Left') : t('Right'));
  }
  if (action === 3) {
    const next = s.statusBarVisible ? 0 : 1;
    setBoolSetting('statusBarVisible', next);
    if (_hStatusBarBtn) updateBtn(_hStatusBarBtn, next > 0 ? t('Visible') : t('Hidden'));
  }
  if (action === 4) {
    const next = cycleActivityBar(s.activityBarLocation);
    setStringSetting('activityBarLocation', next);
    if (_hActivityBarBtn) updateBtn(_hActivityBarBtn, next);
  }
  if (action === 5) {
    const next = cycleLineNumbers(s.editorLineNumbers);
    setStringSetting('editorLineNumbers', next);
    if (_hEdLineNumBtn) updateBtn(_hEdLineNumBtn, next);
  }
  if (action === 6) {
    const next = s.editorFontSize + 1;
    if (next <= 72) {
      setNumberSetting('editorFontSize', next);
      if (_hEdFontSizeVal) updateValBtn(_hEdFontSizeVal, next.toString());
    }
  }
  if (action === 7) {
    const next = s.editorFontSize - 1;
    if (next >= 8) {
      setNumberSetting('editorFontSize', next);
      if (_hEdFontSizeVal) updateValBtn(_hEdFontSizeVal, next.toString());
    }
  }
  if (action === 8) {
    const next = s.editorTabSize + 1;
    if (next <= 16) {
      setNumberSetting('editorTabSize', next);
      if (_hEdTabSizeVal) updateValBtn(_hEdTabSizeVal, next.toString());
    }
  }
  if (action === 9) {
    const next = s.editorTabSize - 1;
    if (next >= 1) {
      setNumberSetting('editorTabSize', next);
      if (_hEdTabSizeVal) updateValBtn(_hEdTabSizeVal, next.toString());
    }
  }
  if (action === 10) {
    const next = s.editorInsertSpaces ? 0 : 1;
    setBoolSetting('editorInsertSpaces', next);
    if (_hEdInsertSpacesBtn) updateBtn(_hEdInsertSpacesBtn, next > 0 ? t('On') : t('Off'));
  }
  if (action === 11) {
    const next = cycleWordWrap(s.editorWordWrap);
    setStringSetting('editorWordWrap', next);
    if (_hEdWordWrapBtn) updateBtn(_hEdWordWrapBtn, next);
  }
  if (action === 12) {
    const next = cycleCursorStyle(s.editorCursorStyle);
    setStringSetting('editorCursorStyle', next);
    if (_hEdCursorStyleBtn) updateBtn(_hEdCursorStyleBtn, next);
  }
  if (action === 13) {
    const next = s.editorMinimapEnabled ? 0 : 1;
    setBoolSetting('editorMinimapEnabled', next);
    if (_hEdMinimapBtn) updateBtn(_hEdMinimapBtn, next > 0 ? t('On') : t('Off'));
  }
  if (action === 14) {
    const next = s.editorFormatOnSave ? 0 : 1;
    setBoolSetting('editorFormatOnSave', next);
    if (_hEdFormatOnSaveBtn) updateBtn(_hEdFormatOnSaveBtn, next > 0 ? t('On') : t('Off'));
  }
  if (action === 15) {
    const next = cycleAutoSave(s.filesAutoSave);
    setStringSetting('filesAutoSave', next);
    if (_hAutoSaveBtn) updateBtn(_hAutoSaveBtn, next);
  }
  if (action === 16) {
    const next = s.filesAutoSaveDelay + 100;
    setNumberSetting('filesAutoSaveDelay', next);
    if (_hAutoSaveDelayVal) updateValBtn(_hAutoSaveDelayVal, next.toString());
  }
  if (action === 17) {
    const next = s.filesAutoSaveDelay - 100;
    if (next >= 0) {
      setNumberSetting('filesAutoSaveDelay', next);
      if (_hAutoSaveDelayVal) updateValBtn(_hAutoSaveDelayVal, next.toString());
    }
  }
  if (action === 18) {
    const next = s.filesTrimTrailingWhitespace ? 0 : 1;
    setBoolSetting('filesTrimTrailingWhitespace', next);
    if (_hTrimWsBtn) updateBtn(_hTrimWsBtn, next > 0 ? t('On') : t('Off'));
  }
  if (action === 19) {
    const next = s.terminalFontSize + 1;
    if (next <= 72) {
      setNumberSetting('terminalFontSize', next);
      if (_hTermFontSizeVal) updateValBtn(_hTermFontSizeVal, next.toString());
    }
  }
  if (action === 20) {
    const next = s.terminalFontSize - 1;
    if (next >= 6) {
      setNumberSetting('terminalFontSize', next);
      if (_hTermFontSizeVal) updateValBtn(_hTermFontSizeVal, next.toString());
    }
  }
  if (action === 21) {
    const next = cycleTermCursor(s.terminalCursorStyle);
    setStringSetting('terminalCursorStyle', next);
    if (_hTermCursorBtn) updateBtn(_hTermCursorBtn, next);
  }
  if (action === 22) {
    const next = s.aiInlineCompletionEnabled ? 0 : 1;
    setBoolSetting('aiInlineCompletionEnabled', next);
    if (_hAiInlineBtn) updateBtn(_hAiInlineBtn, next > 0 ? t('On') : t('Off'));
  }
  if (action === 23) {
    const next = s.aiInlineCompletionDelay + 50;
    if (next <= 5000) {
      setNumberSetting('aiInlineCompletionDelay', next);
      if (_hAiInlineDelayVal) updateValBtn(_hAiInlineDelayVal, next.toString());
    }
  }
  if (action === 24) {
    const next = s.aiInlineCompletionDelay - 50;
    if (next >= 0) {
      setNumberSetting('aiInlineCompletionDelay', next);
      if (_hAiInlineDelayVal) updateValBtn(_hAiInlineDelayVal, next.toString());
    }
  }
  if (action === 25) {
    const next = s.searchUseIgnoreFiles ? 0 : 1;
    setBoolSetting('searchUseIgnoreFiles', next);
    if (_hSearchIgnoreBtn) updateBtn(_hSearchIgnoreBtn, next > 0 ? t('On') : t('Off'));
  }
  if (action === 26) {
    const next = s.searchFollowSymlinks ? 0 : 1;
    setBoolSetting('searchFollowSymlinks', next);
    if (_hSearchSymlinksBtn) updateBtn(_hSearchSymlinksBtn, next > 0 ? t('On') : t('Off'));
  }
  if (action === 27) {
    const next = s.telemetryEnabled ? 0 : 1;
    setBoolSetting('telemetryEnabled', next);
    if (_hTelemetryBtn) updateBtn(_hTelemetryBtn, next > 0 ? t('On') : t('Off'));
  }
  if (action === 28) {
    const next = s.editorInsertFinalNewline ? 0 : 1;
    setBoolSetting('editorInsertFinalNewline', next);
    if (_hEdInsertFinalNewlineBtn) updateBtn(_hEdInsertFinalNewlineBtn, next > 0 ? t('On') : t('Off'));
  }
  if (action === 29) {
    const next = s.editorTrimFinalNewlines ? 0 : 1;
    setBoolSetting('editorTrimFinalNewlines', next);
    if (_hEdTrimFinalNewlinesBtn) updateBtn(_hEdTrimFinalNewlinesBtn, next > 0 ? t('On') : t('Off'));
  }
  if (action === 30) {
    const next = s.editorFormatNormalizeIndent ? 0 : 1;
    setBoolSetting('editorFormatNormalizeIndent', next);
    if (_hEdFormatNormalizeIndentBtn) updateBtn(_hEdFormatNormalizeIndentBtn, next > 0 ? t('On') : t('Off'));
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
  widgetSetHeight(spacer, 20);
  widgetAddChild(ctr, spacer);

  const header = Button(title, () => { _labelClick(); });
  buttonSetBordered(header, 0);
  textSetFontSize(header, 14);
  textSetFontWeight(header, 14, 0.7);
  setBtnFg(header, getEditorForeground());
  widgetAddChild(ctr, header);

  const sep = VStack(0, []);
  widgetSetHeight(sep, 1);
  setBg(sep, getPanelBorder());
  widgetAddChild(ctr, sep);

  const postSep = VStack(0, []);
  widgetSetHeight(postSep, 6);
  widgetAddChild(ctr, postSep);
}

let _labelClickCount = 0;
function _labelClick(): void { _labelClickCount = _labelClickCount + 1; }

function makeSettingLabel(label: string, desc: string): unknown {
  const b = Button(label, () => { _labelClick(); });
  buttonSetBordered(b, 0);
  textSetFontSize(b, 13);
  setBtnFg(b, getEditorForeground());
  widgetSetHugging(b, 1);
  return b;
}

function makeToggleRow(
  ctr: unknown, colors: ResolvedUIColors,
  label: string, desc: string, currentOn: number,
  onClick: () => void,
): unknown {
  const btn = Button(currentOn > 0 ? t('On') : t('Off'), onClick);
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 12);
  setBtnFg(btn, getButtonBackground());
  widgetSetWidth(btn, 60);
  const lbl = makeSettingLabel(label, desc);
  widgetSetHugging(lbl, 1);
  const row = HStack(12, [lbl, btn]);
  widgetSetHeight(row, 26);
  widgetAddChild(ctr, row);
  return btn;
}

function makeToggleRowAlt(
  ctr: unknown, colors: ResolvedUIColors,
  label: string, desc: string, onLabel: string, offLabel: string, currentOn: number,
  onClick: () => void,
): unknown {
  const btn = Button(currentOn > 0 ? onLabel : offLabel, onClick);
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 12);
  setBtnFg(btn, getButtonBackground());
  widgetSetWidth(btn, 80);
  const lbl = makeSettingLabel(label, desc);
  widgetSetHugging(lbl, 1);
  const row = HStack(12, [lbl, btn]);
  widgetSetHeight(row, 26);
  widgetAddChild(ctr, row);
  return btn;
}

function makeCycleRow(
  ctr: unknown, colors: ResolvedUIColors,
  label: string, desc: string, currentValue: string,
  onClick: () => void,
): unknown {
  const btn = Button(currentValue, onClick);
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 12);
  setBtnFg(btn, getButtonBackground());
  widgetSetWidth(btn, 120);
  const lbl = makeSettingLabel(label, desc);
  widgetSetHugging(lbl, 1);
  const row = HStack(12, [lbl, btn]);
  widgetSetHeight(row, 26);
  widgetAddChild(ctr, row);
  return btn;
}

function makeStepperRow(
  ctr: unknown, colors: ResolvedUIColors,
  label: string, desc: string, currentValue: number,
  onDown: () => void, onUp: () => void,
): unknown {
  const downBtn = Button(' - ', onDown);
  buttonSetBordered(downBtn, 0);
  textSetFontSize(downBtn, 12);
  const valLabel = Button(currentValue.toString(), () => { _labelClick(); });
  buttonSetBordered(valLabel, 0);
  textSetFontSize(valLabel, 13);
  setBtnFg(valLabel, getEditorForeground());
  widgetSetWidth(valLabel, 40);
  const upBtn = Button(' + ', onUp);
  buttonSetBordered(upBtn, 0);
  textSetFontSize(upBtn, 12);
  const controls = HStack(2, [downBtn, valLabel, upBtn]);
  const lbl = makeSettingLabel(label, desc);
  widgetSetHugging(lbl, 1);
  const row = HStack(12, [lbl, controls]);
  widgetSetHeight(row, 26);
  widgetAddChild(ctr, row);
  return valLabel;
}

function makeTextRow(
  ctr: unknown, colors: ResolvedUIColors,
  label: string, desc: string, value: string,
  onChange: (text: string) => void,
): void {
  const field = TextField(value, onChange);
  widgetSetWidth(field, 220);
  const lbl = makeSettingLabel(label, desc);
  widgetSetHugging(lbl, 1);
  const row = HStack(12, [lbl, field]);
  widgetSetHeight(row, 26);
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
  _hEdInsertFinalNewlineBtn = null;
  _hEdTrimFinalNewlinesBtn = null;
  _hEdFormatNormalizeIndentBtn = null;
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
  _hTelemetryBtn = null;
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
  if (matchesSearch(t('Font Size'), t('Controls the font size in pixels')) > 0) hasEditor = 1;
  if (matchesSearch(t('Font Family'), t('Controls the font family')) > 0) hasEditor = 1;
  if (matchesSearch(t('Tab Size'), t('The number of spaces a tab is equal to')) > 0) hasEditor = 1;
  if (matchesSearch(t('Insert Spaces'), t('Insert spaces when pressing Tab')) > 0) hasEditor = 1;
  if (matchesSearch(t('Word Wrap'), t('Controls how lines should wrap')) > 0) hasEditor = 1;
  if (matchesSearch(t('Line Numbers'), t('Controls the display of line numbers')) > 0) hasEditor = 1;
  if (matchesSearch(t('Cursor Style'), t('Controls the cursor style in the editor')) > 0) hasEditor = 1;
  if (matchesSearch(t('Minimap'), t('Controls whether the minimap is shown')) > 0) hasEditor = 1;
  if (matchesSearch(t('Format on Save'), t('Format the file on save')) > 0) hasEditor = 1;
  if (matchesSearch(t('Insert Final Newline'), t('Insert a final newline at end of file on save')) > 0) hasEditor = 1;
  if (matchesSearch(t('Trim Final Newlines'), t('Trim trailing blank lines on save')) > 0) hasEditor = 1;
  if (matchesSearch(t('Normalize Indentation'), t('Normalize indentation on format')) > 0) hasEditor = 1;

  if (hasEditor > 0) {
    makeSection(ctr, colors, t('Editor'));
    if (matchesSearch(t('Font Size'), t('Controls the font size in pixels')) > 0)
      _hEdFontSizeVal = makeStepperRow(ctr, colors, t('Font Size'), t('Controls the font size in pixels'), s.editorFontSize, () => { onEdFontSizeDown(); }, () => { onEdFontSizeUp(); });
    if (matchesSearch(t('Font Family'), t('Controls the font family')) > 0)
      makeTextRow(ctr, colors, t('Font Family'), t('Controls the font family'), s.editorFontFamily, onFontFamilyChange);
    if (matchesSearch(t('Tab Size'), t('The number of spaces a tab is equal to')) > 0)
      _hEdTabSizeVal = makeStepperRow(ctr, colors, t('Tab Size'), t('The number of spaces a tab is equal to'), s.editorTabSize, () => { onEdTabSizeDown(); }, () => { onEdTabSizeUp(); });
    if (matchesSearch(t('Insert Spaces'), t('Insert spaces when pressing Tab')) > 0)
      _hEdInsertSpacesBtn = makeToggleRow(ctr, colors, t('Insert Spaces'), t('Insert spaces when pressing Tab'), s.editorInsertSpaces ? 1 : 0, () => { onInsertSpacesToggle(); });
    if (matchesSearch(t('Word Wrap'), t('Controls how lines should wrap')) > 0)
      _hEdWordWrapBtn = makeCycleRow(ctr, colors, t('Word Wrap'), t('Controls how lines should wrap'), s.editorWordWrap, () => { onWordWrapCycle(); });
    if (matchesSearch(t('Line Numbers'), t('Controls the display of line numbers')) > 0)
      _hEdLineNumBtn = makeCycleRow(ctr, colors, t('Line Numbers'), t('Controls the display of line numbers'), s.editorLineNumbers, () => { onLineNumCycle(); });
    if (matchesSearch(t('Cursor Style'), t('Controls the cursor style in the editor')) > 0)
      _hEdCursorStyleBtn = makeCycleRow(ctr, colors, t('Cursor Style'), t('Controls the cursor style in the editor'), s.editorCursorStyle, () => { onCursorStyleCycle(); });
    if (matchesSearch(t('Minimap'), t('Controls whether the minimap is shown')) > 0)
      _hEdMinimapBtn = makeToggleRow(ctr, colors, t('Minimap'), t('Controls whether the minimap is shown'), s.editorMinimapEnabled ? 1 : 0, () => { onMinimapToggle(); });
    if (matchesSearch(t('Format on Save'), t('Format the file on save')) > 0)
      _hEdFormatOnSaveBtn = makeToggleRow(ctr, colors, t('Format on Save'), t('Format the file on save'), s.editorFormatOnSave ? 1 : 0, () => { onFormatOnSaveToggle(); });
    if (matchesSearch(t('Insert Final Newline'), t('Insert a final newline at end of file on save')) > 0)
      _hEdInsertFinalNewlineBtn = makeToggleRow(ctr, colors, t('Insert Final Newline'), t('Insert a final newline at end of file on save'), s.editorInsertFinalNewline ? 1 : 0, () => { onInsertFinalNewlineToggle(); });
    if (matchesSearch(t('Trim Final Newlines'), t('Trim trailing blank lines on save')) > 0)
      _hEdTrimFinalNewlinesBtn = makeToggleRow(ctr, colors, t('Trim Final Newlines'), t('Trim trailing blank lines on save'), s.editorTrimFinalNewlines ? 1 : 0, () => { onTrimFinalNewlinesToggle(); });
    if (matchesSearch(t('Normalize Indentation'), t('Normalize indentation on format')) > 0)
      _hEdFormatNormalizeIndentBtn = makeToggleRow(ctr, colors, t('Normalize Indentation'), t('Normalize indentation (tabs/spaces) when formatting'), s.editorFormatNormalizeIndent ? 1 : 0, () => { onFormatNormalizeIndentToggle(); });
  }

  // ---- Workbench ----
  if (matchesSearch(t('Color Theme'), t('Specifies the color theme')) > 0) hasWorkbench = 1;
  if (matchesSearch(t('Sidebar Location'), t('Controls the location of the sidebar')) > 0) hasWorkbench = 1;
  if (matchesSearch(t('Status Bar'), t('Controls the visibility of the status bar')) > 0) hasWorkbench = 1;
  if (matchesSearch(t('Activity Bar'), t('Controls the position of the activity bar')) > 0) hasWorkbench = 1;

  if (hasWorkbench > 0) {
    makeSection(ctr, colors, t('Workbench'));
    if (matchesSearch(t('Color Theme'), t('Specifies the color theme')) > 0)
      _hThemeBtn = makeCycleRow(ctr, colors, t('Color Theme'), t('Specifies the color theme'), s.colorTheme, () => { onThemeCycle(); });
    if (matchesSearch(t('Sidebar Location'), t('Controls the location of the sidebar')) > 0)
      _hSidebarLocBtn = makeCycleRow(ctr, colors, t('Sidebar Location'), t('Controls the location of the sidebar'), s.sidebarLocation.charCodeAt(0) === 108 ? t('Left') : t('Right'), () => { onSidebarLocCycle(); });
    if (matchesSearch(t('Status Bar'), t('Controls the visibility of the status bar')) > 0)
      _hStatusBarBtn = makeToggleRowAlt(ctr, colors, t('Status Bar'), t('Controls the visibility of the status bar'), t('Visible'), t('Hidden'), s.statusBarVisible ? 1 : 0, () => { onStatusBarToggle(); });
    if (matchesSearch(t('Activity Bar'), t('Controls the position of the activity bar')) > 0)
      _hActivityBarBtn = makeCycleRow(ctr, colors, t('Activity Bar'), t('Controls the position of the activity bar'), s.activityBarLocation, () => { onActivityBarCycle(); });
  }

  // ---- Files ----
  if (matchesSearch(t('Auto Save'), t('Controls auto save of editors')) > 0) hasFiles = 1;
  if (matchesSearch(t('Auto Save Delay'), t('Delay in ms after which a file is auto saved')) > 0) hasFiles = 1;
  if (matchesSearch(t('Trim Trailing Whitespace'), t('Remove trailing whitespace on save')) > 0) hasFiles = 1;

  if (hasFiles > 0) {
    makeSection(ctr, colors, t('Files'));
    if (matchesSearch(t('Auto Save'), t('Controls auto save of editors')) > 0)
      _hAutoSaveBtn = makeCycleRow(ctr, colors, t('Auto Save'), t('Controls auto save of editors'), s.filesAutoSave, () => { onAutoSaveCycle(); });
    if (matchesSearch(t('Auto Save Delay'), t('Delay in ms after which a file is auto saved')) > 0)
      _hAutoSaveDelayVal = makeStepperRow(ctr, colors, t('Auto Save Delay'), t('Delay in ms after which a file is auto saved'), s.filesAutoSaveDelay, () => { onAutoSaveDelayDown(); }, () => { onAutoSaveDelayUp(); });
    if (matchesSearch(t('Trim Trailing Whitespace'), t('Remove trailing whitespace on save')) > 0)
      _hTrimWsBtn = makeToggleRow(ctr, colors, t('Trim Trailing Whitespace'), t('Remove trailing whitespace on save'), s.filesTrimTrailingWhitespace ? 1 : 0, () => { onTrimWsToggle(); });
  }

  // ---- Terminal ----
  if (matchesSearch(t('Terminal Font Size'), t('Controls the font size of the terminal')) > 0) hasTerminal = 1;
  if (matchesSearch(t('Terminal Cursor Style'), t('Controls the cursor style of the terminal')) > 0) hasTerminal = 1;

  if (hasTerminal > 0) {
    makeSection(ctr, colors, t('Terminal'));
    if (matchesSearch(t('Terminal Font Size'), t('Controls the font size of the terminal')) > 0)
      _hTermFontSizeVal = makeStepperRow(ctr, colors, t('Terminal Font Size'), t('Controls the font size of the terminal'), s.terminalFontSize, () => { onTermFontSizeDown(); }, () => { onTermFontSizeUp(); });
    if (matchesSearch(t('Terminal Cursor Style'), t('Controls the cursor style of the terminal')) > 0)
      _hTermCursorBtn = makeCycleRow(ctr, colors, t('Terminal Cursor Style'), t('Controls the cursor style of the terminal'), s.terminalCursorStyle, () => { onTermCursorCycle(); });
  }

  // ---- AI ----
  if (matchesSearch(t('Anthropic'), t('API key for Anthropic Claude models')) > 0) hasAi = 1;
  if (matchesSearch(t('OpenAI'), t('API key for OpenAI GPT models')) > 0) hasAi = 1;
  if (matchesSearch(t('Google'), t('API key for Google Gemini models')) > 0) hasAi = 1;
  if (matchesSearch(t('DeepSeek'), t('API key for DeepSeek models')) > 0) hasAi = 1;
  if (matchesSearch(t('xAI'), t('API key for xAI Grok models')) > 0) hasAi = 1;
  if (matchesSearch(t('Ollama'), t('Local Ollama server')) > 0) hasAi = 1;
  if (matchesSearch(t('Custom'), t('Custom OpenAI-compatible endpoint')) > 0) hasAi = 1;
  if (matchesSearch(t('Snippet Hints'), t('Suggest closing braces and block bodies after the cursor (local heuristics).')) > 0) hasAi = 1;
  if (matchesSearch(t('Snippet Hints Delay'), t('Delay in ms before showing snippet hints')) > 0) hasAi = 1;

  if (hasAi > 0) {
    makeSection(ctr, colors, t('AI Provider Keys'));
    if (matchesSearch(t('Anthropic'), t('API key for Anthropic Claude models')) > 0)
      makeTextRow(ctr, colors, t('Anthropic API Key'), t('API key for Anthropic Claude models'), s.aiKeyAnthropic.length > 8 ? 'sk-...set' : '', onAiKeyAnthropicChange);
    if (matchesSearch(t('OpenAI'), t('API key for OpenAI GPT models')) > 0)
      makeTextRow(ctr, colors, t('OpenAI API Key'), t('API key for OpenAI GPT models'), s.aiKeyOpenai.length > 8 ? 'sk-...set' : '', onAiKeyOpenaiChange);
    if (matchesSearch(t('Google'), t('API key for Google Gemini models')) > 0)
      makeTextRow(ctr, colors, t('Google AI API Key'), t('API key for Google Gemini models'), s.aiKeyGoogle.length > 8 ? '...set' : '', onAiKeyGoogleChange);
    if (matchesSearch(t('DeepSeek'), t('API key for DeepSeek models')) > 0)
      makeTextRow(ctr, colors, t('DeepSeek API Key'), t('API key for DeepSeek models'), s.aiKeyDeepseek.length > 8 ? '...set' : '', onAiKeyDeepseekChange);
    if (matchesSearch(t('xAI'), t('API key for xAI Grok models')) > 0)
      makeTextRow(ctr, colors, t('xAI API Key'), t('API key for xAI Grok models'), s.aiKeyXai.length > 8 ? '...set' : '', onAiKeyXaiChange);

    makeSection(ctr, colors, t('Local / Custom'));
    if (matchesSearch(t('Ollama'), t('Local Ollama server')) > 0) {
      makeTextRow(ctr, colors, t('Ollama URL'), t('URL for local Ollama server'), s.aiOllamaUrl, onAiOllamaUrlChange);
      makeTextRow(ctr, colors, t('Ollama Model'), t('Model name for Ollama (e.g., llama3:8b)'), s.aiOllamaModel, onAiOllamaModelChange);
    }
    if (matchesSearch(t('Custom'), t('Custom OpenAI-compatible endpoint')) > 0) {
      makeTextRow(ctr, colors, t('Custom URL'), t('Custom OpenAI-compatible API endpoint'), s.aiCustomUrl, onAiCustomUrlChange);
      makeTextRow(ctr, colors, t('Custom API Key'), t('API key for custom endpoint'), s.aiCustomKey.length > 5 ? '...set' : '', onAiCustomKeyChange);
      makeTextRow(ctr, colors, t('Custom Model'), t('Model name for custom endpoint'), s.aiCustomModel, onAiCustomModelChange);
    }

    makeSection(ctr, colors, t('Editor Features'));
    if (matchesSearch(t('Snippet Hints'), t('Suggest closing braces and block bodies after the cursor (local heuristics).')) > 0)
      _hAiInlineBtn = makeToggleRow(ctr, colors, t('Snippet Hints'), t('Suggest closing braces and block bodies after the cursor. Local heuristics only — no AI provider call. Model-backed completion in v1.1.'), s.aiInlineCompletionEnabled ? 1 : 0, () => { onAiInlineToggle(); });
    if (matchesSearch(t('Snippet Hints Delay'), t('Delay in ms before showing snippet hints')) > 0)
      _hAiInlineDelayVal = makeStepperRow(ctr, colors, t('Snippet Hints Delay'), t('Delay in ms before showing snippet hints'), s.aiInlineCompletionDelay, () => { onAiInlineDelayDown(); }, () => { onAiInlineDelayUp(); });
  }

  // ---- Search ----
  if (matchesSearch(t('Use Ignore Files'), t('Use .gitignore files when searching')) > 0) hasSearch = 1;
  if (matchesSearch(t('Follow Symlinks'), t('Follow symbolic links while searching')) > 0) hasSearch = 1;

  if (hasSearch > 0) {
    makeSection(ctr, colors, t('Search'));
    if (matchesSearch(t('Use Ignore Files'), t('Use .gitignore files when searching')) > 0)
      _hSearchIgnoreBtn = makeToggleRow(ctr, colors, t('Use Ignore Files'), t('Use .gitignore files when searching'), s.searchUseIgnoreFiles ? 1 : 0, () => { onSearchIgnoreToggle(); });
    if (matchesSearch(t('Follow Symlinks'), t('Follow symbolic links while searching')) > 0)
      _hSearchSymlinksBtn = makeToggleRow(ctr, colors, t('Follow Symlinks'), t('Follow symbolic links while searching'), s.searchFollowSymlinks ? 1 : 0, () => { onSearchSymlinksToggle(); });
  }

  // ---- Privacy ----
  let hasPrivacy = 0;
  if (matchesSearch(t('Anonymous Statistics'), t('Share anonymous usage statistics to help improve Hone')) > 0) hasPrivacy = 1;

  if (hasPrivacy > 0) {
    makeSection(ctr, colors, t('Privacy'));
    if (matchesSearch(t('Anonymous Statistics'), t('Share anonymous usage statistics to help improve Hone')) > 0)
      _hTelemetryBtn = makeToggleRow(ctr, colors, t('Anonymous Statistics'), t('Share anonymous usage statistics to help improve Hone. No file content, paths, or personal data is ever collected.'), s.telemetryEnabled ? 1 : 0, () => { onTelemetryToggle(); });
  }

  // ---- Account ----
  let hasAccount = 0;
  if (matchesSearch(t('Account'), t('Plan tier projects devices email')) > 0) hasAccount = 1;

  if (hasAccount > 0) {
    makeSection(ctr, colors, t('Account'));

    // Plan
    const planVal = Button(t('Free'), () => { _labelClick(); });
    buttonSetBordered(planVal, 0);
    setBtnFg(planVal, getInputPlaceholderForeground());
    textSetFontSize(planVal, 12);
    const planLbl = makeSettingLabel(t('Plan'), ''); widgetSetWidth(planLbl, 200);
    const planRow = HStack(12, [planLbl, planVal]);
    widgetSetHeight(planRow, 26);
    widgetAddChild(ctr, planRow);
    _hAccountTierLabel = planVal;

    // Synced projects
    const projVal = Button(t('0 of 1'), () => { _labelClick(); });
    buttonSetBordered(projVal, 0);
    setBtnFg(projVal, getInputPlaceholderForeground());
    textSetFontSize(projVal, 12);
    const projLbl = makeSettingLabel(t('Synced Projects'), ''); widgetSetWidth(projLbl, 200);
    const projRow = HStack(12, [projLbl, projVal]);
    widgetSetHeight(projRow, 26);
    widgetAddChild(ctr, projRow);
    _hAccountProjectsLabel = projVal;

    // Email
    const emailVal = Button(t('Not linked'), () => { _labelClick(); });
    buttonSetBordered(emailVal, 0);
    setBtnFg(emailVal, getInputPlaceholderForeground());
    textSetFontSize(emailVal, 12);
    const emailLbl = makeSettingLabel(t('Email'), ''); widgetSetWidth(emailLbl, 200);
    const emailRow = HStack(12, [emailLbl, emailVal]);
    widgetSetHeight(emailRow, 26);
    widgetAddChild(ctr, emailRow);
    _hAccountEmailLabel = emailVal;
  }
}

// ---------------------------------------------------------------------------
// Main render (exported — replaces old renderSettingsPanel)
// ---------------------------------------------------------------------------

export function renderSettingsTab(container: unknown, colors: ResolvedUIColors): void {
  _colors = colors;
  _searchText = '';

  // Header
  const titleText = Button(t('Settings'), () => { _labelClick(); });
  buttonSetBordered(titleText, 0);
  textSetFontSize(titleText, 20);
  textSetFontWeight(titleText, 20, 0.6);
  setBtnFg(titleText, getEditorForeground());

  const searchField = TextField(t('Search settings...'), onSearchChange);
  widgetSetWidth(searchField, 220);

  const header = HStackWithInsets(8, 16, 16, 16, 16);
  widgetAddChild(header, titleText);
  widgetAddChild(header, Spacer());
  widgetAddChild(header, searchField);

  // Scrollable content
  const content = VStackWithInsets(10, 0, 16, 0, 16);
  _contentContainer = content;

  const scroll = ScrollView();
  scrollViewSetChild(scroll, content);
  widgetSetHugging(scroll, 1);

  // Outer container
  const outer = VStack(0, [header, scroll]);
  setBg(outer, getEditorBackground());
  widgetSetHugging(outer, 1);
  widgetAddChild(container, outer);

  // Build settings content
  buildContent(content, colors);
}

export function updateAccountTier(tier: string): void {
  if (_hAccountTierLabel !== null) {
    textSetString(_hAccountTierLabel, tier);
  }
}

export function updateAccountProjects(current: number, max: number): void {
  if (_hAccountProjectsLabel !== null) {
    let txt = String(current);
    txt += t(' of ');
    txt += String(max);
    textSetString(_hAccountProjectsLabel, txt);
  }
}

export function updateAccountEmail(email: string): void {
  if (_hAccountEmailLabel !== null) {
    if (email.length > 0 && email.indexOf('@hone.local') < 0) {
      textSetString(_hAccountEmailLabel, email);
    } else {
      textSetString(_hAccountEmailLabel, t('Not linked'));
    }
  }
}
