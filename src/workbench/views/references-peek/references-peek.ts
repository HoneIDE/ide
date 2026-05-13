/**
 * References peek panel (SHIP-V1-GAPS.md #27, follow-up to Phase 2 LSP wiring).
 *
 * Consumes the LSP `textDocument/references` response (a JSON array of
 * Location objects) and renders one row per hit. Click jumps the editor to
 * that line. Uses the same sidebar-takeover pattern as the command palette
 * and quick open so it slots into the existing layout without an overlay
 * infrastructure.
 *
 * Parser tolerates either flat `Location[]` or `LocationLink[]` (some servers
 * emit the latter for definitions/references).
 */

import {
  VStack, HStack, Text, Button, Spacer, ScrollView,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  widgetAddChild, widgetClearChildren, widgetSetWidth,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { setFg, setBtnFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getSecondaryTextColor } from '../../theme/theme-colors';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _container: unknown = null;
let _listContainer: unknown = null;
let _ready: number = 0;

let _refUris: string[] = [];
let _refLines: number[] = [];
let _refCols: number[] = [];
let _refCount: number = 0;

let _jumpHandler: (filePath: string, line: number, character: number) => void = _noopJump;
function _noopJump(_f: string, _l: number, _c: number): void {}

export function setReferencesJumpHandler(fn: (filePath: string, line: number, character: number) => void): void {
  _jumpHandler = fn;
}

/** Mount the peek panel into the given sidebar container. */
export function renderReferencesPeek(parent: unknown, _colors: ResolvedUIColors): void {
  _container = parent;
  _ready = 1;
  widgetClearChildren(parent);

  const title = Text(t('REFERENCES'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(parent, title);

  _listContainer = VStack(2, []);
  const scroll = ScrollView();
  widgetAddChild(scroll, _listContainer);
  widgetAddChild(parent, scroll);

  renderEmptyState(t('Find All References to populate.'));
}

/**
 * Public entry: consume an LSP references JSON payload and render the rows.
 * The payload is a JSON array of `Location` objects (or `LocationLink`).
 */
export function showReferencesFromJson(json: string): void {
  if (_ready < 1 || _listContainer === null) return;
  _refUris = [];
  _refLines = [];
  _refCols = [];
  _refCount = 0;

  if (json.length === 0 || json === 'null' || json === '[]') {
    renderEmptyState(t('No references found.'));
    return;
  }

  parseLocations(json);

  if (_refCount === 0) {
    renderEmptyState(t('No references found.'));
    return;
  }
  renderResultsList();
}

// ---------------------------------------------------------------------------
// Parsing — accepts Location[] and LocationLink[]. Hand-rolled extractor
// avoids JSON.parse for Perry compatibility.
// ---------------------------------------------------------------------------

function parseLocations(json: string): void {
  let p = 0;
  while (p < json.length) {
    const open = json.indexOf('{', p);
    if (open < 0) return;
    const close = findMatchingBrace(json, open);
    if (close < 0) return;
    const body = json.slice(open, close + 1);

    // `uri` for Location, `targetUri` for LocationLink.
    let uri = extractStringField(body, '"uri"');
    if (uri.length === 0) uri = extractStringField(body, '"targetUri"');

    // `range.start.line/character` (Location) or `targetSelectionRange` (LocationLink).
    let rangeBody = '';
    const selIdx = body.indexOf('"targetSelectionRange"');
    const rngIdx = body.indexOf('"range"');
    const useIdx = selIdx >= 0 ? selIdx : rngIdx;
    if (useIdx >= 0) {
      const subOpen = body.indexOf('{', useIdx);
      if (subOpen >= 0) {
        const subClose = findMatchingBrace(body, subOpen);
        if (subClose > subOpen) rangeBody = body.slice(subOpen, subClose + 1);
      }
    }
    let line = -1;
    let col = -1;
    if (rangeBody.length > 0) {
      const startIdx = rangeBody.indexOf('"start"');
      if (startIdx >= 0) {
        const startOpen = rangeBody.indexOf('{', startIdx);
        if (startOpen >= 0) {
          const startClose = findMatchingBrace(rangeBody, startOpen);
          if (startClose > startOpen) {
            const startBody = rangeBody.slice(startOpen, startClose + 1);
            line = extractNumberField(startBody, '"line"');
            col = extractNumberField(startBody, '"character"');
          }
        }
      }
    }

    if (uri.length > 0 && line >= 0) {
      _refUris.push(uri);
      _refLines.push(line);
      _refCols.push(col < 0 ? 0 : col);
      _refCount = _refCount + 1;
    }
    p = close + 1;
    if (_refCount >= 500) break; // hard cap
  }
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

function extractStringField(s: string, key: string): string {
  const idx = s.indexOf(key);
  if (idx < 0) return '';
  let p = idx + key.length;
  while (p < s.length && (s.charCodeAt(p) === 58 || s.charCodeAt(p) === 32)) p++;
  if (p >= s.length || s.charCodeAt(p) !== 34) return '';
  p++;
  let out = '';
  while (p < s.length) {
    const c = s.charCodeAt(p);
    if (c === 92 && p + 1 < s.length) {
      const n = s.charCodeAt(p + 1);
      if (n === 34) out += '"';
      else if (n === 92) out += '\\';
      else if (n === 47) out += '/';
      else if (n === 110) out += '\n';
      else if (n === 116) out += '\t';
      else out += s.charAt(p + 1);
      p += 2;
      continue;
    }
    if (c === 34) break;
    out += s.charAt(p);
    p++;
  }
  return out;
}

function extractNumberField(s: string, key: string): number {
  const idx = s.indexOf(key);
  if (idx < 0) return -1;
  let p = idx + key.length;
  while (p < s.length && (s.charCodeAt(p) === 58 || s.charCodeAt(p) === 32)) p++;
  let end = p;
  while (end < s.length) {
    const c = s.charCodeAt(end);
    if ((c >= 48 && c <= 57) || c === 45 || c === 46) {
      end = end + 1;
    } else {
      break;
    }
  }
  if (end === p) return -1;
  return Number(s.slice(p, end));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderEmptyState(message: string): void {
  if (_listContainer === null) return;
  widgetClearChildren(_listContainer);
  const empty = Text(message);
  textSetFontSize(empty, 12);
  setFg(empty, getSecondaryTextColor());
  widgetAddChild(_listContainer, empty);
}

function renderResultsList(): void {
  if (_listContainer === null) return;
  widgetClearChildren(_listContainer);

  // Group consecutive entries by file for VS Code-style readability.
  let lastFile = '';
  for (let i = 0; i < _refCount; i++) {
    const uri = _refUris[i];
    const filePath = uriToPath(uri);
    const fileLabel = shortName(filePath);
    if (fileLabel !== lastFile) {
      lastFile = fileLabel;
      const header = Text(fileLabel);
      textSetFontSize(header, 11);
      textSetFontWeight(header, 11, 0.6);
      setFg(header, getSideBarForeground());
      widgetAddChild(_listContainer, header);
    }
    appendRefRow(filePath, _refLines[i], _refCols[i]);
  }

  const summary = Text(String(_refCount) + ' ' + t('reference(s).'));
  textSetFontSize(summary, 10);
  setFg(summary, getSecondaryTextColor());
  widgetAddChild(_listContainer, summary);
}

function appendRefRow(filePath: string, line: number, col: number): void {
  if (_listContainer === null) return;
  const fp = filePath;
  const ln = line;
  const cn = col;
  const label = '  ' + t('Line') + ' ' + String(line + 1) + ', ' + t('Col') + ' ' + String(col + 1);
  const btn = Button(label, () => { _jumpHandler(fp, ln, cn); });
  setBtnFg(btn, getSideBarForeground());
  widgetAddChild(_listContainer, btn);
}

function uriToPath(uri: string): string {
  // `file:///abs/path` → `/abs/path`. Tolerate `file://` (no slash) too.
  if (uri.length < 8) return uri;
  if (uri.charCodeAt(0) === 102 && uri.charCodeAt(1) === 105 && uri.charCodeAt(2) === 108 && uri.charCodeAt(3) === 101) {
    // "file:"
    let p = 5;
    while (p < uri.length && uri.charCodeAt(p) === 47) p++;
    if (p > 5) {
      // Restore the leading slash on POSIX (file:///abs → /abs)
      return '/' + uri.slice(p);
    }
    return uri.slice(5);
  }
  return uri;
}

function shortName(path: string): string {
  let lastSlash = -1;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 47 || c === 92) lastSlash = i;
  }
  if (lastSlash >= 0) return path.slice(lastSlash + 1);
  return path;
}
