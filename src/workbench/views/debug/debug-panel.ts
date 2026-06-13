/**
 * Debug panel — breakpoints, variables, call stack, output, stepping controls.
 *
 * debugStart() detects file language and runs the program via execSync on
 * a background thread (spawn). Output is displayed in the output section.
 * Error stack traces are parsed into the call stack section.
 *
 * Perry-safe: module-level state, no closures on `this`, no optional chaining,
 * no for...of, no shorthand properties, no dynamic key access.
 */
import {
  VStack, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight, textSetFontFamily, textSetString,
  buttonSetBordered, buttonSetImagePosition,
  widgetAddChild, widgetClearChildren,
  widgetSetBackgroundColor,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { execText } from '../../../process-compat';
import { existsSync } from 'fs';
import { spawn } from 'perry/thread';
import { setFg, setBtnFg, setBtnTint, monoFont, setIconButton } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getStatusAddedColor, getStatusDeletedColor, getSecondaryTextColor } from '../../theme/theme-colors';
import { getTempDir } from '../../paths';

// Platform constant — 0=macOS, 1=iOS, 3=Windows, 4=Linux, 5=web.
declare const __platform__: number;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let debugReady: number = 0;
let debugRunning: number = 0;
let debugPaused: number = 0;
// True while the background execSync thread is still blocked on the child
// process (it returns only when the child exits). `debugStop()` cannot
// actually kill the child (execSync captures no PID), so it must NOT clear
// this — otherwise Run→Stop→Run on a long-lived program (a dev server,
// `cargo run`, a REPL) re-passes the debugRunning guard and spawns ANOTHER
// orphan copy each time, accumulating unkillable processes. Cleared only
// in onRunComplete, i.e. when the child has genuinely exited. Real
// stop/kill needs the spawnBackground+PID rearchitecture noted in #11 (v1.1).
let _debugThreadInFlight: number = 0;
let debugWorkspaceRoot: string = '';

// Breakpoints: parallel arrays
let bpFiles: string[] = [];
let bpLines: number[] = [];
let bpCount: number = 0;

// Variables when paused
let varNames: string[] = [];
let varValues: string[] = [];
let varCount: number = 0;

// Call stack when paused
let stackFrames: string[] = [];
let stackFiles: string[] = [];
let stackLines: number[] = [];
let stackCount: number = 0;

// Output from last run
let outputLines: string[] = [];
let outputLineCount: number = 0;
let lastExitCode: number = -1;
let lastRunFile: string = '';

// UI refs
let bpContainer: unknown = null;
let varContainer: unknown = null;
let csContainer: unknown = null;
let outputContainer: unknown = null;
let statusLabel: unknown = null;
let statusText: unknown = null;
let panelColors: ResolvedUIColors = null as any;

// Callbacks (set from render.ts)
let _onBreakpointToggle: (file: string, line: number) => void = () => {};
let _onFileOpen: (file: string, line: number) => void = () => {};
let _getCurrentFilePath: () => string = () => { return ''; };

export function setDebugWorkspaceRoot(root: string): void {
  debugWorkspaceRoot = root;
}

export function setDebugBreakpointToggle(fn: (file: string, line: number) => void): void {
  _onBreakpointToggle = fn;
}

export function setDebugFileOpener(fn: (file: string, line: number) => void): void {
  _onFileOpen = fn;
}

export function setDebugCurrentFilePath(fn: () => string): void {
  _getCurrentFilePath = fn;
}

export function resetDebugPanelReady(): void {
  debugReady = 0;
  bpContainer = null;
  varContainer = null;
  csContainer = null;
  outputContainer = null;
  statusLabel = null;
  statusText = null;
}

// ---------------------------------------------------------------------------
// Breakpoint management
// ---------------------------------------------------------------------------

export function addBreakpoint(file: string, line: number): void {
  // Check if already exists
  for (let i = 0; i < bpCount; i = i + 1) {
    if (bpLines[i] === line) {
      // Same line — compare files
      const bf = bpFiles[i];
      if (bf.length === file.length) {
        let match = 1;
        for (let c = 0; c < bf.length; c = c + 1) {
          if (bf.charCodeAt(c) !== file.charCodeAt(c)) { match = 0; break; }
        }
        if (match > 0) return; // Already exists
      }
    }
  }
  if (bpCount < 50) {
    bpFiles[bpCount] = file;
    bpLines[bpCount] = line;
    bpCount = bpCount + 1;
    updateBreakpointsUI();
  }
}

export function removeBreakpoint(file: string, line: number): void {
  for (let i = 0; i < bpCount; i = i + 1) {
    if (bpLines[i] === line) {
      const bf = bpFiles[i];
      if (bf.length === file.length) {
        let match = 1;
        for (let c = 0; c < bf.length; c = c + 1) {
          if (bf.charCodeAt(c) !== file.charCodeAt(c)) { match = 0; break; }
        }
        if (match > 0) {
          // Remove by shifting
          for (let j = i; j < bpCount - 1; j = j + 1) {
            bpFiles[j] = bpFiles[j + 1];
            bpLines[j] = bpLines[j + 1];
          }
          bpCount = bpCount - 1;
          updateBreakpointsUI();
          return;
        }
      }
    }
  }
}

export function getBreakpointLines(file: string): number[] {
  const result: number[] = [];
  let count = 0;
  for (let i = 0; i < bpCount; i = i + 1) {
    const bf = bpFiles[i];
    if (bf.length === file.length) {
      let match = 1;
      for (let c = 0; c < bf.length; c = c + 1) {
        if (bf.charCodeAt(c) !== file.charCodeAt(c)) { match = 0; break; }
      }
      if (match > 0) {
        result[count] = bpLines[i];
        count = count + 1;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Language detection & command building
// ---------------------------------------------------------------------------

/** Extract file extension from path (after last '.') */
function getFileExtension(filePath: string): string {
  let dotPos = -1;
  for (let i = filePath.length - 1; i >= 0; i = i - 1) {
    if (filePath.charCodeAt(i) === 46) { dotPos = i; break; }
    // Stop at path separator
    if (filePath.charCodeAt(i) === 47) break;
  }
  if (dotPos < 0) return '';
  return filePath.slice(dotPos + 1);
}

/** Extract directory from file path (everything before last '/') */
function getFileDir(filePath: string): string {
  let lastSlash = -1;
  for (let i = filePath.length - 1; i >= 0; i = i - 1) {
    if (filePath.charCodeAt(i) === 47) { lastSlash = i; break; }
  }
  if (lastSlash < 0) return '.';
  return filePath.slice(0, lastSlash);
}

/** Check if a string equals another (charCodeAt comparison for Perry safety) */
function strEq(a: string, b: string): number {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i = i + 1) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return 0;
  }
  return 1;
}

/**
 * Walk up from dir looking for Cargo.toml.
 * Returns the directory containing Cargo.toml, or '' if not found.
 */
function findCargoRoot(startDir: string): string {
  let dir = startDir;
  // Walk up at most 10 levels
  for (let depth = 0; depth < 10; depth = depth + 1) {
    let checkPath = dir;
    checkPath += '/Cargo.toml';
    if (existsSync(checkPath)) {
      return dir;
    }
    // Go up one directory
    let lastSlash = -1;
    for (let i = dir.length - 1; i >= 0; i = i - 1) {
      if (dir.charCodeAt(i) === 47) { lastSlash = i; break; }
    }
    if (lastSlash <= 0) break;
    dir = dir.slice(0, lastSlash);
  }
  return '';
}

/** Build the shell command to run a file based on its extension.
 *
 * Path quoting: every interpolated path (filePath, cargoRoot, debugBin) is
 * wrapped in double quotes. Workspace paths frequently contain spaces on
 * every desktop OS (`C:\Users\Foo\My Projects\...`, `~/Library/...`,
 * `/Users/Foo Bar/...`). Double quotes preserve the path as one argv slot in
 * both cmd.exe and POSIX `/bin/sh`. We don't need to escape `$` or backtick
 * inside the quotes here because filesystem paths essentially never contain
 * them. If they did, those characters would already trigger their own
 * pathological POSIX behavior — out of scope for the run-file feature.
 */
function buildRunCommand(filePath: string, ext: string): string {
  const qFile = '"' + filePath + '"';
  // TypeScript
  if (strEq(ext, 'ts') > 0) {
    let cmd = 'bun run ';
    cmd += qFile;
    return cmd;
  }
  // JavaScript
  if (strEq(ext, 'js') > 0) {
    let cmd = 'bun run ';
    cmd += qFile;
    return cmd;
  }
  // JSX / TSX
  if (strEq(ext, 'tsx') > 0 || strEq(ext, 'jsx') > 0) {
    let cmd = 'bun run ';
    cmd += qFile;
    return cmd;
  }
  // Python — Windows usually has `python` (not `python3`); Unix typically
  // has `python3`. Best-effort: probe via `findExecutableOnPath`... actually
  // simpler: `python` resolves on both (Windows Python launcher provides it,
  // macOS Big Sur+ links python3 → python).
  if (strEq(ext, 'py') > 0) {
    let cmd = 'python3 ';
    if (__platform__ === 3) cmd = 'python ';
    cmd += qFile;
    return cmd;
  }
  // Go
  if (strEq(ext, 'go') > 0) {
    let cmd = 'go run ';
    cmd += qFile;
    return cmd;
  }
  // SHIP-V1-GAPS.md followup §5: cross-platform debug-build output path.
  // `/tmp/hone-debug-bin` is POSIX-only; Windows uses `%TEMP%\hone-debug-bin.exe`.
  // Perry-safe: assemble strings with if/else instead of ternary on strings.
  let debugBin = getTempDir();
  if (__platform__ === 3) debugBin += '/hone-debug-bin.exe';
  else debugBin += '/hone-debug-bin';
  const qBin = '"' + debugBin + '"';
  // `cd` works in both shells; Windows needs `/d` to also switch drives.
  let cdFlag = 'cd ';
  if (__platform__ === 3) cdFlag = 'cd /d ';

  // Rust
  if (strEq(ext, 'rs') > 0) {
    const dir = getFileDir(filePath);
    const cargoRoot = findCargoRoot(dir);
    if (cargoRoot.length > 0) {
      let cmd = cdFlag;
      cmd += '"';
      cmd += cargoRoot;
      cmd += '"';
      cmd += ' && cargo run 2>&1';
      return cmd;
    }
    let cmd = 'rustc ';
    cmd += qFile;
    cmd += ' -o ';
    cmd += qBin;
    cmd += ' && ';
    cmd += qBin;
    return cmd;
  }
  // C
  if (strEq(ext, 'c') > 0) {
    let cmd = 'cc ';
    cmd += qFile;
    cmd += ' -o ';
    cmd += qBin;
    cmd += ' && ';
    cmd += qBin;
    return cmd;
  }
  // C++
  if (strEq(ext, 'cpp') > 0 || strEq(ext, 'cc') > 0 || strEq(ext, 'cxx') > 0) {
    let cmd = 'c++ ';
    cmd += qFile;
    cmd += ' -o ';
    cmd += qBin;
    cmd += ' && ';
    cmd += qBin;
    return cmd;
  }
  // Shell — `bash` on Unix; on Windows we use Git for Windows's bash if
  // available (env-resolved), else WSL `sh`.
  if (strEq(ext, 'sh') > 0) {
    let cmd = 'bash ';
    cmd += qFile;
    return cmd;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Stack trace parsing
// ---------------------------------------------------------------------------

/**
 * Parse error output for stack trace entries.
 * Looks for common patterns:
 *   - Node/Bun: "    at functionName (file:line:col)"  or  "    at file:line:col"
 *   - Python:   '  File "file", line N, in funcName'
 *   - Go:       "file.go:line"
 *   - Rust:     "file.rs:line"
 *
 * Populates stackFrames/stackFiles/stackLines module-level arrays.
 */
function parseStackTrace(output: string): void {
  stackCount = 0;
  let lineStart = 0;
  for (let i = 0; i <= output.length; i = i + 1) {
    if (i === output.length || output.charCodeAt(i) === 10) {
      if (i > lineStart && stackCount < 20) {
        const line = output.slice(lineStart, i);
        parseOneStackLine(line);
      }
      lineStart = i + 1;
    }
  }
}

function parseOneStackLine(line: string): void {
  // Node/Bun pattern: "    at <name> (<file>:<line>:<col>)"
  // or                "    at <file>:<line>:<col>"
  const atIdx = findSubstring(line, '    at ');
  if (atIdx >= 0) {
    parseJsStackLine(line, atIdx + 7);
    return;
  }

  // Python pattern: '  File "<file>", line <N>, in <name>'
  const pyFileIdx = findSubstring(line, '  File "');
  if (pyFileIdx >= 0) {
    parsePyStackLine(line, pyFileIdx + 8);
    return;
  }
}

function findSubstring(haystack: string, needle: string): number {
  if (needle.length > haystack.length) return -1;
  const limit = haystack.length - needle.length;
  for (let i = 0; i <= limit; i = i + 1) {
    let match = 1;
    for (let j = 0; j < needle.length; j = j + 1) {
      if (haystack.charCodeAt(i + j) !== needle.charCodeAt(j)) { match = 0; break; }
    }
    if (match > 0) return i;
  }
  return -1;
}

function parseJsStackLine(line: string, start: number): void {
  // Check if there's a '(' indicating "at name (file:line:col)"
  let parenIdx = -1;
  for (let i = start; i < line.length; i = i + 1) {
    if (line.charCodeAt(i) === 40) { parenIdx = i; break; }
  }

  let funcName = t('<anonymous>');
  let fileAndLoc = '';

  if (parenIdx > start) {
    // "at funcName (file:line:col)"
    funcName = line.slice(start, parenIdx - 1);
    // Find closing paren
    let closeIdx = line.length;
    for (let i = parenIdx + 1; i < line.length; i = i + 1) {
      if (line.charCodeAt(i) === 41) { closeIdx = i; break; }
    }
    fileAndLoc = line.slice(parenIdx + 1, closeIdx);
  } else {
    // "at file:line:col"
    fileAndLoc = line.slice(start);
  }

  // Parse file:line from fileAndLoc — find first ':' followed by a digit
  let colonIdx = -1;
  for (let i = 0; i < fileAndLoc.length - 1; i = i + 1) {
    if (fileAndLoc.charCodeAt(i) === 58) {
      const nextChar = fileAndLoc.charCodeAt(i + 1);
      // Check if next char is a digit (48-57)
      if (nextChar >= 48 && nextChar <= 57) {
        colonIdx = i;
        break;
      }
    }
  }

  if (colonIdx < 1) return;

  const file = fileAndLoc.slice(0, colonIdx);
  // Parse line number after colon
  let lineNum = 0;
  for (let i = colonIdx + 1; i < fileAndLoc.length; i = i + 1) {
    const ch = fileAndLoc.charCodeAt(i);
    if (ch >= 48 && ch <= 57) {
      lineNum = lineNum * 10 + (ch - 48);
    } else {
      break;
    }
  }

  if (lineNum > 0 && stackCount < 20) {
    stackFrames[stackCount] = funcName;
    stackFiles[stackCount] = file;
    stackLines[stackCount] = lineNum;
    stackCount = stackCount + 1;
  }
}

function parsePyStackLine(line: string, start: number): void {
  // Find closing quote after file path
  let quoteIdx = -1;
  for (let i = start; i < line.length; i = i + 1) {
    if (line.charCodeAt(i) === 34) { quoteIdx = i; break; }
  }
  if (quoteIdx < 0) return;

  const file = line.slice(start, quoteIdx);

  // Find ", line " after the closing quote
  const lineMarker = ', line ';
  let lineMarkerIdx = findSubstring(line, lineMarker);
  if (lineMarkerIdx < 0) return;
  let numStart = lineMarkerIdx + lineMarker.length;

  // Parse line number
  let lineNum = 0;
  for (let i = numStart; i < line.length; i = i + 1) {
    const ch = line.charCodeAt(i);
    if (ch >= 48 && ch <= 57) {
      lineNum = lineNum * 10 + (ch - 48);
    } else {
      break;
    }
  }

  // Find ", in " for function name
  let funcName = t('<module>');
  const inMarker = ', in ';
  let inIdx = findSubstring(line, inMarker);
  if (inIdx > numStart) {
    funcName = line.slice(inIdx + inMarker.length);
    // Trim trailing whitespace/CR
    let end = funcName.length;
    for (let i = funcName.length - 1; i >= 0; i = i - 1) {
      const ch = funcName.charCodeAt(i);
      if (ch === 32 || ch === 13 || ch === 10) {
        end = i;
      } else {
        break;
      }
    }
    if (end < funcName.length) {
      funcName = funcName.slice(0, end);
    }
  }

  if (lineNum > 0 && stackCount < 20) {
    stackFrames[stackCount] = funcName;
    stackFiles[stackCount] = file;
    stackLines[stackCount] = lineNum;
    stackCount = stackCount + 1;
  }
}

// ---------------------------------------------------------------------------
// Output parsing — split into lines
// ---------------------------------------------------------------------------

function parseOutputLines(output: string): void {
  outputLineCount = 0;
  let lineStart = 0;
  for (let i = 0; i <= output.length; i = i + 1) {
    if (i === output.length || output.charCodeAt(i) === 10) {
      if (outputLineCount < 500) {
        // Trim trailing CR
        let lineEnd = i;
        if (lineEnd > lineStart && output.charCodeAt(lineEnd - 1) === 13) {
          lineEnd = lineEnd - 1;
        }
        outputLines[outputLineCount] = output.slice(lineStart, lineEnd);
        outputLineCount = outputLineCount + 1;
      }
      lineStart = i + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Debug session control
// ---------------------------------------------------------------------------

function debugStart(): void {
  if (debugRunning > 0) return;
  // A previous run's child may still be alive even though debugRunning was
  // cleared by debugStop(). Refuse to spawn another — otherwise orphans
  // accumulate (see _debugThreadInFlight). Tell the user why.
  if (_debugThreadInFlight > 0) {
    outputLineCount = 0;
    outputLines[0] = t('Previous program is still running in the background (it cannot be force-stopped in v1). Wait for it to exit before running again.');
    outputLineCount = 1;
    updateOutputUI();
    return;
  }

  // Get current file path
  const filePath = _getCurrentFilePath();
  if (filePath.length < 1) {
    // No file open — show error in output
    outputLineCount = 0;
    outputLines[0] = t('No file open. Open a file to run it.');
    outputLineCount = 1;
    lastExitCode = -1;
    updateOutputUI();
    return;
  }

  // Detect file extension
  const ext = getFileExtension(filePath);
  if (ext.length < 1) {
    outputLineCount = 0;
    outputLines[0] = t('Cannot detect file type — no file extension.');
    outputLineCount = 1;
    lastExitCode = -1;
    updateOutputUI();
    return;
  }

  // Build run command
  const cmd = buildRunCommand(filePath, ext);
  if (cmd.length < 1) {
    outputLineCount = 0;
    let msg = t('Unsupported file type: .');
    msg += ext;
    outputLines[0] = msg;
    outputLineCount = 1;
    lastExitCode = -1;
    updateOutputUI();
    return;
  }

  // Update state to running
  debugRunning = 1;
  debugPaused = 0;
  lastRunFile = filePath;
  outputLineCount = 0;
  stackCount = 0;
  varCount = 0;

  // Show "Running..." in output
  let runningMsg = t('Running: ');
  runningMsg += cmd;
  outputLines[0] = runningMsg;
  outputLineCount = 1;
  outputLines[1] = '';
  outputLineCount = 2;

  updateStatusUI();
  updateOutputUI();
  updateVariablesUI();
  updateCallStackUI();

  // Run on background thread. Mark in-flight BEFORE spawn so a racing
  // debugStart can't slip a second child through.
  _debugThreadInFlight = 1;
  const cmdToRun = cmd;
  spawn(() => {
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    // execSync returns stdout; stderr goes to the error on failure
    // We redirect stderr to stdout with 2>&1 to capture everything
    let fullCmd = cmdToRun;
    // Only append 2>&1 if not already present
    let has2to1 = 0;
    const marker = '2>&1';
    if (fullCmd.length >= marker.length) {
      const tail = fullCmd.slice(fullCmd.length - marker.length);
      if (tail.length === marker.length) {
        let tailMatch = 1;
        for (let t = 0; t < tail.length; t = t + 1) {
          if (tail.charCodeAt(t) !== marker.charCodeAt(t)) { tailMatch = 0; break; }
        }
        if (tailMatch > 0) has2to1 = 1;
      }
    }
    if (has2to1 < 1) {
      fullCmd += ' 2>&1';
    }

    try {
      stdout = execText(fullCmd) as unknown as string;
      exitCode = 0;
    } catch (e: any) {
      // On non-zero exit, execSync throws. Try to get output from error.
      exitCode = 1;
      if (e) {
        // Perry: access error message
        const errMsg = String(e);
        if (errMsg.length > 0) {
          stderr = errMsg;
        }
      }
    }

    return {
      stdout: stdout,
      stderr: stderr,
      exitCode: exitCode,
    };
  }).then((result) => { onRunComplete(result); });
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function onRunComplete(result: RunResult): void {
  debugRunning = 0;
  debugPaused = 0;
  // Child has genuinely exited (execSync returned) — clear the in-flight
  // guard so the user can run again.
  _debugThreadInFlight = 0;

  // Combine output
  let fullOutput = '';
  if (result.stdout.length > 0) {
    fullOutput += result.stdout;
  }
  if (result.stderr.length > 0) {
    if (fullOutput.length > 0) {
      fullOutput += '\n';
    }
    fullOutput += result.stderr;
  }

  lastExitCode = result.exitCode;

  // Parse output into display lines
  parseOutputLines(fullOutput);

  // Add exit status line
  if (outputLineCount < 500) {
    if (outputLineCount > 0) {
      // Add blank line before status
      outputLines[outputLineCount] = '';
      outputLineCount = outputLineCount + 1;
    }
    if (result.exitCode === 0) {
      outputLines[outputLineCount] = t('Process exited with code 0');
    } else {
      let exitMsg = t('Process exited with code ');
      exitMsg += String(result.exitCode);
      outputLines[outputLineCount] = exitMsg;
    }
    outputLineCount = outputLineCount + 1;
  }

  // Parse stack traces from error output
  if (result.exitCode !== 0) {
    parseStackTrace(fullOutput);
  }

  updateStatusUI();
  updateOutputUI();
  updateCallStackUI();
  updateVariablesUI();
}

function debugPause(): void {
  if (debugRunning < 1) return;
  debugPaused = 1;
  updateStatusUI();
}

function debugContinue(): void {
  if (debugRunning < 1) return;
  debugPaused = 0;
  varCount = 0;
  stackCount = 0;
  updateVariablesUI();
  updateCallStackUI();
  updateStatusUI();
}

function debugStepOver(): void {
  if (debugPaused < 1) return;
  // In a real implementation, send DAP next request
}

function debugStepInto(): void {
  if (debugPaused < 1) return;
  // In a real implementation, send DAP stepIn request
}

function debugStepOut(): void {
  if (debugPaused < 1) return;
  // In a real implementation, send DAP stepOut request
}

function debugStop(): void {
  debugRunning = 0;
  debugPaused = 0;
  varCount = 0;
  stackCount = 0;
  // Be honest: with the execSync model there is no PID to kill, so the
  // child keeps running until it exits on its own. Say so rather than
  // letting the cleared "Running..." status imply it was actually stopped.
  // (#11 honest-framing; real kill needs the spawnBackground+PID v1.1 work.)
  if (_debugThreadInFlight > 0) {
    if (outputLineCount < outputLines.length) {
      outputLines[outputLineCount] = t('[Stop pressed — the program keeps running in the background until it exits; it cannot be force-killed in v1.]');
      outputLineCount = outputLineCount + 1;
      updateOutputUI();
    }
  }
  updateVariablesUI();
  updateCallStackUI();
  updateStatusUI();
}

// ---------------------------------------------------------------------------
// UI rendering
// ---------------------------------------------------------------------------

function updateBreakpointsUI(): void {
  if (debugReady < 1 || !bpContainer) return;
  widgetClearChildren(bpContainer);

  if (bpCount < 1) {
    const hint = Text(t('No breakpoints set'));
    textSetFontSize(hint, 11);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(bpContainer, hint);
    return;
  }

  for (let i = 0; i < bpCount; i = i + 1) {
    const file = bpFiles[i];
    const line = bpLines[i];

    // Extract filename
    let lastSlash = -1;
    for (let j = file.length - 1; j >= 0; j = j - 1) {
      if (file.charCodeAt(j) === 47) { lastSlash = j; break; }
    }
    let name = file;
    if (lastSlash >= 0) name = file.slice(lastSlash + 1);

    let label = name;
    label += ':';
    label += String(line);

    const filePath = file;
    const lineNum = line;
    const bpBtn = Button(label, () => { openBreakpointFile(filePath, lineNum); });
    buttonSetBordered(bpBtn, 0);
    textSetFontSize(bpBtn, 11);
    setBtnFg(bpBtn, getSideBarForeground());
    widgetAddChild(bpContainer, bpBtn);
  }
}

function openBreakpointFile(file: string, line: number): void {
  _onFileOpen(file, line);
}

function updateVariablesUI(): void {
  if (debugReady < 1 || !varContainer) return;
  widgetClearChildren(varContainer);

  if (debugPaused < 1 || varCount < 1) {
    const hint = Text(debugRunning > 0 ? t('Running...') : t('Not started'));
    textSetFontSize(hint, 11);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(varContainer, hint);
    return;
  }

  for (let i = 0; i < varCount; i = i + 1) {
    let label = varNames[i];
    label += ' = ';
    label += varValues[i];
    const varLabel = Text(label);
    textSetFontSize(varLabel, 11);
    setFg(varLabel, getSideBarForeground());
    widgetAddChild(varContainer, varLabel);
  }
}

function updateCallStackUI(): void {
  if (debugReady < 1 || !csContainer) return;
  widgetClearChildren(csContainer);

  if (stackCount < 1) {
    let hintMsg = t('No call stack');
    if (debugRunning > 0) hintMsg = t('Running...');
    const hint = Text(hintMsg);
    textSetFontSize(hint, 11);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(csContainer, hint);
    return;
  }

  for (let i = 0; i < stackCount; i = i + 1) {
    let label = stackFrames[i];
    label += ' (';
    label += stackFiles[i];
    label += ':';
    label += String(stackLines[i]);
    label += ')';

    const frameFile = stackFiles[i];
    const frameLine = stackLines[i];
    const frameBtn = Button(label, () => { onStackFrameClick(frameFile, frameLine); });
    buttonSetBordered(frameBtn, 0);
    textSetFontSize(frameBtn, 11);
    textSetFontFamily(frameBtn, 11, monoFont());
    setBtnFg(frameBtn, getSideBarForeground());
    widgetAddChild(csContainer, frameBtn);
  }
}

function onStackFrameClick(file: string, line: number): void {
  _onFileOpen(file, line);
}

function updateOutputUI(): void {
  if (debugReady < 1 || !outputContainer) return;
  widgetClearChildren(outputContainer);

  if (outputLineCount < 1) {
    const hint = Text(t('No output'));
    textSetFontSize(hint, 11);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(outputContainer, hint);
    return;
  }

  // Limit to 100 displayed lines for performance
  let displayCount = outputLineCount;
  if (displayCount > 100) displayCount = 100;

  for (let i = 0; i < displayCount; i = i + 1) {
    const lineText = Text(outputLines[i]);
    textSetFontSize(lineText, 11);
    textSetFontFamily(lineText, 11, monoFont());

    // Color error lines (exit status, error keywords) differently
    let isErrorLine = 0;
    if (lastExitCode !== 0 && i === outputLineCount - 1) {
      isErrorLine = 1;
    }
    // Check if line starts with "Error" or contains common error markers
    if (outputLines[i].length >= 5) {
      const firstFive = outputLines[i].slice(0, 5);
      if (strEq(firstFive, 'Error') > 0) isErrorLine = 1;
    }
    if (outputLines[i].length >= 9) {
      const firstNine = outputLines[i].slice(0, 9);
      if (strEq(firstNine, 'TypeError') > 0) isErrorLine = 1;
    }
    if (outputLines[i].length >= 14) {
      const firstFourteen = outputLines[i].slice(0, 14);
      if (strEq(firstFourteen, 'ReferenceError') > 0) isErrorLine = 1;
    }
    if (outputLines[i].length >= 11) {
      const firstEleven = outputLines[i].slice(0, 11);
      if (strEq(firstEleven, 'SyntaxError') > 0) isErrorLine = 1;
    }
    // Python: "Traceback"
    if (outputLines[i].length >= 9) {
      const firstNineB = outputLines[i].slice(0, 9);
      if (strEq(firstNineB, 'Traceback') > 0) isErrorLine = 1;
    }

    if (isErrorLine > 0) {
      setFg(lineText, getStatusDeletedColor());
    } else {
      setFg(lineText, getSideBarForeground());
    }
    widgetAddChild(outputContainer, lineText);
  }

  if (outputLineCount > 100) {
    let truncMsg = '... (';
    truncMsg += String(outputLineCount - 100);
    truncMsg += ' more lines)';
    const truncLabel = Text(truncMsg);
    textSetFontSize(truncLabel, 11);
    setFg(truncLabel, getSecondaryTextColor());
    widgetAddChild(outputContainer, truncLabel);
  }
}

function updateStatusUI(): void {
  if (!statusText) return;
  if (debugRunning > 0) {
    textSetString(statusText, t('Running...'));
    setFg(statusText, getStatusAddedColor());
  } else if (lastExitCode === 0) {
    textSetString(statusText, t('Finished (exit 0)'));
    setFg(statusText, getStatusAddedColor());
  } else if (lastExitCode > 0) {
    let msg = t('Finished (exit ');
    msg += String(lastExitCode);
    msg += ')';
    textSetString(statusText, msg);
    setFg(statusText, getStatusDeletedColor());
  } else {
    textSetString(statusText, t('Ready'));
    setFg(statusText, getSecondaryTextColor());
  }
}

// ---------------------------------------------------------------------------
// Public render
// ---------------------------------------------------------------------------

export function renderDebugPanel(container: unknown, colors: ResolvedUIColors): void {
  panelColors = colors;
  debugReady = 0;

  // SHIP-V1-GAPS.md #11: this panel ships as "Run" in v1.0. Real DAP
  // (breakpoints, step over/in/out, variables, call stack live) is wired
  // through `hone-core/src/protocols/dap/` in code but the IDE doesn't yet
  // spawn an adapter or transport DAP messages. The buttons act on a local
  // `execText(buildRunCommand(...))` flow that runs the file without a
  // debugger attached. The "DAP wiring" item lands in v1.1; renaming the
  // panel header keeps the v1.0 framing honest.
  const title = Text(t('RUN'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  const subtitle = Text(t('Breakpoints + step controls are v1.1. Today this runs the file.'));
  textSetFontSize(subtitle, 10);
  setFg(subtitle, '#9999AA');
  widgetAddChild(container, subtitle);

  // Toolbar row with wired buttons
  const playBtn = Button('', () => { onPlayOrContinueClick(); });
  buttonSetBordered(playBtn, 0);
  setIconButton(playBtn, 'play.fill');
  buttonSetImagePosition(playBtn, 1);
  setBtnTint(playBtn, getStatusAddedColor());

  const pauseBtn = Button('', () => { debugPause(); });
  buttonSetBordered(pauseBtn, 0);
  setIconButton(pauseBtn, 'pause.fill');
  buttonSetImagePosition(pauseBtn, 1);
  setBtnTint(pauseBtn, colors.sideBarForeground);

  const stepOverBtn = Button('', () => { debugStepOver(); });
  buttonSetBordered(stepOverBtn, 0);
  setIconButton(stepOverBtn, 'arrow.right');
  buttonSetImagePosition(stepOverBtn, 1);
  setBtnTint(stepOverBtn, colors.sideBarForeground);

  const stepIntoBtn = Button('', () => { debugStepInto(); });
  buttonSetBordered(stepIntoBtn, 0);
  setIconButton(stepIntoBtn, 'arrow.down.right');
  buttonSetImagePosition(stepIntoBtn, 1);
  setBtnTint(stepIntoBtn, colors.sideBarForeground);

  const stepOutBtn = Button('', () => { debugStepOut(); });
  buttonSetBordered(stepOutBtn, 0);
  setIconButton(stepOutBtn, 'arrow.up.left');
  buttonSetImagePosition(stepOutBtn, 1);
  setBtnTint(stepOutBtn, colors.sideBarForeground);

  const stopBtn = Button('', () => { onStopClick(); });
  buttonSetBordered(stopBtn, 0);
  setIconButton(stopBtn, 'stop.fill');
  buttonSetImagePosition(stopBtn, 1);
  setBtnTint(stopBtn, getStatusDeletedColor());

  const toolbar = HStack(4, [playBtn, pauseBtn, stepOverBtn, stepIntoBtn, stepOutBtn, stopBtn]);
  widgetAddChild(container, toolbar);

  // Status line
  statusText = Text(t('Ready'));
  textSetFontSize(statusText, 11);
  setFg(statusText, getSecondaryTextColor());
  widgetAddChild(container, statusText);

  // Output section
  const outHeader = Text(t('OUTPUT'));
  textSetFontSize(outHeader, 10);
  textSetFontWeight(outHeader, 10, 0.6);
  setFg(outHeader, colors.sideBarForeground);
  widgetAddChild(container, outHeader);

  outputContainer = VStack(1, []);
  widgetSetBackgroundColor(outputContainer, 0.1, 0.1, 0.1, 1.0);
  widgetAddChild(container, outputContainer);

  // Breakpoints section
  const bpHeader = Text(t('BREAKPOINTS'));
  textSetFontSize(bpHeader, 10);
  textSetFontWeight(bpHeader, 10, 0.6);
  setFg(bpHeader, colors.sideBarForeground);
  widgetAddChild(container, bpHeader);

  bpContainer = VStack(1, []);
  widgetAddChild(container, bpContainer);

  // Call stack section
  const csHeader = Text(t('CALL STACK'));
  textSetFontSize(csHeader, 10);
  textSetFontWeight(csHeader, 10, 0.6);
  setFg(csHeader, colors.sideBarForeground);
  widgetAddChild(container, csHeader);

  csContainer = VStack(1, []);
  widgetAddChild(container, csContainer);

  // Variables section
  const varHeader = Text(t('VARIABLES'));
  textSetFontSize(varHeader, 10);
  textSetFontWeight(varHeader, 10, 0.6);
  setFg(varHeader, colors.sideBarForeground);
  widgetAddChild(container, varHeader);

  varContainer = VStack(1, []);
  widgetAddChild(container, varContainer);

  debugReady = 1;
  updateBreakpointsUI();
  updateVariablesUI();
  updateCallStackUI();
  updateOutputUI();
  updateStatusUI();

  widgetAddChild(container, Spacer());
}

// ---------------------------------------------------------------------------
// Button callbacks — use module-level named functions (Perry closure safety)
// ---------------------------------------------------------------------------

function onPlayOrContinueClick(): void {
  if (debugPaused > 0) {
    debugContinue();
  } else {
    debugStart();
  }
}

function onStopClick(): void {
  debugStop();
}
