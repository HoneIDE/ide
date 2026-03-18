/**
 * Plugin status bar bridge — creates/updates/removes status bar items for plugins.
 *
 * Maps plugin host API calls to the workbench status bar system.
 * Perry-safe: module-level state, for-loops, no closures on `this`.
 */

import {
  createStatusBarEntry,
  updateStatusBarEntry,
  removeStatusBarEntry,
  type StatusBarAlignment,
} from '../../layout/status-bar';

// Track plugin-owned status bar items for cleanup on deactivate
let pluginItems: Map<number, string> = new Map(); // id -> entryId
let nextItemId: number = 10000; // Start high to avoid conflicts with built-in items

/**
 * Create a status bar item for a plugin.
 * Returns a numeric handle for future updates.
 */
export function pluginStatusBarCreate(
  pluginName: string,
  text: string,
  tooltip: string,
  alignment: string,
  priority: number,
  commandId: string,
): number {
  const id = nextItemId;
  nextItemId++;

  let entryId = 'plugin:';
  entryId += pluginName;
  entryId += ':';
  entryId += String(id);

  let align: StatusBarAlignment = 'right';
  if (alignment === 'left') align = 'left';
  if (alignment === 'center') align = 'center';

  createStatusBarEntry(entryId, {
    text: text,
    tooltip: tooltip,
    alignment: align,
    priority: priority,
    command: commandId.length > 0 ? commandId : null,
  });

  pluginItems.set(id, entryId);
  return id;
}

/**
 * Update a plugin's status bar item.
 */
export function pluginStatusBarUpdate(
  handle: number,
  text: string,
  tooltip: string,
): void {
  const entryId = pluginItems.get(handle);
  if (entryId === undefined) return;

  updateStatusBarEntry(entryId, {
    text: text,
    tooltip: tooltip,
  });
}

/**
 * Remove a plugin's status bar item.
 */
export function pluginStatusBarRemove(handle: number): void {
  const entryId = pluginItems.get(handle);
  if (entryId === undefined) return;

  removeStatusBarEntry(entryId);
  pluginItems.delete(handle);
}

/**
 * Remove all status bar items for a plugin (cleanup on deactivate).
 */
export function pluginStatusBarCleanup(pluginName: string): void {
  const prefix = 'plugin:' + pluginName + ':';
  const toRemove: number[] = [];
  const entries = Array.from(pluginItems.entries());
  for (let i = 0; i < entries.length; i++) {
    const handle = entries[i][0];
    const entryId = entries[i][1];
    if (entryId.indexOf(prefix) === 0) {
      removeStatusBarEntry(entryId);
      toRemove.push(handle);
    }
  }
  for (let i = 0; i < toRemove.length; i++) {
    pluginItems.delete(toRemove[i]);
  }
}
