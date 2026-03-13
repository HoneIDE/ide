/**
 * Platform-aware path resolution.
 *
 * Replaces hardcoded `/bin/echo $HOME`, `/tmp`, and `~/.hone/` with
 * paths that work on macOS, iOS (sandbox), and Android (app-specific storage).
 *
 * Perry injects `__platform__` at compile time:
 *   0 = macOS, 1 = iOS, 2 = Android, 3 = Windows, 4 = Linux, 5 = Web
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

declare const __platform__: number;

// Cached resolved paths
let _homeDir = '';
let _tempDir = '';
let _appDataDir = '';

/**
 * iOS Documents directory via Perry FFI.
 * Returns the app sandbox Documents path (e.g. /var/mobile/.../Documents).
 */
declare function hone_get_documents_dir(): string;

/**
 * Android app-specific files directory via Perry FFI.
 * Returns the internal storage path (e.g. /data/data/com.hone.ide/files).
 */
declare function hone_get_app_files_dir(): string;

function trimNewline(s: string): string {
  let end = s.length;
  while (end > 0) {
    const ch = s.charCodeAt(end - 1);
    if (ch === 10 || ch === 13 || ch === 32) {
      end = end - 1;
    } else {
      break;
    }
  }
  if (end < s.length) return s.slice(0, end);
  return s;
}

/**
 * Get the user's home directory. Platform-aware:
 * - macOS/Linux: `$HOME` via shell
 * - iOS: Documents directory (sandbox)
 * - Android: app-specific files directory
 * - Windows: `%USERPROFILE%` via shell
 */
export function getHomeDir(): string {
  if (_homeDir.length > 0) return _homeDir;

  // Web — use virtual documents directory (localStorage-backed)
  if (__platform__ === 5) {
    _homeDir = '/documents';
    return _homeDir;
  }

  // iOS — use Documents directory (sandbox, no $HOME)
  if (__platform__ === 1) {
    try {
      const docs = hone_get_documents_dir();
      if (docs.length > 0) { _homeDir = docs; return _homeDir; }
    } catch (e: any) {}
    // Fallback: known iOS simulator path pattern
    _homeDir = '/tmp';
    return _homeDir;
  }

  // Android — use app-specific files directory
  if (__platform__ === 2) {
    try {
      const appDir = hone_get_app_files_dir();
      if (appDir.length > 0) { _homeDir = appDir; return _homeDir; }
    } catch (e: any) {}
    _homeDir = '/tmp';
    return _homeDir;
  }

  // macOS (0), Linux (4) — use $HOME via shell
  if (__platform__ === 0 || __platform__ === 4) {
    try {
      const result = execSync('/bin/echo $HOME') as unknown as string;
      const dir = trimNewline(result);
      if (dir.length > 0) { _homeDir = dir; return _homeDir; }
    } catch (e: any) {}
  }

  // Windows (3) — use %USERPROFILE%
  if (__platform__ === 3) {
    try {
      const result = execSync('echo %USERPROFILE%') as unknown as string;
      const dir = trimNewline(result);
      if (dir.length > 0) { _homeDir = dir; return _homeDir; }
    } catch (e: any) {}
  }

  // Final fallback
  _homeDir = '/tmp';
  return _homeDir;
}

/**
 * Get the temporary directory. Platform-aware:
 * - macOS/Linux/Windows: /tmp (or system temp)
 * - iOS: Documents/tmp (sandbox-safe)
 * - Android: app cache directory
 */
export function getTempDir(): string {
  if (_tempDir.length > 0) return _tempDir;

  if (__platform__ === 1) {
    // iOS: use Documents/tmp (sandbox-safe)
    let dir = getHomeDir();
    dir += '/tmp';
    ensureDirExists(dir);
    _tempDir = dir;
    return _tempDir;
  }

  if (__platform__ === 2) {
    // Android: use app files/tmp
    let dir = getHomeDir();
    dir += '/tmp';
    ensureDirExists(dir);
    _tempDir = dir;
    return _tempDir;
  }

  if (__platform__ === 5) {
    // Web: use virtual tmp under documents
    let dir = getHomeDir();
    dir += '/tmp';
    ensureDirExists(dir);
    _tempDir = dir;
    return _tempDir;
  }

  _tempDir = '/tmp';
  return _tempDir;
}

/**
 * Get the app data directory (~/.hone/ equivalent). Platform-aware:
 * - macOS/Linux: ~/.hone/
 * - iOS: Documents/.hone/
 * - Android: appFiles/.hone/
 * - Windows: %USERPROFILE%/.hone/
 */
export function getAppDataDir(): string {
  if (_appDataDir.length > 0) {
    // Return a copy to prevent callers from mutating _appDataDir via +=
    let copy = '';
    copy += _appDataDir;
    return copy;
  }

  let dir = getHomeDir();
  dir += '/.hone';
  ensureDirExists(dir);
  _appDataDir = dir;
  // Return a copy
  let copy = '';
  copy += _appDataDir;
  return copy;
}

/**
 * Get the chats directory (~/.hone/chats/).
 */
let _chatsDir = '';
export function getChatsDir(): string {
  if (_chatsDir.length > 0) return _chatsDir;
  const base = getAppDataDir();
  let dir = '';
  dir += base;
  dir += '/chats';
  ensureDirExists(dir);
  _chatsDir = dir;
  return _chatsDir;
}

function ensureDirExists(dir: string): void {
  if (!existsSync(dir)) {
    try { mkdirSync(dir); } catch (e: any) { /* ignore */ }
  }
}

/**
 * Get the current working directory. Platform-aware:
 * - macOS/Linux/Windows: process.cwd() (Perry native support)
 * - iOS/Android: falls back to home directory
 */
export function getCwd(): string {
  // iOS, Android, and Web don't have a meaningful cwd
  if (__platform__ === 1 || __platform__ === 2 || __platform__ === 5) {
    return getHomeDir();
  }

  try {
    const dir = process.cwd();
    if (dir.length > 0) return dir;
  } catch (e: any) {}

  // Fallback: try execSync('pwd')
  try {
    const result = execSync('pwd') as unknown as string;
    const dir = trimNewline(result);
    if (dir.length > 0) return dir;
  } catch (e: any) {}

  return '';
}

/**
 * Whether the platform can run Unix shell commands.
 * iOS and Android cannot.
 */
export function canRunShellCommands(): boolean {
  return __platform__ === 0 || __platform__ === 3 || __platform__ === 4;
}

/**
 * Get or create a persistent device ID (16 hex chars).
 * Stored in ~/.hone/device-id.
 */
let _deviceId = '';
const HEX = '0123456789abcdef';

export function getOrCreateDeviceId(): string {
  if (_deviceId.length > 0) return _deviceId;

  let path = getAppDataDir();
  path += '/device-id';

  try {
    if (existsSync(path)) {
      const stored = readFileSync(path);
      if (stored.length >= 16) {
        _deviceId = stored.slice(0, 16);
        return _deviceId;
      }
    }
  } catch (e: any) { /* ignore */ }

  // Generate new 16-char hex ID
  let id = '';
  for (let i = 0; i < 16; i++) {
    const idx = Math.floor(Math.random() * 16);
    id += HEX[idx];
  }
  _deviceId = id;

  try {
    writeFileSync(path, id);
  } catch (e: any) { /* ignore */ }

  return _deviceId;
}

/**
 * Reset cached paths (for testing).
 */
export function resetPathCache(): void {
  _homeDir = '';
  _tempDir = '';
  _appDataDir = '';
}
