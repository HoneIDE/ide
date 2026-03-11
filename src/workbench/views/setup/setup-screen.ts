/**
 * First-run setup screen.
 *
 * Shown once on first launch. Lets user choose theme and opt into sync.
 * When sync is enabled, auto-creates an anonymous user on auth.hone.codes.
 *
 * Perry constraints:
 * - Module-level functions for all callbacks
 * - No string-returning function calls in async/fetch contexts
 * - Use fetch stream polling API for HTTP requests
 */
import {
  VStack, VStackWithInsets, HStack, HStackWithInsets, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight, textSetString,
  buttonSetBordered, buttonSetTitle,
  widgetSetBackgroundColor, widgetSetWidth, widgetSetHeight,
  widgetAddChild, widgetSetHidden,
} from 'perry/ui';
import { streamStart, streamPoll, streamStatus, streamClose } from 'node-fetch';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import {
  getWorkbenchSettings, setStringSetting, setBoolSetting,
} from '../../settings';
import { renderWorkbench } from '../../render';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _container: unknown = null;
let _statusText: unknown = null;
let _syncYesBtn: unknown = null;
let _syncNoBtn: unknown = null;
let _getStartedBtn: unknown = null;
let _themeDarkBtn: unknown = null;
let _themeLightBtn: unknown = null;

let _title: unknown = null;
let _subtitle: unknown = null;
let _themeLabel: unknown = null;
let _syncLabel: unknown = null;
let _syncDesc: unknown = null;
let _syncDesc2: unknown = null;
let _syncDesc3: unknown = null;

let _parentRoot: unknown = null;

let _statsLabel: unknown = null;
let _statsDesc: unknown = null;
let _statsYesBtn: unknown = null;
let _statsNoBtn: unknown = null;
let _statsStatus: unknown = null;

let _syncChoice: number = -1; // -1=not chosen, 0=no, 1=yes
let _fetchHandle: number = 0;
let _pollInterval: number = 0;
let _setupDone: number = 0;
let _pollCount: number = 0; // timeout counter (50 × 200ms = 10s)

declare const __platform__: number;

// ---------------------------------------------------------------------------
// Callbacks (module-level functions for Perry)
// ---------------------------------------------------------------------------

function applyDarkColors(): void {
  if (_container !== null) widgetSetBackgroundColor(_container, 0.11, 0.11, 0.12, 1.0);
  if (_title !== null) setFg(_title, '#E0E0E0');
  if (_subtitle !== null) setFg(_subtitle, '#888888');
  if (_themeLabel !== null) setFg(_themeLabel, '#CCCCCC');
  if (_syncLabel !== null) setFg(_syncLabel, '#CCCCCC');
  if (_syncDesc !== null) setFg(_syncDesc, '#888888');
  if (_syncDesc2 !== null) setFg(_syncDesc2, '#888888');
  if (_syncDesc3 !== null) setFg(_syncDesc3, '#888888');
  if (_statusText !== null) setFg(_statusText, '#66BB6A');
  if (_statsLabel !== null) setFg(_statsLabel, '#CCCCCC');
  if (_statsDesc !== null) setFg(_statsDesc, '#888888');
  if (_statsStatus !== null) setFg(_statsStatus, '#66BB6A');
}

function applyLightColors(): void {
  if (_container !== null) widgetSetBackgroundColor(_container, 0.96, 0.96, 0.97, 1.0);
  if (_title !== null) setFg(_title, '#1E1E1E');
  if (_subtitle !== null) setFg(_subtitle, '#666666');
  if (_themeLabel !== null) setFg(_themeLabel, '#333333');
  if (_syncLabel !== null) setFg(_syncLabel, '#333333');
  if (_syncDesc !== null) setFg(_syncDesc, '#666666');
  if (_syncDesc2 !== null) setFg(_syncDesc2, '#666666');
  if (_syncDesc3 !== null) setFg(_syncDesc3, '#666666');
  if (_statusText !== null) setFg(_statusText, '#2E7D32');
  if (_statsLabel !== null) setFg(_statsLabel, '#333333');
  if (_statsDesc !== null) setFg(_statsDesc, '#666666');
  if (_statsStatus !== null) setFg(_statsStatus, '#2E7D32');
}

function onThemeDark(): void {
  setStringSetting('colorTheme', 'Hone Dark');
  if (_themeDarkBtn !== null) {
    buttonSetTitle(_themeDarkBtn, 'Dark (selected)');
  }
  if (_themeLightBtn !== null) {
    buttonSetTitle(_themeLightBtn, 'Light');
  }
  applyDarkColors();
}

function onThemeLight(): void {
  setStringSetting('colorTheme', 'Hone Light');
  if (_themeLightBtn !== null) {
    buttonSetTitle(_themeLightBtn, 'Light (selected)');
  }
  if (_themeDarkBtn !== null) {
    buttonSetTitle(_themeDarkBtn, 'Dark');
  }
  applyLightColors();
}

function onStatsYes(): void {
  setBoolSetting('telemetryEnabled', 1);
  if (_statsYesBtn !== null) widgetSetHidden(_statsYesBtn, 1);
  if (_statsNoBtn !== null) widgetSetHidden(_statsNoBtn, 1);
  if (_statsStatus !== null) textSetString(_statsStatus, 'Anonymous stats enabled. Thanks!');
}

function onStatsNo(): void {
  setBoolSetting('telemetryEnabled', 0);
  if (_statsYesBtn !== null) widgetSetHidden(_statsYesBtn, 1);
  if (_statsNoBtn !== null) widgetSetHidden(_statsNoBtn, 1);
  if (_statsStatus !== null) textSetString(_statsStatus, 'Stats disabled. You can enable this later in Settings.');
}

function onSyncYes(): void {
  _syncChoice = 1;
  if (_statusText !== null) {
    textSetString(_statusText, 'Setting up sync...');
  }
  if (_syncYesBtn !== null) widgetSetHidden(_syncYesBtn, 1);
  if (_syncNoBtn !== null) widgetSetHidden(_syncNoBtn, 1);

  // Start auto-registration via fetch stream API
  const s = getWorkbenchSettings();
  let platName = 'unknown';
  if (__platform__ === 0) platName = 'macos';
  if (__platform__ === 1) platName = 'ios';
  if (__platform__ === 2) platName = 'android';
  if (__platform__ === 3) platName = 'windows';
  if (__platform__ === 4) platName = 'linux';
  let url = s.syncAuthUrl;
  url += '/auth/quick-setup?deviceName=HoneIDE&platform=';
  url += platName;
  _fetchHandle = streamStart(url, 'GET', '', '{}');
  _pollCount = 0;
  _pollInterval = setInterval(pollSetupResponse, 200);
}

function onSyncNo(): void {
  _syncChoice = 0;
  setBoolSetting('syncEnabled', 0);
  if (_statusText !== null) {
    textSetString(_statusText, 'Sync disabled. You can enable it later in Settings.');
  }
  if (_syncYesBtn !== null) widgetSetHidden(_syncYesBtn, 1);
  if (_syncNoBtn !== null) widgetSetHidden(_syncNoBtn, 1);
  if (_getStartedBtn !== null) widgetSetHidden(_getStartedBtn, 0);
}

function pollSetupResponse(): void {
  if (_fetchHandle === 0) return;
  const status = streamStatus(_fetchHandle);
  // 0=connecting, 1=streaming, 2=done, 3=error
  _pollCount = _pollCount + 1;
  if (status < 2) {
    // Timeout after 10 seconds (50 polls × 200ms)
    if (_pollCount < 50) return;
    // Timed out — treat as error
    streamClose(_fetchHandle);
    _fetchHandle = 0;
    clearInterval(_pollInterval);
    _pollInterval = 0;
    if (_statusText !== null) {
      textSetString(_statusText, 'Could not reach sync server. You can set up sync later in Settings.');
    }
    setBoolSetting('syncEnabled', 0);
    if (_getStartedBtn !== null) widgetSetHidden(_getStartedBtn, 0);
    return;
  }

  // Collect response lines
  let responseText = '';
  let line = streamPoll(_fetchHandle);
  while (line.length > 0) {
    responseText += line;
    line = streamPoll(_fetchHandle);
  }

  if (status === 3 || responseText.length < 5) {
    // Error
    if (_statusText !== null) {
      textSetString(_statusText, 'Could not reach sync server. You can set up sync later in Settings.');
    }
    setBoolSetting('syncEnabled', 0);
  } else {
    // Parse deviceToken from response: {"ok":true,"deviceToken":"...","userId":...}
    const tkIdx = responseText.indexOf('"deviceToken":"');
    if (tkIdx >= 0) {
      const tkStart = tkIdx + 15;
      const tkEnd = responseText.indexOf('"', tkStart);
      const token = responseText.slice(tkStart, tkEnd);

      setBoolSetting('syncEnabled', 1);
      setStringSetting('syncDeviceToken', token);

      if (_statusText !== null) {
        textSetString(_statusText, 'Sync is ready!');
      }
    } else {
      if (_statusText !== null) {
        textSetString(_statusText, 'Setup issue. You can configure sync in Settings.');
      }
      setBoolSetting('syncEnabled', 0);
    }
  }

  streamClose(_fetchHandle);
  _fetchHandle = 0;
  clearInterval(_pollInterval);
  _pollInterval = 0;

  if (_getStartedBtn !== null) widgetSetHidden(_getStartedBtn, 0);
}

function onGetStarted(): void {
  if (_setupDone > 0) return;
  _setupDone = 1;
  setBoolSetting('setupComplete', 1);

  // Hide setup screen and show workbench
  if (_container !== null) {
    widgetSetHidden(_container, 1);
  }
  if (_parentRoot !== null) {
    const workbench = renderWorkbench('full');
    widgetAddChild(_parentRoot, workbench);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function setSetupParent(parent: unknown): void {
  _parentRoot = parent;
}

export function createSetupScreen(): unknown {
  // Title
  const title = Text('Welcome to Hone');
  textSetFontSize(title, 28);
  textSetFontWeight(title, 28, 0.7);
  setFg(title, '#E0E0E0');
  _title = title;

  const subtitle = Text('A lightweight, native code editor');
  textSetFontSize(subtitle, 14);
  setFg(subtitle, '#888888');
  _subtitle = subtitle;

  // Theme section
  const themeLabel = Text('Choose your theme');
  textSetFontSize(themeLabel, 16);
  textSetFontWeight(themeLabel, 16, 0.6);
  setFg(themeLabel, '#CCCCCC');
  _themeLabel = themeLabel;

  const darkBtn = Button('Dark (selected)', () => { onThemeDark(); });
  buttonSetBordered(darkBtn, 1);
  widgetSetWidth(darkBtn, 120);
  _themeDarkBtn = darkBtn;

  const lightBtn = Button('Light', () => { onThemeLight(); });
  buttonSetBordered(lightBtn, 1);
  widgetSetWidth(lightBtn, 120);
  _themeLightBtn = lightBtn;

  const themeRow = HStack(12, [darkBtn, lightBtn]);

  // Sync section
  const syncLabel = Text('Cross-device sync');
  textSetFontSize(syncLabel, 16);
  textSetFontWeight(syncLabel, 16, 0.6);
  setFg(syncLabel, '#CCCCCC');
  _syncLabel = syncLabel;

  const syncDesc = Text('Your first project syncs free between desktop and mobile.');
  textSetFontSize(syncDesc, 13);
  setFg(syncDesc, '#888888');
  _syncDesc = syncDesc;

  const syncDesc2 = Text('No email or payment needed. Upgrade to Pro ($3/mo) for unlimited.');
  textSetFontSize(syncDesc2, 13);
  setFg(syncDesc2, '#888888');
  _syncDesc2 = syncDesc2;

  const syncDesc3 = Text('Files, AI chat, and editor state sync — all end-to-end encrypted.');
  textSetFontSize(syncDesc3, 13);
  setFg(syncDesc3, '#888888');
  _syncDesc3 = syncDesc3;

  const yesBtn = Button('Enable Sync', () => { onSyncYes(); });
  buttonSetBordered(yesBtn, 1);
  widgetSetWidth(yesBtn, 140);
  _syncYesBtn = yesBtn;

  const noBtn = Button('Skip', () => { onSyncNo(); });
  buttonSetBordered(noBtn, 1);
  widgetSetWidth(noBtn, 100);
  _syncNoBtn = noBtn;

  const syncBtnRow = HStack(12, [yesBtn, noBtn]);

  // Status
  const statusTxt = Text('');
  textSetFontSize(statusTxt, 13);
  setFg(statusTxt, '#66BB6A');
  _statusText = statusTxt;

  // Get Started button (hidden until sync choice is made)
  const startBtn = Button('Get Started', () => { onGetStarted(); });
  buttonSetBordered(startBtn, 1);
  widgetSetWidth(startBtn, 160);
  widgetSetHidden(startBtn, 1);
  _getStartedBtn = startBtn;

  // Build layout
  const content = VStackWithInsets(16, 60, 60, 60, 60);
  widgetSetBackgroundColor(content, 0.11, 0.11, 0.12, 1.0);
  widgetAddChild(content, Spacer());
  widgetAddChild(content, title);
  widgetAddChild(content, subtitle);
  widgetAddChild(content, Spacer());
  widgetAddChild(content, themeLabel);
  widgetAddChild(content, themeRow);
  widgetAddChild(content, Spacer());
  widgetAddChild(content, syncLabel);
  widgetAddChild(content, syncDesc);
  widgetAddChild(content, syncDesc2);
  widgetAddChild(content, syncDesc3);
  widgetAddChild(content, syncBtnRow);
  widgetAddChild(content, statusTxt);
  widgetAddChild(content, Spacer());

  // Anonymous statistics section
  const statsLabel = Text('Anonymous statistics');
  textSetFontSize(statsLabel, 16);
  textSetFontWeight(statsLabel, 16, 0.6);
  setFg(statsLabel, '#CCCCCC');
  _statsLabel = statsLabel;

  const statsDesc = Text('Share anonymous usage stats to help improve Hone. No file content, paths, or personal data is ever collected.');
  textSetFontSize(statsDesc, 13);
  setFg(statsDesc, '#888888');
  _statsDesc = statsDesc;

  const statsYesBtn = Button('Yes, share stats', () => { onStatsYes(); });
  buttonSetBordered(statsYesBtn, 1);
  widgetSetWidth(statsYesBtn, 160);
  _statsYesBtn = statsYesBtn;

  const statsNoBtn = Button('No thanks', () => { onStatsNo(); });
  buttonSetBordered(statsNoBtn, 1);
  widgetSetWidth(statsNoBtn, 100);
  _statsNoBtn = statsNoBtn;

  const statsBtnRow = HStack(12, [statsYesBtn, statsNoBtn]);

  const statsStatus = Text('');
  textSetFontSize(statsStatus, 13);
  setFg(statsStatus, '#66BB6A');
  _statsStatus = statsStatus;

  widgetAddChild(content, statsLabel);
  widgetAddChild(content, statsDesc);
  widgetAddChild(content, statsBtnRow);
  widgetAddChild(content, statsStatus);
  widgetAddChild(content, Spacer());
  widgetAddChild(content, startBtn);
  widgetAddChild(content, Spacer());

  _container = content;
  return content;
}
