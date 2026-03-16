/**
 * AI Inline completion — triggers FIM ghost text after cursor dwell.
 *
 * Polls cursor position, debounces, calls the editor's ghost text FFI
 * when a completion is available. Perry-safe: module-level state.
 */
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getWorkbenchSettings } from '../../settings';

let _inlineReady: number = 0;
let _lastCursorLine: number = -1;
let _lastCursorCol: number = -1;
let _pollIntervalId: number = 0;
let _dwellTicks: number = 0;
let _completionRequested: number = 0;
let _ghostActive: number = 0;

// Editor access callbacks
let _getCursorLine: () => number = () => -1;
let _getCursorCol: () => number = () => -1;
let _getLineContent: (line: number) => string = () => '';
let _setGhostText: (text: string, line: number, col: number) => void = () => {};
let _clearGhostText: () => void = () => {};
let _getFileContent: () => string = () => '';
let _getFilePath: () => string = () => '';

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

/** Set additional context providers for FIM. */
export function setInlineContextProviders(
  getFileContent: () => string,
  getFilePath: () => string,
): void {
  _getFileContent = getFileContent;
  _getFilePath = getFilePath;
}

function pollCursor(): void {
  if (_inlineReady < 1) return;

  const line = _getCursorLine();
  const col = _getCursorCol();

  // Cursor moved — reset dwell, clear ghost text
  if (line !== _lastCursorLine || col !== _lastCursorCol) {
    _lastCursorLine = line;
    _lastCursorCol = col;
    _dwellTicks = 0;
    _completionRequested = 0;
    if (_ghostActive > 0) {
      _clearGhostText();
      _ghostActive = 0;
    }
    return;
  }

  // Cursor dwelling — increment counter
  _dwellTicks = _dwellTicks + 1;

  // After ~600ms (2 ticks at 300ms), trigger completion
  if (_dwellTicks === 2 && _completionRequested < 1) {
    _completionRequested = 1;
    requestCompletion(line, col);
  }
}

/** Request a FIM completion for the current cursor position. */
function requestCompletion(line: number, col: number): void {
  // Check if inline completion is enabled in settings
  const settings = getWorkbenchSettings();
  if (!settings.aiInlineCompletionEnabled) return;

  // Get context for FIM
  const content = _getFileContent();
  if (content.length < 1) return;

  // Build prefix (content before cursor) and suffix (content after cursor)
  let offset = 0;
  let currentLine = 0;
  for (let i = 0; i < content.length; i = i + 1) {
    if (currentLine === line) {
      offset = i + col;
      break;
    }
    if (content.charCodeAt(i) === 10) {
      currentLine = currentLine + 1;
    }
  }

  const prefix = content.slice(0, offset);
  const suffix = content.slice(offset);

  // For now, generate a simple context-aware suggestion
  // Full FIM provider integration (Anthropic/OpenAI API) comes with AI provider wiring
  const lineContent = _getLineContent(line);
  const suggestion = generateLocalSuggestion(lineContent, col, prefix);

  if (suggestion.length > 0) {
    _setGhostText(suggestion, line, col);
    _ghostActive = 1;
  }
}

/**
 * Generate a simple local suggestion based on context.
 * This is a placeholder — the real FIM will call the AI provider API.
 */
function generateLocalSuggestion(lineContent: string, col: number, _prefix: string): string {
  // Only suggest when at end of line or after common patterns
  if (col < lineContent.length) return '';

  // Simple pattern matching for common completions
  const trimmed = lineContent.trimStart();

  // Function declaration → suggest body
  if (trimmed.indexOf('function ') === 0 && lineContent.indexOf('{') < 0) {
    return ' {\n  \n}';
  }
  // If statement → suggest body
  if (trimmed.indexOf('if (') === 0 && lineContent.indexOf('{') < 0) {
    return ' {\n  \n}';
  }
  // For loop → suggest body
  if (trimmed.indexOf('for (') === 0 && lineContent.indexOf('{') < 0) {
    return ' {\n  \n}';
  }
  // const/let with = → suggest semicolon
  if ((trimmed.indexOf('const ') === 0 || trimmed.indexOf('let ') === 0) && lineContent.indexOf(';') < 0 && lineContent.indexOf('=') > 0) {
    return ';';
  }

  return '';
}

/** Accept the current ghost text (Tab key). */
export function acceptInlineCompletion(): void {
  if (_ghostActive < 1) return;
  // The ghost text controller in EditorViewModel handles insertion
  // For now, just clear the ghost — full acceptance needs editor command wiring
  _clearGhostText();
  _ghostActive = 0;
}

/** Dismiss the current ghost text (Escape key). */
export function dismissInlineCompletion(): void {
  if (_ghostActive < 1) return;
  _clearGhostText();
  _ghostActive = 0;
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

export function isGhostTextActive(): number {
  return _ghostActive;
}
