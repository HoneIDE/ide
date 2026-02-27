/**
 * Application menu — native menu bar on desktop, action sheets on mobile.
 *
 * Desktop: traditional File / Edit / View / ... menu bar
 * Tablet: condensed menu accessible via hamburger icon
 * Phone: action sheet triggered by "..." button
 */

import type { DeviceClass, Platform } from './platform';

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
        label: 'File',
        items: [
          item('menu.file.new', 'New File', 'file.newFile', `${mod}+N`),
          item('menu.file.open', 'Open File...', 'file.openFile', `${mod}+O`),
          item('menu.file.openFolder', 'Open Folder...', 'file.openFolder'),
          separator(),
          item('menu.file.save', 'Save', 'file.save', `${mod}+S`),
          item('menu.file.saveAs', 'Save As...', 'file.saveAs', `${mod}+Shift+S`),
          item('menu.file.saveAll', 'Save All', 'file.saveAll'),
          separator(),
          item('menu.file.close', 'Close Editor', 'workbench.action.closeActiveEditor', `${mod}+W`),
        ],
      },
      {
        label: 'Edit',
        items: [
          item('menu.edit.undo', 'Undo', 'edit.undo', `${mod}+Z`),
          item('menu.edit.redo', 'Redo', 'edit.redo', `${mod}+Shift+Z`),
          separator(),
          item('menu.edit.cut', 'Cut', 'edit.cut', `${mod}+X`),
          item('menu.edit.copy', 'Copy', 'edit.copy', `${mod}+C`),
          item('menu.edit.paste', 'Paste', 'edit.paste', `${mod}+V`),
          separator(),
          item('menu.edit.find', 'Find', 'edit.find', `${mod}+F`),
          item('menu.edit.replace', 'Replace', 'edit.replace', `${mod}+H`),
          separator(),
          item('menu.edit.selectAll', 'Select All', 'edit.selectAll', `${mod}+A`),
        ],
      },
      {
        label: 'View',
        items: [
          item('menu.view.commandPalette', 'Command Palette...', 'view.commandPalette', `${mod}+Shift+P`),
          item('menu.view.quickOpen', 'Quick Open...', 'view.quickOpen', `${mod}+P`),
          separator(),
          item('menu.view.sidebar', 'Toggle Sidebar', 'view.toggleSidebar', `${mod}+B`),
          item('menu.view.bottomPanel', 'Toggle Bottom Panel', 'view.toggleBottomPanel', `${mod}+J`),
          item('menu.view.terminal', 'Toggle Terminal', 'view.toggleTerminal', `${mod}+\``),
          separator(),
          item('menu.view.zoomIn', 'Zoom In', 'view.zoomIn', `${mod}+=`),
          item('menu.view.zoomOut', 'Zoom Out', 'view.zoomOut', `${mod}+-`),
          item('menu.view.resetZoom', 'Reset Zoom', 'view.resetZoom', `${mod}+0`),
        ],
      },
      {
        label: 'Go',
        items: [
          item('menu.go.goToFile', 'Go to File...', 'view.quickOpen', `${mod}+P`),
          item('menu.go.goToLine', 'Go to Line...', 'editor.action.goToLine', `${mod}+G`),
          item('menu.go.goToSymbol', 'Go to Symbol...', 'editor.action.goToSymbol', `${mod}+Shift+O`),
        ],
      },
      {
        label: 'Help',
        items: [
          item('menu.help.welcome', 'Welcome', 'workbench.action.showWelcome'),
          item('menu.help.docs', 'Documentation', 'workbench.action.openDocs'),
          separator(),
          item('menu.help.about', 'About Hone', 'workbench.action.showAbout'),
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
    item('mobile.newFile', 'New File', 'file.newFile'),
    item('mobile.openFile', 'Open File', 'file.openFile'),
    separator(),
    item('mobile.commandPalette', 'Command Palette', 'view.commandPalette'),
    item('mobile.find', 'Find in File', 'edit.find'),
    separator(),
    item('mobile.settings', 'Settings', 'workbench.action.openSettings'),
    item('mobile.theme', 'Color Theme', 'workbench.action.selectTheme'),
  ];

  if (deviceClass === 'tablet') {
    // Tablets get a few extra actions since they have more screen space
    actions.splice(5, 0,
      item('mobile.toggleSidebar', 'Toggle Sidebar', 'view.toggleSidebar'),
      item('mobile.toggleBottomPanel', 'Toggle Bottom Panel', 'view.toggleBottomPanel'),
    );
  }

  return actions;
}
