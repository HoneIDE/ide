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
  if (command === 'file.openFile') {
    openFileAction();
  } else if (command === 'file.openFolder') {
    openFolderAction();
  } else if (command === 'view.toggleSidebar') {
    toggleSidebarAction();
  } else if (command === 'workbench.action.closeActiveEditor') {
    closeEditorAction();
  }
  // Other commands are no-ops for now
}

// ---------------------------------------------------------------------------
// Build native menus from menu data
// ---------------------------------------------------------------------------

function buildNativeMenu(items: MenuItem[]): unknown {
  const menu = menuCreate();
  const len = items.length;
  for (let i = 0; i < len; i = i + 1) {
    const mi = items[i];
    if (mi.type === 'separator') {
      menuAddSeparator(menu);
    } else if (mi.type === 'submenu' && mi.submenu) {
      const sub = buildNativeMenu(mi.submenu);
      menuAddSubmenu(menu, mi.label, sub);
    } else {
      const cmd = mi.command;
      if (mi.shortcut) {
        menuAddItem(menu, mi.label, () => { dispatchCommand(cmd); }, mi.shortcut);
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
