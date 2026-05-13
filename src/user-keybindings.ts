/**
 * User keybindings loader (SHIP-V1-GAPS.md #41).
 *
 * Reads `~/.hone/keybindings.json` and produces `Keybinding` entries that the
 * IDE merges *before* its defaults. Because `matchKeybinding` returns the
 * first match, putting user bindings first means they override defaults.
 *
 * Format matches VS Code's `keybindings.json` shape so users can copy their
 * existing config:
 *
 *   [
 *     { "key": "ctrl+shift+p", "command": "view.commandPalette" },
 *     { "key": "cmd+k cmd+s",  "command": "workbench.action.openKeybindings" },
 *     { "key": "cmd+w",        "command": "workbench.action.closeActiveEditor", "when": "editorTextFocus" }
 *   ]
 *
 * Perry-safe: hand-rolled JSON parser (no JSON.parse — Perry handles it but
 * keeps the dependency narrow), char-code comparisons.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Platform } from './platform';
import { getDefaultKeybindings, type Keybinding, type KeyCombo } from './keybindings';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge user keybindings ahead of the platform defaults. `matchKeybinding`
 * returns the first match, so any user binding shadows the default for that
 * combo. This is the function the IDE should call instead of
 * `getDefaultKeybindings` directly.
 */
export function getEffectiveKeybindings(platform: Platform, appDataDir: string): Keybinding[] {
  const user = loadUserKeybindings(appDataDir, platform);
  const defaults = getDefaultKeybindings(platform);
  // User first so they win the first-match race in `matchKeybinding`.
  const out: Keybinding[] = [];
  for (let i = 0; i < user.length; i++) out.push(user[i]);
  for (let j = 0; j < defaults.length; j++) out.push(defaults[j]);
  return out;
}

/**
 * Load user keybindings from `${appDataDir}/keybindings.json` if present.
 * Returns an empty array if the file doesn't exist, is unreadable, or has
 * a malformed entry (malformed entries are skipped, not fatal).
 */
export function loadUserKeybindings(appDataDir: string, platform: Platform): Keybinding[] {
  const path = join(appDataDir, 'keybindings.json');
  if (!existsSync(path)) return [];
  let text = '';
  try {
    text = readFileSync(path, 'utf-8');
  } catch (_e) {
    return [];
  }
  if (text.length === 0) return [];
  return parseUserKeybindings(text, platform);
}

/**
 * Parse a JSON keybindings document. Exposed so tests can exercise the parser
 * directly without touching the filesystem.
 */
export function parseUserKeybindings(text: string, platform: Platform): Keybinding[] {
  const entries = extractObjectArray(text);
  const out: Keybinding[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const key = extractStringField(entry, '"key"');
    const command = extractStringField(entry, '"command"');
    if (key.length === 0 || command.length === 0) continue;
    const when = extractStringField(entry, '"when"');
    const combos = parseKeyChord(key, platform);
    if (combos.length === 0) continue;
    out.push({
      command: command,
      keys: combos,
      when: when.length > 0 ? when : null,
      display: prettyDisplay(combos, platform),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Key chord parser
// ---------------------------------------------------------------------------

/**
 * Parse a chord string like "ctrl+shift+p" or "cmd+k cmd+s" into KeyCombos.
 *
 * - Tokens are space-separated.
 * - Within a token, components are `+`-separated.
 * - Modifiers: `ctrl`, `shift`, `alt`, `cmd` (alias for `meta`), `meta`,
 *   `cmdorctrl` (resolves to `cmd` on apple platforms, `ctrl` elsewhere).
 * - The final component is the key.
 */
export function parseKeyChord(input: string, platform: Platform): KeyCombo[] {
  const lower = input.toLowerCase();
  const tokens = lower.split(' ');
  const out: KeyCombo[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].trim();
    if (tok.length === 0) continue;
    const combo = parseSingleCombo(tok, platform);
    if (combo === null) return []; // malformed → reject the whole chord
    out.push(combo);
    if (out.length >= 2) break; // longer chords aren't supported by the matcher today
  }
  return out;
}

function parseSingleCombo(token: string, platform: Platform): KeyCombo | null {
  const parts = token.split('+');
  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  let key = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.length === 0) continue;
    if (p === 'ctrl' || p === 'control') ctrl = true;
    else if (p === 'shift') shift = true;
    else if (p === 'alt' || p === 'option') alt = true;
    else if (p === 'cmd' || p === 'meta' || p === 'super' || p === 'win') meta = true;
    else if (p === 'cmdorctrl') {
      if (isApplePlatform(platform)) meta = true; else ctrl = true;
    } else {
      // The first non-modifier token wins; later non-modifiers are an error.
      if (key.length > 0) return null;
      key = p.length === 1 ? p : normalizeKeyName(p);
    }
  }
  if (key.length === 0) return null;
  return { key: key, ctrl: ctrl, shift: shift, alt: alt, meta: meta };
}

function normalizeKeyName(name: string): string {
  // VS Code uses lowercase names (`enter`, `escape`, `space`, `tab`, `up`,
  // `down`, `left`, `right`, `f1`..`f12`, `pageup`, `pagedown`, `home`,
  // `end`, `backspace`, `delete`). Hone's KeyCombo.key is case-insensitive
  // downstream — we preserve the user's lowercase form.
  if (name === 'esc') return 'escape';
  if (name === 'ins') return 'insert';
  if (name === 'del') return 'delete';
  return name;
}

function isApplePlatform(platform: Platform): boolean {
  return platform === 'macos' || platform === 'ios' || platform === 'ipados';
}

function prettyDisplay(combos: KeyCombo[], platform: Platform): string {
  let parts = '';
  for (let i = 0; i < combos.length; i++) {
    if (i > 0) parts += ' ';
    const c = combos[i];
    if (c.meta) parts += isApplePlatform(platform) ? 'Cmd+' : 'Win+';
    if (c.ctrl) parts += 'Ctrl+';
    if (c.alt) parts += isApplePlatform(platform) ? 'Option+' : 'Alt+';
    if (c.shift) parts += 'Shift+';
    parts += c.key.length === 1 ? c.key.toUpperCase() : c.key;
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Minimal JSON extractor — we only need to walk a top-level array of objects
// and read three string fields per object. Avoids a full JSON parser.
// ---------------------------------------------------------------------------

function extractObjectArray(text: string): string[] {
  const out: string[] = [];
  let p = 0;
  // Skip whitespace until '['
  while (p < text.length && text.charCodeAt(p) !== 91) p++; // '['
  if (p >= text.length) return out;
  p++; // consume '['
  while (p < text.length) {
    // Skip whitespace + commas
    while (p < text.length) {
      const c = text.charCodeAt(p);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) { p++; continue; }
      break;
    }
    if (p >= text.length || text.charCodeAt(p) === 93) break; // ']'
    if (text.charCodeAt(p) !== 123) { p++; continue; }       // '{'
    const end = findMatchingBrace(text, p);
    if (end < 0) break;
    out.push(text.slice(p, end + 1));
    p = end + 1;
  }
  return out;
}

function findMatchingBrace(s: string, openPos: number): number {
  let depth = 0;
  let inStr = 0;
  for (let i = openPos; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inStr === 1) {
      if (c === 92) { i = i + 1; continue; }
      if (c === 34) inStr = 0;
      continue;
    }
    if (c === 34) { inStr = 1; continue; }
    if (c === 123) depth = depth + 1;
    else if (c === 125) {
      depth = depth - 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractStringField(obj: string, key: string): string {
  const idx = obj.indexOf(key);
  if (idx < 0) return '';
  let p = idx + key.length;
  while (p < obj.length && (obj.charCodeAt(p) === 58 || obj.charCodeAt(p) === 32)) p++;
  if (p >= obj.length || obj.charCodeAt(p) !== 34) return '';
  p++;
  let out = '';
  while (p < obj.length) {
    const c = obj.charCodeAt(p);
    if (c === 92 && p + 1 < obj.length) {
      const n = obj.charCodeAt(p + 1);
      if (n === 110) out += '\n';
      else if (n === 116) out += '\t';
      else if (n === 34) out += '"';
      else if (n === 92) out += '\\';
      else out += obj.charAt(p + 1);
      p += 2;
      continue;
    }
    if (c === 34) break;
    out += obj.charAt(p);
    p++;
  }
  return out;
}
