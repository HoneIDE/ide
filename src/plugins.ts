/**
 * Plugin system initialization — gated behind `if (__plugins__)`.
 *
 * When compiled with `perry compile --features plugins`, this module
 * sets up the native plugin host and wires all UI extension points:
 * - Status bar items (plugin-status-bar.ts)
 * - Command palette (plugin-commands.ts)
 * - Notifications (plugin-notifications.ts)
 * - Declarative panels (plugin-panels.ts)
 * - Editor decorations (plugin-decorations.ts)
 * - Context menus (plugin-context-menu.ts)
 *
 * When compiled without the flag, dead-code elimination removes
 * all references to this module and its imports.
 */

// Re-export all plugin bridge modules for use by the FFI layer
export {
  pluginStatusBarCreate,
  pluginStatusBarUpdate,
  pluginStatusBarRemove,
  pluginStatusBarCleanup,
} from './workbench/views/plugins/plugin-status-bar';

export {
  pluginCommandRegister,
  pluginCommandUnregister,
  pluginCommandCleanup,
  getPluginCommands,
  setCommandHookDispatcher,
} from './workbench/views/plugins/plugin-commands';

export {
  pluginNotify,
  setNotificationContainer,
} from './workbench/views/plugins/plugin-notifications';

export {
  pluginPanelCreate,
  pluginPanelUpdate,
  pluginPanelDispose,
  pluginPanelCleanup,
  getPluginPanelWidget,
  setPluginPanelColors,
} from './workbench/views/plugins/plugin-panels';

export {
  pluginCreateDecorationType,
  pluginSetDecorations,
  pluginClearDecorations,
  pluginDecorationCleanup,
  getDecorationsForBuffer,
  setDecorationRenderCallback,
} from './workbench/views/plugins/plugin-decorations';

export {
  pluginContextMenuRegister,
  pluginContextMenuUnregister,
  pluginContextMenuCleanup,
  buildPluginContextMenu,
} from './workbench/views/plugins/plugin-context-menu';

export {
  renderPanelElements,
  registerCommandCallback,
} from './workbench/views/plugins/panel-renderer';

export {
  pluginHostInit,
  pluginHostLoad,
  pluginHostUnload,
  pluginHostCount,
  pluginHostHasHook,
  pluginHostHookCount,
  pluginHostDispatchHook,
  pluginHostRegisterCallback,
  pluginHostScanAndLoad,
} from './workbench/views/plugins/plugin-ffi';

import {
  pluginHostInit,
  pluginHostScanAndLoad,
  pluginHostRegisterCallback,
  pluginHostCount,
  pluginHostDispatchHook as _dispatchHook,
  CALLBACK_NOTIFY,
  CALLBACK_STATUSBAR_CREATE,
  CALLBACK_STATUSBAR_UPDATE,
  CALLBACK_STATUSBAR_REMOVE,
  CALLBACK_COMMAND_REGISTER,
  CALLBACK_COMMAND_UNREGISTER,
} from './workbench/views/plugins/plugin-ffi';

import { pluginNotify } from './workbench/views/plugins/plugin-notifications';
import { pluginStatusBarCreate, pluginStatusBarUpdate, pluginStatusBarRemove } from './workbench/views/plugins/plugin-status-bar';
import { pluginCommandRegister, pluginCommandUnregister, setCommandHookDispatcher } from './workbench/views/plugins/plugin-commands';
import { getAppDataDir } from './workbench/paths';

let pluginsInitialized: number = 0;
let loadedPluginCount: number = 0;

// ---------------------------------------------------------------------------
// Host callback bridge functions (module-level, Perry-safe)
// ---------------------------------------------------------------------------

/** Called from Rust when a plugin calls host.notify(). */
function onPluginNotify(pluginName: string, message: string, severity: string): void {
  pluginNotify(pluginName, message, severity);
}

/** Called from Rust when a plugin calls host.statusBar.addItem(). */
function onPluginStatusBarCreate(
  pluginName: string, text: string, tooltip: string,
  alignment: string, priority: number, commandId: string,
): number {
  return pluginStatusBarCreate(pluginName, text, tooltip, alignment, priority, commandId);
}

/** Called from Rust when a plugin calls host.statusBar.updateItem(). */
function onPluginStatusBarUpdate(handle: number, text: string, tooltip: string): void {
  pluginStatusBarUpdate(handle, text, tooltip);
}

/** Called from Rust when a plugin calls host.statusBar.removeItem(). */
function onPluginStatusBarRemove(handle: number): void {
  pluginStatusBarRemove(handle);
}

/** Called from Rust when a plugin calls host.command.register(). */
function onPluginCommandRegister(pluginName: string, commandId: string, title: string): void {
  pluginCommandRegister(pluginName, commandId, title);
}

/** Called from Rust when a plugin calls host.command.unregister(). */
function onPluginCommandUnregister(commandId: string): void {
  pluginCommandUnregister(commandId);
}

// ---------------------------------------------------------------------------
// Plugin system init
// ---------------------------------------------------------------------------

/** Initialize the plugin system. Called from app.ts when __plugins__ === 1. */
export function initPluginSystem(): void {
  if (pluginsInitialized > 0) return;
  pluginsInitialized = 1;

  // 0. Wire the command hook dispatcher so plugin commands dispatch onCommand hooks
  setCommandHookDispatcher(dispatchPluginHookInternal);

  // 1. Initialize the native plugin host
  const initResult = pluginHostInit();
  if (initResult < 1) {
    console.log('Plugin host init failed');
    return;
  }

  // 2. Register TypeScript callbacks with the Rust host
  pluginHostRegisterCallback(CALLBACK_NOTIFY, onPluginNotify as any);
  pluginHostRegisterCallback(CALLBACK_STATUSBAR_CREATE, onPluginStatusBarCreate as any);
  pluginHostRegisterCallback(CALLBACK_STATUSBAR_UPDATE, onPluginStatusBarUpdate as any);
  pluginHostRegisterCallback(CALLBACK_STATUSBAR_REMOVE, onPluginStatusBarRemove as any);
  pluginHostRegisterCallback(CALLBACK_COMMAND_REGISTER, onPluginCommandRegister as any);
  pluginHostRegisterCallback(CALLBACK_COMMAND_UNREGISTER, onPluginCommandUnregister as any);

  // 3. Scan {appDataDir}/plugins/ for installed plugins and load them.
  // SHIP-V1-GAPS.md followup §5: previous literal `~/.hone/plugins` was
  // never expanded — Rust FFI takes it verbatim, so no platform actually
  // found the dir. `getAppDataDir()` resolves to `%USERPROFILE%/.hone` on
  // Windows, `$HOME/.hone` on Unix.
  const pluginsDir = getAppDataDir() + '/plugins';
  const loaded = pluginHostScanAndLoad(pluginsDir as any);
  loadedPluginCount = loaded;

  console.log('Plugin system initialized');
  if (loaded > 0) {
    let msg = 'Loaded ';
    msg += String(loaded);
    msg += ' plugin(s)';
    console.log(msg);
  }
}

/** Check if the plugin system is available. */
export function isPluginSystemEnabled(): number {
  return pluginsInitialized;
}

/** Get the number of currently loaded plugins. */
export function getLoadedPluginCount(): number {
  return loadedPluginCount;
}

/**
 * Internal hook dispatch — doesn't check pluginsInitialized.
 * Used by setCommandHookDispatcher which may fire before init completes.
 */
function dispatchPluginHookInternal(hookName: string, eventDataJson: string): void {
  _dispatchHook(hookName, eventDataJson);
}

/**
 * Dispatch a hook to all registered plugin handlers.
 * Called from IDE event points (save, open, format, etc.).
 */
export function dispatchPluginHook(hookName: string, eventDataJson: string): void {
  if (pluginsInitialized < 1) return;
  _dispatchHook(hookName, eventDataJson);
}
