/**
 * Shared UI helpers for Perry widgets.
 *
 * Pure functions — no module-level state. Safe for import from any panel module.
 */
import {
  textSetColor,
  buttonSetTextColor, buttonSetContentTintColor,
  widgetSetBackgroundColor,
} from 'perry/ui';

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export function hexToRGBA(hex: string): [number, number, number, number] {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1.0;
  return [r, g, b, a];
}

export function setBg(widget: unknown, hex: string): void {
  const [r, g, b, a] = hexToRGBA(hex);
  widgetSetBackgroundColor(widget, r, g, b, a);
}

export function setFg(text: unknown, hex: string): void {
  const [r, g, b, a] = hexToRGBA(hex);
  textSetColor(text, r, g, b, a);
}

export function setBtnFg(btn: unknown, hex: string): void {
  const [r, g, b, a] = hexToRGBA(hex);
  buttonSetTextColor(btn, r, g, b, a);
}

export function setBtnTint(btn: unknown, hex: string): void {
  const [r, g, b, a] = hexToRGBA(hex);
  buttonSetContentTintColor(btn, r, g, b, a);
}

// ---------------------------------------------------------------------------
// Path / string helpers
// ---------------------------------------------------------------------------

/** Compute a DJB2-like numeric hash for a path, sampling 6 char positions. */
export function pathId(path: string): number {
  let hash = 5381;
  const len = path.length;
  hash = hash * 33 + len;
  if (len > 0) hash = hash * 33 + path.charCodeAt(0);
  if (len > 1) hash = hash * 33 + path.charCodeAt(1);
  if (len > 3) hash = hash * 33 + path.charCodeAt(len - 2);
  if (len > 0) hash = hash * 33 + path.charCodeAt(len - 1);
  if (len > 5) hash = hash * 33 + path.charCodeAt((len / 2) | 0);
  if (hash < 0) hash = 0 - hash;
  return hash;
}

/** Extract filename from a full path. Uses charCodeAt for comparison
 *  since Perry's string === is broken (always returns true). */
export function getFileName(filePath: string): string {
  let lastSlash = -1;
  for (let i = 0; i < filePath.length; i++) {
    // 47 = '/' char code
    if (filePath.charCodeAt(i) === 47) lastSlash = i;
  }
  if (lastSlash >= 0) {
    return filePath.slice(lastSlash + 1);
  }
  return filePath;
}

/** Char-by-char string comparison (Perry === on strings is unreliable). */
export function strEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return false;
  }
  return true;
}

/** ASCII uppercase→lowercase. */
export function toLowerCode(code: number): number {
  if (code >= 65 && code <= 90) return code + 32;
  return code;
}

/** Detect language from file extension. */
export function detectLanguage(filePath: string): string {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.rs')) return 'rust';
  if (filePath.endsWith('.html') || filePath.endsWith('.htm')) return 'html';
  if (filePath.endsWith('.css')) return 'css';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.md')) return 'markdown';
  if (filePath.endsWith('.c') || filePath.endsWith('.h')) return 'c';
  if (filePath.endsWith('.cpp') || filePath.endsWith('.hpp')) return 'cpp';
  return 'plaintext';
}

/** Check if a file name has a text extension we should search. */
export function isTextFile(name: string): boolean {
  if (name.endsWith('.ts')) return true;
  if (name.endsWith('.tsx')) return true;
  if (name.endsWith('.js')) return true;
  if (name.endsWith('.jsx')) return true;
  if (name.endsWith('.json')) return true;
  if (name.endsWith('.md')) return true;
  if (name.endsWith('.css')) return true;
  if (name.endsWith('.html')) return true;
  if (name.endsWith('.rs')) return true;
  if (name.endsWith('.py')) return true;
  if (name.endsWith('.c')) return true;
  if (name.endsWith('.cpp')) return true;
  if (name.endsWith('.h')) return true;
  if (name.endsWith('.toml')) return true;
  if (name.endsWith('.yaml')) return true;
  if (name.endsWith('.yml')) return true;
  if (name.endsWith('.txt')) return true;
  if (name.endsWith('.sh')) return true;
  if (name.endsWith('.swift')) return true;
  return false;
}
