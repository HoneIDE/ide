/**
 * LSP bridge — runs language diagnostics via CLI tools and provides completions.
 *
 * Uses Perry's spawnBackground to run tsc non-blocking. Polls for a sentinel
 * file to detect completion, then reads the output file.
 */
import { spawnBackground } from 'child_process';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { updateDiagnostics } from './diagnostics-panel';

// Module-level state
let lspReady: number = 0;
let lspWorkspaceRoot: string = '';
let lspTimerStarted: number = 0;
let lspTickCount: number = 0;
let lastDiagHashVal: number = 0;
let lastDiagHashLen: number = 0;

// Background process tracking
let diagRunning: number = 0;
const DIAG_LOG_FILE = '/tmp/hone-tsc-diag.txt';
const DIAG_DONE_FILE = '/tmp/hone-tsc-done';

// Status updater callback
let _statusUpdater: (errorCount: number, warningCount: number) => void = () => {};

export function setDiagnosticsStatusUpdater(fn: (errorCount: number, warningCount: number) => void): void {
  _statusUpdater = fn;
}

// Diagnostic results (parallel arrays)
let diagFiles: string[] = [];
let diagLines: number[] = [];
let diagMessages: string[] = [];
let diagSeverities: string[] = [];
let diagCount: number = 0;

export function setLspWorkspaceRoot(root: string): void {
  lspWorkspaceRoot = root;
}

export function initLspBridge(): void {
  if (lspWorkspaceRoot.length < 1) return;
  lspReady = 1;

  // Start polling timer
  if (lspTimerStarted < 1) {
    lspTimerStarted = 1;
    setInterval(() => { onLspTick(); }, 16);
  }
}

export function stopLspBridge(): void {
  lspReady = 0;
}

function onLspTick(): void {
  if (lspReady < 1) return;
  lspTickCount = lspTickCount + 1;

  // Poll running diagnostic process every ~500ms (31 ticks at 16ms)
  if (diagRunning > 0) {
    if ((lspTickCount & 31) === 0) {
      pollDiagDone();
    }
    return;
  }

  // Start new diagnostics every ~10 seconds (625 ticks at 16ms)
  if (lspTickCount >= 625) {
    lspTickCount = 0;
    startDiagnostics();
  }
}

// ---------------------------------------------------------------------------
// Diagnostics via background tsc
// ---------------------------------------------------------------------------

function startDiagnostics(): void {
  if (lspWorkspaceRoot.length < 1) return;
  if (diagRunning > 0) return;

  // Check if tsconfig.json exists
  let hasTsConfig: number = 0;
  try {
    readFileSync(lspWorkspaceRoot + '/tsconfig.json');
    hasTsConfig = 1;
  } catch (e: any) {
    // No tsconfig
  }

  if (hasTsConfig < 1) return;

  // Remove sentinel file before spawning
  try { unlinkSync(DIAG_DONE_FILE); } catch (e: any) { /* ignore */ }

  // Spawn tsc in background — output goes to log file, sentinel written on completion
  const cmd = '/bin/sh';
  const shellCmd = 'cd ' + lspWorkspaceRoot + ' && npx tsc --noEmit --pretty false > /tmp/hone-tsc-diag.txt 2>&1; touch /tmp/hone-tsc-done';
  const args = ['-c', shellCmd];
  spawnBackground(cmd, args, '/dev/null');
  diagRunning = 1;
}

function pollDiagDone(): void {
  // Check if sentinel file exists (tsc finished)
  let done: number = 0;
  if (existsSync(DIAG_DONE_FILE)) {
    done = 1;
  }

  if (done > 0) {
    diagRunning = 0;
    readDiagOutput();
  }
}

function readDiagOutput(): void {
  let output = '';
  try {
    output = readFileSync(DIAG_LOG_FILE);
  } catch (e: any) {
    return;
  }

  if (output.length < 1) return;

  // Quick hash to avoid redundant UI updates
  let h = 0;
  const len = output.length < 200 ? output.length : 200;
  for (let i = 0; i < len; i++) {
    h = ((h * 31) + output.charCodeAt(i)) | 0;
  }
  if (h === lastDiagHashVal && output.length === lastDiagHashLen) return;
  lastDiagHashVal = h;
  lastDiagHashLen = output.length;

  parseTscOutput(output);
  pushDiagnosticsToPanel();
}

function parseTscOutput(output: string): void {
  diagFiles = [];
  diagLines = [];
  diagMessages = [];
  diagSeverities = [];
  diagCount = 0;

  if (output.length < 1) return;

  // tsc output format: file(line,col): error TS1234: message
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 5) continue;

    // Find '(' for (line,col)
    let parenIdx = -1;
    for (let j = 0; j < line.length; j++) {
      if (line.charCodeAt(j) === 40) { parenIdx = j; break; }
    }
    if (parenIdx < 1) continue;

    // Find ')'
    let closeIdx = -1;
    for (let j = parenIdx + 1; j < line.length; j++) {
      if (line.charCodeAt(j) === 41) { closeIdx = j; break; }
    }
    if (closeIdx < 0) continue;

    // Find ": " after close paren
    let colonIdx = closeIdx + 1;
    if (colonIdx + 1 >= line.length) continue;
    if (line.charCodeAt(colonIdx) !== 58) continue; // ':'
    if (line.charCodeAt(colonIdx + 1) !== 32) continue; // ' '
    colonIdx = colonIdx + 2;

    // Determine severity from first char after ": "
    let severity = 'error';
    if (colonIdx < line.length && line.charCodeAt(colonIdx) === 119) { // 'w'
      severity = 'warning';
    }

    // Extract file path
    const filePath = line.slice(0, parenIdx);

    // Extract line number from (line,col)
    const locStr = line.slice(parenIdx + 1, closeIdx);
    let commaIdx = -1;
    for (let j = 0; j < locStr.length; j++) {
      if (locStr.charCodeAt(j) === 44) { commaIdx = j; break; }
    }
    let lineNum = 0;
    if (commaIdx > 0) {
      lineNum = parseInt(locStr.slice(0, commaIdx));
    }

    // Extract message after "error TSxxxx: " or "warning TSxxxx: "
    let msgStart = colonIdx;
    for (let j = colonIdx; j < line.length - 1; j++) {
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
}

function pushDiagnosticsToPanel(): void {
  let errorCount = 0;
  let warningCount = 0;
  for (let i = 0; i < diagCount; i++) {
    if (diagSeverities[i].charCodeAt(0) === 101) errorCount = errorCount + 1;
    if (diagSeverities[i].charCodeAt(0) === 119) warningCount = warningCount + 1;
  }
  updateDiagnostics(diagFiles, diagLines, diagMessages, diagSeverities, diagCount);
  callStatusUpdater(errorCount, warningCount);
}

function callStatusUpdater(errors: number, warnings: number): void {
  _statusUpdater(errors, warnings);
}

// ---------------------------------------------------------------------------
// Completions (keyword-based)
// ---------------------------------------------------------------------------

const TS_KEYWORDS = 'abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let module namespace never new null of package private protected public readonly return set static super switch this throw true try type typeof undefined var void while with yield';

export function getCompletions(prefix: string, filePath: string): string[] {
  if (prefix.length < 1) return [];
  const results: string[] = [];
  let resultCount = 0;
  const keywords = TS_KEYWORDS.split(' ');
  for (let i = 0; i < keywords.length; i++) {
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

// Trigger immediate diagnostics (called on file save)
export function triggerDiagnostics(): void {
  if (lspReady < 1) return;
  lspTickCount = 600; // Will trigger on next tick cycle
}
