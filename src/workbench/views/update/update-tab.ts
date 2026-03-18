/**
 * Update tab — shows release notes and install button in the editor pane.
 *
 * Virtual tab path: __update__ (length 10, charCodeAt(2) === 117 'u')
 * Follows the same pattern as settings-panel.ts (virtual tab in editor pane).
 *
 * All state is module-level (Perry closures capture by value).
 */

import {
  VStack, VStackWithInsets, HStack, HStackWithInsets, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight, textSetString,
  buttonSetBordered,
  widgetAddChild, widgetSetHugging, widgetSetWidth, widgetSetHeight,
  widgetSetBackgroundColor, widgetSetHidden,
  ScrollView, scrollViewSetChild,
} from 'perry/ui';
import { setBg, setFg, setBtnFg } from '../../ui-helpers';
import {
  getEditorBackground, getEditorForeground, getButtonBackground, getButtonForeground,
} from '../../theme/theme-colors';
import {
  getCurrentVersion, getLatestVersion, getReleaseNotes,
  getUpdateState, getUpdateError, performUpdate,
} from './update-checker';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _container: unknown = null;
let _titleLabel: unknown = null;
let _currentVerLabel: unknown = null;
let _newVerLabel: unknown = null;
let _notesLabel: unknown = null;
let _statusLabel: unknown = null;
let _installBtn: unknown = null;
let _dismissBtn: unknown = null;
let _retryBtn: unknown = null;
let _pollInterval: number = 0;
let _rendered: number = 0;

// ---------------------------------------------------------------------------
// Callbacks (module-level functions for Perry)
// ---------------------------------------------------------------------------

function onInstallClick(): void {
  if (_statusLabel !== null) {
    textSetString(_statusLabel, 'Downloading and verifying update...');
  }
  if (_installBtn !== null) widgetSetHidden(_installBtn, 1);
  if (_dismissBtn !== null) widgetSetHidden(_dismissBtn, 1);
  performUpdate();
  // Start polling for state changes
  if (_pollInterval === 0) {
    _pollInterval = setInterval(pollUpdateState, 200);
  }
}

function onDismissClick(): void {
  // Just hide — render.ts will handle tab close
}

function onRetryClick(): void {
  if (_retryBtn !== null) widgetSetHidden(_retryBtn, 1);
  if (_statusLabel !== null) textSetString(_statusLabel, '');
  if (_installBtn !== null) widgetSetHidden(_installBtn, 0);
  if (_dismissBtn !== null) widgetSetHidden(_dismissBtn, 0);
}

function pollUpdateState(): void {
  const state = getUpdateState();
  if (state === 3) {
    // Downloading
    if (_statusLabel !== null) {
      textSetString(_statusLabel, 'Downloading and verifying update...');
    }
  } else if (state === 4) {
    // Ready — restarting
    if (_statusLabel !== null) {
      textSetString(_statusLabel, 'Update installed! Restarting...');
    }
    clearInterval(_pollInterval);
    _pollInterval = 0;
  } else if (state === 5) {
    // Error
    const errMsg = getUpdateError();
    if (_statusLabel !== null) {
      textSetString(_statusLabel, errMsg);
    }
    if (_retryBtn !== null) widgetSetHidden(_retryBtn, 0);
    clearInterval(_pollInterval);
    _pollInterval = 0;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderUpdateTab(container: unknown): void {
  if (_rendered > 0) return;
  _rendered = 1;

  const bgColor = getEditorBackground();
  const fgColor = getEditorForeground();

  // Title
  const title = Text('Update Available');
  textSetFontSize(title, 20);
  textSetFontWeight(title, 20, 0.7);
  setFg(title, fgColor);
  _titleLabel = title;

  // Current version
  let curVerText = 'Current version: ';
  curVerText += getCurrentVersion();
  const curVer = Text(curVerText);
  textSetFontSize(curVer, 13);
  setFg(curVer, fgColor);
  _currentVerLabel = curVer;

  // New version
  let newVerText = 'New version: ';
  newVerText += getLatestVersion();
  const newVer = Text(newVerText);
  textSetFontSize(newVer, 13);
  textSetFontWeight(newVer, 13, 0.6);
  setFg(newVer, fgColor);
  _newVerLabel = newVer;

  // Release notes header
  const notesHeader = Text('Release Notes');
  textSetFontSize(notesHeader, 15);
  textSetFontWeight(notesHeader, 15, 0.6);
  setFg(notesHeader, fgColor);

  // Release notes body
  let notes = getReleaseNotes();
  if (notes.length === 0) notes = 'No release notes available.';
  const notesBody = Text(notes);
  textSetFontSize(notesBody, 13);
  setFg(notesBody, fgColor);
  _notesLabel = notesBody;

  // Status label (for download progress / errors)
  const statusLabel = Text('');
  textSetFontSize(statusLabel, 13);
  setFg(statusLabel, '#66BB6A');
  _statusLabel = statusLabel;

  // Install button
  const installBtn = Button('Install & Restart', () => { onInstallClick(); });
  buttonSetBordered(installBtn, 0);
  setBtnFg(installBtn, '#ffffff');
  widgetSetBackgroundColor(installBtn, 0.0, 0.48, 0.80, 1.0);
  widgetSetWidth(installBtn, 160);
  widgetSetHeight(installBtn, 32);
  _installBtn = installBtn;

  // Dismiss button
  const dismissBtn = Button('Not Now', () => { onDismissClick(); });
  buttonSetBordered(dismissBtn, 0);
  setBtnFg(dismissBtn, fgColor);
  widgetSetWidth(dismissBtn, 100);
  widgetSetHeight(dismissBtn, 32);
  _dismissBtn = dismissBtn;

  // Retry button (hidden by default)
  const retryBtn = Button('Try Again', () => { onRetryClick(); });
  buttonSetBordered(retryBtn, 0);
  setBtnFg(retryBtn, '#ffffff');
  widgetSetBackgroundColor(retryBtn, 0.0, 0.48, 0.80, 1.0);
  widgetSetWidth(retryBtn, 120);
  widgetSetHeight(retryBtn, 32);
  widgetSetHidden(retryBtn, 1);
  _retryBtn = retryBtn;

  // Button row
  const btnRow = HStack(12, [installBtn, dismissBtn, retryBtn]);

  // Spacer between version info and notes
  const spacer1 = VStack(0, []);
  widgetSetHeight(spacer1, 16);

  const spacer2 = VStack(0, []);
  widgetSetHeight(spacer2, 12);

  const spacer3 = VStack(0, []);
  widgetSetHeight(spacer3, 20);

  // Content
  const content = VStackWithInsets(8, 40, 40, 40, 40);
  widgetAddChild(content, title);
  widgetAddChild(content, spacer1);
  widgetAddChild(content, curVer);
  widgetAddChild(content, newVer);
  widgetAddChild(content, spacer2);
  widgetAddChild(content, notesHeader);
  widgetAddChild(content, notesBody);
  widgetAddChild(content, spacer3);
  widgetAddChild(content, btnRow);
  widgetAddChild(content, statusLabel);

  const scroll = ScrollView();
  scrollViewSetChild(scroll, content);

  const outer = VStack(0, [scroll]);
  setBg(outer, bgColor);
  widgetSetHugging(outer, 1);

  widgetAddChild(container, outer);
  _container = container;
}

/** Reset rendered state so tab can be rebuilt (e.g. after theme change). */
export function resetUpdateTab(): void {
  _rendered = 0;
  _container = null;
  _titleLabel = null;
  _currentVerLabel = null;
  _newVerLabel = null;
  _notesLabel = null;
  _statusLabel = null;
  _installBtn = null;
  _dismissBtn = null;
  _retryBtn = null;
  if (_pollInterval > 0) {
    clearInterval(_pollInterval);
    _pollInterval = 0;
  }
}
