/**
 * Shared UI helpers for Perry widgets.
 *
 * Pure functions — no module-level state. Safe for import from any panel module.
 */
import {
  textSetColor,
  buttonSetTextColor, buttonSetContentTintColor, buttonSetImage, buttonSetTitle,
  widgetSetBackgroundColor,
} from 'perry/ui';

// Platform constant — 0=macOS, 1=iOS, 3=Windows, 4=Linux, 5=web.
declare const __platform__: number;

/**
 * SHIP-V1-GAPS.md followup §5: per-platform monospace font name. The codebase
 * had `'Menlo'` hardcoded in ~20 places — Menlo is macOS-only, so on Windows
 * users got the platform's Courier New fallback (functional but ugly). This
 * helper returns the canonical mono font per platform:
 *   - macOS / iOS: Menlo (system mono since 10.6)
 *   - Windows: Consolas (ships with every Windows since Vista)
 *   - Linux / web / Android: monospace (CSS-family fallback chain)
 *
 * Callers do `textSetFontSize(widget, sz); textSetFontFamily(widget, monoFont());`
 * — Perry's textSetFontFamily takes (widget, family) only. Passing a size as a
 * third arg makes the table dispatch skip the call entirely (silent no-op).
 */
export function monoFont(): string {
  if (__platform__ === 3) return 'Consolas';
  if (__platform__ === 4) return 'DejaVu Sans Mono';
  return 'Menlo';
}

/**
 * SHIP-V1-GAPS.md followup §5: SF Symbol → Unicode fallback table. SF Symbols
 * are macOS-only — on Windows / Linux a `buttonSetImage(btn, 'chevron.right')`
 * call leaves the button blank (since the icon doesn't render). Map the
 * common symbol names to Unicode glyphs that render on every platform.
 * Returns empty string for names we haven't mapped — caller can keep the
 * label they passed to Button() as the visible affordance.
 */
export function unicodeForSymbol(symbol: string): string {
  // Order by frequency in the codebase (chevrons + close are most common).
  if (symbol === 'chevron.right') return '›';   // ›
  if (symbol === 'chevron.down') return '˅';    // ˅
  if (symbol === 'chevron.up') return '˄';      // ˄
  if (symbol === 'xmark') return '✕';           // ✕
  if (symbol === 'circle.fill') return '●';     // ●
  if (symbol === 'folder') return '\u{1F4C1}';       // 📁
  if (symbol === 'folder.fill') return '\u{1F4C1}';  // 📁
  if (symbol === 'folder.badge.plus') return '\u{1F4C1}+';
  if (symbol === 'doc.text') return '\u{1F4C4}';     // 📄
  if (symbol === 'doc.badge.plus') return '\u{1F4C4}+';
  if (symbol === 'gearshape') return '⚙';       // ⚙
  if (symbol === 'magnifyingglass') return '\u{1F50D}'; // 🔍
  if (symbol === 'pin.fill') return '\u{1F4CC}';     // 📌
  if (symbol === 'sparkles') return '✨';        // ✨
  if (symbol === 'ellipsis') return '…';        // …
  if (symbol === 'arrow.right') return '→';     // →
  if (symbol === 'arrow.left.arrow.right') return '↔'; // ↔
  if (symbol === 'arrow.left.arrow.right.square') return '↔';
  if (symbol === 'arrow.up.left') return '↖';   // ↖
  if (symbol === 'arrow.up.left.and.arrow.down.right') return '⇄';
  if (symbol === 'arrow.down.right') return '↘'; // ↘
  if (symbol === 'arrow.down.right.and.arrow.up.left') return '⇄';
  if (symbol === 'arrow.triangle.branch') return '⚡'; // ⚡ (closest mono branch)
  if (symbol === 'arrow.triangle.2.circlepath') return '↻'; // ↻
  if (symbol === 'play.fill') return '▶';       // ▶
  if (symbol === 'pause.fill') return '⏸';      // ⏸
  if (symbol === 'stop.fill') return '■';       // ■
  if (symbol === 'doc.on.doc') return '⧉';      // ⧉
  return '';
}

/**
 * Per-platform icon setter — replaces bare `buttonSetImage(btn, sfSymbol)`
 * call sites. On macOS / iOS uses the native SF Symbol via buttonSetImage.
 * On Windows / Linux / web, sets the button's title to the Unicode glyph
 * from `unicodeForSymbol` so the button isn't a blank clickable area.
 * Falls back to no-op if the symbol isn't in the table — callers should
 * provide a sensible button label in that case.
 */
export function setIconButton(btn: unknown, symbol: string): void {
  if (__platform__ === 0 || __platform__ === 1) {
    buttonSetImage(btn, symbol);
    return;
  }
  const glyph = unicodeForSymbol(symbol);
  if (glyph.length > 0) buttonSetTitle(btn, glyph);
}

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
    // 47 = '/', 92 = '\' — must accept BOTH. Windows OS paths are
    // backslash-delimited, so a `/`-only scan finds no separator and this
    // canonical helper returns the ENTIRE absolute path as the "filename".
    // It backs ~27 call sites (tab labels, git changed-files, AI context
    // chips, search results, Problems panel, explorer, timeline, terminal),
    // so every filename on every Windows surface rendered as the full
    // `C:\Users\…\foo.ts`. Fixing the shared helper fixes them all at once.
    const c = filePath.charCodeAt(i);
    if (c === 47 || c === 92) lastSlash = i;
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

/** Get the SF Symbol icon name for a file based on its extension (50+ types). */
export function getFileIcon(name: string): string {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'swift';
  if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.mjs') || name.endsWith('.cjs')) return 'swift';
  if (name.endsWith('.json') || name.endsWith('.jsonc') || name.endsWith('.json5')) return 'curlybraces';
  if (name.endsWith('.toml') || name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.ini') || name.endsWith('.env')) return 'gearshape';
  if (name.endsWith('.xml') || name.endsWith('.svg') || name.endsWith('.plist')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.rs')) return 'gearshape.2';
  if (name.endsWith('.c') || name.endsWith('.h') || name.endsWith('.cpp') || name.endsWith('.hpp') || name.endsWith('.cc') || name.endsWith('.cxx')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.go')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.swift')) return 'swift';
  if (name.endsWith('.java') || name.endsWith('.kt') || name.endsWith('.kts')) return 'cup.and.saucer';
  if (name.endsWith('.cs')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.zig')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.py') || name.endsWith('.pyi')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.rb') || name.endsWith('.erb')) return 'diamond';
  if (name.endsWith('.php')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.lua')) return 'moon';
  if (name.endsWith('.r') || name.endsWith('.R')) return 'chart.bar';
  if (name.endsWith('.ex') || name.endsWith('.exs')) return 'drop';
  if (name.endsWith('.hs')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.scala') || name.endsWith('.sc')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.clj') || name.endsWith('.cljs')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.html') || name.endsWith('.htm') || name.endsWith('.ejs') || name.endsWith('.hbs')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.css') || name.endsWith('.scss') || name.endsWith('.less') || name.endsWith('.sass') || name.endsWith('.styl')) return 'paintbrush';
  if (name.endsWith('.vue') || name.endsWith('.svelte') || name.endsWith('.astro')) return 'chevron.left.forwardslash.chevron.right';
  if (name.endsWith('.graphql') || name.endsWith('.gql')) return 'arrow.triangle.branch';
  if (name.endsWith('.wasm')) return 'cpu';
  if (name.endsWith('.md') || name.endsWith('.mdx') || name.endsWith('.rst') || name.endsWith('.txt')) return 'doc.plaintext';
  if (name.endsWith('.tex') || name.endsWith('.bib')) return 'doc.plaintext';
  if (name.endsWith('.sh') || name.endsWith('.bash') || name.endsWith('.zsh') || name.endsWith('.fish') || name.endsWith('.ps1')) return 'terminal';
  if (name.endsWith('.dockerfile')) return 'shippingbox';
  if (name.endsWith('.tf') || name.endsWith('.tfvars')) return 'cloud';
  if (name.endsWith('.sql') || name.endsWith('.sqlite') || name.endsWith('.db')) return 'cylinder';
  if (name.endsWith('.csv') || name.endsWith('.tsv')) return 'tablecells';
  if (name.endsWith('.proto')) return 'arrow.triangle.branch';
  if (name.endsWith('.cmake') || name.endsWith('.make') || name.endsWith('.mk')) return 'hammer';
  if (name.endsWith('.gradle')) return 'hammer';
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif') || name.endsWith('.ico') || name.endsWith('.webp')) return 'photo';
  if (name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.avi') || name.endsWith('.webm')) return 'film';
  if (name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.ogg') || name.endsWith('.flac')) return 'music.note';
  if (name.endsWith('.ttf') || name.endsWith('.otf') || name.endsWith('.woff') || name.endsWith('.woff2')) return 'textformat';
  if (name.endsWith('.zip') || name.endsWith('.tar') || name.endsWith('.gz') || name.endsWith('.7z')) return 'archivebox';
  if (name.endsWith('.lock') || name.endsWith('.lockb')) return 'lock';
  if (name === 'Dockerfile' || name === 'docker-compose.yml' || name === 'docker-compose.yaml') return 'shippingbox';
  if (name === 'Makefile' || name === 'CMakeLists.txt') return 'hammer';
  if (name === 'LICENSE' || name === 'LICENCE') return 'doc.text';
  if (name === '.gitignore' || name === '.gitattributes') return 'arrow.triangle.branch';
  return 'doc';
}

/** Get the color hex for a file icon based on its extension (50+ types). */
export function getFileIconColor(name: string): string {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return '#3178C6';
  if (name.endsWith('.js') || name.endsWith('.jsx') || name.endsWith('.mjs') || name.endsWith('.cjs')) return '#F7DF1E';
  if (name.endsWith('.json') || name.endsWith('.jsonc') || name.endsWith('.json5')) return '#F7DF1E';
  if (name.endsWith('.rs')) return '#CE422B';
  if (name.endsWith('.go')) return '#00ADD8';
  if (name.endsWith('.swift')) return '#F05138';
  if (name.endsWith('.c') || name.endsWith('.h') || name.endsWith('.cpp') || name.endsWith('.hpp') || name.endsWith('.cc')) return '#659AD2';
  if (name.endsWith('.java') || name.endsWith('.kt') || name.endsWith('.kts')) return '#B07219';
  if (name.endsWith('.cs')) return '#68217A';
  if (name.endsWith('.zig')) return '#F7A41D';
  if (name.endsWith('.py') || name.endsWith('.pyi')) return '#3776AB';
  if (name.endsWith('.rb') || name.endsWith('.erb')) return '#CC342D';
  if (name.endsWith('.php')) return '#777BB4';
  if (name.endsWith('.lua')) return '#000080';
  if (name.endsWith('.r') || name.endsWith('.R')) return '#276DC3';
  if (name.endsWith('.ex') || name.endsWith('.exs')) return '#6E4A7E';
  if (name.endsWith('.hs')) return '#5E5086';
  if (name.endsWith('.scala') || name.endsWith('.sc')) return '#DC322F';
  if (name.endsWith('.clj') || name.endsWith('.cljs')) return '#63B132';
  if (name.endsWith('.html') || name.endsWith('.htm') || name.endsWith('.ejs')) return '#E44D26';
  if (name.endsWith('.css') || name.endsWith('.scss') || name.endsWith('.less') || name.endsWith('.sass')) return '#1572B6';
  if (name.endsWith('.vue')) return '#41B883';
  if (name.endsWith('.svelte')) return '#FF3E00';
  if (name.endsWith('.astro')) return '#FF5D01';
  if (name.endsWith('.graphql') || name.endsWith('.gql')) return '#E535AB';
  if (name.endsWith('.md') || name.endsWith('.mdx')) return '#519ABA';
  if (name.endsWith('.sh') || name.endsWith('.bash') || name.endsWith('.zsh') || name.endsWith('.fish')) return '#4EAA25';
  if (name.endsWith('.dockerfile') || name === 'Dockerfile') return '#2496ED';
  if (name.endsWith('.tf') || name.endsWith('.tfvars')) return '#7B42BC';
  if (name.endsWith('.toml') || name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.ini')) return '#6D8086';
  if (name.endsWith('.xml') || name.endsWith('.svg') || name.endsWith('.plist')) return '#E44D26';
  if (name.endsWith('.sql') || name.endsWith('.sqlite')) return '#E38C00';
  if (name.endsWith('.csv') || name.endsWith('.tsv')) return '#237346';
  if (name.endsWith('.wasm')) return '#654FF0';
  if (name.endsWith('.proto')) return '#6D8086';
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif') || name.endsWith('.webp')) return '#A074C4';
  if (name.endsWith('.lock') || name.endsWith('.lockb')) return '#6D8086';
  if (name === '.gitignore' || name === '.gitattributes') return '#F05032';
  if (name === '.env' || name.endsWith('.env')) return '#ECD53F';
  return '';
}

/** Truncate a name to maxLen characters, appending '...' if needed. */
export function truncateName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  let result = name.slice(0, maxLen - 3);
  result += '...';
  return result;
}

/** Check if a file name has a text extension we should search.
 *  Perry-safe: uses charCodeAt for extension matching (no .endsWith). */
export function isTextFile(name: string): boolean {
  const len = name.length;
  if (len < 2) return false;
  // Find last dot
  let dotPos = -1;
  for (let i = len - 1; i >= 0; i--) {
    if (name.charCodeAt(i) === 46) { dotPos = i; break; }
  }
  if (dotPos < 0) return false;
  const extLen = len - dotPos - 1;
  // Match by extension length + first char for speed
  // 1-char: .c .h
  if (extLen === 1) {
    const c = name.charCodeAt(dotPos + 1);
    if (c === 99 || c === 104) return true; // c, h
    return false;
  }
  // 2-char: .ts .js .rs .py .go .rb .md .sh
  if (extLen === 2) {
    const c1 = name.charCodeAt(dotPos + 1);
    const c2 = name.charCodeAt(dotPos + 2);
    if (c1 === 116 && c2 === 115) return true; // ts
    if (c1 === 106 && c2 === 115) return true; // js
    if (c1 === 114 && c2 === 115) return true; // rs
    if (c1 === 112 && c2 === 121) return true; // py
    if (c1 === 103 && c2 === 111) return true; // go
    if (c1 === 114 && c2 === 98) return true;  // rb
    if (c1 === 109 && c2 === 100) return true;  // md
    if (c1 === 115 && c2 === 104) return true;  // sh
    return false;
  }
  // 3-char: .tsx .jsx .mjs .cjs .css .htm .cpp .hpp .txt .yml .xml .svg .sql .zsh .php
  if (extLen === 3) {
    const c1 = name.charCodeAt(dotPos + 1);
    const c2 = name.charCodeAt(dotPos + 2);
    const c3 = name.charCodeAt(dotPos + 3);
    if (c1 === 116 && c2 === 115 && c3 === 120) return true; // tsx
    if (c1 === 106 && c2 === 115 && c3 === 120) return true; // jsx
    if (c1 === 109 && c2 === 106 && c3 === 115) return true; // mjs
    if (c1 === 99 && c2 === 106 && c3 === 115) return true;  // cjs
    if (c1 === 99 && c2 === 115 && c3 === 115) return true;  // css
    if (c1 === 104 && c2 === 116 && c3 === 109) return true;  // htm
    if (c1 === 99 && c2 === 112 && c3 === 112) return true;  // cpp
    if (c1 === 104 && c2 === 112 && c3 === 112) return true;  // hpp
    if (c1 === 116 && c2 === 120 && c3 === 116) return true;  // txt
    if (c1 === 121 && c2 === 109 && c3 === 108) return true;  // yml
    if (c1 === 120 && c2 === 109 && c3 === 108) return true;  // xml
    if (c1 === 115 && c2 === 118 && c3 === 103) return true;  // svg
    if (c1 === 115 && c2 === 113 && c3 === 108) return true;  // sql
    if (c1 === 122 && c2 === 115 && c3 === 104) return true;  // zsh
    if (c1 === 112 && c2 === 104 && c3 === 112) return true;  // php
    return false;
  }
  // 4-char: .json .toml .yaml .html .scss .less .bash .java
  if (extLen === 4) {
    const c1 = name.charCodeAt(dotPos + 1);
    const c2 = name.charCodeAt(dotPos + 2);
    if (c1 === 106 && c2 === 115) return true;  // json
    if (c1 === 116 && c2 === 111) return true;  // toml
    if (c1 === 121 && c2 === 97) return true;   // yaml
    if (c1 === 104 && c2 === 116) return true;   // html
    if (c1 === 115 && c2 === 99) return true;   // scss
    if (c1 === 108 && c2 === 101) return true;   // less
    if (c1 === 98 && c2 === 97) return true;    // bash
    if (c1 === 106 && c2 === 97) return true;   // java
    return false;
  }
  // 5-char: .jsonc .swift
  if (extLen === 5) {
    const c1 = name.charCodeAt(dotPos + 1);
    if (c1 === 106) return true;  // jsonc
    if (c1 === 115) return true;  // swift
  }
  return false;
}
