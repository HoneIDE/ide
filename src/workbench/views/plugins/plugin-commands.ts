/**
 * Plugin command palette bridge — registers/unregisters commands for plugins.
 *
 * Wired into the real command system (commands.ts) so plugin commands appear
 * in the command palette (Cmd+Shift+P).
 *
 * When a plugin command is executed, also dispatches the 'onCommand' hook
 * so plugins can react to command invocations.
 *
 * Perry-safe: module-level state, for-loops.
 */

import { registerCommand } from '../../../commands';

// Track registered plugin commands: commandId -> title
let pluginCommands: Map<string, string> = new Map();

// Track unregister functions from the command system
let pluginCommandDisposers: Map<string, () => void> = new Map();

// Optional hook dispatch callback — set from plugins.ts to avoid circular imports
let hookDispatchFn: ((hookName: string, eventJson: string) => void) | null = null;

/**
 * Set the function used to dispatch hooks when plugin commands execute.
 * Called once during plugin system init to avoid circular imports.
 */
export function setCommandHookDispatcher(fn: (hookName: string, eventJson: string) => void): void {
  hookDispatchFn = fn;
}

/**
 * Register a command from a plugin.
 * The command appears in the command palette (Cmd+Shift+P).
 */
export function pluginCommandRegister(
  pluginName: string,
  commandId: string,
  title: string,
): void {
  pluginCommands.set(commandId, title);

  // Build a display title with plugin prefix
  let displayTitle = title;
  if (pluginName.length > 0) {
    displayTitle = pluginName;
    displayTitle += ': ';
    displayTitle += title;
  }

  // Register with the real command system so it appears in the palette
  const dispose = registerCommand(commandId, displayTitle, () => {
    executePluginCommand(commandId);
  }, { category: 'Extensions', showInPalette: true });

  pluginCommandDisposers.set(commandId, dispose);
}

/**
 * Unregister a command from a plugin.
 */
export function pluginCommandUnregister(commandId: string): void {
  pluginCommands.delete(commandId);
  const dispose = pluginCommandDisposers.get(commandId);
  if (dispose !== undefined) {
    dispose();
    pluginCommandDisposers.delete(commandId);
  }
}

/**
 * Get all registered plugin commands.
 */
export function getPluginCommands(): { commandId: string; title: string }[] {
  const result: { commandId: string; title: string }[] = [];
  const entries = Array.from(pluginCommands.entries());
  for (let i = 0; i < entries.length; i++) {
    result.push({ commandId: entries[i][0], title: entries[i][1] });
  }
  return result;
}

/**
 * Remove all commands for a plugin (cleanup on deactivate).
 */
export function pluginCommandCleanup(pluginName: string): void {
  const prefix = pluginName + '.';
  const toRemove: string[] = [];
  const keys = Array.from(pluginCommands.keys());
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(prefix) === 0) {
      toRemove.push(keys[i]);
    }
  }
  for (let i = 0; i < toRemove.length; i++) {
    pluginCommandUnregister(toRemove[i]);
  }
}

/**
 * Execute a plugin command — dispatches the onCommand hook.
 * Module-level function (Perry-safe).
 */
function executePluginCommand(commandId: string): void {
  if (hookDispatchFn !== null) {
    let eventJson = '{"commandId":"';
    eventJson += commandId;
    eventJson += '"}';
    hookDispatchFn('onCommand', eventJson);
  }
}
