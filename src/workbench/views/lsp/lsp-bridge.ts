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
import { spawnBackground, spawnSync } from 'child_process';
import { spawn } from 'perry/thread';

// Platform constant — 0=macOS, 1=iOS, 3=Windows, 4=Linux, 5=web.
declare const __platform__: number;

// SHIP-V1-GAPS.md followup §5: cross-platform `which`-equivalent. `which`
// only exists on POSIX; Windows ships `where`. Output of `where` is the
// full path of the matched executable (multiple lines if multiple hits —
// we take the first).
function findExecutableOnPath(name: string): string {
  try {
    if (__platform__ === 3) {
      const r = spawnSync('where', [name]);
      if (r.status === 0 && r.stdout.length > 0) {
        // First non-empty line is the canonical hit.
        for (let i = 0; i < r.stdout.length; i++) {
          if (r.stdout.charCodeAt(i) === 10 || r.stdout.charCodeAt(i) === 13) {
            return r.stdout.slice(0, i);
          }
        }
        return r.stdout;
      }
    } else {
      const r = spawnSync('which', [name]);
      if (r.status === 0 && r.stdout.length > 0) {
        let end = r.stdout.length;
        while (end > 0 && (r.stdout.charCodeAt(end - 1) === 10 || r.stdout.charCodeAt(end - 1) === 13)) end--;
        return r.stdout.slice(0, end);
      }
    }
  } catch (_e: any) {}
  return '';
}

/**
 * Build an LSP `file://` URI from an OS-native absolute path.
 *
 * The old inline `let uri = 'file://'; uri += filePath;` was correct ONLY on
 * POSIX (`/abs/x` → `file://` + `/abs/x` = `file:///abs/x`, valid). On
 * Windows `filePath` is a backslash drive path (`C:\Users\x\f.ts`), so it
 * produced `file://C:\Users\x\f.ts` — a malformed URI whose authority parses
 * as `C:`. typescript-language-server / tsgo cannot resolve that back to a
 * filesystem path, so EVERY outbound LSP message (didOpen/Change/Save/Close,
 * hover, definition, references, completion, formatting, codeAction, rename,
 * documentSymbol, …) referenced a document the server never accepted —
 * LSP was entirely non-functional on Windows (no diagnostics/hover/etc.).
 *
 * Correct Windows form is `file:///C:/Users/x/f.ts`: backslashes → forward
 * slashes, and a leading `/` before the drive so the URI has an empty
 * authority + absolute path. POSIX behavior is preserved EXACTLY (path
 * already starts with `/`, so we emit `file://` + `/abs` unchanged).
 * Percent-encoding is intentionally NOT added here: the prior code never
 * encoded on any platform and the servers in use tolerate raw paths;
 * introducing encoding now would be an orthogonal behavior change that
 * could regress the currently-working POSIX path. Tracked separately.
 */
function pathToFileUri(p: string): string {
  let s = '';
  for (let i = 0; i < p.length; i++) {
    if (p.charCodeAt(i) === 92) s += '/'; // '\' → '/'
    else s += p.charAt(i);
  }
  let uri = 'file://';
  if (s.length > 0 && s.charCodeAt(0) === 47) {
    uri += s;           // POSIX '/abs' → 'file:///abs' (unchanged)
  } else {
    uri += '/';         // Windows 'C:/..' → 'file:///C:/..'
    uri += s;
  }
  return uri;
}

/**
 * Inverse of pathToFileUri: a server-sent `file://` URI → OS-native path.
 *
 * The old inline `if (uri.indexOf('file://')===0) filePath = uri.slice(7)`
 * was correct ONLY on POSIX (`file:///abs` → `/abs`). On Windows the server
 * (now that iter-103 sends well-formed `file:///C:/…`) echoes that form, and
 * a bare slice(7) yields `/C:/Users/x` — a leading-slash-before-drive path
 * Win32 cannot open, so go-to-definition jumped nowhere and inbound
 * diagnostics keyed every file under a bogus path (Problems panel + squiggle
 * mapping silently wrong on Windows).
 *
 * Deliberately MINIMAL: returns exactly the old `uri.slice(7)` for every
 * non-Windows-drive shape (so the working POSIX path is byte-identical and
 * carries zero regression risk — same scoping rule as iter-103's forward
 * helper), and diverges ONLY for the precise `/<letter>:` drive pattern
 * that was 100% broken before, stripping the spurious leading slash and
 * switching `/`→`\` so it matches the OS-native form used everywhere else.
 * Percent-decoding intentionally not added here (orthogonal; never done on
 * any platform; tracked with the same note as iter-103).
 */
function fileUriToPath(uri: string): string {
  if (uri.indexOf('file://') !== 0) return uri;
  const rest = uri.slice(7);
  if (rest.length >= 3 && rest.charCodeAt(0) === 47) {
    const d = rest.charCodeAt(1);
    const isLetter = (d >= 65 && d <= 90) || (d >= 97 && d <= 122);
    if (isLetter && rest.charCodeAt(2) === 58) { // '<letter>' ':'
      const drivePart = rest.slice(1);           // 'C:/Users/x'
      let out = '';
      for (let i = 0; i < drivePart.length; i++) {
        if (drivePart.charCodeAt(i) === 47) out += '\\';
        else out += drivePart.charAt(i);
      }
      return out;                                // 'C:\Users\x'
    }
  }
  return rest;                                   // POSIX: identical to old slice(7)
}
import { updateDiagnostics, setFileDiagnostics, getDiagErrorCount, getDiagWarningCount } from './diagnostics-panel';
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
let _formatCallback: ((editsJson: string) => void) | null = null;

// Fallback diagnostics (tsc-based, for when no LSP server)
let useFallbackDiag: number = 0;
let fallbackDiagRunning: number = 0;
let DIAG_LOG_FILE = '';
let DIAG_DONE_FILE = '';

// Current document state
let currentFilePath: string = '';

// Per-document LSP version tracking. The LSP spec requires version numbers
// to be monotonically increasing PER DOCUMENT. The old single global
// `currentFileVersion` broke this: edit A (→v4), open B (counter reset to
// 1), edit A again → didChange A "version 2" while the server last saw A at
// v4 → the server rejects/ignores the change and its document model
// desyncs from the editor (wrong diagnostics/completion/hover on the file
// being actively edited). Parallel arrays (Perry-safe, mirrors the
// fileCache pattern; no dynamic object-key access).
let _lspVerPaths: string[] = [];
let _lspVerNums: number[] = [];

function _lspVerIndex(p: string): number {
  for (let i = 0; i < _lspVerPaths.length; i++) {
    if (_lspVerPaths[i].length === p.length) {
      let match = 1;
      for (let j = 0; j < p.length; j++) {
        if (_lspVerPaths[i].charCodeAt(j) !== p.charCodeAt(j)) { match = 0; break; }
      }
      if (match > 0) return i;
    }
  }
  return -1;
}

/** Set a document's version (used by didOpen → 1). */
function _lspVerReset(p: string): void {
  const idx = _lspVerIndex(p);
  if (idx >= 0) { _lspVerNums[idx] = 1; return; }
  _lspVerPaths.push(p);
  _lspVerNums.push(1);
}

/** Bump and return a document's version (used by didChange). Falls back to
 * 1 if the doc was never opened (shouldn't happen, but never desync). */
function _lspVerBump(p: string): number {
  const idx = _lspVerIndex(p);
  if (idx >= 0) { _lspVerNums[idx] = _lspVerNums[idx] + 1; return _lspVerNums[idx]; }
  _lspVerPaths.push(p);
  _lspVerNums.push(1);
  return 1;
}

/** Drop a document's version entry (used by didClose) so a later reopen
 * starts cleanly at 1 and the arrays don't grow unbounded. */
function _lspVerDrop(p: string): void {
  const idx = _lspVerIndex(p);
  if (idx < 0) return;
  for (let i = idx; i < _lspVerPaths.length - 1; i++) {
    _lspVerPaths[i] = _lspVerPaths[i + 1];
    _lspVerNums[i] = _lspVerNums[i + 1];
  }
  _lspVerPaths.pop();
  _lspVerNums.pop();
}

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
  _lspVerReset(filePath); // this doc's version → 1 (per-document)
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  // Build textDocument/didOpen notification
  let uri = pathToFileUri(filePath);
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
  // Per-document monotonic version (not a global counter — see _lspVer*).
  const docVersion = _lspVerBump(filePath);
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  let uri = pathToFileUri(filePath);
  let json = '{"jsonrpc":"2.0","method":"textDocument/didChange","params":{"textDocument":{"uri":"';
  json += uri;
  json += '","version":';
  json += String(docVersion);
  json += '},"contentChanges":[{"text":';
  json += jsonEscapeString(content);
  json += '}]}}';
  hone_lsp_send(lspServerHandle, json as any);
}

/** Notify LSP of a file save. */
export function lspDidSave(filePath: string): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  let uri = pathToFileUri(filePath);
  let json = '{"jsonrpc":"2.0","method":"textDocument/didSave","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"}}}';
  hone_lsp_send(lspServerHandle, json as any);
}

/** Notify LSP that a document was closed in the editor.
 *
 * Without this, the language server treats every file ever opened in the
 * session as still-open forever: its in-memory program/AST model grows
 * unbounded over a long session (a server-side resource leak), it keeps
 * (re)publishing diagnostics for files no longer visible, and it's an LSP
 * spec violation (textDocument/didClose is required when a doc leaves the
 * editor). Mirrors lspDidSave — a bare notification carrying the URI.
 * Same un-escaped `file://` + path convention as didOpen/didChange/didSave
 * (kept consistent deliberately; URI-escaping is a separate cross-cutting
 * concern for all four, not this targeted close fix). */
export function lspDidClose(filePath: string): void {
  // Drop the per-document version entry: a later reopen of this path must
  // restart at version 1 (didOpen), and this keeps the tracking arrays
  // bounded over a long session. Done before the server-readiness guard so
  // local bookkeeping stays correct even if the server isn't up.
  _lspVerDrop(filePath);
  if (lspServerHandle < 0 || lspInitialized < 1) return;
  let uri = pathToFileUri(filePath);
  let json = '{"jsonrpc":"2.0","method":"textDocument/didClose","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"}}}';
  hone_lsp_send(lspServerHandle, json as any);
}

/** Request formatting for the current document. Returns via callback. */
export function lspFormatDocument(filePath: string, tabSize: number, insertSpaces: number): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;

  let uri = pathToFileUri(filePath);
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

  let uri = pathToFileUri(filePath);
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

  let uri = pathToFileUri(filePath);
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

/** Set callback for formatting results. */
export function setFormatCallback(fn: (editsJson: string) => void): void {
  _formatCallback = fn;
}

/** Check if LSP server is ready and initialized. */
export function lspIsReady(): number {
  if (lspServerHandle >= 0 && lspInitialized > 0) return 1;
  return 0;
}

/** Request signature help. */
export function lspSignatureHelp(filePath: string, line: number, character: number): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;

  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;

  let uri = pathToFileUri(filePath);
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

// ---------------------------------------------------------------------------
// Phase 2 (SHIP-V1-GAPS.md #27–#35): references, rename, document/workspace
// symbols, code actions, inlay hints. Each follows the same pattern as the
// existing hover/definition/signature requests: build the JSON-RPC envelope,
// track pending by id, route the response in handleLspMessage.
// ---------------------------------------------------------------------------

let _referencesCallback: ((locationsJson: string) => void) | null = null;
let _renameCallback: ((workspaceEditJson: string) => void) | null = null;
let _docSymbolsCallback: ((symbolsJson: string) => void) | null = null;
let _workspaceSymbolsCallback: ((symbolsJson: string) => void) | null = null;
let _codeActionsCallback: ((actionsJson: string) => void) | null = null;
let _inlayHintsCallback: ((hintsJson: string) => void) | null = null;

export function setReferencesCallback(fn: (locationsJson: string) => void): void {
  _referencesCallback = fn;
}
export function setRenameCallback(fn: (workspaceEditJson: string) => void): void {
  _renameCallback = fn;
}
export function setDocumentSymbolsCallback(fn: (symbolsJson: string) => void): void {
  _docSymbolsCallback = fn;
}
export function setWorkspaceSymbolsCallback(fn: (symbolsJson: string) => void): void {
  _workspaceSymbolsCallback = fn;
}
export function setCodeActionsCallback(fn: (actionsJson: string) => void): void {
  _codeActionsCallback = fn;
}
export function setInlayHintsCallback(fn: (hintsJson: string) => void): void {
  _inlayHintsCallback = fn;
}

/** Find all references to the symbol at (line, character). */
export function lspReferences(filePath: string, line: number, character: number, includeDeclaration: number): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;
  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;
  let uri = pathToFileUri(filePath);
  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"textDocument/references","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"},"position":{"line":';
  json += String(line);
  json += ',"character":';
  json += String(character);
  json += '},"context":{"includeDeclaration":';
  json += includeDeclaration > 0 ? 'true' : 'false';
  json += '}}}';
  trackPendingRequest(id, 'textDocument/references');
  hone_lsp_send(lspServerHandle, json as any);
}

/** Rename the symbol at (line, character) to newName. Returns a WorkspaceEdit. */
export function lspRename(filePath: string, line: number, character: number, newName: string): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;
  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;
  let uri = pathToFileUri(filePath);
  // Escape " and \ in newName so the JSON-RPC payload stays valid.
  let escaped = '';
  for (let i = 0; i < newName.length; i++) {
    const c = newName.charCodeAt(i);
    if (c === 34) escaped += '\\"';
    else if (c === 92) escaped += '\\\\';
    else if (c === 10) escaped += '\\n';
    else escaped += newName.charAt(i);
  }
  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"textDocument/rename","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"},"position":{"line":';
  json += String(line);
  json += ',"character":';
  json += String(character);
  json += '},"newName":"';
  json += escaped;
  json += '"}}';
  trackPendingRequest(id, 'textDocument/rename');
  hone_lsp_send(lspServerHandle, json as any);
}

/** Get all symbols defined in this document (for the outline view). */
export function lspDocumentSymbols(filePath: string): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;
  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;
  let uri = pathToFileUri(filePath);
  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"textDocument/documentSymbol","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"}}}';
  trackPendingRequest(id, 'textDocument/documentSymbol');
  hone_lsp_send(lspServerHandle, json as any);
}

/** Find workspace-wide symbols matching `query` (powers Cmd+T / '#' prefix in Quick Open). */
export function lspWorkspaceSymbols(query: string): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;
  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;
  // Escape query
  let escaped = '';
  for (let i = 0; i < query.length; i++) {
    const c = query.charCodeAt(i);
    if (c === 34) escaped += '\\"';
    else if (c === 92) escaped += '\\\\';
    else escaped += query.charAt(i);
  }
  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"workspace/symbol","params":{"query":"';
  json += escaped;
  json += '"}}';
  trackPendingRequest(id, 'workspace/symbol');
  hone_lsp_send(lspServerHandle, json as any);
}

/**
 * Request code actions (quick fixes + refactors) for a range. The context
 * carries diagnostics so the server can surface fix-this-error actions.
 * `diagnosticsJson` is the verbatim JSON array of LSP Diagnostic objects.
 */
export function lspCodeActions(
  filePath: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
  diagnosticsJson: string,
): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;
  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;
  let uri = pathToFileUri(filePath);
  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"textDocument/codeAction","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"},"range":{"start":{"line":';
  json += String(startLine);
  json += ',"character":';
  json += String(startCol);
  json += '},"end":{"line":';
  json += String(endLine);
  json += ',"character":';
  json += String(endCol);
  json += '}},"context":{"diagnostics":';
  json += diagnosticsJson.length > 0 ? diagnosticsJson : '[]';
  json += '}}}';
  trackPendingRequest(id, 'textDocument/codeAction');
  hone_lsp_send(lspServerHandle, json as any);
}

let _semanticTokensCallback: ((tokensJson: string) => void) | null = null;
export function setSemanticTokensCallback(fn: (tokensJson: string) => void): void {
  _semanticTokensCallback = fn;
}

/**
 * Request full semantic tokens for a file. SHIP-V1-GAPS.md #32.
 * Result delivered as LSP SemanticTokens JSON (`{ data: number[], resultId? }`).
 * Editor overlay rendering of the deltas is v1.1.
 */
export function lspSemanticTokens(filePath: string): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;
  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;
  let uri = pathToFileUri(filePath);
  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"textDocument/semanticTokens/full","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"}}}';
  trackPendingRequest(id, 'textDocument/semanticTokens/full');
  hone_lsp_send(lspServerHandle, json as any);
}

/** Get inlay hints (parameter names, inferred types) for a range. */
export function lspInlayHints(
  filePath: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
): void {
  if (lspServerHandle < 0 || lspInitialized < 1) return;
  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;
  let uri = pathToFileUri(filePath);
  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"textDocument/inlayHint","params":{"textDocument":{"uri":"';
  json += uri;
  json += '"},"range":{"start":{"line":';
  json += String(startLine);
  json += ',"character":';
  json += String(startCol);
  json += '},"end":{"line":';
  json += String(endLine);
  json += ',"character":';
  json += String(endCol);
  json += '}}}}';
  trackPendingRequest(id, 'textDocument/inlayHint');
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
  // Discover LSP server on a background thread (which commands can be slow)
  const wsRoot = lspWorkspaceRoot;

  // First check local paths synchronously (fast — just existsSync).
  // SHIP-V1-GAPS.md followup §5: on Windows, `node_modules/.bin/` contains
  // `.cmd` wrappers, not bare names; check both.
  const tsgoLocations: string[] = [];
  if (__platform__ === 3) {
    tsgoLocations.push(wsRoot + '/node_modules/.bin/tsgo.cmd');
    tsgoLocations.push(wsRoot + '/node_modules/.bin/tsgo.exe');
  }
  tsgoLocations.push(wsRoot + '/node_modules/.bin/tsgo');
  if (__platform__ !== 3) {
    tsgoLocations.push('/usr/local/bin/tsgo');
    tsgoLocations.push('/opt/homebrew/bin/tsgo');
  }
  for (let i = 0; i < tsgoLocations.length; i = i + 1) {
    if (fileExistsSafe(tsgoLocations[i])) {
      launchLspServer(tsgoLocations[i], '--lsp');
      return;
    }
  }

  const tslsLocations: string[] = [];
  if (__platform__ === 3) {
    tslsLocations.push(wsRoot + '/node_modules/.bin/typescript-language-server.cmd');
    tslsLocations.push(wsRoot + '/node_modules/.bin/typescript-language-server.exe');
  }
  tslsLocations.push(wsRoot + '/node_modules/.bin/typescript-language-server');
  for (let i = 0; i < tslsLocations.length; i = i + 1) {
    if (fileExistsSafe(tslsLocations[i])) {
      launchLspServer(tslsLocations[i], '--stdio');
      return;
    }
  }

  // Fallback: run `which` commands on a background thread
  spawn(() => {
    let cmd = '';
    let args = '';
    const tsgo = findExecutableOnPath('tsgo');
    if (tsgo.length > 0) {
      cmd = tsgo;
      args = '--lsp';
    }
    if (cmd.length < 1) {
      const tsls = findExecutableOnPath('typescript-language-server');
      if (tsls.length > 0) {
        cmd = tsls;
        args = '--stdio';
      }
    }
    return { cmd: cmd, args: args };
  }).then((result) => { onLspDiscoveryResult(result); });
}

function onLspDiscoveryResult(r: { cmd: string; args: string }): void {
  if (r.cmd.length < 1) {
    useFallbackDiag = 1;
    return;
  }
  launchLspServer(r.cmd, r.args);
}

function launchLspServer(serverCmd: string, serverArgs: string): void {
  const handle = hone_lsp_start(serverCmd as any, serverArgs as any, lspWorkspaceRoot as any);
  if (handle < 0) {
    useFallbackDiag = 1;
    return;
  }
  lspServerHandle = handle;
  lspServerLanguage = 'typescript';
  sendInitialize();
}

function sendInitialize(): void {
  const id = lspNextRequestId;
  lspNextRequestId = lspNextRequestId + 1;

  let rootUri = pathToFileUri(lspWorkspaceRoot);

  let json = '{"jsonrpc":"2.0","id":';
  json += String(id);
  json += ',"method":"initialize","params":{"processId":null,"rootUri":"';
  json += rootUri;
  // SHIP-V1-GAPS.md #34/#32: advertise markdown hover + semantic tokens.
  json += '","capabilities":{"textDocument":{"synchronization":{"didSave":true},"completion":{"completionItem":{"snippetSupport":false}},"hover":{"contentFormat":["markdown","plaintext"]},"definition":{},"references":{},"documentSymbol":{"hierarchicalDocumentSymbolSupport":true},"rename":{"prepareSupport":false},"codeAction":{"codeActionLiteralSupport":{"codeActionKind":{"valueSet":["quickfix","refactor","source"]}}},"formatting":{},"rangeFormatting":{},"onTypeFormatting":{},"inlayHint":{"dynamicRegistration":false},"semanticTokens":{"requests":{"full":true},"tokenTypes":["namespace","type","class","enum","interface","struct","typeParameter","parameter","variable","property","enumMember","event","function","method","macro","keyword","modifier","comment","string","number","regexp","operator"],"tokenModifiers":["declaration","definition","readonly","static","deprecated","abstract","async","modification","documentation","defaultLibrary"],"formats":["relative"]},"publishDiagnostics":{"relatedInformation":true}},"workspace":{"symbol":{}}}}}';

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

  // 'textDocument/formatting' — contains 'formatting'
  if (method.indexOf('formatting') > 0) {
    handleFormattingResponse(json);
    return;
  }

  // Phase 2 LSP responses — string-contains routing keeps Perry happy.
  if (method.indexOf('references') > 0) {
    handleReferencesResponse(json);
    return;
  }
  if (method.indexOf('rename') > 0) {
    handleRenameResponse(json);
    return;
  }
  if (method.indexOf('documentSymbol') > 0) {
    handleDocumentSymbolsResponse(json);
    return;
  }
  if (method.indexOf('workspace/symbol') >= 0) {
    handleWorkspaceSymbolsResponse(json);
    return;
  }
  if (method.indexOf('codeAction') > 0) {
    handleCodeActionsResponse(json);
    return;
  }
  if (method.indexOf('inlayHint') > 0) {
    handleInlayHintsResponse(json);
    return;
  }
  if (method.indexOf('semanticTokens') > 0) {
    handleSemanticTokensResponse(json);
    return;
  }
}

function handleSemanticTokensResponse(json: string): void {
  if (_semanticTokensCallback === null) return;
  const payload = extractResultPayload(json);
  _semanticTokensCallback(payload);
}

/** Extract the "result" JSON sub-payload from an LSP response envelope. */
function extractResultPayload(json: string): string {
  const idx = json.indexOf('"result"');
  if (idx < 0) return '';
  // Skip "result" : 8 chars + colon + ws
  let p = idx + 8;
  while (p < json.length && (json.charCodeAt(p) === 58 || json.charCodeAt(p) === 32)) p = p + 1;
  // Find matching end of value (object, array, string, null, etc).
  const startCh = json.charCodeAt(p);
  if (startCh === 110) { // 'n'ull
    return 'null';
  }
  if (startCh === 91) { // '['
    return sliceBalanced(json, p, 91, 93);
  }
  if (startCh === 123) { // '{'
    return sliceBalanced(json, p, 123, 125);
  }
  return '';
}

/** Slice a balanced-delimited substring starting at `start` (which must point at `open`). */
function sliceBalanced(s: string, start: number, open: number, close: number): string {
  let depth = 0;
  let inStr = 0;
  for (let i = start; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inStr === 1) {
      if (c === 92) { i = i + 1; continue; } // skip escaped char
      if (c === 34) inStr = 0;
      continue;
    }
    if (c === 34) { inStr = 1; continue; }
    if (c === open) depth = depth + 1;
    else if (c === close) {
      depth = depth - 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return '';
}

function handleReferencesResponse(json: string): void {
  if (_referencesCallback === null) return;
  const payload = extractResultPayload(json);
  _referencesCallback(payload);
}

function handleRenameResponse(json: string): void {
  if (_renameCallback === null) return;
  const payload = extractResultPayload(json);
  _renameCallback(payload);
}

function handleDocumentSymbolsResponse(json: string): void {
  if (_docSymbolsCallback === null) return;
  const payload = extractResultPayload(json);
  _docSymbolsCallback(payload);
}

function handleWorkspaceSymbolsResponse(json: string): void {
  if (_workspaceSymbolsCallback === null) return;
  const payload = extractResultPayload(json);
  _workspaceSymbolsCallback(payload);
}

function handleCodeActionsResponse(json: string): void {
  if (_codeActionsCallback === null) return;
  const payload = extractResultPayload(json);
  _codeActionsCallback(payload);
}

function handleInlayHintsResponse(json: string): void {
  if (_inlayHintsCallback === null) return;
  const payload = extractResultPayload(json);
  _inlayHintsCallback(payload);
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

  // Convert URI to file path (Windows-aware: file:///C:/x → C:\x).
  let filePath = fileUriToPath(uri);

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

function handleFormattingResponse(json: string): void {
  if (_formatCallback === null) return;

  const resultIdx = json.indexOf('"result"');
  if (resultIdx < 0) return;
  const resultStr = json.slice(resultIdx);

  // Check for null result (no edits)
  if (resultStr.indexOf('"result":null') >= 0) return;

  // Pass the raw result JSON to the callback — render.ts will parse the TextEdit array
  _formatCallback(resultStr);
}

function handleDiagnosticsNotification(json: string): void {
  // Extract URI
  const uri = extractJsonString(json, '"uri":"');

  // Extract diagnostics array — simplified parsing
  const diagStart = json.indexOf('"diagnostics":[');
  if (diagStart < 0) return;

  // Parse individual diagnostics. (No per-entry file array — every entry in
  // one publishDiagnostics belongs to the single `filePath` below; the
  // aggregate keys on it via setFileDiagnostics.)
  let diagLines: number[] = [];
  let diagMessages: string[] = [];
  let diagSeverities: string[] = [];
  let diagCount = 0;

  // Convert URI to file path (Windows-aware: file:///C:/x → C:\x).
  let filePath = fileUriToPath(uri);

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
      diagLines[diagCount] = lineNum >= 0 ? lineNum : 0;
      diagMessages[diagCount] = message;
      diagSeverities[diagCount] = severity;
      diagCount = diagCount + 1;
    }

    searchFrom = msgIdx + message.length + 12;
  }

  // Per-file replace within the aggregate (this notification is for ONE
  // file — `filePath`). count===0 is a legitimate "this file is now clean"
  // clear, correctly scoped to filePath (the old code passed [] with no
  // file and wiped every other file's diagnostics, and reported only this
  // notification's counts as the global total). Status bar now reflects
  // project-wide totals across all files, not just the last published one.
  setFileDiagnostics(filePath, diagLines, diagMessages, diagSeverities, diagCount);
  callStatusUpdater(getDiagErrorCount(), getDiagWarningCount());
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

  // SHIP-V1-GAPS.md followup §5: per-platform shell + null-device path.
  // Windows uses `cmd /c`, and POSIX `touch` is `type nul >` on Win.
  // The `&& npx tsc... > log 2>&1` redirect form is accepted by both cmd
  // and POSIX shells.
  if (__platform__ === 3) {
    const shellCmd = 'cd /d "' + lspWorkspaceRoot + '" && npx tsc --noEmit --pretty false > "' + DIAG_LOG_FILE + '" 2>&1 & type nul > "' + DIAG_DONE_FILE + '"';
    spawnBackground('cmd.exe', ['/c', shellCmd], 'NUL');
  } else {
    // Quote all interpolated paths — workspace and home dirs frequently contain
    // spaces (`/Users/Foo/My Documents/...`), and unquoted `cd /Users/Foo My
    // Documents` parses as `cd /Users/Foo` with `My Documents` as extra argv.
    // POSIX sh accepts single-quoted strings literally so no $-expansion.
    const shellCmd = 'cd "' + lspWorkspaceRoot + '" && npx tsc --noEmit --pretty false > "' + DIAG_LOG_FILE + '" 2>&1; touch "' + DIAG_DONE_FILE + '"';
    spawnBackground('/bin/sh', ['-c', shellCmd], '/dev/null');
  }
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
