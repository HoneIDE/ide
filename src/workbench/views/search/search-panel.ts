/**
 * Search panel — extracted from render.ts.
 *
 * Renders a search/replace UI in the sidebar container.
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, Text, Button, Spacer,
  TextField,
  textSetColor, textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString,
  buttonSetBordered, buttonSetTextColor,
  widgetAddChild, widgetClearChildren, widgetSetHidden,
  textfieldSetString, textfieldFocus,
} from 'perry/ui';
import { readFileSync, readdirSync, isDirectory, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { hexToRGBA, setBg, setFg, setBtnFg, pathId, getFileName, toLowerCode, isTextFile } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground } from '../../theme/theme-colors';
import { telemetryTrackSearch } from '../../telemetry';

// ---------------------------------------------------------------------------
// Module-level state (must be declared BEFORE any function — Perry no-hoist)
// ---------------------------------------------------------------------------

let searchWorkspaceRoot = '';
let searchQuery = '';
let searchCaseSensitive: number = 0;
let searchUseRegex: number = 0;
let searchShowReplace: number = 0;
let replaceQuery = '';

// Search results — parallel arrays
let srFilePaths: string[] = [];
let srLineNums: number[] = [];
let srLineTexts: string[] = [];
let srCount: number = 0;

// UI widget refs
let searchTextField: unknown = null;
let replaceTextField: unknown = null;
let replaceFieldContainer: unknown = null;
let searchResultCountLabel: unknown = null;
let searchResultsContainer: unknown = null;
let searchPanelReady: number = 0;

// Polling debounce — module-level vars only (no captured params)
let searchDirty: number = 0;
let searchPollActive: number = 0;

// Stored colors for result rendering
let panelColors: ResolvedUIColors = null as any;
let panelContainer: unknown = null;

// File opener callback — set by render.ts
let _fileOpener: (path: string, name: string) => void = _noopOpener;

// Editor reloader callback — set by render.ts for reload-after-replace
let _editorReloader: (path: string, content: string) => void = _noopReloader;
let _currentEditorPath: () => string = _noopPath;

function _noopOpener(p: string, n: string): void {}
function _noopReloader(p: string, c: string): void {}
function _noopPath(): string { return ''; }

// ---------------------------------------------------------------------------
// Public API — setters
// ---------------------------------------------------------------------------

export function setSearchWorkspaceRoot(root: string): void {
  searchWorkspaceRoot = root;
}

export function setSearchFileOpener(fn: (path: string, name: string) => void): void {
  _fileOpener = fn;
}

export function setSearchEditorReloader(fn: (path: string, content: string) => void): void {
  _editorReloader = fn;
}

export function setSearchCurrentEditorPath(fn: () => string): void {
  _currentEditorPath = fn;
}

export function resetSearchPanelReady(): void {
  searchPanelReady = 0;
}

// ---------------------------------------------------------------------------
// Search logic
// ---------------------------------------------------------------------------

/** Manual char-by-char substring search respecting case toggle. */
function findInLine(haystack: string, needle: string): number {
  const hLen = haystack.length;
  const nLen = needle.length;
  if (nLen < 1) return -1;
  if (nLen > hLen) return -1;
  const limit = hLen - nLen;
  for (let i = 0; i <= limit; i++) {
    let match = 1;
    for (let j = 0; j < nLen; j++) {
      let hc = haystack.charCodeAt(i + j);
      let nc = needle.charCodeAt(j);
      if (searchCaseSensitive < 1) {
        hc = toLowerCode(hc);
        nc = toLowerCode(nc);
      }
      if (hc !== nc) { match = 0; break; }
    }
    if (match > 0) return i;
  }
  return -1;
}

/** Search a single file for matches, appending to result arrays. */
function searchFile(filePath: string): void {
  if (srCount >= 500) return;
  let content = '';
  try { content = readFileSync(filePath); } catch (e) { return; }
  // Skip very large files (> 256KB) to avoid memory pressure
  if (content.length > 262144) return;
  let lineStart = 0;
  let lineNum = 1;
  for (let i = 0; i <= content.length; i++) {
    if (i === content.length || content.charCodeAt(i) === 10) {
      const line = content.slice(lineStart, i);
      if (findInLine(line, searchQuery) >= 0) {
        srFilePaths[srCount] = filePath;
        srLineNums[srCount] = lineNum;
        srLineTexts[srCount] = line;
        srCount = srCount + 1;
        if (srCount >= 500) return;
      }
      lineStart = i + 1;
      lineNum = lineNum + 1;
    }
  }
}

/** Check if a directory name should be skipped during search. */
function shouldSkipDir(name: string): number {
  // Skip common large/irrelevant directories
  if (name === 'node_modules') return 1;
  if (name === 'target') return 1;
  if (name === 'dist') return 1;
  if (name === 'build') return 1;
  if (name === '__pycache__') return 1;
  if (name === 'vendor') return 1;
  if (name === 'android-build') return 1;
  if (name === 'test-runs') return 1;
  if (name === 'coverage') return 1;
  if (name === '.git') return 1;
  // Skip .app bundles (macOS)
  const len = name.length;
  if (len > 4) {
    if (name.charCodeAt(len - 4) === 46 &&
        name.charCodeAt(len - 3) === 97 &&
        name.charCodeAt(len - 2) === 112 &&
        name.charCodeAt(len - 1) === 112) {
      return 1;
    }
  }
  return 0;
}

/** Recursively search a directory. */
function searchDir(dirPath: string, depth: number): void {
  if (depth > 9) return;
  if (srCount >= 500) return;
  let names: string[] = [];
  try { names = readdirSync(dirPath); } catch (e) { return; }
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name.charCodeAt(0) === 46) continue; // skip hidden
    if (srCount >= 500) return;
    const fullPath = join(dirPath, name);
    if (isDirectory(fullPath)) {
      if (shouldSkipDir(name) < 1) {
        searchDir(fullPath, depth + 1);
      }
    } else if (isTextFile(name)) {
      searchFile(fullPath);
    }
  }
}

/** Run the search and update UI. Tries ripgrep first, falls back to manual scan. */
function performSearch(): void {
  srFilePaths = [];
  srLineNums = [];
  srLineTexts = [];
  srCount = 0;
  if (searchQuery.length < 1) {
    updateSearchResultsUI();
    return;
  }
  if (searchWorkspaceRoot.length < 1) {
    updateSearchResultsUI();
    return;
  }

  // Try ripgrep first (fast, supports regex/globs)
  if (tryRipgrepSearch() > 0) {
    updateSearchResultsUI();
    telemetryTrackSearch();
    return;
  }

  // Fallback to manual filesystem scan
  searchDir(searchWorkspaceRoot, 0);
  updateSearchResultsUI();
  telemetryTrackSearch();
}

/** Try to run search via ripgrep. Returns 1 if rg was available, 0 if not. */
function tryRipgrepSearch(): number {
  // Build rg command
  let cmd = 'rg --json --max-count 500';
  if (searchCaseSensitive > 0) {
    cmd += ' --case-sensitive';
  } else {
    cmd += ' --smart-case';
  }
  if (searchUseRegex > 0) {
    cmd += ' --regexp';
  } else {
    cmd += ' --fixed-strings';
  }
  // Escape the query for shell — wrap in single quotes, escape existing single quotes
  cmd += " '";
  for (let i = 0; i < searchQuery.length; i = i + 1) {
    const ch = searchQuery.charCodeAt(i);
    if (ch === 39) {
      // Single quote → end quote, escaped quote, start quote
      cmd += "'\\''";
    } else {
      cmd += searchQuery.charAt(i);
    }
  }
  cmd += "' ";
  cmd += searchWorkspaceRoot;

  let output = '';
  try {
    output = execSync(cmd) as unknown as string;
  } catch (e) {
    // rg not found or no results (exit code 1 = no matches, 2 = error)
    // Check if it was just "no matches" — empty output is fine
    return 0;
  }

  if (output.length < 2) return 1; // No matches, but rg worked

  // Parse ripgrep JSON output (newline-delimited JSON)
  parseRipgrepOutput(output);
  return 1;
}

/** Parse ripgrep --json output into parallel arrays. */
function parseRipgrepOutput(output: string): void {
  // Each line is a JSON object. Match lines have type:"match"
  let lineStart = 0;
  for (let i = 0; i <= output.length; i = i + 1) {
    if (i === output.length || output.charCodeAt(i) === 10) {
      if (i > lineStart + 10) {
        const line = output.slice(lineStart, i);
        parseRipgrepLine(line);
      }
      lineStart = i + 1;
    }
  }
}

/** Parse a single ripgrep JSON line. */
function parseRipgrepLine(json: string): void {
  if (srCount >= 500) return;

  // Quick check: must contain "type":"match"
  if (json.indexOf('"type":"match"') < 0) return;

  // Extract file path: "path":{"text":"..."}
  const pathIdx = json.indexOf('"path":{"text":"');
  if (pathIdx < 0) return;
  const pathStart = pathIdx + 16;
  let pathEnd = pathStart;
  for (let i = pathStart; i < json.length; i = i + 1) {
    if (json.charCodeAt(i) === 34) { pathEnd = i; break; }
  }
  const filePath = json.slice(pathStart, pathEnd);

  // Extract line number: "line_number":N
  const lnIdx = json.indexOf('"line_number":');
  if (lnIdx < 0) return;
  let lnStr = '';
  for (let i = lnIdx + 14; i < json.length; i = i + 1) {
    const ch = json.charCodeAt(i);
    if (ch >= 48 && ch <= 57) {
      lnStr += json.charAt(i);
    } else {
      break;
    }
  }
  const lineNum = parseInt(lnStr);

  // Extract line text: "lines":{"text":"..."}
  const ltIdx = json.indexOf('"lines":{"text":"');
  if (ltIdx < 0) return;
  const ltStart = ltIdx + 17;
  let ltEnd = ltStart;
  let escaped = 0;
  for (let i = ltStart; i < json.length; i = i + 1) {
    if (escaped > 0) { escaped = 0; continue; }
    if (json.charCodeAt(i) === 92) { escaped = 1; continue; }
    if (json.charCodeAt(i) === 34) { ltEnd = i; break; }
  }
  let lineText = json.slice(ltStart, ltEnd);
  // Trim trailing newline from line text
  if (lineText.length > 0 && lineText.charCodeAt(lineText.length - 1) === 10) {
    lineText = lineText.slice(0, lineText.length - 1);
  }
  // Unescape \\n and \\t
  let unescaped = '';
  for (let i = 0; i < lineText.length; i = i + 1) {
    if (lineText.charCodeAt(i) === 92 && i + 1 < lineText.length) {
      const next = lineText.charCodeAt(i + 1);
      if (next === 110) { unescaped += '\n'; i = i + 1; continue; }
      if (next === 116) { unescaped += '\t'; i = i + 1; continue; }
      if (next === 92) { unescaped += '\\'; i = i + 1; continue; }
    }
    unescaped += lineText.charAt(i);
  }

  srFilePaths[srCount] = filePath;
  srLineNums[srCount] = lineNum;
  srLineTexts[srCount] = unescaped;
  srCount = srCount + 1;
}

/** Toggle regex search mode. */
function toggleRegex(): void {
  searchUseRegex = searchUseRegex > 0 ? 0 : 1;
  if (searchQuery.length > 0) {
    searchGeneration = searchGeneration + 1;
    searchPending = 1;
  }
}

/** Update the search results display. */
function updateSearchResultsUI(): void {
  if (searchPanelReady < 1) return;
  widgetClearChildren(searchResultsContainer);
  if (searchQuery.length < 1) {
    textSetString(searchResultCountLabel, 'Type to search');
    return;
  }
  if (srCount < 1) {
    textSetString(searchResultCountLabel, 'No results');
    return;
  }
  let countText = '';
  if (srCount >= 500) {
    countText = '500+ results';
  } else if (srCount >= 100) {
    countText = '100+ results';
  } else if (srCount >= 10) {
    countText = '10+ results';
  } else {
    countText = 'results found';
  }
  textSetString(searchResultCountLabel, countText);

  // Group by file — detect file change via pathId comparison
  let lastFileId = -1;
  for (let i = 0; i < srCount; i++) {
    const fpath = srFilePaths[i];
    const fid = pathId(fpath);
    if (fid !== lastFileId) {
      lastFileId = fid;
      const fname = getFileName(fpath);
      const header = Text(fname);
      textSetFontSize(header, 12);
      textSetFontWeight(header, 12, 0.6);
      if (panelColors) {
        setFg(header, getSideBarForeground());
      }
      widgetAddChild(searchResultsContainer, header);
    }
    let lineText = srLineTexts[i];
    if (lineText.length > 60) {
      lineText = lineText.slice(0, 60);
    }
    let trimStart = 0;
    while (trimStart < lineText.length && lineText.charCodeAt(trimStart) === 32) {
      trimStart = trimStart + 1;
    }
    if (trimStart > 0) {
      lineText = lineText.slice(trimStart);
    }
    const resultPath = fpath;
    const btn = Button(lineText, () => { onSearchResultClick(resultPath); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 11);
    textSetFontFamily(btn, 11, 'Menlo');
    if (panelColors) {
      setBtnFg(btn, getSideBarForeground());
    }
    widgetAddChild(searchResultsContainer, btn);
  }
}

function onSearchResultClick(filePath: string): void {
  const name = getFileName(filePath);
  _fileOpener(filePath, name);
}

function onSearchInput(text: string): void {
  searchQuery = text;
  // Debounce: schedule search after 300ms of no input
  searchGeneration = searchGeneration + 1;
  const gen = searchGeneration;
  searchPending = 1;
  setTimeout(() => { debouncedSearch(gen); }, 300);
}

function debouncedSearch(gen: number): void {
  if (gen !== searchGeneration) return; // newer input superseded this
  if (searchPending < 1) return;
  searchPending = 0;
  performSearch();
}

function onReplaceInput(text: string): void {
  replaceQuery = text;
}

function toggleCaseSensitive(): void {
  if (searchCaseSensitive > 0) {
    searchCaseSensitive = 0;
  } else {
    searchCaseSensitive = 1;
  }
  performSearch();
}

function toggleReplaceField(): void {
  if (searchShowReplace > 0) {
    searchShowReplace = 0;
    widgetSetHidden(replaceFieldContainer, 1);
  } else {
    searchShowReplace = 1;
    widgetSetHidden(replaceFieldContainer, 0);
  }
}

function replaceInFile(filePath: string): void {
  let content = '';
  try { content = readFileSync(filePath); } catch (e) { return; }
  const idx = findInLine(content, searchQuery);
  if (idx < 0) return;
  let result = '';
  result += content.slice(0, idx);
  result += replaceQuery;
  result += content.slice(idx + searchQuery.length);
  try { writeFileSync(filePath, result); } catch (e) { return; }
  const curPath = _currentEditorPath();
  if (curPath.length > 0) {
    const fpId = pathId(filePath);
    const curId = pathId(curPath);
    if (fpId === curId) {
      _editorReloader(filePath, result);
    }
  }
}

function replaceAllInFile(filePath: string): void {
  let content = '';
  try { content = readFileSync(filePath); } catch (e) { return; }
  let result = '';
  let pos = 0;
  while (pos <= content.length - searchQuery.length) {
    const idx = findInLine(content.slice(pos), searchQuery);
    if (idx < 0) {
      result += content.slice(pos);
      break;
    }
    result += content.slice(pos, pos + idx);
    result += replaceQuery;
    pos = pos + idx + searchQuery.length;
  }
  if (pos < content.length && pos > 0) {
    // remaining content already appended above when idx < 0
  } else if (pos === 0) {
    return;
  }
  try { writeFileSync(filePath, result); } catch (e) { return; }
  const curPath = _currentEditorPath();
  if (curPath.length > 0) {
    const fpId = pathId(filePath);
    const curId = pathId(curPath);
    if (fpId === curId) {
      const reloaded = readFileSync(filePath);
      _editorReloader(filePath, reloaded);
    }
  }
}

function onReplaceOne(): void {
  if (replaceQuery.length < 1) return;
  if (srCount < 1) return;
  replaceInFile(srFilePaths[0]);
  performSearch();
}

function onReplaceAll(): void {
  if (replaceQuery.length < 1) return;
  if (srCount < 1) return;
  let lastFileId = -1;
  for (let i = 0; i < srCount; i++) {
    const fid = pathId(srFilePaths[i]);
    if (fid !== lastFileId) {
      lastFileId = fid;
      replaceAllInFile(srFilePaths[i]);
    }
  }
  performSearch();
}

// ---------------------------------------------------------------------------
// Public render function
// ---------------------------------------------------------------------------

export function renderSearchPanel(container: unknown, colors: ResolvedUIColors): void {
  panelContainer = container;
  panelColors = colors;
  searchPanelReady = 0;

  const title = Text('SEARCH');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  if (colors) setFg(title, getSideBarForeground());
  widgetAddChild(container, title);

  // Search text field
  searchTextField = TextField('Search', (text: string) => { onSearchInput(text); });
  widgetAddChild(container, searchTextField);
  if (searchQuery.length > 0) {
    textfieldSetString(searchTextField, searchQuery);
  }

  // Controls row: Aa (case) + .* (regex) + Replace toggle
  const caseBtn = Button('Aa', () => { toggleCaseSensitive(); });
  buttonSetBordered(caseBtn, 0);
  textSetFontSize(caseBtn, 11);
  if (colors) setBtnFg(caseBtn, getSideBarForeground());
  const regexBtn = Button('.*', () => { toggleRegex(); });
  buttonSetBordered(regexBtn, 0);
  textSetFontSize(regexBtn, 11);
  if (colors) setBtnFg(regexBtn, getSideBarForeground());
  const replToggleBtn = Button('Replace', () => { toggleReplaceField(); });
  buttonSetBordered(replToggleBtn, 0);
  textSetFontSize(replToggleBtn, 11);
  if (colors) setBtnFg(replToggleBtn, getSideBarForeground());
  const controlsRow = HStack(4, [caseBtn, regexBtn, replToggleBtn]);
  widgetAddChild(container, controlsRow);

  // Replace container (hidden by default)
  const replContainer = VStack(4, []);
  replaceFieldContainer = replContainer;
  replaceTextField = TextField('Replace', (text: string) => { onReplaceInput(text); });
  widgetAddChild(replContainer, replaceTextField);
  if (replaceQuery.length > 0) {
    textfieldSetString(replaceTextField, replaceQuery);
  }
  const replOneBtn = Button('Replace', () => { onReplaceOne(); });
  buttonSetBordered(replOneBtn, 0);
  textSetFontSize(replOneBtn, 11);
  if (colors) setBtnFg(replOneBtn, getSideBarForeground());
  const replAllBtn = Button('Replace All', () => { onReplaceAll(); });
  buttonSetBordered(replAllBtn, 0);
  textSetFontSize(replAllBtn, 11);
  if (colors) setBtnFg(replAllBtn, getSideBarForeground());
  const replBtnRow = HStack(4, [replOneBtn, replAllBtn]);
  widgetAddChild(replContainer, replBtnRow);
  widgetAddChild(container, replContainer);
  if (searchShowReplace < 1) {
    widgetSetHidden(replContainer, 1);
  }

  // Result count label
  searchResultCountLabel = Text('Type to search');
  textSetFontSize(searchResultCountLabel, 11);
  if (colors) setFg(searchResultCountLabel, getSideBarForeground());
  widgetAddChild(container, searchResultCountLabel);

  // Results container
  searchResultsContainer = VStack(2, []);
  widgetAddChild(container, searchResultsContainer);
  searchPanelReady = 1;

  // Focus the search field
  textfieldFocus(searchTextField);

  // If there was a previous query, re-run search to show results
  if (searchQuery.length > 0) {
    performSearch();
  }

  widgetAddChild(container, Spacer());
}
