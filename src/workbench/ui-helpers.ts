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

/** Extract filename from a full path. */
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

/** ASCII uppercase→lowercase. */
export function toLowerCode(code: number): number {
  if (code >= 65 && code <= 90) return code + 32;
  return code;
}

/** Detect language from file extension. */
export function detectLanguage(filePath: string): string {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) return 'javascript';
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.rs')) return 'rust';
  if (filePath.endsWith('.html') || filePath.endsWith('.htm')) return 'html';
  if (filePath.endsWith('.css') || filePath.endsWith('.scss') || filePath.endsWith('.less')) return 'css';
  if (filePath.endsWith('.json') || filePath.endsWith('.jsonc')) return 'json';
  if (filePath.endsWith('.md')) return 'markdown';
  if (filePath.endsWith('.c') || filePath.endsWith('.h')) return 'c';
  if (filePath.endsWith('.cpp') || filePath.endsWith('.hpp')) return 'cpp';
  if (filePath.endsWith('.go')) return 'go';
  if (filePath.endsWith('.java')) return 'java';
  if (filePath.endsWith('.swift')) return 'swift';
  if (filePath.endsWith('.sh') || filePath.endsWith('.bash') || filePath.endsWith('.zsh')) return 'shell';
  if (filePath.endsWith('.rb')) return 'ruby';
  if (filePath.endsWith('.php')) return 'php';
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) return 'yaml';
  if (filePath.endsWith('.toml')) return 'toml';
  if (filePath.endsWith('.sql')) return 'sql';
  if (filePath.endsWith('.xml') || filePath.endsWith('.svg')) return 'xml';
  return 'plaintext';
}

/** Get the SF Symbol icon name for a file based on its extension. */
export function getFileIcon(name: string): string {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'swift';
  if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.mjs') || name.endsWith('.cjs')) return 'swift';
  if (name.endsWith('.json') || name.endsWith('.jsonc')) return 'curlybraces';
  if (name.endsWith('.rs')) return 'gearshape.2';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.css') || name.endsWith('.scss') || name.endsWith('.less')) return 'paintbrush';
  if (name.endsWith('.md')) return 'doc.plaintext';
  if (name.endsWith('.py')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.sh') || name.endsWith('.bash') || name.endsWith('.zsh')) return 'terminal';
  if (name.endsWith('.toml') || name.endsWith('.yaml') || name.endsWith('.yml')) return 'gearshape';
  if (name.endsWith('.swift')) return 'swift';
  if (name.endsWith('.c') || name.endsWith('.h') || name.endsWith('.cpp') || name.endsWith('.hpp')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.go')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.java')) return 'cup.and.saucer';
  if (name.endsWith('.rb')) return 'diamond';
  if (name.endsWith('.php')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.sql')) return 'cylinder';
  if (name.endsWith('.xml') || name.endsWith('.svg')) return 'chevron.left.forwardslash.chevron.right';
  return 'doc';
}

/** Get the color hex for a file icon based on its extension. */
export function getFileIconColor(name: string): string {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return '#3178C6';
  if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.mjs') || name.endsWith('.cjs')) return '#F7DF1E';
  if (name.endsWith('.json') || name.endsWith('.jsonc')) return '#F7DF1E';
  if (name.endsWith('.rs')) return '#CE422B';
  if (name.endsWith('.html') || name.endsWith('.htm')) return '#E44D26';
  if (name.endsWith('.css') || name.endsWith('.scss') || name.endsWith('.less')) return '#1572B6';
  if (name.endsWith('.md')) return '#519ABA';
  if (name.endsWith('.py')) return '#3776AB';
  if (name.endsWith('.sh') || name.endsWith('.bash') || name.endsWith('.zsh')) return '#4EAA25';
  if (name.endsWith('.toml') || name.endsWith('.yaml') || name.endsWith('.yml')) return '#6D8086';
  if (name.endsWith('.swift')) return '#F05138';
  if (name.endsWith('.c') || name.endsWith('.h') || name.endsWith('.cpp') || name.endsWith('.hpp')) return '#659AD2';
  if (name.endsWith('.go')) return '#00ADD8';
  if (name.endsWith('.java')) return '#B07219';
  if (name.endsWith('.rb')) return '#CC342D';
  if (name.endsWith('.php')) return '#777BB4';
  if (name.endsWith('.sql')) return '#E38C00';
  if (name.endsWith('.xml') || name.endsWith('.svg')) return '#E44D26';
  return '';
}

/** Truncate a name to maxLen characters, appending '...' if needed. */
export function truncateName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  let result = name.slice(0, maxLen - 3);
  result += '...';
  return result;
}

/** Check if a file name has a text extension we should search. */
export function isTextFile(name: string): boolean {
  if (name.endsWith('.ts')) return true;
  if (name.endsWith('.tsx')) return true;
  if (name.endsWith('.js')) return true;
  if (name.endsWith('.jsx')) return true;
  if (name.endsWith('.mjs')) return true;
  if (name.endsWith('.cjs')) return true;
  if (name.endsWith('.json')) return true;
  if (name.endsWith('.jsonc')) return true;
  if (name.endsWith('.md')) return true;
  if (name.endsWith('.css')) return true;
  if (name.endsWith('.scss')) return true;
  if (name.endsWith('.less')) return true;
  if (name.endsWith('.html')) return true;
  if (name.endsWith('.htm')) return true;
  if (name.endsWith('.rs')) return true;
  if (name.endsWith('.py')) return true;
  if (name.endsWith('.c')) return true;
  if (name.endsWith('.cpp')) return true;
  if (name.endsWith('.hpp')) return true;
  if (name.endsWith('.h')) return true;
  if (name.endsWith('.toml')) return true;
  if (name.endsWith('.yaml')) return true;
  if (name.endsWith('.yml')) return true;
  if (name.endsWith('.txt')) return true;
  if (name.endsWith('.sh')) return true;
  if (name.endsWith('.bash')) return true;
  if (name.endsWith('.zsh')) return true;
  if (name.endsWith('.swift')) return true;
  if (name.endsWith('.go')) return true;
  if (name.endsWith('.java')) return true;
  if (name.endsWith('.rb')) return true;
  if (name.endsWith('.php')) return true;
  if (name.endsWith('.sql')) return true;
  if (name.endsWith('.xml')) return true;
  if (name.endsWith('.svg')) return true;
  return false;
}
