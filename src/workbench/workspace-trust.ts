/**
 * Workspace trust (SHIP-V1-GAPS.md #58).
 *
 * Tracks which workspace folders the user has explicitly trusted. v1.0 ships
 * the registry + commands; gating the plugin host on trust lands with the
 * `@honeide/api` runtime implementation (#56).
 *
 * Storage: `${appDataDir}/trusted-workspaces.ini` — one absolute path per
 * line. Comments allowed (`#` prefix). Loaded lazily on first query.
 *
 * Perry-safe: module-level state, no JSON, hand-rolled line splitting.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _appDataDir: string = '';
let _trusted: string[] = [];
let _loaded: number = 0;

export function initWorkspaceTrust(appDataDir: string): void {
  _appDataDir = appDataDir;
}

function trustPath(): string {
  return join(_appDataDir, 'trusted-workspaces.ini');
}

function loadTrustedIfNeeded(): void {
  if (_loaded > 0) return;
  _loaded = 1;
  if (_appDataDir.length === 0) return;
  const path = trustPath();
  if (!existsSync(path)) return;
  let text = '';
  try { text = readFileSync(path, 'utf-8'); } catch (_e: any) { return; }
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) {
      if (i > start) {
        let line = text.slice(start, i);
        // Trim trailing CR
        if (line.length > 0 && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, line.length - 1);
        // Trim spaces
        let a = 0;
        let b = line.length;
        while (a < b && line.charCodeAt(a) === 32) a++;
        while (b > a && line.charCodeAt(b - 1) === 32) b--;
        line = line.slice(a, b);
        if (line.length > 0 && line.charCodeAt(0) !== 35) {
          _trusted.push(line);
        }
      }
      start = i + 1;
    }
  }
}

function flushTrusted(): void {
  if (_appDataDir.length === 0) return;
  let out = '# Trusted workspace paths (one per line).\n';
  out += '# Removing an entry revokes trust; that folder will re-prompt next time.\n';
  for (let i = 0; i < _trusted.length; i++) {
    out += _trusted[i];
    out += '\n';
  }
  try { writeFileSync(trustPath(), out); } catch (_e: any) {}
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Return 1 if `folderPath` is on the trust list, 0 otherwise. */
export function isWorkspaceTrusted(folderPath: string): number {
  if (folderPath.length === 0) return 0;
  loadTrustedIfNeeded();
  for (let i = 0; i < _trusted.length; i++) {
    if (_trusted[i] === folderPath) return 1;
  }
  return 0;
}

/** Add `folderPath` to the trusted list (idempotent). */
export function trustWorkspace(folderPath: string): void {
  if (folderPath.length === 0) return;
  loadTrustedIfNeeded();
  for (let i = 0; i < _trusted.length; i++) {
    if (_trusted[i] === folderPath) return;
  }
  _trusted.push(folderPath);
  flushTrusted();
}

/** Remove `folderPath` from the trusted list. */
export function revokeWorkspaceTrust(folderPath: string): void {
  loadTrustedIfNeeded();
  const out: string[] = [];
  for (let i = 0; i < _trusted.length; i++) {
    if (_trusted[i] !== folderPath) out.push(_trusted[i]);
  }
  _trusted = out;
  flushTrusted();
}

/** List all trusted workspace paths. */
export function listTrustedWorkspaces(): string[] {
  loadTrustedIfNeeded();
  const out: string[] = [];
  for (let i = 0; i < _trusted.length; i++) out.push(_trusted[i]);
  return out;
}
