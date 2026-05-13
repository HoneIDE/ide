/**
 * Command Palette (SHIP-V1-GAPS.md #15).
 *
 * VS Code-style command discoverability. Cmd+Shift+P opens it. The user types
 * a fragment; commands matching by title or category are filtered. Enter
 * executes the focused command and closes the palette.
 *
 * v1 implementation reuses the existing sidebar-replacement pattern (like
 * `goToFileAction`) so it integrates with the current layout system without
 * needing a floating overlay infrastructure. Phase 8 polish moves it to a
 * centered overlay above everything else.
 */

import {
  VStack, HStack, Text, Button, Spacer, TextField, ScrollView,
  textSetFontSize, textSetFontWeight,
  widgetAddChild, widgetClearChildren, widgetSetHidden,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { getPaletteCommands, executeCommand, type CommandDescriptor } from '../../../commands';
import { setFg, setBtnFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getSecondaryTextColor } from '../../theme/theme-colors';

// ---------------------------------------------------------------------------
// Module-level state (Perry closures capture by value)
// ---------------------------------------------------------------------------

let _sidebarContainer: unknown = null;
let _onClose: () => void = _noopVoid;
let _inputField: unknown = null;
let _resultsContainer: unknown = null;
let _filteredIds: string[] = [];
let _filteredTitles: string[] = [];
let _filteredCount: number = 0;
let _isOpen: number = 0;

function _noopVoid(): void {}

/**
 * Initialize palette with the host sidebar container and a close callback.
 * Call once at app startup. The close callback restores whatever view the
 * sidebar showed before the palette took it over.
 */
export function initCommandPalette(sidebarContainer: unknown, onClose: () => void): void {
  _sidebarContainer = sidebarContainer;
  _onClose = onClose;
}

/** Whether the palette is currently displayed in the sidebar. */
export function isCommandPaletteOpen(): number {
  return _isOpen;
}

/**
 * Open the palette. Pushes a TextField + filtered command list into the host
 * sidebar. Existing sidebar contents are cleared by the caller before render.
 */
export function openCommandPalette(_colors: ResolvedUIColors): void {
  if (_sidebarContainer === null) return;
  widgetClearChildren(_sidebarContainer);
  _isOpen = 1;

  const titleRow = HStack(8, []);
  const title = Text(t('COMMAND PALETTE'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(titleRow, title);
  widgetAddChild(titleRow, Spacer());
  const closeBtn = Button('×', () => { closeCommandPalette(); });
  setBtnFg(closeBtn, getSecondaryTextColor());
  widgetAddChild(titleRow, closeBtn);
  widgetAddChild(_sidebarContainer, titleRow);

  _inputField = TextField(t('Type a command…'), (text: string) => { onPaletteInput(text); });
  widgetAddChild(_sidebarContainer, _inputField);

  _resultsContainer = VStack(2, []);
  const scroll = ScrollView();
  widgetAddChild(scroll, _resultsContainer);
  widgetAddChild(_sidebarContainer, scroll);

  // Show all commands initially.
  renderPaletteResults('');
}

export function closeCommandPalette(): void {
  if (_isOpen < 1) return;
  _isOpen = 0;
  _inputField = null;
  _resultsContainer = null;
  _filteredIds = [];
  _filteredTitles = [];
  _filteredCount = 0;
  _onClose();
}

function onPaletteInput(text: string): void {
  // Defer one tick so the TextField commits its value before we re-render.
  setTimeout(() => { renderPaletteResults(text); }, 0);
}

/**
 * Filter commands by query (case-insensitive substring match against either
 * title or category) and render the result list. Simple substring is fine
 * for v1; tighter fuzzy ranking is a Phase 8 polish.
 */
function renderPaletteResults(query: string): void {
  if (_resultsContainer === null) return;
  widgetClearChildren(_resultsContainer);
  _filteredIds = [];
  _filteredTitles = [];
  _filteredCount = 0;

  const commands = getPaletteCommands();
  const qLower = query.toLowerCase();

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (qLower.length > 0) {
      const titleMatch = cmd.title.toLowerCase().indexOf(qLower) >= 0;
      const catMatch = cmd.category.toLowerCase().indexOf(qLower) >= 0;
      if (titleMatch !== true && catMatch !== true) continue;
    }
    _filteredIds.push(cmd.id);
    _filteredTitles.push(cmd.title);
    _filteredCount = _filteredCount + 1;
    appendPaletteItem(cmd);
    if (_filteredCount >= 200) break;
  }

  if (_filteredCount === 0 && qLower.length > 0) {
    const empty = Text(t('No matching commands'));
    textSetFontSize(empty, 12);
    setFg(empty, getSecondaryTextColor());
    widgetAddChild(_resultsContainer, empty);
  }
}

function appendPaletteItem(cmd: CommandDescriptor): void {
  if (_resultsContainer === null) return;
  // Capture the id by value at button-creation time (Perry closure rule).
  const cmdId = cmd.id;
  const row = HStack(8, []);
  const titleBtn = Button(cmd.title, () => { onPaletteSelect(cmdId); });
  setBtnFg(titleBtn, getSideBarForeground());
  widgetAddChild(row, titleBtn);
  if (cmd.category.length > 0) {
    widgetAddChild(row, Spacer());
    const catLabel = Text(cmd.category);
    textSetFontSize(catLabel, 11);
    setFg(catLabel, getSecondaryTextColor());
    widgetAddChild(row, catLabel);
  }
  widgetAddChild(_resultsContainer, row);
}

function onPaletteSelect(commandId: string): void {
  closeCommandPalette();
  // Defer execution one tick so the close repaint completes first; otherwise
  // an action that itself manipulates the sidebar (e.g. "Toggle Sidebar")
  // races with the palette's own teardown.
  setTimeout(() => { executeCommand(commandId); }, 0);
}
