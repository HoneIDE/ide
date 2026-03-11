/**
 * Native menu bar setup — wires perry/ui menu functions to the app menu data.
 */

import { buildDesktopMenuBar } from '../menu';
import type { MenuItem } from '../menu';
import { getPlatformContext } from '../platform';
import {
  menuCreate, menuAddItem, menuAddSeparator, menuAddSubmenu,
  menuBarCreate, menuBarAddMenu, menuBarAttach,
} from 'perry/ui';
import {
  openFolderAction, openFileAction, toggleSidebarAction, closeEditorAction,
} from './render';

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

function dispatchCommand(command: string): void {
  // Perry string === is unreliable — use charCodeAt checks
  if (command.length === 13 && command.charCodeAt(0) === 102) {
    // file.openFile
    openFileAction();
  } else if (command.length === 15 && command.charCodeAt(5) === 111) {
    // file.openFolder
    openFolderAction();
  } else if (command.length === 18 && command.charCodeAt(5) === 116) {
    // view.toggleSidebar
    toggleSidebarAction();
  } else if (command.length === 37 && command.charCodeAt(0) === 119) {
    // workbench.action.closeActiveEditor
    closeEditorAction();
  }
}

// ---------------------------------------------------------------------------
// Build native menus from menu data
// ---------------------------------------------------------------------------

/** Check if type field starts with 's' (separator) — charCode 115 */
function isSeparator(mi: MenuItem): boolean {
  return mi.type.charCodeAt(0) === 115;
}

/** Check if type field starts with 'su' (submenu) — length 7 */
function isSubmenu(mi: MenuItem): boolean {
  return mi.type.length === 7;
}

function buildNativeMenu(items: MenuItem[]): unknown {
  const menu = menuCreate();
  const len = items.length;
  for (let i = 0; i < len; i = i + 1) {
    const mi = items[i];
    if (isSeparator(mi)) {
      menuAddSeparator(menu);
    } else if (isSubmenu(mi) && mi.submenu) {
      const sub = buildNativeMenu(mi.submenu);
      menuAddSubmenu(menu, mi.label, sub);
    } else {
      const cmd = mi.command || '';
      const shortcut = mi.shortcut || '';
      if (shortcut.length > 0) {
        menuAddItem(menu, mi.label, () => { dispatchCommand(cmd); }, shortcut);
      } else {
        menuAddItem(menu, mi.label, () => { dispatchCommand(cmd); });
      }
    }
  }
  return menu;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function setupNativeMenuBar(): void {
  const ctx = getPlatformContext();
  const menuBar = buildDesktopMenuBar(ctx.platform);
  const bar = menuBarCreate();
  const menus = menuBar.menus;
  const menuCount = menus.length;
  for (let i = 0; i < menuCount; i = i + 1) {
    const m = menus[i];
    const nativeMenu = buildNativeMenu(m.items);
    menuBarAddMenu(bar, m.label, nativeMenu);
  }
  menuBarAttach(bar);
}
