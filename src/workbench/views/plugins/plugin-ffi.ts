/**
 * Plugin FFI bridge — declares and wraps native plugin host functions.
 *
 * Import PLUGINS_LIVE to trigger Perry's package.json FFI discovery.
 * All functions delegate to the Rust hone-plugin-host static library.
 *
 * Perry-safe: module-level state, no closures on `this`.
 */

import { PLUGINS_LIVE } from '@honeide/plugins/perry/live';

// FFI declarations (resolved by Perry codegen)
declare function hone_plugin_init(): number;
declare function hone_plugin_load(pathPtr: number): number;
declare function hone_plugin_unload(handle: number): number;
declare function hone_plugin_count(): number;
declare function hone_plugin_has_hook(hookNamePtr: number): number;
declare function hone_plugin_hook_count(): number;
declare function hone_plugin_dispatch_hook(hookNamePtr: number, eventDataPtr: number): number;
declare function hone_plugin_register_host_callback(callbackId: number, fnPtr: number): number;
declare function hone_plugin_scan_and_load(dirPtr: number): number;

// Ensure import is retained
const _pluginsLive = PLUGINS_LIVE;

// ---------------------------------------------------------------------------
// Callback IDs for hone_plugin_register_host_callback
// ---------------------------------------------------------------------------

/** Callback IDs must match the Rust side in host_api.rs */
export const CALLBACK_NOTIFY = 1;
export const CALLBACK_STATUSBAR_CREATE = 2;
export const CALLBACK_STATUSBAR_UPDATE = 3;
export const CALLBACK_STATUSBAR_REMOVE = 4;
export const CALLBACK_COMMAND_REGISTER = 5;
export const CALLBACK_COMMAND_UNREGISTER = 6;

// ---------------------------------------------------------------------------
// Exported wrappers — called from plugins.ts
// ---------------------------------------------------------------------------

/** Initialize the native plugin host. Returns 1 on success. */
export function pluginHostInit(): number {
  return hone_plugin_init();
}

/** Load a plugin from a directory path. Returns handle > 0, or 0 on failure. */
export function pluginHostLoad(path: string): number {
  return hone_plugin_load(path as any);
}

/** Unload a plugin by handle. Returns 1 on success. */
export function pluginHostUnload(handle: number): number {
  return hone_plugin_unload(handle);
}

/** Get the number of loaded plugins. */
export function pluginHostCount(): number {
  return hone_plugin_count();
}

/** Check if any plugin is registered for a hook. Returns 1 if yes. */
export function pluginHostHasHook(hookName: string): number {
  return hone_plugin_has_hook(hookName as any);
}

/** Get total number of hook registrations. */
export function pluginHostHookCount(): number {
  return hone_plugin_hook_count();
}

/** Dispatch a hook to all registered plugin handlers. */
export function pluginHostDispatchHook(hookName: string, eventDataJson: string): number {
  return hone_plugin_dispatch_hook(hookName as any, eventDataJson as any);
}

/**
 * Register a TypeScript callback with the Rust host.
 * The callback_id identifies which host API function to wire.
 * The fn_ptr is a function reference.
 */
export function pluginHostRegisterCallback(callbackId: number, fnPtr: number): number {
  return hone_plugin_register_host_callback(callbackId, fnPtr);
}

/** Scan a directory for plugins and load each one. Returns count loaded. */
export function pluginHostScanAndLoad(dirPath: string): number {
  return hone_plugin_scan_and_load(dirPath as any);
}
