/**
 * Window management — handles window lifecycle, dimensions, and
 * multi-window support (iPad Stage Manager, macOS, etc.).
 */

import type { Platform, PlatformContext } from './platform';

// Perry window management APIs
declare function perry_create_window(title: string, width: number, height: number): number;
declare function perry_close_window(handle: number): void;
declare function perry_set_window_title(handle: number, title: string): void;
declare function perry_set_window_size(handle: number, width: number, height: number): void;
declare function perry_get_window_size(handle: number): { width: number; height: number };
declare function perry_set_fullscreen(handle: number, fullscreen: boolean): void;
declare function perry_is_fullscreen(handle: number): boolean;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WindowConfig {
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface WindowState {
  handle: number;
  title: string;
  width: number;
  height: number;
  fullscreen: boolean;
}

// ---------------------------------------------------------------------------
// Default window sizes per platform
// ---------------------------------------------------------------------------

export function getDefaultWindowConfig(platform: Platform): WindowConfig {
  switch (platform) {
    case 'macos':
    case 'windows':
    case 'linux':
      return { title: 'Hone', width: 1400, height: 900, minWidth: 800, minHeight: 600 };
    case 'ipados':
      // iPad defaults to full screen; these are for Stage Manager
      return { title: 'Hone', width: 1024, height: 768, minWidth: 600, minHeight: 400 };
    case 'ios':
    case 'android':
      // Mobile uses the full screen — dimensions are informational
      return { title: 'Hone', width: 0, height: 0, minWidth: 0, minHeight: 0 };
    case 'web':
      return { title: 'Hone', width: 1280, height: 800, minWidth: 600, minHeight: 400 };
  }
}

// ---------------------------------------------------------------------------
// Window manager
// ---------------------------------------------------------------------------

const _windows: Map<number, WindowState> = new Map();
const _listeners: Set<(windows: WindowState[]) => void> = new Set();
let _primaryHandle: number = -1;

/**
 * Create the primary application window.
 */
export function createPrimaryWindow(ctx: PlatformContext): WindowState {
  const config = getDefaultWindowConfig(ctx.platform);

  // On mobile, use the screen dimensions directly
  const width = ctx.deviceClass === 'phone' || ctx.deviceClass === 'tablet'
    ? ctx.screen.width
    : config.width;
  const height = ctx.deviceClass === 'phone' || ctx.deviceClass === 'tablet'
    ? ctx.screen.height
    : config.height;

  let handle: number;
  try {
    handle = perry_create_window(config.title, width, height);
  } catch {
    // Test environment — use a mock handle
    handle = 1;
  }

  const state: WindowState = {
    handle,
    title: config.title,
    width,
    height,
    fullscreen: false,
  };

  _windows.set(handle, state);
  _primaryHandle = handle;
  notifyListeners();
  return state;
}

export function getPrimaryWindow(): WindowState | null {
  return _windows.get(_primaryHandle) ?? null;
}

export function getAllWindows(): WindowState[] {
  return Array.from(_windows.values());
}

export function setWindowTitle(handle: number, title: string): void {
  const win = _windows.get(handle);
  if (!win) return;
  win.title = title;
  try { perry_set_window_title(handle, title); } catch { /* test env */ }
  notifyListeners();
}

export function updateWindowSize(handle: number, width: number, height: number): void {
  const win = _windows.get(handle);
  if (!win) return;
  win.width = width;
  win.height = height;
  notifyListeners();
}

export function closeWindow(handle: number): void {
  try { perry_close_window(handle); } catch { /* test env */ }
  _windows.delete(handle);
  notifyListeners();
}

export function onWindowsChange(listener: (windows: WindowState[]) => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

/** Reset all windows. Used in tests. */
export function clearWindows(): void {
  _windows.clear();
  _primaryHandle = -1;
}

function notifyListeners(): void {
  const windows = getAllWindows();
  for (const fn of _listeners) fn(windows);
}
