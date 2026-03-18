/**
 * Buffer persistence — saves dirty editor buffers to ~/.hone/.buffers/
 * so unsaved changes survive tab switches.
 *
 * All state is module-level (Perry closures capture by value).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { getAppDataDir } from './paths';

let _buffersDir = '';

function djb2Hash(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getBufferPath(filePath: string): string {
  const h = djb2Hash(filePath);
  let p = '';
  p += _buffersDir;
  p += '/';
  p += String(h);
  p += '.buf';
  return p;
}

export function initBufferStore(): void {
  let dir = getAppDataDir();
  dir += '/.buffers';
  if (!existsSync(dir)) {
    try { mkdirSync(dir); } catch (e: any) { /* ignore */ }
  }
  _buffersDir = dir;
}

export function saveBuffer(filePath: string, content: string): void {
  if (_buffersDir.length < 1) return;
  const bp = getBufferPath(filePath);
  try { writeFileSync(bp, content); } catch (e: any) { /* ignore */ }
}

export function loadBuffer(filePath: string): string {
  if (_buffersDir.length < 1) return '';
  const bp = getBufferPath(filePath);
  try {
    if (existsSync(bp)) {
      return readFileSync(bp);
    }
  } catch (e: any) { /* ignore */ }
  return '';
}

export function deleteBuffer(filePath: string): void {
  if (_buffersDir.length < 1) return;
  const bp = getBufferPath(filePath);
  try {
    if (existsSync(bp)) {
      unlinkSync(bp);
    }
  } catch (e: any) { /* ignore */ }
}

export function hasBuffer(filePath: string): number {
  if (_buffersDir.length < 1) return 0;
  const bp = getBufferPath(filePath);
  try {
    if (existsSync(bp)) return 1;
  } catch (e: any) { /* ignore */ }
  return 0;
}
