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

let _parentRoot: unknown = null;

let _syncChoice: number = -1; // -1=not chosen, 0=no, 1=yes
let _fetchHandle: number = 0;
let _pollInterval: number = 0;
let _setupDone: number = 0;

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
  if (_statusText !== null) setFg(_statusText, '#66BB6A');
}

function applyLightColors(): void {
  if (_container !== null) widgetSetBackgroundColor(_container, 0.96, 0.96, 0.97, 1.0);
  if (_title !== null) setFg(_title, '#1E1E1E');
  if (_subtitle !== null) setFg(_subtitle, '#666666');
  if (_themeLabel !== null) setFg(_themeLabel, '#333333');
  if (_syncLabel !== null) setFg(_syncLabel, '#333333');
  if (_syncDesc !== null) setFg(_syncDesc, '#666666');
  if (_syncDesc2 !== null) setFg(_syncDesc2, '#666666');
  if (_statusText !== null) setFg(_statusText, '#2E7D32');
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

function onSyncYes(): void {
  _syncChoice = 1;
  if (_statusText !== null) {
    textSetString(_statusText, 'Setting up sync...');
  }
  if (_syncYesBtn !== null) widgetSetHidden(_syncYesBtn, 1);
  if (_syncNoBtn !== null) widgetSetHidden(_syncNoBtn, 1);

  // Start auto-registration via fetch stream API
  const s = getWorkbenchSettings();
  let url = s.syncAuthUrl;
  url += '/auth/quick-setup?deviceName=HoneIDE&platform=macOS';
  _fetchHandle = streamStart(url, 'GET', '', '{}');
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
  if (status < 2) return;

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

  const syncDesc = Text('Sync your workspace between desktop and mobile in real time.');
  textSetFontSize(syncDesc, 13);
  setFg(syncDesc, '#888888');
  _syncDesc = syncDesc;

  const syncDesc2 = Text('No account or payment required. You can change this later in Settings.');
  textSetFontSize(syncDesc2, 13);
  setFg(syncDesc2, '#888888');
  _syncDesc2 = syncDesc2;

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
  widgetAddChild(content, syncBtnRow);
  widgetAddChild(content, statusTxt);
  widgetAddChild(content, Spacer());
  widgetAddChild(content, startBtn);
  widgetAddChild(content, Spacer());

  _container = content;
  return content;
}
