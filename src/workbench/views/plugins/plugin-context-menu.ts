/**
 * Plugin context menu bridge — registers context menu items from plugins.
 *
 * Perry-safe: module-level state, for-loops.
 */

import { menuCreate, menuAddItem } from 'perry/ui';

export interface PluginContextMenuItem {
  id: number;
  pluginName: string;
  location: string;
  label: string;
  commandId: string;
  group: string;
}

let menuItems: Map<number, PluginContextMenuItem> = new Map();
let nextMenuId: number = 1;

/**
 * Register a context menu item from a plugin.
 */
export function pluginContextMenuRegister(
  pluginName: string,
  location: string,
  label: string,
  commandId: string,
  group: string,
): number {
  const id = nextMenuId;
  nextMenuId++;

  menuItems.set(id, {
    id: id,
    pluginName: pluginName,
    location: location,
    label: label,
    commandId: commandId,
    group: group,
  });

  return id;
}

/**
 * Unregister a context menu item.
 */
export function pluginContextMenuUnregister(handle: number): void {
  menuItems.delete(handle);
}

/**
 * Get all registered context menu items for a given location.
 */
export function getPluginContextMenuItems(location: string): PluginContextMenuItem[] {
  const result: PluginContextMenuItem[] = [];
  const entries = Array.from(menuItems.values());
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].location === location) {
      result.push(entries[i]);
    }
  }
  return result;
}

/**
 * Build a Perry menu from plugin context menu items for a location.
 */
export function buildPluginContextMenu(location: string, onCommand: (cmdId: string) => void): unknown | null {
  const items = getPluginContextMenuItems(location);
  if (items.length === 0) return null;

  const menu = menuCreate();
  for (let i = 0; i < items.length; i++) {
    const cmdId = items[i].commandId;
    menuAddItem(menu, items[i].label, () => { onCommand(cmdId); });
  }
  return menu;
}

/**
 * Cleanup all context menu items for a plugin.
 */
export function pluginContextMenuCleanup(pluginName: string): void {
  const toRemove: number[] = [];
  const entries = Array.from(menuItems.entries());
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][1].pluginName === pluginName) {
      toRemove.push(entries[i][0]);
    }
  }
  for (let i = 0; i < toRemove.length; i++) {
    menuItems.delete(toRemove[i]);
  }
}
