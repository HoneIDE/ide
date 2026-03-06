/**
 * AI Inline completion — polls cursor for FIM (fill-in-middle) ghost text.
 */
import type { ResolvedUIColors } from '../../theme/theme-loader';

let _inlineReady: number = 0;
let _lastCursorLine: number = -1;
let _lastCursorCol: number = -1;
let _pollIntervalId: number = 0;

// Editor access callbacks
let _getCursorLine: () => number = () => -1;
let _getCursorCol: () => number = () => -1;
let _getLineContent: (line: number) => string = () => '';
let _setGhostText: (text: string, line: number, col: number) => void = () => {};
let _clearGhostText: () => void = () => {};

export function setInlineEditorAccess(
  getCursorLine: () => number,
  getCursorCol: () => number,
  getLineContent: (line: number) => string,
  setGhostText: (text: string, line: number, col: number) => void,
  clearGhostText: () => void,
): void {
  _getCursorLine = getCursorLine;
  _getCursorCol = getCursorCol;
  _getLineContent = getLineContent;
  _setGhostText = setGhostText;
  _clearGhostText = clearGhostText;
}

function pollCursor(): void {
  if (_inlineReady < 1) return;
  const line = _getCursorLine();
  const col = _getCursorCol();
  if (line !== _lastCursorLine || col !== _lastCursorCol) {
    _lastCursorLine = line;
    _lastCursorCol = col;
    _clearGhostText();
    // Future: trigger FIM completion request after debounce
  }
}

export function initInlineCompletion(): void {
  _inlineReady = 1;
  _pollIntervalId = setInterval(pollCursor, 300) as unknown as number;
}

export function stopInlineCompletion(): void {
  _inlineReady = 0;
  if (_pollIntervalId > 0) {
    clearInterval(_pollIntervalId);
    _pollIntervalId = 0;
  }
}
