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
  widgetAddChild, widgetClearChildren, widgetSetHidden,
  widgetSetBackgroundColor, widgetSetWidth, widgetMatchParentWidth,
  textfieldGetString,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import { getSideBarForeground, getButtonForeground } from '../../theme/theme-colors';
import { getActiveTheme } from '../../theme/theme-loader';
import { buildTrustSettings } from './trust-settings';
import { buildReviewPanel } from './review-panel';

// --- Module-level state ---

let syncPanelReady: number = 0;
let syncContainer: unknown = null;

// Status text
let statusLabel: unknown = null;
let statusText = t('Not connected');

// Pairing code display
let codeLabel: unknown = null;
let currentCode = '';

// Device list container
let deviceContainer: unknown = null;

// Upgrade prompt
let upgradeContainer: unknown = null;
let syncLimited: number = 0;

// SHIP-V1-GAPS.md #14: trust-settings + review-panel host containers.
// Lazily mounted on first reveal so the import isn't dead-weight at startup.
let advancedContainer: unknown = null;
let advancedExpanded: number = 0;
let trustHost: unknown = null;
let reviewHost: unknown = null;
let advancedBuilt: number = 0;

// Host/guest mode (0=host, 1=guest)
let syncMode: number = 0;

// Device data (parallel arrays)
let devNames: string[] = [];
let devStatuses: string[] = [];
let devCount: number = 0;

// Join code text input
let joinCodeText = '';
let joinInputHandle: unknown = null;
let joinInputReady: number = 0;

// Callbacks
let _pairCallback: () => void = _noopVoid;
let _joinCallback: (code: string) => void = _noopCode;
let _disconnectCallback: () => void = _noopVoid;

function _noopVoid(): void {}
function _noopCode(c: string): void {}

// --- Public API ---

export function buildSyncPanel(): unknown {
  // Title
  const title = Text(t('Sync'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());

  // Status
  statusLabel = Text(statusText);
  textSetFontSize(statusLabel, 10);
  textSetColor(statusLabel, 0.5, 0.5, 0.5, 1.0);

  // Pairing section
  const pairBtn = Button(t('Pair Device'), () => { onPairClicked(); });
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

  const codeHint = Text(t('Share this code with your mobile device'));
  textSetFontSize(codeHint, 9);
  textSetColor(codeHint, 0.45, 0.45, 0.45, 1.0);

  const pairSection = VStack(4, [pairBtn, codeLabel, codeHint]);

  // Devices section header
  const devHeader = Text(t('Connected Devices'));
  textSetFontSize(devHeader, 10);
  textSetFontWeight(devHeader, 10, 0.6);
  setFg(devHeader, getSideBarForeground());

  deviceContainer = VStack(2, []);

  // Build device rows for any already-known devices
  rebuildDeviceList();

  // Join session section (enter code from another device)
  const joinHeader = Text(t('Join Session'));
  textSetFontSize(joinHeader, 10);
  textSetFontWeight(joinHeader, 10, 0.6);
  setFg(joinHeader, getSideBarForeground());

  const joinInput = TextField(t('Enter 6-char code'), onJoinTextInput);
  joinInputHandle = joinInput;
  joinInputReady = 1;
  widgetSetWidth(joinInput, 180);

  const joinBtn = Button(t('Join'), () => { onJoinClicked(); });
  buttonSetBordered(joinBtn, 0);
  setBtnFg(joinBtn, getButtonForeground());

  const joinRow = HStack(8, [joinInput, joinBtn]);
  const joinSection = VStack(4, [joinHeader, joinRow]);

  // Divider
  const divider = Text(t('— or —'));
  textSetFontSize(divider, 9);
  textSetColor(divider, 0.4, 0.4, 0.4, 1.0);

  // Upgrade prompt (hidden until limit is hit)
  upgradeContainer = VStack(4, []);

  // SHIP-V1-GAPS.md #14: advanced section — Trust Settings + Review Queue.
  // Hidden by default; toggled by the chevron button below. Lazily renders
  // its content on first reveal so an idle sync user pays nothing for the
  // 575 LOC of trust+review code beyond the imports.
  const advancedToggle = Button(t('▸ Advanced'), () => { onAdvancedToggle(); });
  buttonSetBordered(advancedToggle, 0);
  setBtnFg(advancedToggle, getSideBarForeground());
  textSetFontSize(advancedToggle, 10);
  advancedContainer = VStack(8, []);
  widgetSetHidden(advancedContainer, 1);

  syncContainer = VStackWithInsets(12, 8, 8, 8, 8);
  widgetAddChild(syncContainer, title);
  widgetAddChild(syncContainer, statusLabel);
  widgetAddChild(syncContainer, pairSection);
  widgetAddChild(syncContainer, divider);
  widgetAddChild(syncContainer, joinSection);
  widgetAddChild(syncContainer, devHeader);
  widgetAddChild(syncContainer, deviceContainer);
  widgetAddChild(syncContainer, upgradeContainer);
  widgetAddChild(syncContainer, advancedToggle);
  widgetAddChild(syncContainer, advancedContainer);

  // Show limit prompt if already limited
  if (syncLimited === 1) {
    showSyncLimitPrompt();
  }

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

export function showSyncLimitPrompt(): void {
  syncLimited = 1;
  if (upgradeContainer === null) return;
  // Build the upgrade message
  widgetClearChildren(upgradeContainer);

  const limitMsg = Text(t('Free plan syncs 1 project.'));
  textSetFontSize(limitMsg, 11);
  textSetColor(limitMsg, 0.85, 0.65, 0.2, 1.0);
  widgetAddChild(upgradeContainer, limitMsg);

  const upgradeMsg = Text(t('Upgrade to Pro or use a self-hosted relay.'));
  textSetFontSize(upgradeMsg, 10);
  textSetColor(upgradeMsg, 0.5, 0.5, 0.5, 1.0);
  widgetAddChild(upgradeContainer, upgradeMsg);
}

export function hideSyncLimitPrompt(): void {
  syncLimited = 0;
  if (upgradeContainer === null) return;
  widgetClearChildren(upgradeContainer);
}

export function isSyncLimited(): number {
  return syncLimited;
}

// --- Internal ---

function onPairClicked(): void {
  _pairCallback();
}

function onJoinTextInput(text: string): void {
  joinCodeText = text;
}

function onJoinClicked(): void {
  setSyncStatusText(t('Join clicked...'));
  // Read text directly from the TextField handle (onChange callback may not fire on iOS)
  if (joinInputReady > 0) {
    const directText = textfieldGetString(joinInputHandle);
    let dbg = 'Read: [';
    dbg += directText;
    dbg += '] len=';
    dbg += String(directText.length);
    setSyncStatusText(dbg);
    if (directText.length > 0) {
      joinCodeText = directText;
    }
  } else {
    setSyncStatusText(t('No input handle'));
  }
  let dbg2 = 'Joining with: [';
  dbg2 += joinCodeText;
  dbg2 += ']';
  setSyncStatusText(dbg2);
  _joinCallback(joinCodeText);
}

export function setJoinCodeText(text: string): void {
  joinCodeText = text;
}

// SHIP-V1-GAPS.md #14: advanced-section toggle. First click lazily mounts
// the trust-settings + review-panel widgets; subsequent clicks just flip
// visibility. The underlying state arrays in both modules persist across
// toggles so transient proposals don't get dropped if the user collapses
// and re-expands.
function onAdvancedToggle(): void {
  if (advancedContainer === null) return;
  if (advancedExpanded > 0) {
    widgetSetHidden(advancedContainer, 1);
    advancedExpanded = 0;
    return;
  }
  if (advancedBuilt < 1) {
    const theme = getActiveTheme();
    const colors: any = theme !== null ? (theme as any).uiColors : null;
    trustHost = buildTrustSettings(colors);
    reviewHost = buildReviewPanel(colors);
    widgetAddChild(advancedContainer, trustHost);
    widgetAddChild(advancedContainer, reviewHost);
    advancedBuilt = 1;
  }
  widgetSetHidden(advancedContainer, 0);
  advancedExpanded = 1;
}

function rebuildDeviceList(): void {
  if (!deviceContainer) return;
  widgetClearChildren(deviceContainer);

  if (devCount === 0) {
    const empty = Text(t('No devices paired'));
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
