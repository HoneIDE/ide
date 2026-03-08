/**
 * Sync Panel — sidebar view for sync/pairing.
 *
 * Host mode (desktop): shows pairing code, QR code URL, device list, relay status.
 * Guest mode (mobile): shows code input + connect button.
 *
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, VStackWithInsets, Text, Button, Spacer, TextField,
  textSetFontSize, textSetFontWeight,
  textSetString, textSetColor,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetClearChildren,
  widgetSetBackgroundColor, widgetSetWidth, widgetMatchParentWidth,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import { getSideBarForeground, getButtonForeground } from '../../theme/theme-colors';

// --- Module-level state ---

let syncPanelReady: number = 0;
let syncContainer: unknown = null;

// Status text
let statusLabel: unknown = null;
let statusText = 'Not connected';

// Pairing code display
let codeLabel: unknown = null;
let currentCode = '';

// Device list container
let deviceContainer: unknown = null;

// Host/guest mode (0=host, 1=guest)
let syncMode: number = 0;

// Device data (parallel arrays)
let devNames: string[] = [];
let devStatuses: string[] = [];
let devCount: number = 0;

// Join code text input
let joinCodeText = '';

// Callbacks
let _pairCallback: () => void = _noopVoid;
let _joinCallback: (code: string) => void = _noopCode;
let _disconnectCallback: () => void = _noopVoid;

function _noopVoid(): void {}
function _noopCode(c: string): void {}

// --- Public API ---

export function buildSyncPanel(): unknown {
  // Title
  const title = Text('Sync');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());

  // Status
  statusLabel = Text(statusText);
  textSetFontSize(statusLabel, 10);
  textSetColor(statusLabel, 0.5, 0.5, 0.5, 1.0);

  // Pairing section
  const pairBtn = Button('Pair Device', () => { onPairClicked(); });
  buttonSetBordered(pairBtn, 0);
  setBtnFg(pairBtn, getButtonForeground());

  let codeInitial = '------';
  if (currentCode.length > 0) {
    codeInitial = currentCode;
  }
  codeLabel = Text(codeInitial);
  textSetFontSize(codeLabel, 18);
  textSetFontWeight(codeLabel, 18, 0.7);
  setFg(codeLabel, getSideBarForeground());

  const codeHint = Text('Share this code with your mobile device');
  textSetFontSize(codeHint, 9);
  textSetColor(codeHint, 0.45, 0.45, 0.45, 1.0);

  const pairSection = VStack(4, [pairBtn, codeLabel, codeHint]);

  // Devices section header
  const devHeader = Text('Connected Devices');
  textSetFontSize(devHeader, 10);
  textSetFontWeight(devHeader, 10, 0.6);
  setFg(devHeader, getSideBarForeground());

  deviceContainer = VStack(2, []);

  // Build device rows for any already-known devices
  rebuildDeviceList();

  // Join session section (enter code from another device)
  const joinHeader = Text('Join Session');
  textSetFontSize(joinHeader, 10);
  textSetFontWeight(joinHeader, 10, 0.6);
  setFg(joinHeader, getSideBarForeground());

  const joinInput = TextField('Enter 6-char code', onJoinTextInput);
  widgetSetWidth(joinInput, 180);

  const joinBtn = Button('Join', () => { onJoinClicked(); });
  buttonSetBordered(joinBtn, 0);
  setBtnFg(joinBtn, getButtonForeground());

  const joinRow = HStack(8, [joinInput, joinBtn]);
  const joinSection = VStack(4, [joinHeader, joinRow]);

  // Divider
  const divider = Text('— or —');
  textSetFontSize(divider, 9);
  textSetColor(divider, 0.4, 0.4, 0.4, 1.0);

  syncContainer = VStackWithInsets(12, 8, 8, 8, 8);
  widgetAddChild(syncContainer, title);
  widgetAddChild(syncContainer, statusLabel);
  widgetAddChild(syncContainer, pairSection);
  widgetAddChild(syncContainer, divider);
  widgetAddChild(syncContainer, joinSection);
  widgetAddChild(syncContainer, devHeader);
  widgetAddChild(syncContainer, deviceContainer);

  syncPanelReady = 1;
  return syncContainer;
}

export function refreshSyncPanel(): void {
  if (syncPanelReady === 0) return;
  // Update status text
  if (statusLabel) {
    textSetString(statusLabel, statusText);
  }
  // Update code display
  if (codeLabel) {
    if (currentCode.length > 0) {
      textSetString(codeLabel, currentCode);
    } else {
      textSetString(codeLabel, '');
    }
  }
  rebuildDeviceList();
}

export function setSyncStatusText(text: string): void {
  statusText = text;
  if (statusLabel) {
    textSetString(statusLabel, text);
  }
}

export function setSyncPairingCode(code: string): void {
  currentCode = code;
  if (codeLabel) {
    textSetString(codeLabel, code);
  }
}

export function setSyncMode(mode: number): void {
  syncMode = mode;
}

export function setSyncPairCallback(fn: () => void): void {
  _pairCallback = fn;
}

export function setSyncJoinCallback(fn: (code: string) => void): void {
  _joinCallback = fn;
}

export function setSyncDisconnectCallback(fn: () => void): void {
  _disconnectCallback = fn;
}

export function addSyncDevice(name: string, status: string): void {
  devNames.push(name);
  devStatuses.push(status);
  devCount = devCount + 1;
  rebuildDeviceList();
}

export function removeSyncDevice(name: string): void {
  for (let i = 0; i < devCount; i++) {
    if (devNames[i] === name) {
      devNames.splice(i, 1);
      devStatuses.splice(i, 1);
      devCount = devCount - 1;
      rebuildDeviceList();
      return;
    }
  }
}

export function updateSyncDeviceStatus(name: string, status: string): void {
  for (let i = 0; i < devCount; i++) {
    if (devNames[i] === name) {
      devStatuses[i] = status;
      rebuildDeviceList();
      return;
    }
  }
}

export function clearSyncDevices(): void {
  devNames = [];
  devStatuses = [];
  devCount = 0;
  rebuildDeviceList();
}

// --- Internal ---

function onPairClicked(): void {
  _pairCallback();
}

function onJoinTextInput(text: string): void {
  joinCodeText = text;
}

function onJoinClicked(): void {
  _joinCallback(joinCodeText);
}

export function setJoinCodeText(text: string): void {
  joinCodeText = text;
}

function rebuildDeviceList(): void {
  if (!deviceContainer) return;
  widgetClearChildren(deviceContainer);

  if (devCount === 0) {
    const empty = Text('No devices paired');
    textSetFontSize(empty, 11);
    textSetColor(empty, 0.45, 0.45, 0.45, 1.0);
    widgetAddChild(deviceContainer, empty);
    return;
  }

  for (let i = 0; i < devCount; i++) {
    const row = buildDeviceRow(i);
    widgetAddChild(deviceContainer, row);
  }
}

function buildDeviceRow(idx: number): unknown {
  const name = devNames[idx];
  const status = devStatuses[idx];

  const nameLabel = Text(name);
  textSetFontSize(nameLabel, 11);
  setFg(nameLabel, getSideBarForeground());

  const statusDot = Text(status);
  textSetFontSize(statusDot, 10);
  if (status === 'connected') {
    textSetColor(statusDot, 0.3, 0.8, 0.3, 1.0);
  } else {
    textSetColor(statusDot, 0.5, 0.5, 0.5, 1.0);
  }

  const row = HStack(8, [nameLabel, Spacer(), statusDot]);
  return row;
}
