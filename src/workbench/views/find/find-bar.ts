/**
 * Find & Replace bar — VS Code-style overlay at top-right of editor pane.
 *
 * Architecture: The find bar is a Perry UI overlay positioned on the editor pane.
 * It uses callbacks to get/set editor content and navigate matches.
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, Text, Button, Spacer,
  HStackWithInsets, VStackWithInsets,
  TextField,
  textSetFontSize, textSetString,
  buttonSetBordered, buttonSetImage, buttonSetImagePosition,
  widgetAddChild, widgetSetWidth, widgetSetHeight, widgetSetHidden, widgetSetHugging, widgetSetBackgroundColor,
  widgetAddOverlay, widgetSetOverlayFrame,
  textfieldSetString, textfieldFocus, textfieldSetOnSubmit,
  textfieldSetBorderless, textfieldSetBackgroundColor, textfieldSetFontSize, textfieldSetTextColor,
} from 'perry/ui';
import { setBg, setFg, setBtnFg, setBtnTint, toLowerCode } from '../../ui-helpers';
import {
  getEditorBackground, getEditorForeground,
  getInputBackground, getInputForeground, getInputBorder,
  getButtonBackground, getButtonForeground,
  isCurrentThemeDark,
} from '../../theme/theme-colors';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

// Overlay x position (set by render.ts based on editor pane width)
let findBarX: number = 0;

// Widget handles
let findBarContainer: unknown = null;
let findRowWidget: unknown = null;
let replaceRowWidget: unknown = null;
let bottomBorderWidget: unknown = null;
let findTextField: unknown = null;
let replaceTextField: unknown = null;
let matchCountLabel: unknown = null;
let replaceRow: unknown = null;
let findBarReady: number = 0;
let findBarVisible: number = 0;

// Search state
let findQuery = '';
let findCaseSensitive: number = 0;
let findWholeWord: number = 0;
let findMatchCount: number = 0;
let findCurrentMatch: number = 0;

// Match results — parallel arrays
let findMatchLines: number[] = [];
let findMatchCols: number[] = [];
let findMatchOffsets: number[] = [];
let findMatchLengths: number[] = [];

// Replace state
let replaceQuery = '';
let replaceRowVisible: number = 0;

// Toggle button refs for visual state
let caseSensitiveBtn: unknown = null;
let wholeWordBtn: unknown = null;
let chevronBtn: unknown = null;

// Editor callbacks (set by render.ts)
let _getContent: () => string = _noopContent;
let _setContent: (c: string) => void = _noopSetContent;
let _scrollToLine: (line: number) => void = _noopScroll;
let _renderEditor: () => void = _noopRender;
let _pushDecorations: (json: string) => void = _noopPush;
let _getCharWidth: () => number = _noopCharWidth;
let _getViewportStart: () => number = _noopViewportStart;
let _setLineBackground: (line: number, r: number, g: number, b: number, a: number) => void = _noopLineBg;
let _clearLineBackgrounds: () => void = _noopClearLineBg;

// Track how many lines were highlighted last time so we can clear them
let lastHighlightedLineCount: number = 0;

function _noopContent(): string { return ''; }
function _noopSetContent(c: string): void {}
function _noopScroll(line: number): void {}
function _noopRender(): void {}
function _noopPush(j: string): void {}
function _noopCharWidth(): number { return 8; }
function _noopViewportStart(): number { return 0; }
function _noopLineBg(l: number, r: number, g: number, b: number, a: number): void {}
function _noopClearLineBg(): void {}

// ---------------------------------------------------------------------------
// Setters for editor callbacks
// ---------------------------------------------------------------------------

export function setFindEditorCallbacks(
  getContent: () => string,
  setContent: (c: string) => void,
  scrollToLine: (line: number) => void,
  renderEditor: () => void,
  pushDecorations: (json: string) => void,
  getCharWidth: () => number,
  getViewportStart: () => number,
  setLineBg: (line: number, r: number, g: number, b: number, a: number) => void,
  clearLineBgs: () => void,
): void {
  _getContent = getContent;
  _setContent = setContent;
  _scrollToLine = scrollToLine;
  _renderEditor = renderEditor;
  _pushDecorations = pushDecorations;
  _getCharWidth = getCharWidth;
  _getViewportStart = getViewportStart;
  _setLineBackground = setLineBg;
  _clearLineBackgrounds = clearLineBgs;
}

export function setFindBarPosition(x: number): void {
  findBarX = x;
}

// ---------------------------------------------------------------------------
// Search logic (Perry-safe char-by-char)
// ---------------------------------------------------------------------------

function isWordBoundary(code: number): number {
  // Space, tab, newline, punctuation — NOT alphanumeric or underscore
  if (code >= 48 && code <= 57) return 0;  // 0-9
  if (code >= 65 && code <= 90) return 0;  // A-Z
  if (code >= 97 && code <= 122) return 0; // a-z
  if (code === 95) return 0;               // _
  return 1;
}

function performSearch(): void {
  findMatchLines = [];
  findMatchCols = [];
  findMatchOffsets = [];
  findMatchLengths = [];
  findMatchCount = 0;
  findCurrentMatch = 0;

  if (findQuery.length < 1) {
    updateMatchLabel();
    return;
  }

  const content = _getContent();
  if (content.length < 1) {
    updateMatchLabel();
    return;
  }

  const qLen = findQuery.length;
  let line = 0;
  let lineStart = 0;
  const limit = content.length - qLen;

  for (let i = 0; i <= limit; i++) {
    const ch = content.charCodeAt(i);
    if (ch === 10) {
      line = line + 1;
      lineStart = i + 1;
      continue;
    }

    // Try to match at position i
    let match = 1;
    for (let j = 0; j < qLen; j++) {
      let cc = content.charCodeAt(i + j);
      let qc = findQuery.charCodeAt(j);
      if (findCaseSensitive < 1) {
        cc = toLowerCode(cc);
        qc = toLowerCode(qc);
      }
      if (cc !== qc) {
        match = 0;
        break;
      }
    }

    if (match > 0) {
      // Whole word check
      if (findWholeWord > 0) {
        if (i > 0 && isWordBoundary(content.charCodeAt(i - 1)) < 1) {
          match = 0;
        }
        if (match > 0 && (i + qLen) < content.length && isWordBoundary(content.charCodeAt(i + qLen)) < 1) {
          match = 0;
        }
      }

      if (match > 0 && findMatchCount < 10000) {
        // Column = byte offset from line start (matches Rust UTF-8 byte indexing)
        const col = i - lineStart;
        findMatchLines.push(line);
        findMatchCols.push(col);
        findMatchOffsets.push(i);
        findMatchLengths.push(qLen);
        findMatchCount = findMatchCount + 1;
      }
    }
  }

  updateMatchLabel();
}

function updateMatchLabel(): void {
  if (!matchCountLabel) return;
  if (findMatchCount < 1) {
    textSetString(matchCountLabel, 'No results');
  } else {
    let label = '';
    label += String(findCurrentMatch + 1);
    label += ' of ';
    label += String(findMatchCount);
    textSetString(matchCountLabel, label);
  }
}

// ---------------------------------------------------------------------------
// Match navigation
// ---------------------------------------------------------------------------

function goToNextMatch(): void {
  if (findMatchCount < 1) return;
  findCurrentMatch = findCurrentMatch + 1;
  if (findCurrentMatch >= findMatchCount) {
    findCurrentMatch = 0;
  }
  navigateToCurrentMatch();
}

function goToPrevMatch(): void {
  if (findMatchCount < 1) return;
  findCurrentMatch = findCurrentMatch - 1;
  if (findCurrentMatch < 0) {
    findCurrentMatch = findMatchCount - 1;
  }
  navigateToCurrentMatch();
}

function navigateToCurrentMatch(): void {
  updateMatchLabel();
  if (findCurrentMatch < 0 || findCurrentMatch >= findMatchCount) return;
  const line = findMatchLines[findCurrentMatch];
  _scrollToLine(line);
  sendMatchData();
}

/** Send packed match data to render.ts via _pushDecorations callback.
 * Format: "CUR:N|LINE,COL,LEN|LINE,COL,LEN|..."
 * This avoids cross-module array access issues in Perry. */
function sendMatchData(): void {
  if (findMatchCount < 1) {
    _pushDecorations('CLEAR');
    return;
  }
  let data = 'CUR:';
  data += String(findCurrentMatch);
  const limit = findMatchCount < 200 ? findMatchCount : 200;
  for (let i = 0; i < limit; i++) {
    data += '|';
    data += String(findMatchLines[i]);
    data += ',';
    data += String(findMatchCols[i]);
    data += ',';
    data += String(findMatchLengths[i]);
  }
  _pushDecorations(data);
}

// ---------------------------------------------------------------------------
// Replace logic
// ---------------------------------------------------------------------------

function doReplaceOne(): void {
  if (findMatchCount < 1) return;
  if (findCurrentMatch < 0 || findCurrentMatch >= findMatchCount) return;
  const content = _getContent();
  const offset = findMatchOffsets[findCurrentMatch];
  const matchLen = findMatchLengths[findCurrentMatch];
  let newContent = content.slice(0, offset);
  newContent += replaceQuery;
  newContent += content.slice(offset + matchLen);
  _setContent(newContent);
  _renderEditor();
  performSearch();
  // Stay at current index or move to next
  if (findCurrentMatch >= findMatchCount && findMatchCount > 0) {
    findCurrentMatch = 0;
  }
  navigateToCurrentMatch();
}

function doReplaceAll(): void {
  if (findMatchCount < 1) return;
  const content = _getContent();
  // Replace from end to start to preserve offsets
  let result = content;
  for (let i = findMatchCount - 1; i >= 0; i--) {
    const offset = findMatchOffsets[i];
    const matchLen = findMatchLengths[i];
    let newResult = result.slice(0, offset);
    newResult += replaceQuery;
    newResult += result.slice(offset + matchLen);
    result = newResult;
  }
  _setContent(result);
  _renderEditor();
  performSearch();
}

// ---------------------------------------------------------------------------
// Toggle buttons
// ---------------------------------------------------------------------------

function toggleCaseSensitive(): void {
  findCaseSensitive = findCaseSensitive > 0 ? 0 : 1;
  updateToggleButtonColors();
  performSearch();
}

function toggleWholeWord(): void {
  findWholeWord = findWholeWord > 0 ? 0 : 1;
  updateToggleButtonColors();
  performSearch();
}

function toggleReplaceRow(): void {
  replaceRowVisible = replaceRowVisible > 0 ? 0 : 1;
  if (replaceRow) {
    widgetSetHidden(replaceRow, replaceRowVisible > 0 ? 0 : 1);
  }
  // Update overlay height
  updateOverlaySize();
}

function updateToggleButtonColors(): void {
  if (caseSensitiveBtn) {
    if (findCaseSensitive > 0) {
      setBg(caseSensitiveBtn, getButtonBackground());
    } else {
      setBg(caseSensitiveBtn, getInputBackground());
    }
  }
  if (wholeWordBtn) {
    if (findWholeWord > 0) {
      setBg(wholeWordBtn, getButtonBackground());
    } else {
      setBg(wholeWordBtn, getInputBackground());
    }
  }
}

function updateOverlaySize(): void {
  // No-op: using VStack child visibility instead of overlay frame
}

// ---------------------------------------------------------------------------
// Show / Hide
// ---------------------------------------------------------------------------

export function showFindBar(): void {
  if (findBarReady < 1) return;
  findBarVisible = 1;
  widgetSetHidden(findBarContainer, 0);
  applyFindBarColors();
  if (findTextField) textfieldFocus(findTextField);
}

export function showFindBarWithReplace(): void {
  if (findBarReady < 1) return;
  findBarVisible = 1;
  replaceRowVisible = 1;
  if (replaceRow) widgetSetHidden(replaceRow, 0);
  widgetSetHidden(findBarContainer, 0);
  applyFindBarColors();
  if (findTextField) textfieldFocus(findTextField);
}

export function hideFindBar(): void {
  if (findBarReady < 1) return;
  findBarVisible = 0;
  widgetSetHidden(findBarContainer, 1);
  // Clear line highlights when find bar closes
  _clearLineBackgrounds();
  lastHighlightedLineCount = 0;
  _pushDecorations('');
}

export function isFindBarVisible(): number {
  return findBarVisible;
}

export function getFindMatchCount(): number {
  return findMatchCount;
}

export function getFindMatchLine(idx: number): number {
  if (idx < 0 || idx >= findMatchCount) return -1;
  return findMatchLines[idx];
}

export function getFindMatchCol(idx: number): number {
  if (idx < 0 || idx >= findMatchCount) return 0;
  return findMatchCols[idx];
}

export function getFindMatchLen(idx: number): number {
  if (idx < 0 || idx >= findMatchCount) return 0;
  return findMatchLengths[idx];
}

export function getFindCurrentMatch(): number {
  return findCurrentMatch;
}

/**
 * Push find match highlight decorations to the editor.
 * Called from render.ts syncEditorDecorations poll (250ms).
 * Decorations are cleared each draw cycle so must be pushed repeatedly.
 * Only pushes matches near the visible viewport to keep JSON small.
 */
/**
 * Build and push find highlights via the dedicated setFindHighlights FFI.
 * These persist across begin_frame clears — no polling needed.
 * Called from render.ts syncEditorDecorations (250ms) to update when matches change.
 */
export function pushFindHighlights(): void {
  if (findBarVisible < 1) {
    if (lastHighlightedLineCount > 0) {
      _pushDecorations('');
      _clearLineBackgrounds();
      lastHighlightedLineCount = 0;
    }
    return;
  }
  if (findMatchCount < 1) {
    if (lastHighlightedLineCount > 0) {
      _pushDecorations('');
      _clearLineBackgrounds();
      lastHighlightedLineCount = 0;
    }
    return;
  }

  // Clear previous
  _clearLineBackgrounds();

  // Get the current match's line number
  let currentMatchLine = -1;
  if (findCurrentMatch >= 0 && findCurrentMatch < findMatchCount) {
    currentMatchLine = findMatchLines[findCurrentMatch];
  }

  // Use setLineBackground for each match line — reliable, persists across frames.
  // Track unique lines to avoid double-setting
  let prevLine = -1;
  let count = 0;
  const limit = findMatchCount < 200 ? findMatchCount : 200;

  for (let i = 0; i < limit; i++) {
    const line = findMatchLines[i];
    if (line === prevLine) continue;
    prevLine = line;
    if (count > 200) break;

    if (line === currentMatchLine) {
      // Current match line: stronger orange
      _setLineBackground(line + 1, 0.91, 0.67, 0.33, 0.28);
    } else {
      // Other match lines: subtle yellow
      _setLineBackground(line + 1, 0.89, 0.76, 0.33, 0.15);
    }
    count = count + 1;
  }

  // Also push character-precise highlights via find_highlights FFI for the
  // current match only (single JSON entry — avoids Perry string corruption in loops)
  if (findCurrentMatch >= 0 && findCurrentMatch < findMatchCount) {
    const curLine = findMatchLines[findCurrentMatch];
    const curCol = findMatchCols[findCurrentMatch];
    const curLen = findMatchLengths[findCurrentMatch];
    let json = '[{"line":';
    json += String(curLine);
    json += ',"col":';
    json += String(curCol);
    json += ',"len":';
    json += String(curLen);
    json += ',"current":1}]';
    _pushDecorations(json);
  }

  lastHighlightedLineCount = count;
}

// ---------------------------------------------------------------------------
// Text field callbacks (module-level for Perry)
// ---------------------------------------------------------------------------

function onFindTextChanged(text: string): void {
  findQuery = text;
  performSearch();
  // Send match data to render.ts for highlighting
  sendMatchData();
}

function onReplaceTextChanged(text: string): void {
  replaceQuery = text;
}

function onFindSubmit(): void {
  goToNextMatch();
}

function onCloseClick(): void {
  hideFindBar();
}

function onNextClick(): void {
  goToNextMatch();
}

function onPrevClick(): void {
  goToPrevMatch();
}

function onCaseClick(): void {
  toggleCaseSensitive();
}

function onWordClick(): void {
  toggleWholeWord();
}

function onChevronClick(): void {
  toggleReplaceRow();
}

function onReplaceOneClick(): void {
  doReplaceOne();
}

function onReplaceAllClick(): void {
  doReplaceAll();
}

// ---------------------------------------------------------------------------
// Create the find bar widget
// ---------------------------------------------------------------------------

/** Re-apply find bar background colors using direct RGBA calls. */
function applyFindBarColors(): void {
  if (isCurrentThemeDark() > 0) {
    widgetSetBackgroundColor(findBarContainer, 0.16, 0.16, 0.18, 1.0);
  } else {
    widgetSetBackgroundColor(findBarContainer, 0.84, 0.84, 0.85, 1.0);
  }
}

export function createFindBar(): unknown {
  // Find row — compact VS Code-like layout
  chevronBtn = Button('', () => { onChevronClick(); });
  buttonSetBordered(chevronBtn, 0);
  buttonSetImage(chevronBtn, 'chevron.right');
  buttonSetImagePosition(chevronBtn, 1);
  textSetFontSize(chevronBtn, 10);
  widgetSetWidth(chevronBtn, 20);

  findTextField = TextField('Find', (text: string) => { onFindTextChanged(text); });
  widgetSetWidth(findTextField, 160);
  widgetSetHeight(findTextField, 24);
  textfieldSetBorderless(findTextField, 1);
  textfieldSetFontSize(findTextField, 12);
  textfieldSetOnSubmit(findTextField, () => { onFindSubmit(); });

  caseSensitiveBtn = Button('Aa', () => { onCaseClick(); });
  buttonSetBordered(caseSensitiveBtn, 0);
  textSetFontSize(caseSensitiveBtn, 11);
  widgetSetWidth(caseSensitiveBtn, 28);

  wholeWordBtn = Button('ab', () => { onWordClick(); });
  buttonSetBordered(wholeWordBtn, 0);
  textSetFontSize(wholeWordBtn, 11);
  widgetSetWidth(wholeWordBtn, 28);

  matchCountLabel = Text('No results');
  textSetFontSize(matchCountLabel, 11);

  const prevBtn = Button('', () => { onPrevClick(); });
  buttonSetBordered(prevBtn, 0);
  buttonSetImage(prevBtn, 'chevron.up');
  buttonSetImagePosition(prevBtn, 1);
  textSetFontSize(prevBtn, 10);
  widgetSetWidth(prevBtn, 24);

  const nextBtn = Button('', () => { onNextClick(); });
  buttonSetBordered(nextBtn, 0);
  buttonSetImage(nextBtn, 'chevron.down');
  buttonSetImagePosition(nextBtn, 1);
  textSetFontSize(nextBtn, 10);
  widgetSetWidth(nextBtn, 24);

  const closeBtn = Button('', () => { onCloseClick(); });
  buttonSetBordered(closeBtn, 0);
  buttonSetImage(closeBtn, 'xmark');
  buttonSetImagePosition(closeBtn, 1);
  textSetFontSize(closeBtn, 10);
  widgetSetWidth(closeBtn, 24);

  // spacing=3, top=3, right=6, bottom=3, left=4
  const findRow = HStackWithInsets(3, 3, 6, 3, 4);
  findRowWidget = findRow;
  widgetSetHeight(findRow, 30);
  widgetAddChild(findRow, chevronBtn);
  widgetAddChild(findRow, findTextField);
  widgetAddChild(findRow, caseSensitiveBtn);
  widgetAddChild(findRow, wholeWordBtn);
  widgetAddChild(findRow, matchCountLabel);
  widgetAddChild(findRow, prevBtn);
  widgetAddChild(findRow, nextBtn);
  widgetAddChild(findRow, closeBtn);

  // Replace row
  const replaceSpacer = HStack(0, []);
  widgetSetWidth(replaceSpacer, 20);

  replaceTextField = TextField('Replace', (text: string) => { onReplaceTextChanged(text); });
  widgetSetWidth(replaceTextField, 160);
  widgetSetHeight(replaceTextField, 24);
  textfieldSetBorderless(replaceTextField, 1);
  textfieldSetFontSize(replaceTextField, 12);

  const replaceOneBtn = Button('', () => { onReplaceOneClick(); });
  buttonSetBordered(replaceOneBtn, 0);
  buttonSetImage(replaceOneBtn, 'arrow.left.arrow.right');
  buttonSetImagePosition(replaceOneBtn, 1);
  textSetFontSize(replaceOneBtn, 10);
  widgetSetWidth(replaceOneBtn, 24);

  const replaceAllBtn = Button('', () => { onReplaceAllClick(); });
  buttonSetBordered(replaceAllBtn, 0);
  buttonSetImage(replaceAllBtn, 'arrow.left.arrow.right.square');
  buttonSetImagePosition(replaceAllBtn, 1);
  textSetFontSize(replaceAllBtn, 10);
  widgetSetWidth(replaceAllBtn, 24);

  replaceRow = HStackWithInsets(3, 3, 6, 3, 24);
  replaceRowWidget = replaceRow;
  widgetSetHeight(replaceRow, 30);
  widgetAddChild(replaceRow, replaceSpacer);
  widgetAddChild(replaceRow, replaceTextField);
  widgetAddChild(replaceRow, replaceOneBtn);
  widgetAddChild(replaceRow, replaceAllBtn);
  widgetSetHidden(replaceRow, 1); // hidden by default

  // Apply theme colors
  setFg(matchCountLabel, getEditorForeground());
  setBtnFg(chevronBtn, getEditorForeground());
  setBtnFg(caseSensitiveBtn, getEditorForeground());
  setBtnFg(wholeWordBtn, getEditorForeground());
  setBtnFg(prevBtn, getEditorForeground());
  setBtnFg(nextBtn, getEditorForeground());
  setBtnFg(closeBtn, getEditorForeground());
  setBtnFg(replaceOneBtn, getEditorForeground());
  setBtnFg(replaceAllBtn, getEditorForeground());

  // Use findRow directly as the container (HStackWithInsets supports setBg, VStack doesn't)
  findBarContainer = findRow;
  findRowWidget = findRow;
  findBarReady = 1;

  // Apply background
  applyFindBarColors();

  return findRow;
}
