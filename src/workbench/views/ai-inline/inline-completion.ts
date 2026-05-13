/**
 * Snippet hints — local heuristic ghost text after cursor dwell.
 *
 * SHIP-V1-GAPS.md #10: ships a *local* snippet engine, not a model-backed
 * inline completion. Pattern-matches the line before the cursor and offers
 * closings (`)`, `}`, `then`/`end`, block bodies). No AI provider is
 * contacted; no FIM prompt is sent. The exported function/setting names keep
 * the `aiInline*` prefix for back-compat with stored settings files.
 * Model-backed completion using `hone-core/src/ai/inline/completion-provider.ts`
 * is queued for v1.1 once the IDE has a streaming HTTP path for FIM.
 *
 * Polls cursor position, debounces, calls the editor's ghost text FFI when a
 * suggestion is available. Perry-safe: module-level state.
 */
import { getWorkbenchSettings } from '../../settings';

let _inlineReady: number = 0;
let _lastCursorLine: number = -1;
let _lastCursorCol: number = -1;
let _pollIntervalId: number = 0;
let _dwellTicks: number = 0;
let _completionRequested: number = 0;
let _ghostActive: number = 0;
let _lastSuggestion: string = '';

// Editor access callbacks
let _getCursorLine: () => number = () => -1;
let _getCursorCol: () => number = () => -1;
let _getLineContent: (line: number) => string = () => '';
let _setGhostText: (text: string, line: number, col: number) => void = () => {};
let _clearGhostText: () => void = () => {};
let _getFileContent: () => string = () => '';
let _getFilePath: () => string = () => '';
let _insertText: (text: string) => void = () => {};

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

/** Set the text insertion callback for accepting completions. */
export function setInlineInsertCallback(
  insertText: (text: string) => void,
): void {
  _insertText = insertText;
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
      _lastSuggestion = '';
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

  // Get the current line text
  const lineContent = _getLineContent(line);
  if (lineContent.length < 1 && col < 1) return;

  // Get a few lines above for context
  let contextAbove = '';
  let ctxStart = line - 5;
  if (ctxStart < 0) ctxStart = 0;
  for (let ci = ctxStart; ci < line; ci++) {
    const ctxLine = _getLineContent(ci);
    contextAbove += ctxLine;
    contextAbove += '\n';
  }

  // Get file extension for language-specific suggestions
  const filePath = _getFilePath();
  const ext = getFileExtension(filePath);

  // Generate a context-aware suggestion
  const suggestion = generateLocalSuggestion(lineContent, col, contextAbove, ext);

  if (suggestion.length > 0) {
    _setGhostText(suggestion, line, col);
    _ghostActive = 1;
    _lastSuggestion = suggestion;
  }
}

/** Extract file extension from path (Perry-safe, no regex). */
function getFileExtension(filePath: string): string {
  if (filePath.length < 1) return '';
  let lastDot = -1;
  for (let i = filePath.length - 1; i >= 0; i--) {
    const ch = filePath.charCodeAt(i);
    if (ch === 46) { // '.'
      lastDot = i;
      break;
    }
    if (ch === 47 || ch === 92) break; // '/' or '\'
  }
  if (lastDot < 0) return '';
  return filePath.slice(lastDot + 1);
}

/** Count leading whitespace characters. */
function getIndent(lineContent: string): string {
  let indent = '';
  for (let i = 0; i < lineContent.length; i++) {
    const ch = lineContent.charCodeAt(i);
    if (ch === 32 || ch === 9) { // space or tab
      indent += lineContent.charAt(i);
    } else {
      break;
    }
  }
  return indent;
}

/** Check if a string ends with a given suffix (Perry-safe). */
function endsWith(str: string, suffix: string): boolean {
  if (str.length < suffix.length) return false;
  const start = str.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    if (str.charCodeAt(start + i) !== suffix.charCodeAt(i)) return false;
  }
  return true;
}

/** Check if text before cursor position contains a substring. */
function lineBeforeCursor(lineContent: string, col: number): string {
  if (col >= lineContent.length) return lineContent;
  return lineContent.slice(0, col);
}

/** Trim whitespace from start of string (Perry-safe). */
function trimStart(str: string): string {
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
      start = i + 1;
    } else {
      break;
    }
  }
  return str.slice(start);
}

/** Trim whitespace from end of string (Perry-safe). */
function trimEnd(str: string): string {
  let end = str.length;
  for (let i = str.length - 1; i >= 0; i--) {
    const ch = str.charCodeAt(i);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
      end = i;
    } else {
      break;
    }
  }
  return str.slice(0, end);
}

/** Check if contextAbove suggests we're inside a function body. */
function isInsideFunction(contextAbove: string): number {
  // Look for function/method signature in context above
  if (contextAbove.indexOf('function ') >= 0) return 1;
  if (contextAbove.indexOf(') {') >= 0) return 1;
  if (contextAbove.indexOf('=> {') >= 0) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Perry-safe string builders: use += to build multi-part suggestions.
// Perry's `'a' + var + 'b'` chained concatenation is unreliable; `+=` works.
// ---------------------------------------------------------------------------

/** Build `<prefix>\n<indent>  \n<indent>}` block pattern (2-space indent). */
function blockBody2(prefix: string, indent: string): string {
  let s = '';
  s += prefix;
  s += '\n';
  s += indent;
  s += '  \n';
  s += indent;
  s += '}';
  return s;
}

/** Build ` {\n<indent>  \n<indent>}` block pattern. */
function braceBlock2(indent: string): string {
  let s = ' {\n';
  s += indent;
  s += '  \n';
  s += indent;
  s += '}';
  return s;
}

/** Build `{\n<indent>  \n<indent>}` block pattern (no leading space). */
function braceBlockNoSpace2(indent: string): string {
  let s = '{\n';
  s += indent;
  s += '  \n';
  s += indent;
  s += '}';
  return s;
}

/** Build `) {\n<indent>  \n<indent>}` close-paren-then-block. */
function closeParenBlock2(indent: string): string {
  let s = ') {\n';
  s += indent;
  s += '  \n';
  s += indent;
  s += '}';
  return s;
}

/** Build block with 4-space indent (for Rust). */
function braceBlockNoSpace4(indent: string): string {
  let s = '{\n';
  s += indent;
  s += '    \n';
  s += indent;
  s += '}';
  return s;
}

/** Build ` {\n<indent>    \n<indent>}` (4-space). */
function braceBlock4(indent: string): string {
  let s = ' {\n';
  s += indent;
  s += '    \n';
  s += indent;
  s += '}';
  return s;
}

/** Build block with tab indent (for Go). */
function braceBlockTab(indent: string): string {
  let s = ' {\n';
  s += indent;
  s += '\t\n';
  s += indent;
  s += '}';
  return s;
}

/** Build block with tab indent, no leading space (for Go). */
function braceBlockNoSpaceTab(indent: string): string {
  let s = '{\n';
  s += indent;
  s += '\t\n';
  s += indent;
  s += '}';
  return s;
}

/**
 * Generate a context-aware suggestion based on current line, cursor position,
 * lines above, and file extension.
 */
function generateLocalSuggestion(lineContent: string, col: number, contextAbove: string, ext: string): string {
  const before = lineBeforeCursor(lineContent, col);
  const trimmed = trimStart(before);
  const indent = getIndent(lineContent);

  // Only suggest when at or near end of line content
  const afterCursor = lineContent.slice(col);
  const afterTrimmed = trimEnd(afterCursor);
  if (afterTrimmed.length > 0) return '';

  // Empty line after opening brace — suggest closing brace
  if (trimmed.length === 0) {
    // Check if the line above ends with {
    const ctxTrimmed = trimEnd(contextAbove);
    if (endsWith(ctxTrimmed, '{')) {
      // Determine outer indent from context
      let outerIndent = '';
      let lastNlPos = -1;
      for (let i = ctxTrimmed.length - 1; i >= 0; i--) {
        if (ctxTrimmed.charCodeAt(i) === 10) {
          lastNlPos = i;
          break;
        }
      }
      if (lastNlPos >= 0) {
        const lastLine = ctxTrimmed.slice(lastNlPos + 1);
        outerIndent = getIndent(lastLine);
      }
      let result = '';
      result += outerIndent;
      result += '}';
      return result;
    }
    return '';
  }

  // ---- Language-specific patterns ----
  if (ext === 'py') {
    return generatePythonSuggestion(trimmed, before, indent);
  }
  if (ext === 'go') {
    return generateGoSuggestion(trimmed, before, indent);
  }
  if (ext === 'rs') {
    return generateRustSuggestion(trimmed, before, indent);
  }

  // ---- TypeScript / JavaScript / general patterns ----
  return generateTsSuggestion(trimmed, before, indent, contextAbove);
}

/**
 * TypeScript / JavaScript suggestions.
 */
function generateTsSuggestion(trimmed: string, before: string, indent: string, contextAbove: string): string {

  // After `function ` without parens or braces
  if (trimmed.indexOf('function ') === 0) {
    if (before.indexOf('(') < 0) {
      let s = 'name() {\n';
      s += indent;
      s += '  \n';
      s += indent;
      s += '}';
      return s;
    }
    if (before.indexOf('{') < 0) {
      if (before.indexOf(')') >= 0) {
        return braceBlock2(indent);
      }
      return closeParenBlock2(indent);
    }
    return '';
  }

  // After `if (` — suggest closing `) { ... }`
  if (trimmed.indexOf('if (') === 0 || trimmed.indexOf('if(') === 0) {
    if (before.indexOf('{') < 0) {
      if (before.indexOf(')') >= 0) {
        return braceBlock2(indent);
      }
      return closeParenBlock2(indent);
    }
    return '';
  }

  // After `else if (` — suggest closing `) { ... }`
  if (trimmed.indexOf('else if (') >= 0 || trimmed.indexOf('} else if (') >= 0) {
    if (before.indexOf('{') < 0) {
      if (before.indexOf(')') >= 0) {
        return braceBlock2(indent);
      }
      return closeParenBlock2(indent);
    }
    return '';
  }

  // After `else` without brace
  if (endsWith(trimmed, 'else') || endsWith(trimmed, '} else')) {
    return braceBlock2(indent);
  }

  // After `for (` — suggest standard loop
  if (trimmed.indexOf('for (') === 0 || trimmed.indexOf('for(') === 0) {
    if (before.indexOf('{') < 0) {
      if (before.indexOf(';') < 0) {
        let s = 'let i = 0; i < arr.length; i++) {\n';
        s += indent;
        s += '  \n';
        s += indent;
        s += '}';
        return s;
      }
      if (before.indexOf(')') >= 0) {
        return braceBlock2(indent);
      }
      return closeParenBlock2(indent);
    }
    return '';
  }

  // After `while (` — suggest closing `) { ... }`
  if (trimmed.indexOf('while (') === 0 || trimmed.indexOf('while(') === 0) {
    if (before.indexOf('{') < 0) {
      if (before.indexOf(')') >= 0) {
        return braceBlock2(indent);
      }
      return closeParenBlock2(indent);
    }
    return '';
  }

  // After `switch (` — suggest closing `) { case: break; }`
  if (trimmed.indexOf('switch (') === 0 || trimmed.indexOf('switch(') === 0) {
    if (before.indexOf('{') < 0) {
      if (before.indexOf(')') >= 0) {
        let s = ' {\n';
        s += indent;
        s += '  case :\n';
        s += indent;
        s += '    break;\n';
        s += indent;
        s += '}';
        return s;
      }
    }
    return '';
  }

  // After `const ` or `let ` without `=`
  if (trimmed.indexOf('const ') === 0 || trimmed.indexOf('let ') === 0) {
    if (before.indexOf('=') < 0 && before.indexOf(';') < 0) {
      return '= ';
    }
    if (before.indexOf('=') >= 0 && before.indexOf(';') < 0) {
      if (endsWith(trimmed, '{')) return '';
      if (endsWith(trimmed, '(')) return '';
      return ';';
    }
    return '';
  }

  // After `var ` without `=`
  if (trimmed.indexOf('var ') === 0) {
    if (before.indexOf('=') < 0 && before.indexOf(';') < 0) {
      return '= ';
    }
    return '';
  }

  // After `import ` — suggest `{ } from '';`
  if (trimmed.indexOf('import ') === 0) {
    if (before.indexOf('from') < 0) {
      if (before.indexOf('{') < 0) {
        return "{ } from '';";
      }
      if (before.indexOf('}') >= 0) {
        return " from '';";
      }
      return " } from '';";
    }
    if (before.indexOf("'") < 0 && before.indexOf('"') < 0) {
      return " '';";
    }
    return '';
  }

  // After `export ` — suggest common patterns
  if (trimmed.indexOf('export ') === 0) {
    if (endsWith(trimmed, 'export ')) {
      return 'function ';
    }
    if (endsWith(trimmed, 'export default ')) {
      return 'function ';
    }
    return '';
  }

  // After `class ` — suggest class body
  if (trimmed.indexOf('class ') === 0) {
    if (before.indexOf('{') < 0) {
      if (before.indexOf('extends') >= 0 || before.indexOf('implements') >= 0) {
        let s = ' {\n';
        s += indent;
        s += '  constructor() {\n';
        s += indent;
        s += '  }\n';
        s += indent;
        s += '}';
        return s;
      }
      let s = 'Name {\n';
      s += indent;
      s += '  constructor() {\n';
      s += indent;
      s += '  }\n';
      s += indent;
      s += '}';
      return s;
    }
    return '';
  }

  // After `interface ` — suggest interface body
  if (trimmed.indexOf('interface ') === 0) {
    if (before.indexOf('{') < 0) {
      return braceBlockNoSpace2(indent);
    }
    return '';
  }

  // After `return ` — suggest semicolon if inside function
  if (trimmed.indexOf('return ') === 0) {
    if (endsWith(trimmed, 'return ')) {
      if (isInsideFunction(contextAbove) > 0) {
        return ';';
      }
    }
    return '';
  }

  // After `return;` — nothing
  if (trimmed.indexOf('return;') === 0) return '';

  // After `try` — suggest try/catch block
  if (endsWith(trimmed, 'try')) {
    let s = ' {\n';
    s += indent;
    s += '  \n';
    s += indent;
    s += '} catch (e) {\n';
    s += indent;
    s += '  \n';
    s += indent;
    s += '}';
    return s;
  }

  // After `catch` — suggest `(e) { }`
  if (endsWith(trimmed, 'catch')) {
    let s = ' (e) {\n';
    s += indent;
    s += '  \n';
    s += indent;
    s += '}';
    return s;
  }

  // After `console.` — suggest common methods
  if (endsWith(trimmed, 'console.')) {
    return 'log()';
  }

  // After `async ` — suggest function
  if (endsWith(trimmed, 'async ')) {
    return 'function ';
  }

  // After `throw new ` — suggest Error
  if (endsWith(trimmed, 'throw new ')) {
    return "Error('')";
  }

  // Arrow function: after `) => ` without brace
  if (endsWith(trimmed, ') =>') || endsWith(trimmed, ') => ')) {
    return braceBlockNoSpace2(indent);
  }

  // After opening brace at end of line — handled by empty-line-after-brace above
  if (endsWith(trimmed, '{')) {
    return '';
  }

  return '';
}

/**
 * Python-specific suggestions.
 */
function generatePythonSuggestion(trimmed: string, before: string, indent: string): string {
  // After `def ` — suggest function signature
  if (trimmed.indexOf('def ') === 0) {
    if (before.indexOf('(') < 0) {
      let s = 'name(self):\n';
      s += indent;
      s += '    pass';
      return s;
    }
    if (before.indexOf(':') < 0) {
      if (before.indexOf(')') >= 0) {
        let s = ':\n';
        s += indent;
        s += '    pass';
        return s;
      }
      let s = '):\n';
      s += indent;
      s += '    pass';
      return s;
    }
    return '';
  }

  // After `class ` — suggest class body
  if (trimmed.indexOf('class ') === 0) {
    if (before.indexOf(':') < 0) {
      let s = ':\n';
      s += indent;
      s += '    def __init__(self):\n';
      s += indent;
      s += '        pass';
      return s;
    }
    return '';
  }

  // After `if ` — suggest colon
  if (trimmed.indexOf('if ') === 0) {
    if (before.indexOf(':') < 0) {
      return ':';
    }
    return '';
  }

  // After `elif ` — suggest colon
  if (trimmed.indexOf('elif ') === 0) {
    if (before.indexOf(':') < 0) {
      return ':';
    }
    return '';
  }

  // After `else` — suggest colon
  if (endsWith(trimmed, 'else')) {
    return ':';
  }

  // After `for ` — suggest for-in
  if (trimmed.indexOf('for ') === 0) {
    if (before.indexOf(' in ') < 0) {
      return 'item in items:';
    }
    if (before.indexOf(':') < 0) {
      return ':';
    }
    return '';
  }

  // After `while ` — suggest colon
  if (trimmed.indexOf('while ') === 0) {
    if (before.indexOf(':') < 0) {
      return ':';
    }
    return '';
  }

  // After `from ` — suggest import
  if (trimmed.indexOf('from ') === 0) {
    if (before.indexOf('import') < 0) {
      return ' import ';
    }
    return '';
  }

  // After `return ` — suggest None
  if (endsWith(trimmed, 'return ')) {
    return 'None';
  }

  // After `try:` — suggest try/except block
  if (endsWith(trimmed, 'try:')) {
    let s = '\n';
    s += indent;
    s += '    pass\n';
    s += indent;
    s += 'except Exception as e:\n';
    s += indent;
    s += '    pass';
    return s;
  }

  // After `print(` — suggest closing
  if (endsWith(trimmed, 'print(')) {
    return ')';
  }

  return '';
}

/**
 * Go-specific suggestions.
 */
function generateGoSuggestion(trimmed: string, before: string, indent: string): string {
  // After `func ` — suggest function signature
  if (trimmed.indexOf('func ') === 0) {
    if (before.indexOf('(') < 0) {
      let s = 'name() {\n';
      s += indent;
      s += '\t\n';
      s += indent;
      s += '}';
      return s;
    }
    if (before.indexOf('{') < 0) {
      if (before.indexOf(')') >= 0) {
        return braceBlockTab(indent);
      }
    }
    return '';
  }

  // After `if ` — suggest condition block
  if (trimmed.indexOf('if ') === 0) {
    if (before.indexOf('{') < 0) {
      return braceBlockNoSpaceTab(indent);
    }
    return '';
  }

  // After `for ` — suggest range
  if (trimmed.indexOf('for ') === 0) {
    if (before.indexOf('{') < 0) {
      if (before.indexOf(':=') < 0) {
        let s = 'i := 0; i < n; i++ {\n';
        s += indent;
        s += '\t\n';
        s += indent;
        s += '}';
        return s;
      }
      return braceBlockNoSpaceTab(indent);
    }
    return '';
  }

  // After `type ` — suggest struct
  if (trimmed.indexOf('type ') === 0) {
    if (before.indexOf('struct') < 0 && before.indexOf('interface') < 0) {
      let s = 'Name struct {\n';
      s += indent;
      s += '\t\n';
      s += indent;
      s += '}';
      return s;
    }
    return '';
  }

  // After `switch` — suggest body
  if (trimmed.indexOf('switch ') === 0 || endsWith(trimmed, 'switch')) {
    if (before.indexOf('{') < 0) {
      let s = ' {\n';
      s += indent;
      s += 'case :\n';
      s += indent;
      s += '\t\n';
      s += indent;
      s += '}';
      return s;
    }
    return '';
  }

  // After `package ` — suggest main
  if (trimmed.indexOf('package ') === 0) {
    if (endsWith(trimmed, 'package ')) {
      return 'main';
    }
    return '';
  }

  // After `import ` — suggest quotes
  if (endsWith(trimmed, 'import ')) {
    return '"fmt"';
  }

  // After `fmt.` — suggest Println
  if (endsWith(trimmed, 'fmt.')) {
    return 'Println()';
  }

  // After `return ` — suggest nil
  if (endsWith(trimmed, 'return ')) {
    return 'nil';
  }

  // After `err != nil {` — suggest error return
  if (endsWith(trimmed, 'err != nil {')) {
    let s = '\n';
    s += indent;
    s += '\treturn err\n';
    s += indent;
    s += '}';
    return s;
  }

  return '';
}

/**
 * Rust-specific suggestions.
 */
function generateRustSuggestion(trimmed: string, before: string, indent: string): string {
  // After `fn ` or `pub fn ` — suggest function signature
  if (trimmed.indexOf('fn ') === 0 || trimmed.indexOf('pub fn ') === 0) {
    if (before.indexOf('(') < 0) {
      let s = 'name() {\n';
      s += indent;
      s += '    \n';
      s += indent;
      s += '}';
      return s;
    }
    if (before.indexOf('{') < 0) {
      if (before.indexOf(')') >= 0) {
        return braceBlock4(indent);
      }
      if (before.indexOf('->') >= 0) {
        return braceBlock4(indent);
      }
    }
    return '';
  }

  // After `struct ` — suggest struct body
  if (trimmed.indexOf('struct ') === 0 || trimmed.indexOf('pub struct ') === 0) {
    if (before.indexOf('{') < 0) {
      return braceBlockNoSpace4(indent);
    }
    return '';
  }

  // After `impl ` — suggest impl body
  if (trimmed.indexOf('impl ') === 0) {
    if (before.indexOf('{') < 0) {
      return braceBlockNoSpace4(indent);
    }
    return '';
  }

  // After `enum ` — suggest enum body
  if (trimmed.indexOf('enum ') === 0 || trimmed.indexOf('pub enum ') === 0) {
    if (before.indexOf('{') < 0) {
      return braceBlockNoSpace4(indent);
    }
    return '';
  }

  // After `if ` — suggest condition
  if (trimmed.indexOf('if ') === 0) {
    if (before.indexOf('{') < 0) {
      return braceBlockNoSpace4(indent);
    }
    return '';
  }

  // After `for ` — suggest iteration
  if (trimmed.indexOf('for ') === 0) {
    if (before.indexOf(' in ') < 0) {
      let s = 'item in items.iter() {\n';
      s += indent;
      s += '    \n';
      s += indent;
      s += '}';
      return s;
    }
    if (before.indexOf('{') < 0) {
      return braceBlockNoSpace4(indent);
    }
    return '';
  }

  // After `match ` — suggest match body
  if (trimmed.indexOf('match ') === 0) {
    if (before.indexOf('{') < 0) {
      let s = '{\n';
      s += indent;
      s += '    _ => {},\n';
      s += indent;
      s += '}';
      return s;
    }
    return '';
  }

  // After `let ` — suggest binding
  if (trimmed.indexOf('let ') === 0 || trimmed.indexOf('let mut ') === 0) {
    if (before.indexOf('=') < 0 && before.indexOf(';') < 0) {
      return '= ';
    }
    if (before.indexOf('=') >= 0 && before.indexOf(';') < 0) {
      return ';';
    }
    return '';
  }

  // After `println!(` — suggest closing
  if (endsWith(trimmed, 'println!(')) {
    return '"")';
  }

  // After `Ok(` — suggest closing
  if (endsWith(trimmed, 'Ok(')) {
    return ')';
  }

  // After `Err(` — suggest closing
  if (endsWith(trimmed, 'Err(')) {
    return ')';
  }

  return '';
}

/**
 * Accept the current ghost text (Tab key).
 * NOTE: In Perry mode, the EditorViewModel handles Tab -> acceptGhostText
 * automatically (inserts text + clears ghost state). This function is an
 * external API for programmatic acceptance outside the key event pipeline.
 */
export function acceptInlineCompletion(): void {
  if (_ghostActive < 1) return;
  if (_lastSuggestion.length > 0) {
    _insertText(_lastSuggestion);
  }
  _clearGhostText();
  _ghostActive = 0;
  _completionRequested = 0;
  _lastSuggestion = '';
}

/**
 * Dismiss the current ghost text (Escape key).
 * NOTE: In Perry mode, the EditorViewModel handles Escape -> ghostText.dismiss()
 * automatically. This function is an external API for programmatic dismissal.
 */
export function dismissInlineCompletion(): void {
  if (_ghostActive < 1) return;
  _clearGhostText();
  _ghostActive = 0;
  _completionRequested = 0;
  _lastSuggestion = '';
}

export function initInlineCompletion(): void {
  _inlineReady = 1;
  _pollIntervalId = setInterval(pollCursorFn, 300) as unknown as number;
}

/** Module-level named function for setInterval callback (Perry closure constraint). */
function pollCursorFn(): void {
  pollCursor();
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
