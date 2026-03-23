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
  buttonSetBordered, buttonSetTextColor, buttonSetTitle,
  widgetAddChild, widgetClearChildren, widgetSetHidden,
  textfieldSetString, textfieldFocus, textfieldSetBorderless, textfieldSetBackgroundColor, textfieldSetFontSize, textfieldSetOnSubmit,
} from 'perry/ui';
import { readFileSync, readdirSync, isDirectory, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { spawn, parallelMap } from 'perry/thread';
import { join } from 'path';
import { hexToRGBA, setBg, setFg, setBtnFg, pathId, getFileName, toLowerCode, isTextFile } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getInputBackground } from '../../theme/theme-colors';
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
let replToggleBtn: unknown = null;
let searchResultCountLabel: unknown = null;
let searchResultsContainer: unknown = null;
let searchPanelReady: number = 0;

// Debounce: search pending flag + generation counter
let searchPending: number = 0;
let searchGeneration: number = 0;

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

/** Run the search asynchronously on a background thread. UI stays responsive. */
function performSearch(): void {
  const query = searchQuery;
  const wsRoot = searchWorkspaceRoot;
  const caseSens = searchCaseSensitive;

  if (query.length < 1 || wsRoot.length < 1) {
    srFilePaths = [];
    srLineNums = [];
    srLineTexts = [];
    srCount = 0;
    updateSearchResultsUI();
    return;
  }

  searchGeneration = searchGeneration + 1;
  const gen = searchGeneration;

  // Show "Searching..." immediately
  if (searchPanelReady > 0) {
    textSetString(searchResultCountLabel, 'Searching...');
    widgetClearChildren(searchResultsContainer);
  }

  spawn(() => {
    // Phase 1: Collect all searchable file paths (sequential dir walk)
    const allFiles: string[] = [];
    let fileCount = 0;
    collectSearchFiles(allFiles, wsRoot, 0);
    fileCount = allFiles.length;

    if (fileCount < 1) {
      return { filePaths: [] as string[], lineNums: [] as number[], lineTexts: [] as string[], count: 0 };
    }

    // Phase 2: Search files in parallel across all CPU cores
    const perFileResults = parallelMap(allFiles, (fp) => {
      // Read + search a single file on a worker thread
      let content = '';
      try { content = readFileSync(fp); } catch (e) { return ''; }
      if (content.length > 262144) return ''; // skip >256KB files

      // Search line by line, encode matches as "lineNum\tlineText\n"
      let encoded = '';
      let matchCount = 0;
      let lineStart = 0;
      let lineNum = 1;
      for (let ci = 0; ci <= content.length; ci++) {
        if (ci === content.length || content.charCodeAt(ci) === 10) {
          const line = content.slice(lineStart, ci);
          // Inline findInLine: check if query appears in line
          const hLen = line.length;
          const nLen = query.length;
          if (nLen > 0 && nLen <= hLen) {
            const limit = hLen - nLen;
            let found = 0;
            for (let si = 0; si <= limit; si++) {
              let match = 1;
              for (let sj = 0; sj < nLen; sj++) {
                let hc = line.charCodeAt(si + sj);
                let nc = query.charCodeAt(sj);
                if (caseSens < 1) {
                  if (hc >= 65 && hc <= 90) hc = hc + 32;
                  if (nc >= 65 && nc <= 90) nc = nc + 32;
                }
                if (hc !== nc) { match = 0; break; }
              }
              if (match > 0) { found = 1; break; }
            }
            if (found > 0) {
              encoded = encoded + String(lineNum) + '\t' + line + '\n';
              matchCount = matchCount + 1;
              if (matchCount >= 50) break; // cap per file
            }
          }
          lineStart = ci + 1;
          lineNum = lineNum + 1;
        }
      }
      return encoded;
    });

    // Phase 3: Flatten per-file results into parallel arrays
    const rPaths: string[] = [];
    const rNums: number[] = [];
    const rTexts: string[] = [];
    let rCount = 0;

    for (let fi = 0; fi < perFileResults.length; fi++) {
      if (rCount >= 500) break;
      const encoded = perFileResults[fi];
      if (encoded.length < 1) continue;
      const fp = allFiles[fi];

      // Parse "lineNum\tlineText\n" entries
      let ls = 0;
      for (let ei = 0; ei <= encoded.length; ei++) {
        if (ei === encoded.length || encoded.charCodeAt(ei) === 10) {
          if (ei > ls) {
            const entry = encoded.slice(ls, ei);
            // Find tab separator
            let tabPos = -1;
            for (let ti = 0; ti < entry.length; ti++) {
              if (entry.charCodeAt(ti) === 9) { tabPos = ti; break; }
            }
            if (tabPos > 0) {
              const numStr = entry.slice(0, tabPos);
              const lineText = entry.slice(tabPos + 1);
              rPaths[rCount] = fp;
              rNums[rCount] = parseInt(numStr);
              rTexts[rCount] = lineText;
              rCount = rCount + 1;
              if (rCount >= 500) break;
            }
          }
          ls = ei + 1;
        }
      }
    }

    return { filePaths: rPaths, lineNums: rNums, lineTexts: rTexts, count: rCount };
  }).then((result) => { applySearchResult(result, gen); });
}

/** Recursively collect searchable file paths (inlined in spawn — no module state access). */
function collectSearchFiles(out: string[], dirPath: string, depth: number): void {
  if (depth > 9) return;
  if (out.length >= 10000) return; // safety cap
  let names: string[] = [];
  try { names = readdirSync(dirPath); } catch (e) { return; }
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name.charCodeAt(0) === 46) continue; // skip hidden
    const fullPath = join(dirPath, name);
    if (isDirectory(fullPath)) {
      // Inline shouldSkipDir
      if (name !== 'node_modules' && name !== 'target' && name !== 'dist' &&
          name !== 'build' && name !== '__pycache__' && name !== 'vendor' &&
          name !== 'android-build' && name !== 'test-runs' && name !== 'coverage' &&
          name !== '.git') {
        // Skip .app bundles
        const nLen = name.length;
        let isApp = 0;
        if (nLen > 4) {
          if (name.charCodeAt(nLen - 4) === 46 &&
              name.charCodeAt(nLen - 3) === 97 &&
              name.charCodeAt(nLen - 2) === 112 &&
              name.charCodeAt(nLen - 1) === 112) {
            isApp = 1;
          }
        }
        if (isApp < 1) {
          collectSearchFiles(out, fullPath, depth + 1);
        }
      }
    } else if (isTextFile(name)) {
      out.push(fullPath);
    }
  }
}

interface SearchResult {
  filePaths: string[];
  lineNums: number[];
  lineTexts: string[];
  count: number;
}

function applySearchResult(r: SearchResult, gen: number): void {
  if (gen !== searchGeneration) return; // stale result
  srFilePaths = r.filePaths;
  srLineNums = r.lineNums;
  srLineTexts = r.lineTexts;
  srCount = r.count;
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

  // Group by file — bold file headers, indented dimmer match lines
  let lastFileId = -1;
  let fileMatchShown = 0;
  for (let i = 0; i < srCount; i = i + 1) {
    const fpath = srFilePaths[i];
    const fid = pathId(fpath);
    if (fid !== lastFileId) {
      lastFileId = fid;
      fileMatchShown = 0;
      // Spacing between file groups (not before first)
      if (i > 0) {
        const gap = Text('');
        textSetFontSize(gap, 8);
        widgetAddChild(searchResultsContainer, gap);
      }
      const fname = getFileName(fpath);
      const fileResultPath = fpath;
      const header = Button(fname, () => { onSearchResultClick(fileResultPath); });
      buttonSetBordered(header, 0);
      textSetFontSize(header, 13);
      textSetFontWeight(header, 13, 0.7);
      if (panelColors) {
        setBtnFg(header, getSideBarForeground());
      }
      widgetAddChild(searchResultsContainer, header);
    }
    // Max 8 match lines per file
    fileMatchShown = fileMatchShown + 1;
    if (fileMatchShown <= 8) {
      let lineText = srLineTexts[i];
      if (lineText.length > 80) {
        lineText = lineText.slice(0, 77);
        lineText += '...';
      }
      let trimStart = 0;
      while (trimStart < lineText.length && (lineText.charCodeAt(trimStart) === 32 || lineText.charCodeAt(trimStart) === 9)) {
        trimStart = trimStart + 1;
      }
      if (trimStart > 0) {
        lineText = lineText.slice(trimStart);
      }
      let display = '    ';
      display += lineText;
      const resultPath = fpath;
      const btn = Button(display, () => { onSearchResultClick(resultPath); });
      buttonSetBordered(btn, 0);
      textSetFontSize(btn, 12);
      textSetFontFamily(btn, 12, 'Menlo');
      if (panelColors) {
        setBtnFg(btn, '#888888');
      }
      widgetAddChild(searchResultsContainer, btn);
    }
  }
}

function onSearchResultClick(filePath: string): void {
  const name = getFileName(filePath);
  _fileOpener(filePath, name);
}

let _searchPollStarted: number = 0;

function onSearchInput(text: string): void {
  searchQuery = text;
}

function onSearchSubmit(text: string): void {
  searchQuery = text;
  performSearch();
}

/** Poll for pending search — call from an external setInterval that can create widgets. */
export function pollSearchInput(): void {
  if (searchPending < 1) return;
  searchPending = 0;
  performSearch();
}

function pollSearchDebounce(): void {
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
    buttonSetTitle(replToggleBtn, '\u25B8');
  } else {
    searchShowReplace = 1;
    widgetSetHidden(replaceFieldContainer, 0);
    buttonSetTitle(replToggleBtn, '\u25BE');
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

  // Title row
  const topPad = Text('');
  textSetFontSize(topPad, 8);
  widgetAddChild(container, topPad);

  const title = Text('SEARCH');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  if (colors) setFg(title, getSideBarForeground());
  widgetAddChild(container, title);

  const gap1 = Text('');
  textSetFontSize(gap1, 8);
  widgetAddChild(container, gap1);

  // --- VS Code style: chevron left, inputs with inline buttons ---
  const _iBg = getInputBackground();

  // Chevron toggle (left of both rows)
  let chevronLabel = '\u25B8';
  if (searchShowReplace > 0) {
    chevronLabel = '\u25BE';
  }
  replToggleBtn = Button(chevronLabel, () => { toggleReplaceField(); });
  buttonSetBordered(replToggleBtn, 0);
  textSetFontSize(replToggleBtn, 14);
  if (colors) setBtnFg(replToggleBtn, getSideBarForeground());

  // Search input
  searchTextField = TextField('Search', (text: string) => { onSearchInput(text); });
  textfieldSetOnSubmit(searchTextField, (text: string) => { onSearchSubmit(text); });
  textfieldSetBorderless(searchTextField, 1);
  textfieldSetFontSize(searchTextField, 14);
  if (_iBg.length > 0) {
    const [_ir, _ig, _ib, _ia] = hexToRGBA(_iBg);
    textfieldSetBackgroundColor(searchTextField, _ir, _ig, _ib, _ia);
  }
  if (searchQuery.length > 0) {
    textfieldSetString(searchTextField, searchQuery);
  }

  // Inline buttons: Aa, .*
  const caseBtn = Button('Aa', () => { toggleCaseSensitive(); });
  buttonSetBordered(caseBtn, 0);
  textSetFontSize(caseBtn, 11);
  if (colors) setBtnFg(caseBtn, '#999999');
  const regexBtn = Button('.*', () => { toggleRegex(); });
  buttonSetBordered(regexBtn, 0);
  textSetFontSize(regexBtn, 11);
  if (colors) setBtnFg(regexBtn, '#999999');

  // Search row: [▸] [input] [Aa] [.*]
  const searchRow = HStack(4, [replToggleBtn, searchTextField, caseBtn, regexBtn]);
  widgetAddChild(container, searchRow);

  // --- Replace row (hidden by default): [spacer] [input] [R] [RA] ---
  const replContainer = VStack(2, []);
  replaceFieldContainer = replContainer;

  // Invisible spacer matching chevron width — same char, same size, bg color
  const replChevronSpacer = Text('\u25B8');
  textSetFontSize(replChevronSpacer, 14);
  setFg(replChevronSpacer, '#F5F5F500');

  replaceTextField = TextField('Replace', (text: string) => { onReplaceInput(text); });
  textfieldSetBorderless(replaceTextField, 1);
  textfieldSetFontSize(replaceTextField, 14);
  if (_iBg.length > 0) {
    const [_rr, _rg, _rb, _ra] = hexToRGBA(_iBg);
    textfieldSetBackgroundColor(replaceTextField, _rr, _rg, _rb, _ra);
  }
  if (replaceQuery.length > 0) {
    textfieldSetString(replaceTextField, replaceQuery);
  }

  // Replace buttons — same count and similar width as Aa/.*
  const replOneBtn = Button('Replace', () => { onReplaceOne(); });
  buttonSetBordered(replOneBtn, 0);
  textSetFontSize(replOneBtn, 11);
  if (colors) setBtnFg(replOneBtn, '#999999');
  const replAllBtn = Button('All', () => { onReplaceAll(); });
  buttonSetBordered(replAllBtn, 0);
  textSetFontSize(replAllBtn, 11);
  if (colors) setBtnFg(replAllBtn, '#999999');

  const replaceRow = HStack(4, [replChevronSpacer, replaceTextField, replOneBtn, replAllBtn]);
  widgetAddChild(replContainer, replaceRow);
  widgetAddChild(container, replContainer);
  if (searchShowReplace < 1) {
    widgetSetHidden(replContainer, 1);
  }

  const gap2 = Text('');
  textSetFontSize(gap2, 6);
  widgetAddChild(container, gap2);

  // Spacing before results
  const resPad = Text('');
  textSetFontSize(resPad, 8);
  widgetAddChild(container, resPad);

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
