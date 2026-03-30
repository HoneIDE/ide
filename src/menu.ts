/**
 * Application menu — native menu bar on desktop, action sheets on mobile.
 *
 * Desktop: traditional File / Edit / View / ... menu bar
 * Tablet: condensed menu accessible via hamburger icon
 * Phone: action sheet triggered by "..." button
 */

import type { DeviceClass, Platform } from './platform';
import { t } from 'perry/i18n';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MenuItem {
  id: string;
  label: string;
  /** Command to execute. Null for separator or submenu-only items. */
  command: string | null;
  /** Keyboard shortcut display string (e.g. "Cmd+S"). */
  shortcut: string | null;
  /** Nested submenu items. */
  submenu: MenuItem[] | null;
  /** Whether this item is currently enabled. */
  enabled: boolean;
  /** Whether this item is currently checked (for toggles). */
  checked: boolean;
  /** 'separator' for a divider line. */
  type: 'normal' | 'separator' | 'submenu';
}

export interface MenuBar {
  menus: { label: string; items: MenuItem[] }[];
}

// ---------------------------------------------------------------------------
// Menu construction
// ---------------------------------------------------------------------------

function item(
  id: string,
  label: string,
  command: string,
  shortcut: string | null = null,
): MenuItem {
  return { id, label, command, shortcut, submenu: null, enabled: true, checked: false, type: 'normal' };
}

function separator(): MenuItem {
  return { id: '', label: '', command: null, shortcut: null, submenu: null, enabled: true, checked: false, type: 'separator' };
}

function submenu(id: string, label: string, items: MenuItem[]): MenuItem {
  return { id, label, command: null, shortcut: null, submenu: items, enabled: true, checked: false, type: 'submenu' };
}

// ---------------------------------------------------------------------------
// Desktop menu bar
// ---------------------------------------------------------------------------

export function buildDesktopMenuBar(platform: Platform): MenuBar {
  const mod = platform === 'macos' ? 'Cmd' : 'Ctrl';

  return {
    menus: [
      {
        label: t('File'),
        items: [
          item('menu.file.new', t('New File'), 'file.newFile', `${mod}+N`),
          item('menu.file.open', t('Open File...'), 'file.openFile', `${mod}+O`),
          item('menu.file.openFolder', t('Open Folder...'), 'file.openFolder', `${mod}+Shift+D`),
          submenu('menu.file.openRecent', t('Open Recent'), []),
          separator(),
          item('menu.file.save', t('Save'), 'file.save', `${mod}+S`),
          item('menu.file.saveAs', t('Save As...'), 'file.saveAs', `${mod}+Shift+S`),
          item('menu.file.saveAll', t('Save All'), 'file.saveAll'),
          separator(),
          item('menu.file.close', t('Close Editor'), 'workbench.action.closeActiveEditor', `${mod}+W`),
        ],
      },
      {
        label: t('Edit'),
        items: [
          item('menu.edit.undo', t('Undo'), 'edit.undo', `${mod}+Z`),
          item('menu.edit.redo', t('Redo'), 'edit.redo', `${mod}+Shift+Z`),
          separator(),
          item('menu.edit.cut', t('Cut'), 'edit.cut', `${mod}+X`),
          item('menu.edit.copy', t('Copy'), 'edit.copy', `${mod}+C`),
          item('menu.edit.paste', t('Paste'), 'edit.paste', `${mod}+V`),
          separator(),
          item('menu.edit.find', t('Find'), 'edit.find', `${mod}+F`),
          item('menu.edit.replace', t('Replace'), 'edit.replace', `${mod}+H`),
          separator(),
          item('menu.edit.selectAll', t('Select All'), 'edit.selectAll', `${mod}+A`),
          separator(),
          item('menu.edit.format', t('Format Document'), 'edit.formatDocument', `Shift+Alt+F`),
        ],
      },
      {
        label: t('View'),
        items: [
          item('menu.view.commandPalette', t('Command Palette...'), 'view.commandPalette', `${mod}+Shift+P`),
          item('menu.view.quickOpen', t('Quick Open...'), 'view.quickOpen', `${mod}+P`),
          separator(),
          item('menu.view.sidebar', t('Toggle Sidebar'), 'view.toggleSidebar', `${mod}+B`),
          item('menu.view.bottomPanel', t('Toggle Bottom Panel'), 'view.toggleBottomPanel', `${mod}+J`),
          item('menu.view.terminal', t('Toggle Terminal'), 'view.toggleTerminal', `${mod}+\``),
          separator(),
          item('menu.view.zoomIn', t('Zoom In'), 'view.zoomIn', `${mod}+=`),
          item('menu.view.zoomOut', t('Zoom Out'), 'view.zoomOut', `${mod}+-`),
          item('menu.view.resetZoom', t('Reset Zoom'), 'view.resetZoom', `${mod}+0`),
        ],
      },
      {
        label: t('Go'),
        items: [
          item('menu.go.goToFile', t('Go to File...'), 'view.quickOpen', `${mod}+P`),
          item('menu.go.goToLine', t('Go to Line...'), 'editor.action.goToLine', `${mod}+G`),
          item('menu.go.goToSymbol', t('Go to Symbol...'), 'editor.action.goToSymbol', `${mod}+Shift+O`),
        ],
      },
      {
        label: t('Help'),
        items: [
          item('menu.help.welcome', t('Welcome'), 'workbench.action.showWelcome'),
          item('menu.help.docs', t('Documentation'), 'workbench.action.openDocs'),
          separator(),
          item('menu.help.checkUpdates', t('Check for Updates...'), 'workbench.action.checkForUpdates'),
          separator(),
          item('menu.help.about', t('About Hone'), 'workbench.action.showAbout'),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Mobile action sheet
// ---------------------------------------------------------------------------

/**
 * Build a flat list of actions for the mobile action sheet ("..." menu).
 * Fewer items than the desktop menu — only the most common actions.
 */
export function buildMobileActions(deviceClass: DeviceClass): MenuItem[] {
  const actions: MenuItem[] = [
    item('mobile.newFile', t('New File'), 'file.newFile'),
    item('mobile.openFile', t('Open File'), 'file.openFile'),
    separator(),
    item('mobile.commandPalette', t('Command Palette'), 'view.commandPalette'),
    item('mobile.find', t('Find in File'), 'edit.find'),
    separator(),
    item('mobile.settings', t('Settings'), 'workbench.action.openSettings'),
    item('mobile.theme', t('Color Theme'), 'workbench.action.selectTheme'),
  ];

  if (deviceClass === 'tablet') {
    // Tablets get a few extra actions since they have more screen space
    actions.splice(5, 0,
      item('mobile.toggleSidebar', t('Toggle Sidebar'), 'view.toggleSidebar'),
      item('mobile.toggleBottomPanel', t('Toggle Bottom Panel'), 'view.toggleBottomPanel'),
    );
  }

  return actions;
}
