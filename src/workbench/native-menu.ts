/**
 * Native menu bar setup — wires perry/ui menu functions to the app menu data.
 */

import { buildDesktopMenuBar } from '../menu';
import type { MenuItem } from '../menu';
import { getPlatformContext } from '../platform';
import {
  menuCreate, menuAddItem, menuAddSeparator, menuAddSubmenu,
  menuAddStandardAction,
  menuBarCreate, menuBarAddMenu, menuBarAttach,
} from 'perry/ui';
import {
  openFolderAction, openFileAction, toggleSidebarAction, closeEditorAction,
  checkForUpdatesAction, formatDocumentAction, goToDefinitionAction,
  newFileAction, findAction, replaceAction, openRecentItem,
  saveFileAction, saveFileAsAction,
} from './render';
import {
  getRecentCount, getRecentPath, getRecentType, clearRecentItems,
} from './views/recent/recent-store';

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
  } else if (command.length === 32 && command.charCodeAt(10) === 97 && command.charCodeAt(17) === 99) {
    // workbench.action.checkForUpdates (length 32, charCodeAt(10)='a', charCodeAt(17)='c')
    checkForUpdatesAction();
  } else if (command.length === 15 && command.charCodeAt(0) === 101 && command.charCodeAt(5) === 102) {
    // edit.formatDocument (length 15, 'e'dit.'f'ormatDocument)
    formatDocumentAction();
  } else if (command.length === 20 && command.charCodeAt(0) === 103 && command.charCodeAt(5) === 100) {
    // go.toDefinition (length 20, 'g'o.to'D'efinition — approximate)
    goToDefinitionAction();
  } else if (command.length === 12 && command.charCodeAt(0) === 102 && command.charCodeAt(5) === 110) {
    // file.newFile (length 12, 'f'ile.'n'ewFile)
    newFileAction();
  } else if (command.length === 9 && command.charCodeAt(0) === 101 && command.charCodeAt(5) === 102) {
    // edit.find (length 9, 'e'dit.'f'ind)
    findAction();
  } else if (command.length === 12 && command.charCodeAt(0) === 101 && command.charCodeAt(5) === 114) {
    // edit.replace (length 12, 'e'dit.'r'eplace)
    replaceAction();
  } else if (command.length === 9 && command.charCodeAt(0) === 102 && command.charCodeAt(5) === 115) {
    // file.save (length 9, 'f'ile.'s'ave)
    saveFileAction();
  } else if (command.length === 11 && command.charCodeAt(0) === 102 && command.charCodeAt(5) === 115) {
    // file.saveAs (length 11, 'f'ile.'s'aveAs)
    saveFileAsAction();
  }
}

// ---------------------------------------------------------------------------
// Standard action mapping — Edit menu items that go via responder chain
// ---------------------------------------------------------------------------

/**
 * Map edit commands to their macOS selectors.
 * Returns the selector string (e.g. "copy:") or empty string if not a standard action.
 * Perry-safe: uses length + charCodeAt matching.
 */
function getStandardSelector(cmd: string): string {
  // edit.cut (length 8, 'e'=101, 'd'=100, '.'=46, 'c'=99, 'u'=117, 't'=116)
  if (cmd.length === 8 && cmd.charCodeAt(0) === 101 && cmd.charCodeAt(5) === 99 && cmd.charCodeAt(7) === 116) return 'cut:';
  // edit.copy (length 9, starts with 'e', charCodeAt(5)='c', charCodeAt(8)='y')
  if (cmd.length === 9 && cmd.charCodeAt(0) === 101 && cmd.charCodeAt(5) === 99 && cmd.charCodeAt(8) === 121) return 'copy:';
  // edit.paste (length 10, starts with 'e', charCodeAt(5)='p')
  if (cmd.length === 10 && cmd.charCodeAt(0) === 101 && cmd.charCodeAt(5) === 112) return 'paste:';
  // NOTE: undo/redo intentionally NOT standard actions — macOS disables them
  // when no NSUndoManager exists. Cmd+Z handled in Rust keyDown instead.
  // edit.selectAll (length 14, starts with 'e', charCodeAt(5)='s')
  if (cmd.length === 14 && cmd.charCodeAt(0) === 101 && cmd.charCodeAt(5) === 115) return 'selectAll:';
  return '';
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
    } else if (isSubmenu(mi)) {
      // Check if this is the "Open Recent" submenu (id = menu.file.openRecent, length 20)
      if (mi.id.length === 20 && mi.id.charCodeAt(10) === 111 && mi.id.charCodeAt(14) === 82) {
        // 'o'penRecent at 10, 'R'ecent at 14
        const sub = buildRecentSubmenu();
        menuAddSubmenu(menu, mi.label, sub);
      } else if (mi.submenu) {
        const sub = buildNativeMenu(mi.submenu);
        menuAddSubmenu(menu, mi.label, sub);
      }
    } else {
      const cmd = mi.command || '';
      let shortcut = mi.shortcut || '';

      // Strip shortcuts from undo/redo — Cmd+Z handled in Rust keyDown.
      // Without this, menu captures Cmd+Z and macOS disables it (no NSUndoManager).
      // edit.undo: length 9, charCodeAt(5)='u'=117; edit.redo: length 9, charCodeAt(5)='r'=114
      if (cmd.length === 9 && cmd.charCodeAt(0) === 101) {
        if (cmd.charCodeAt(5) === 117 || cmd.charCodeAt(5) === 114) {
          shortcut = '';
        }
      }

      // Check if this is a standard Edit action (copy/paste/cut/selectAll).
      // These use nil-target NSMenuItem so macOS routes via responder chain.
      const selector = getStandardSelector(cmd);
      if (selector.length > 0 && shortcut.length > 0) {
        menuAddStandardAction(menu, mi.label, selector, shortcut);
      } else if (shortcut.length > 0) {
        menuAddItem(menu, mi.label, () => { dispatchCommand(cmd); }, shortcut);
      } else {
        menuAddItem(menu, mi.label, () => { dispatchCommand(cmd); });
      }
    }
  }
  return menu;
}

// ---------------------------------------------------------------------------
// Recent submenu
// ---------------------------------------------------------------------------

let pendingRecentIdx: number = -1;

function onRecentClick(idx: number): void {
  pendingRecentIdx = idx;
  setTimeout(() => { onRecentClickDeferred(); }, 0);
}

function onRecentClickDeferred(): void {
  const idx = pendingRecentIdx;
  if (idx < 0) return;
  pendingRecentIdx = -1;
  openRecentItem(idx);
}

function onClearRecentClick(): void {
  setTimeout(() => { clearRecentItems(); }, 0);
}

function buildRecentSubmenu(): unknown {
  const sub = menuCreate();
  const count = getRecentCount();
  if (count < 1) {
    menuAddItem(sub, '(No Recent Items)', () => {});
    return sub;
  }
  for (let i = 0; i < count; i++) {
    const idx = i;
    const path = getRecentPath(i);
    // Extract display name: last path segment
    let lastSlash = -1;
    for (let j = path.length - 1; j >= 0; j--) {
      if (path.charCodeAt(j) === 47 || path.charCodeAt(j) === 92) {
        lastSlash = j;
        break;
      }
    }
    let label = path;
    if (lastSlash >= 0) {
      label = path.slice(lastSlash + 1);
    }
    menuAddItem(sub, label, () => { onRecentClick(idx); });
  }
  menuAddSeparator(sub);
  menuAddItem(sub, 'Clear Recent', () => { onClearRecentClick(); });
  return sub;
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
