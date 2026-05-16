/**
 * Plugin FFI bridge — inert stub.
 *
 * The native plugin host (`@honeide/plugins` → `hone_plugin_*` static
 * library) is NOT part of v1: the plugin/marketplace surface is explicitly
 * out of scope (SHIP-V1-GAPS #12 marketplace-mock, #56 @honeide/api has no
 * runtime, #58 workspace-trust gating absent), and the `@honeide/plugins`
 * package is not installed in this checkout. Declaring the `hone_plugin_*`
 * FFI here made Perry emit hard link references to nine native symbols that
 * nothing provides on ANY platform without that package — the Windows build
 * failed to link on exactly these (`hone_plugin_init`, `…_scan_and_load`,
 * `…_dispatch_hook`, …).
 *
 * Until the plugin host actually ships, this module degrades gracefully:
 * every wrapper is a pure-TS no-op returning the "unavailable / nothing
 * loaded" value (0). The plugin subsystem therefore reports zero plugins
 * and zero hooks rather than failing the entire app's link. The exported
 * API surface is unchanged, so `plugins.ts` and other callers compile and
 * run untouched — they simply observe an empty plugin host. Restoring real
 * behaviour is a single change: reinstate the `@honeide/plugins` import +
 * the `declare function hone_plugin_*` block and delegate to them again.
 *
 * Perry-safe: module-level functions only, no FFI, no closures on `this`.
 */

// ---------------------------------------------------------------------------
// Callback IDs for the (future) host callback registration
// ---------------------------------------------------------------------------

/** Callback IDs must match the Rust side in host_api.rs (kept for API
 *  stability — referenced by plugins.ts). */
export const CALLBACK_NOTIFY = 1;
export const CALLBACK_STATUSBAR_CREATE = 2;
export const CALLBACK_STATUSBAR_UPDATE = 3;
export const CALLBACK_STATUSBAR_REMOVE = 4;
export const CALLBACK_COMMAND_REGISTER = 5;
export const CALLBACK_COMMAND_UNREGISTER = 6;

// ---------------------------------------------------------------------------
// Exported wrappers — called from plugins.ts. All inert until the native
// plugin host ships. 0 == "no plugin host / nothing loaded / not handled",
// which every caller already treats as the not-available path.
// ---------------------------------------------------------------------------

/** Initialize the native plugin host. 0 = host unavailable (not v1). */
export function pluginHostInit(): number {
  return 0;
}

/** Load a plugin from a directory path. 0 = failure (no host). */
export function pluginHostLoad(path: string): number {
  return 0;
}

/** Unload a plugin by handle. 0 = failure (no host). */
export function pluginHostUnload(handle: number): number {
  return 0;
}

/** Number of loaded plugins. Always 0 (no host). */
export function pluginHostCount(): number {
  return 0;
}

/** Whether any plugin is registered for a hook. Always 0 (no host). */
export function pluginHostHasHook(hookName: string): number {
  return 0;
}

/** Total number of hook registrations. Always 0 (no host). */
export function pluginHostHookCount(): number {
  return 0;
}

/** Dispatch a hook to plugin handlers. 0 = nothing dispatched (no host). */
export function pluginHostDispatchHook(hookName: string, eventDataJson: string): number {
  return 0;
}

/** Register a TS callback with the host. 0 = not registered (no host). */
export function pluginHostRegisterCallback(callbackId: number, fnPtr: number): number {
  return 0;
}

/** Scan a directory for plugins and load each. 0 = none loaded (no host). */
export function pluginHostScanAndLoad(dirPath: string): number {
  return 0;
}
