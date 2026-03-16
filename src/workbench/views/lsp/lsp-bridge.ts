/**
 * LSP bridge — manages language server processes and provides diagnostics,
 * completions, hover, goto-definition, and formatting via JSON-RPC.
 *
 * Uses the hone-lsp-bridge native FFI crate for bidirectional stdio pipes
 * to language server subprocesses. Supports multiple concurrent servers.
 *
 * Perry-safe: module-level state, for-loops, no closures on `this`.
 */

import { LSP_BRIDGE_LIVE } from '@honeide/lsp-bridge/perry/live';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { spawnBackground, execSync } from 'child_process';
import { updateDiagnostics } from './diagnostics-panel';
import { getTempDir, canRunShellCommands } from '../../paths';

// Trigger FFI discovery
const _lspLive = LSP_BRIDGE_LIVE;

// FFI declarations (resolved by Perry from native library manifest)
declare function hone_lsp_start(cmd: number, args: number, cwd: number): number;
declare function hone_lsp_send(handle: number, message: number): number;
declare function hone_lsp_poll(handle: number): number;
declare function hone_lsp_is_alive(handle: number): number;
declare function hone_lsp_stop(handle: number): number;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let lspReady: number = 0;
let lspWorkspaceRoot: string = '';
let lspTimerStarted: number = 0;
let lspTickCount: number = 0;

// Server handle (-1 = not started)
let lspServerHandle: number = -1;
let lspServerLanguage: string = '';
let lspInitialized: number = 0;
let lspNextRequestId: number = 1;

// Pending request tracking (parallel arrays)
let pendingIds: number[] = [];
let pendingMethods: string[] = [];
let pendingCount: number = 0;

// Diagnostic state
let lastDiagHashVal: number = 0;
let lastDiagHashLen: number = 0;

// Callbacks
let _statusUpdater: (errorCount: number, warningCount: number) => void = () => {};
let _completionCallback: ((items: string[]) => void) | null = null;
let _hoverCallback: ((text: string) => void) | null = null;
let _definitionCallback: ((file: string, line: number) => void) | null = null;

// Fallback diagnostics (tsc-based, for when no LSP server)
let useFallbackDiag: number = 0;
let fallbackDiagRunning: number = 0;
let DIAG_LOG_FILE = '';
let DIAG_DONE_FILE = '';

// Current document state
let currentFilePath: string = '';
let currentFileVersion: number = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function setLspWorkspaceRoot(root: string): void {
  lspWorkspaceRoot = root;
}

export function setDiagnosticsStatusUpdater(fn: (errorCount: number, warningCount: number) => void): void {
  _statusUpdater = fn;
}

export function initLspBridge(): void {
  if (lspWorkspaceRoot.length < 1) return;
  lspReady = 1;

  if (lspTimerStarted < 1) {
    lspTimerStarted = 1;
    setInterval(() => { onLspTick(); }, 16);
  }

  // Try to start a language server
  tryStartServer();
}

export function stopLspBridge(): void {
  lspReady = 0;
  if (lspServerHandle >= 0) {
    hone_lsp_stop(lspServerHandle);
    lspServerHandle = -1;
    lspInitialized = 0;
  }
}

/** Notify LSP of a file open. */
export function lspDidOpen(filePath: string, languageId: string, content: string): void {
  currentFilePath = filePath;
  currentFileVersion = 1;
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  // Build textDocument/didOpen notification
  let uri = 'file://';
  uri += filePath;
  let json = '{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":"';
  json += uri;
  json += '","languageId":"';
  json += languageId;
  json += '","version":1,"text":';
  json += jsonEscapeString(content);
  json += '}}}';
  hone_lsp_send(lspServerHandle, json as any);
}

/** Notify LSP of a file change (full sync). */
export function lspDidChange(filePath: string, content: string): void {
  currentFileVersion = currentFileVersion + 1;
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  let uri = 'file://';
  uri += filePath;
  let json = '{"jsonrpc":"2.0","method":"textDocument/didChange","params":{"textDocument":{"uri":"';
  json += uri;
  json += '","version":';
  json += String(currentFileVersion);
  json += '},"contentChanges":[{"text":';
  json += jsonEscapeString(content);
  json += '}]}}';
  hone_lsp_send(lspServerHandle, json as any);
}

/** Notify LSP of a file save. */
export function lspDidSave(filePath: string): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  let uri = 'file://';
  uri += filePath;
  let json = '{"jsonrpc":"2.0","method":"textDocument/didSave","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"}}}';
  hone_lsp_send(lspServerHandle, json as any);
}

/** Request formatting for the current document. Returns via callback. */
export function lspFormatDocument(filePath: string, tabSize: number, insertSpaces: number): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;

  let uri = 'file://';
  uri += filePath;
  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"textDocument/formatting","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"},"options":{"tabSize":';
  json += String(tabSize);
  json += ',"insertSpaces":';
  json += insertSpaces > 0 ? 'true' : 'false';
  json += '}}}';

  trackPendingRequest(id, 'textDocument/formatting');
  hone_lsp_send(lspServerHandle, json as any);
}

/** Request hover info. */
export function lspHover(filePath: string, line: number, character: number): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;

  let uri = 'file://';
  uri += filePath;
  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"textDocument/hover","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"},"position":{"line":';
  json += String(line);
  json += ',"character":';
  json += String(character);
  json += '}}}';

  trackPendingRequest(id, 'textDocument/hover');
  hone_lsp_send(lspServerHandle, json as any);
}

/** Request go-to-definition. */
export function lspDefinition(filePath: string, line: number, character: number): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;

  let uri = 'file://';
  uri += filePath;
  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"textDocument/definition","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"},"position":{"line":';
  json += String(line);
  json += ',"character":';
  json += String(character);
  json += '}}}';

  trackPendingRequest(id, 'textDocument/definition');
  hone_lsp_send(lspServerHandle, json as any);
}

/** Set callback for hover results. */
export function setHoverCallback(fn: (text: string) => void): void {
  _hoverCallback = fn;
}

/** Set callback for definition results. */
export function setDefinitionCallback(fn: (file: string, line: number) => void): void {
  _definitionCallback = fn;
}

// Signature help callback
let _signatureCallback: ((label: string, activeParam: number, doc: string) => void) | null = null;

/** Set callback for signature help results. */
export function setSignatureCallback(fn: (label: string, activeParam: number, doc: string) => void): void {
  _signatureCallback = fn;
}

/** Request signature help. */
export function lspSignatureHelp(filePath: string, line: number, character: number): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;

  let uri = 'file://';
  uri += filePath;
  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"textDocument/signatureHelp","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"},"position":{"line":';
  json += String(line);
  json += ',"character":';
  json += String(character);
  json += '}}}';

  trackPendingRequest(id, 'textDocument/signatureHelp');
  hone_lsp_send(lspServerHandle, json as any);
}

// Trigger immediate diagnostics (called on file save)
export function triggerDiagnostics(): void {
  if (lspReady < 1) return;
  if (lspServerHandle >= 0 && lspInitialized > 0) {
    // LSP server handles diagnostics automatically on didSave
    return;
  }
  // Fallback: trigger tsc
  lspTickCount = 600;
}

// Keyword-based completions (fallback when no LSP)
const TS_KEYWORDS = 'abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let module namespace never new null of package private protected public readonly return set static super switch this throw true try type typeof undefined var void while with yield';

export function getCompletions(prefix: string, _filePath: string): string[] {
  if (prefix.length < 1) return [];
  const results: string[] = [];
  let resultCount = 0;
  const keywords = TS_KEYWORDS.split(' ');
  for (let i = 0; i < keywords.length; i = i + 1) {
    const kw = keywords[i];
    if (kw.length >= prefix.length && kw.slice(0, prefix.length) === prefix) {
      if (resultCount < 15) {
        results[resultCount] = kw;
        resultCount = resultCount + 1;
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Internal — server lifecycle
// ---------------------------------------------------------------------------

function tryStartServer(): void {
  if (!canRunShellCommands()) return;
  if (lspWorkspaceRoot.length < 1) return;

  // Check for TypeScript project
  let hasTsConfig: number = 0;
  try {
    readFileSync(lspWorkspaceRoot + '/tsconfig.json');
    hasTsConfig = 1;
  } catch (e: any) { /* no tsconfig */ }

  if (hasTsConfig > 0) {
    startTypeScriptServer();
    return;
  }

  // No recognized project — use fallback tsc diagnostics
  useFallbackDiag = 1;
}

function startTypeScriptServer(): void {
  // Find typescript-language-server
  let serverCmd = '';
  let serverArgs = '';

  // Check bundled location first
  const bundledTsServer = lspWorkspaceRoot + '/node_modules/.bin/typescript-language-server';
  if (fileExistsSafe(bundledTsServer)) {
    serverCmd = bundledTsServer;
    serverArgs = '--stdio';
  } else {
    // Check global
    try {
      const which = execSync('which typescript-language-server');
      if (which.length > 0) {
        serverCmd = which.trim();
        serverArgs = '--stdio';
      }
    } catch (e: any) { /* not found */ }
  }

  if (serverCmd.length < 1) {
    // No server found — fall back to tsc diagnostics
    useFallbackDiag = 1;
    return;
  }

  // Start the LSP server via native FFI
  const handle = hone_lsp_start(serverCmd as any, serverArgs as any, lspWorkspaceRoot as any);
  if (handle < 0) {
    useFallbackDiag = 1;
    return;
  }

  lspServerHandle = handle;
  lspServerLanguage = 'typescript';

  // Send initialize request
  sendInitialize();
}

function sendInitialize(): void {
  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;

  let rootUri = 'file://';
  rootUri += lspWorkspaceRoot;

  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"initialize","params":{"processId":null,"rootUri":"';
  json += rootUri;
  json += '","capabilities":{"textDocument":{"synchronization":{"didSave":true},"completion":{"completionItem":{"snippetSupport":false}},"hover":{"contentFormat":["plaintext"]},"definition":{},"formatting":{},"publishDiagnostics":{"relatedInformation":true}}}}}';

  trackPendingRequest(id, 'initialize');
  hone_lsp_send(lspServerHandle, json as any);
}

function sendInitialized(): void {
  let json = '{"jsonrpc":"2.0","method":"initialized","params":{}}';
  hone_lsp_send(lspServerHandle, json as any);
  lspInitialized = 1;
}

// ---------------------------------------------------------------------------
// Internal — message polling
// ---------------------------------------------------------------------------

function onLspTick(): void {
  if (lspReady < 1) return;
  lspTickCount = lspTickCount + 1;

  // Poll LSP server for messages
  if (lspServerHandle >= 0) {
    pollLspMessages();
  }

  // Fallback tsc diagnostics
  if (useFallbackDiag > 0) {
    if (fallbackDiagRunning > 0) {
      if ((lspTickCount & 31) === 0) pollFallbackDiagDone();
    } else if (lspTickCount >= 625) {
      lspTickCount = 0;
      startFallbackDiagnostics();
    }
  }
}

function pollLspMessages(): void {
  // Poll up to 10 messages per tick
  for (let i = 0; i < 10; i = i + 1) {
    const msgPtr = hone_lsp_poll(lspServerHandle);
    if (msgPtr === 0) break;

    // msgPtr is a Perry StringHeader pointer — read it
    const msg = perryStringFromPtr(msgPtr);
    if (msg.length > 0) {
      handleLspMessage(msg);
    }
  }
}

function handleLspMessage(json: string): void {
  // Check for notifications (no "id", has "method")
  if (json.indexOf('publishDiagnostics') > 0) {
    handleDiagnosticsNotification(json);
    return;
  }

  // Check for responses (has "id" and "result")
  if (json.indexOf('"id"') < 0) return;

  const idVal = extractJsonNumber(json, '"id":');
  if (idVal < 0) return;

  const method = findPendingMethod(idVal);
  removePendingRequest(idVal);

  if (method.length < 1) return;

  // Route by method
  // 'i'nitialize (charCodeAt(0) === 105)
  if (method.charCodeAt(0) === 105 && method.length >= 10) {
    sendInitialized();
    return;
  }

  // 'textDocument/hover' — charCodeAt(13) === 104 ('h')
  if (method.length > 15 && method.indexOf('hover') > 0) {
    handleHoverResponse(json);
    return;
  }

  // 'textDocument/definition' — contains 'definition'
  if (method.indexOf('definition') > 0) {
    handleDefinitionResponse(json);
    return;
  }

  // 'textDocument/signatureHelp' — contains 'signatureHelp'
  if (method.indexOf('signatureHelp') > 0) {
    handleSignatureResponse(json);
    return;
  }
}

function handleHoverResponse(json: string): void {
  if (_hoverCallback === null) return;

  // Extract hover content: result.contents can be string, MarkupContent, or MarkedString
  // Look for "value":" in the result
  const resultIdx = json.indexOf('"result"');
  if (resultIdx < 0) return;
  const resultStr = json.slice(resultIdx);

  // Try to find "value":" (MarkupContent format)
  let content = extractJsonString(resultStr, '"value":"');
  if (content.length < 1) {
    // Try plain string: "result":"..."
    content = extractJsonString(resultStr, '"result":"');
  }

  if (content.length > 0) {
    // Unescape \\n to real newlines
    let unescaped = '';
    for (let i = 0; i < content.length; i = i + 1) {
      if (content.charCodeAt(i) === 92 && i + 1 < content.length && content.charCodeAt(i + 1) === 110) {
        unescaped += '\n';
        i = i + 1;
      } else {
        unescaped += content.charAt(i);
      }
    }
    _hoverCallback(unescaped);
  }
}

function handleDefinitionResponse(json: string): void {
  if (_definitionCallback === null) return;

  // Extract Location: { uri: "file:///...", range: { start: { line: N, character: N } } }
  const resultIdx = json.indexOf('"result"');
  if (resultIdx < 0) return;
  const resultStr = json.slice(resultIdx);

  const uri = extractJsonString(resultStr, '"uri":"');
  if (uri.length < 1) return;

  // Convert URI to file path
  let filePath = uri;
  if (uri.indexOf('file://') === 0) {
    filePath = uri.slice(7);
  }

  // Extract start line
  const startIdx = resultStr.indexOf('"start"');
  if (startIdx < 0) return;
  const startStr = resultStr.slice(startIdx);
  const line = extractJsonNumber(startStr, '"line":');

  _definitionCallback(filePath, line >= 0 ? line : 0);
}

function handleSignatureResponse(json: string): void {
  if (_signatureCallback === null) return;

  const resultIdx = json.indexOf('"result"');
  if (resultIdx < 0) return;
  const resultStr = json.slice(resultIdx);

  // Check for null result
  if (resultStr.indexOf('"result":null') >= 0) return;

  // Extract signature label
  const label = extractJsonString(resultStr, '"label":"');
  if (label.length < 1) return;

  // Extract activeParameter
  const activeParam = extractJsonNumber(resultStr, '"activeParameter":');

  // Extract documentation (if present)
  const doc = extractJsonString(resultStr, '"documentation":"');

  _signatureCallback(label, activeParam >= 0 ? activeParam : 0, doc);
}

function handleDiagnosticsNotification(json: string): void {
  // Extract URI
  const uri = extractJsonString(json, '"uri":"');

  // Extract diagnostics array — simplified parsing
  const diagStart = json.indexOf('"diagnostics":[');
  if (diagStart < 0) return;

  // Parse individual diagnostics
  let diagFiles: string[] = [];
  let diagLines: number[] = [];
  let diagMessages: string[] = [];
  let diagSeverities: string[] = [];
  let diagCount = 0;

  // Convert URI to file path
  let filePath = uri;
  if (uri.indexOf('file://') === 0) {
    filePath = uri.slice(7);
  }

  // Find each diagnostic object { "range": ..., "message": ..., "severity": ... }
  let searchFrom = diagStart;
  for (let d = 0; d < 100; d = d + 1) {
    const msgIdx = json.indexOf('"message":"', searchFrom);
    if (msgIdx < 0) break;

    const message = extractJsonString(json.slice(msgIdx), '"message":"');
    const lineNum = extractJsonNumber(json.slice(searchFrom, msgIdx + 100), '"line":');
    const sevNum = extractJsonNumber(json.slice(searchFrom, msgIdx + 200), '"severity":');

    let severity = 'info';
    if (sevNum === 1) severity = 'error';
    if (sevNum === 2) severity = 'warning';
    if (sevNum === 3) severity = 'info';
    if (sevNum === 4) severity = 'hint';

    if (diagCount < 100) {
      diagFiles[diagCount] = filePath;
      diagLines[diagCount] = lineNum >= 0 ? lineNum : 0;
      diagMessages[diagCount] = message;
      diagSeverities[diagCount] = severity;
      diagCount = diagCount + 1;
    }

    searchFrom = msgIdx + message.length + 12;
  }

  if (diagCount > 0) {
    updateDiagnostics(diagFiles, diagLines, diagMessages, diagSeverities, diagCount);
    let errorCount = 0;
    let warningCount = 0;
    for (let i = 0; i < diagCount; i = i + 1) {
      if (diagSeverities[i].charCodeAt(0) === 101) errorCount = errorCount + 1;
      if (diagSeverities[i].charCodeAt(0) === 119) warningCount = warningCount + 1;
    }
    callStatusUpdater(errorCount, warningCount);
  } else {
    // Clear diagnostics for this file
    updateDiagnostics([], [], [], [], 0);
    callStatusUpdater(0, 0);
  }
}

// ---------------------------------------------------------------------------
// Internal — helpers
// ---------------------------------------------------------------------------

function trackPendingRequest(id: number, method: string): void {
  if (pendingCount < 32) {
    pendingIds[pendingCount] = id;
    pendingMethods[pendingCount] = method;
    pendingCount = pendingCount + 1;
  }
}

function findPendingMethod(id: number): string {
  for (let i = 0; i < pendingCount; i = i + 1) {
    if (pendingIds[i] === id) return pendingMethods[i];
  }
  return '';
}

function removePendingRequest(id: number): void {
  for (let i = 0; i < pendingCount; i = i + 1) {
    if (pendingIds[i] === id) {
      // Shift remaining
      for (let j = i; j < pendingCount - 1; j = j + 1) {
        pendingIds[j] = pendingIds[j + 1];
        pendingMethods[j] = pendingMethods[j + 1];
      }
      pendingCount = pendingCount - 1;
      return;
    }
  }
}

/** Extract a string value from JSON: finds "key":"value" and returns value. */
function extractJsonString(json: string, key: string): string {
  const idx = json.indexOf(key);
  if (idx < 0) return '';
  const start = idx + key.length;
  let end = start;
  let escaped = 0;
  for (let i = start; i < json.length; i = i + 1) {
    if (escaped > 0) { escaped = 0; continue; }
    if (json.charCodeAt(i) === 92) { escaped = 1; continue; } // backslash
    if (json.charCodeAt(i) === 34) { end = i; break; } // quote
  }
  return json.slice(start, end);
}

/** Extract a number value from JSON: finds "key":number. */
function extractJsonNumber(json: string, key: string): number {
  const idx = json.indexOf(key);
  if (idx < 0) return -1;
  const start = idx + key.length;
  let numStr = '';
  for (let i = start; i < json.length; i = i + 1) {
    const ch = json.charCodeAt(i);
    if (ch >= 48 && ch <= 57) { // 0-9
      numStr += json.charAt(i);
    } else if (ch === 45 && numStr.length === 0) { // minus sign
      numStr += '-';
    } else {
      break;
    }
  }
  if (numStr.length === 0) return -1;
  return parseInt(numStr);
}

/** Escape a string for JSON embedding. */
function jsonEscapeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i = i + 1) {
    const ch = s.charCodeAt(i);
    if (ch === 34) { out += '\\"'; } // "
    else if (ch === 92) { out += '\\\\'; } // \
    else if (ch === 10) { out += '\\n'; } // newline
    else if (ch === 13) { out += '\\r'; } // CR
    else if (ch === 9) { out += '\\t'; } // tab
    else if (ch < 32) { out += ' '; } // other control chars
    else { out += s.charAt(i); }
  }
  out += '"';
  return out;
}

/** Read a Perry string from a pointer (i64). */
function perryStringFromPtr(ptr: number): string {
  // In Perry, the ptr is a raw pointer to a StringHeader.
  // When returned from Rust FFI as i64, Perry wraps it as a string automatically.
  // We just cast it.
  return ptr as any as string;
}

function fileExistsSafe(path: string): boolean {
  try {
    return existsSync(path);
  } catch (e: any) {
    return false;
  }
}

function callStatusUpdater(errors: number, warnings: number): void {
  _statusUpdater(errors, warnings);
}

// ---------------------------------------------------------------------------
// Fallback tsc diagnostics (when no LSP server available)
// ---------------------------------------------------------------------------

function ensureFallbackPaths(): void {
  if (DIAG_LOG_FILE.length > 0) return;
  const tmp = getTempDir();
  DIAG_LOG_FILE = tmp + '/hone-tsc-diag.txt';
  DIAG_DONE_FILE = tmp + '/hone-tsc-done';
}

function startFallbackDiagnostics(): void {
  if (lspWorkspaceRoot.length < 1) return;
  if (fallbackDiagRunning > 0) return;
  if (!canRunShellCommands()) return;

  // Check if tsconfig.json exists
  let hasTsConfig: number = 0;
  try {
    readFileSync(lspWorkspaceRoot + '/tsconfig.json');
    hasTsConfig = 1;
  } catch (e: any) { /* no tsconfig */ }
  if (hasTsConfig < 1) return;

  ensureFallbackPaths();
  try { unlinkSync(DIAG_DONE_FILE); } catch (e: any) { /* ignore */ }

  const cmd = '/bin/sh';
  const shellCmd = 'cd ' + lspWorkspaceRoot + ' && npx tsc --noEmit --pretty false > ' + DIAG_LOG_FILE + ' 2>&1; touch ' + DIAG_DONE_FILE;
  spawnBackground(cmd, ['-c', shellCmd], '/dev/null');
  fallbackDiagRunning = 1;
}

function pollFallbackDiagDone(): void {
  if (existsSync(DIAG_DONE_FILE)) {
    fallbackDiagRunning = 0;
    readFallbackDiagOutput();
  }
}

function readFallbackDiagOutput(): void {
  let output = '';
  try { output = readFileSync(DIAG_LOG_FILE); } catch (e: any) { return; }
  if (output.length < 1) return;

  let h = 0;
  const len = output.length < 200 ? output.length : 200;
  for (let i = 0; i < len; i = i + 1) {
    h = ((h * 31) + output.charCodeAt(i)) | 0;
  }
  if (h === lastDiagHashVal && output.length === lastDiagHashLen) return;
  lastDiagHashVal = h;
  lastDiagHashLen = output.length;

  parseTscOutput(output);
}

function parseTscOutput(output: string): void {
  let diagFiles: string[] = [];
  let diagLines: number[] = [];
  let diagMessages: string[] = [];
  let diagSeverities: string[] = [];
  let diagCount = 0;

  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i = i + 1) {
    const line = lines[i];
    if (line.length < 5) continue;

    let parenIdx = -1;
    for (let j = 0; j < line.length; j = j + 1) {
      if (line.charCodeAt(j) === 40) { parenIdx = j; break; }
    }
    if (parenIdx < 1) continue;

    let closeIdx = -1;
    for (let j = parenIdx + 1; j < line.length; j = j + 1) {
      if (line.charCodeAt(j) === 41) { closeIdx = j; break; }
    }
    if (closeIdx < 0) continue;

    let colonIdx = closeIdx + 1;
    if (colonIdx + 1 >= line.length) continue;
    if (line.charCodeAt(colonIdx) !== 58) continue;
    if (line.charCodeAt(colonIdx + 1) !== 32) continue;
    colonIdx = colonIdx + 2;

    let severity = 'error';
    if (colonIdx < line.length && line.charCodeAt(colonIdx) === 119) severity = 'warning';

    const filePath = line.slice(0, parenIdx);
    const locStr = line.slice(parenIdx + 1, closeIdx);
    let commaIdx = -1;
    for (let j = 0; j < locStr.length; j = j + 1) {
      if (locStr.charCodeAt(j) === 44) { commaIdx = j; break; }
    }
    let lineNum = 0;
    if (commaIdx > 0) lineNum = parseInt(locStr.slice(0, commaIdx));

    let msgStart = colonIdx;
    for (let j = colonIdx; j < line.length - 1; j = j + 1) {
      if (line.charCodeAt(j) === 58 && line.charCodeAt(j + 1) === 32) {
        msgStart = j + 2;
        break;
      }
    }
    const message = line.slice(msgStart);

    if (diagCount < 100) {
      diagFiles[diagCount] = filePath;
      diagLines[diagCount] = lineNum;
      diagMessages[diagCount] = message;
      diagSeverities[diagCount] = severity;
      diagCount = diagCount + 1;
    }
  }

  updateDiagnostics(diagFiles, diagLines, diagMessages, diagSeverities, diagCount);
  let errorCount = 0;
  let warningCount = 0;
  for (let i = 0; i < diagCount; i = i + 1) {
    if (diagSeverities[i].charCodeAt(0) === 101) errorCount = errorCount + 1;
    if (diagSeverities[i].charCodeAt(0) === 119) warningCount = warningCount + 1;
  }
  callStatusUpdater(errorCount, warningCount);
}
