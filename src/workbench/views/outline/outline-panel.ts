/**
 * Outline panel (SHIP-V1-GAPS.md #84, Phase 2).
 *
 * Lists the symbols defined in the currently-active file, hierarchically.
 * Powered by the LSP `documentSymbol` request (`lspDocumentSymbols`). Clicking
 * a symbol jumps the editor's cursor to its declaration range.
 *
 * The renderer is intentionally simple — flat list with depth indentation —
 * to match the existing sidebar visual style (file explorer, search, git).
 */

import {
  VStack, HStack, Text, Button, Spacer, ScrollView,
  textSetFontSize, textSetFontWeight,
  widgetAddChild, widgetClearChildren, widgetSetWidth,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { setFg, setBtnFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getSecondaryTextColor } from '../../theme/theme-colors';
import { lspDocumentSymbols, setDocumentSymbolsCallback, lspIsReady } from '../lsp/lsp-bridge';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _container: unknown = null;
let _listContainer: unknown = null;
let _activeFilePath: string = '';
let _ready: number = 0;

// SymbolKind → short label (LSP standard kinds 1-26).
const KIND_NAMES = [
  '?', 'File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property',
  'Field', 'Constructor', 'Enum', 'Interface', 'Function', 'Variable', 'Constant',
  'String', 'Number', 'Boolean', 'Array', 'Object', 'Key', 'Null', 'EnumMember',
  'Struct', 'Event', 'Operator', 'TypeParameter',
];

let _jumpHandler: (filePath: string, line: number, character: number) => void = _noopJump;
function _noopJump(_f: string, _l: number, _c: number): void {}

export function setOutlineJumpHandler(fn: (filePath: string, line: number, character: number) => void): void {
  _jumpHandler = fn;
}

/**
 * Mount the outline panel into the given parent. Call once at app startup.
 * Subsequent `setOutlineActiveFile` calls re-render in place.
 */
export function renderOutlinePanel(parent: unknown, _colors: ResolvedUIColors): void {
  _container = parent;
  _ready = 1;
  widgetClearChildren(parent);

  const title = Text(t('OUTLINE'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(parent, title);

  _listContainer = VStack(2, []);
  const scroll = ScrollView();
  widgetAddChild(scroll, _listContainer);
  widgetAddChild(parent, scroll);

  setDocumentSymbolsCallback((json: string) => { onDocumentSymbolsReceived(json); });

  renderEmptyState(t('No file open'));
}

/** Switch the outline to a new active file and re-request its symbols. */
export function setOutlineActiveFile(filePath: string): void {
  _activeFilePath = filePath;
  if (_ready < 1) return;
  if (filePath.length < 1) {
    renderEmptyState(t('No file open'));
    return;
  }
  if (lspIsReady() < 1) {
    renderEmptyState(t('LSP not ready'));
    return;
  }
  renderEmptyState(t('Loading symbols…'));
  lspDocumentSymbols(filePath);
}

// ---------------------------------------------------------------------------
// Symbol parsing — handles both DocumentSymbol (hierarchical) and
// SymbolInformation (flat) result shapes. We don't depend on JSON.parse since
// Perry's behavior with deeply-nested JSON has been finicky; instead we use a
// minimal hand-rolled extractor.
// ---------------------------------------------------------------------------

interface FlatSymbol {
  name: string;
  kind: number;
  line: number;
  character: number;
  depth: number;
}

let _symbols: FlatSymbol[] = [];

function onDocumentSymbolsReceived(json: string): void {
  if (_listContainer === null) return;
  _symbols = [];
  if (json.length === 0 || json === 'null') {
    renderEmptyState(t('No symbols'));
    return;
  }
  // The result is an array. Walk it, recursing into `children` when present.
  let pos = 0;
  while (pos < json.length) {
    const next = parseSymbolObject(json, pos, 0);
    if (next < 0) break;
    pos = next;
  }
  if (_symbols.length === 0) {
    renderEmptyState(t('No symbols'));
    return;
  }
  renderSymbolList();
}

/**
 * Parse one symbol object starting at `from`. Pushes a `FlatSymbol` into
 * `_symbols`, then recurses into `children` (if present) with depth+1.
 * Returns the position right after the symbol's closing brace, or -1.
 */
function parseSymbolObject(s: string, from: number, depth: number): number {
  const open = s.indexOf('{', from);
  if (open < 0) return -1;
  const end = findMatchingBrace(s, open);
  if (end < 0) return -1;

  const body = s.slice(open, end + 1);
  const name = extractStringField(body, '"name"');
  const kind = extractNumberField(body, '"kind"');
  // selectionRange.start is the precise click target; fall back to range.start.
  let line = -1;
  let character = -1;
  const selIdx = body.indexOf('"selectionRange"');
  const rangeIdx = body.indexOf('"range"');
  const useIdx = selIdx >= 0 ? selIdx : rangeIdx;
  if (useIdx >= 0) {
    const slice = body.slice(useIdx);
    line = extractNumberField(slice, '"line"');
    character = extractNumberField(slice, '"character"');
  }

  if (name.length > 0 && line >= 0) {
    _symbols.push({ name: name, kind: kind, line: line, character: character, depth: depth });
  }

  // Recurse into children (hierarchical DocumentSymbol).
  const childrenIdx = body.indexOf('"children"');
  if (childrenIdx >= 0) {
    const arrOpen = body.indexOf('[', childrenIdx);
    if (arrOpen >= 0) {
      const arrEnd = findMatchingBracket(body, arrOpen, 91, 93);
      if (arrEnd > arrOpen) {
        let cp = arrOpen + 1;
        while (cp < arrEnd) {
          const nb = body.indexOf('{', cp);
          if (nb < 0 || nb >= arrEnd) break;
          // Recurse — note we translate `nb` back to absolute position in `s`.
          const absoluteNb = open + nb;
          const advanced = parseSymbolObject(s, absoluteNb, depth + 1);
          if (advanced < 0) break;
          cp = (advanced - open);
        }
      }
    }
  }
  return end + 1;
}

function findMatchingBrace(s: string, openPos: number): number {
  return findMatchingBracket(s, openPos, 123, 125);
}

function findMatchingBracket(s: string, openPos: number, open: number, close: number): number {
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
    if (c === open) depth = depth + 1;
    else if (c === close) {
      depth = depth - 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractStringField(s: string, key: string): string {
  const idx = s.indexOf(key);
  if (idx < 0) return '';
  const colon = s.indexOf(':', idx + key.length);
  if (colon < 0) return '';
  const quote = s.indexOf('"', colon);
  if (quote < 0) return '';
  let i = quote + 1;
  let out = '';
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 92 && i + 1 < s.length) {
      const nc = s.charCodeAt(i + 1);
      if (nc === 110) out += '\n';
      else if (nc === 116) out += '\t';
      else out += s.charAt(i + 1);
      i = i + 2;
      continue;
    }
    if (c === 34) break;
    out += s.charAt(i);
    i = i + 1;
  }
  return out;
}

function extractNumberField(s: string, key: string): number {
  const idx = s.indexOf(key);
  if (idx < 0) return -1;
  const colon = s.indexOf(':', idx + key.length);
  if (colon < 0) return -1;
  let p = colon + 1;
  while (p < s.length && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9)) p = p + 1;
  let end = p;
  while (end < s.length) {
    const c = s.charCodeAt(end);
    if ((c >= 48 && c <= 57) || c === 45 || c === 46 || c === 101 || c === 69) {
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

function renderSymbolList(): void {
  if (_listContainer === null) return;
  widgetClearChildren(_listContainer);
  const n = _symbols.length;
  for (let i = 0; i < n; i++) {
    const sym = _symbols[i];
    appendSymbolRow(sym);
    if (i >= 500) break; // hard cap to avoid runaway rendering
  }
}

function appendSymbolRow(sym: FlatSymbol): void {
  if (_listContainer === null) return;
  // Capture values for the click closure.
  const filePath = _activeFilePath;
  const line = sym.line;
  const character = sym.character;
  const row = HStack(6, []);
  if (sym.depth > 0) {
    const indent = Text('');
    widgetSetWidth(indent, sym.depth * 14);
    widgetAddChild(row, indent);
  }
  const kindLabel = sym.kind >= 1 && sym.kind <= 26 ? KIND_NAMES[sym.kind] : '?';
  const button = Button(sym.name, () => { _jumpHandler(filePath, line, character); });
  setBtnFg(button, getSideBarForeground());
  widgetAddChild(row, button);
  widgetAddChild(row, Spacer());
  const kindBadge = Text(kindLabel);
  textSetFontSize(kindBadge, 10);
  setFg(kindBadge, getSecondaryTextColor());
  widgetAddChild(row, kindBadge);
  widgetAddChild(_listContainer, row);
}
