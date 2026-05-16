/**
 * Claude Code subprocess manager.
 *
 * Spawns `claude` CLI as a background process with --output-format stream-json,
 * redirects output to a log file, and polls the file incrementally for new
 * NDJSON lines. This is the same pattern as lsp-bridge.ts (spawnBackground + poll).
 *
 * All state is module-level (Perry closures capture by value).
 */

import { spawnBackground, spawnSync } from 'child_process';

// Platform constant — 0=macOS, 1=iOS, 3=Windows, 4=Linux, 5=web.
declare const __platform__: number;
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { getAppDataDir, getHomeDir } from '../../paths';
import { setClaudeError, resetClaudeState, setClaudeStarting } from './claude-state';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let claudeHandleId: number = 0;       // from spawnBackground
let claudePid: number = 0;            // process ID
let claudeLogFile = '';                // output file path
let claudeLastOffset: number = 0;     // byte offset for incremental reads
let claudeResumeId = '';              // for --resume
let claudeAlive: number = 0;          // 1 = process running
let claudeBinaryPath = '';            // cached path to claude binary
let claudeBinaryChecked: number = 0;  // 1 = already looked up

// ---------------------------------------------------------------------------
// Binary discovery
// ---------------------------------------------------------------------------

/**
 * Find the claude CLI binary. Tries common paths.
 * Returns path or empty string if not found.
 */
export function findClaudeBinary(): string {
  if (claudeBinaryChecked > 0) return claudeBinaryPath;
  claudeBinaryChecked = 1;

  // SHIP-V1-GAPS.md followup §5: cross-platform `which`. POSIX `which`,
  // Windows `where`. Both print the first hit on stdout.
  try {
    const lookup = __platform__ === 3 ? 'where' : 'which';
    const r = spawnSync(lookup, ['claude']);
    if (r.status === 0 && r.stdout.length > 0) {
      let path = '';
      for (let i = 0; i < r.stdout.length; i++) {
        const ch = r.stdout.charCodeAt(i);
        if (ch === 10 || ch === 13) break;
        path += r.stdout.slice(i, i + 1);
      }
      if (path.length > 3) {
        claudeBinaryPath = path;
        return path;
      }
    }
  } catch (e) {}

  // Try common locations per platform.
  const home = getHomeDir();
  const paths: string[] = [];
  if (__platform__ === 3) {
    // Windows npm global goes under %APPDATA% by default. Add a few common
    // installer locations.
    if (home.length > 0) {
      paths.push(home + '/AppData/Roaming/npm/claude.cmd');
      paths.push(home + '/AppData/Roaming/npm/claude.exe');
      paths.push(home + '/.npm-global/claude.cmd');
      paths.push(home + '/.claude/local/claude.cmd');
    }
  } else {
    paths.push('/usr/local/bin/claude');
    paths.push('/opt/homebrew/bin/claude');
    if (home.length > 0) {
      paths.push(home + '/.npm-global/bin/claude');
      paths.push(home + '/.claude/local/claude');
    }
  }
  for (let i = 0; i < paths.length; i++) {
    try {
      if (existsSync(paths[i])) {
        claudeBinaryPath = paths[i];
        return paths[i];
      }
    } catch (e) {}
  }

  claudeBinaryPath = '';
  return '';
}

/**
 * Check if Claude Code is authenticated.
 * Runs `claude auth status` and checks exit code.
 * Returns 1 if authenticated, 0 if not.
 */
export function checkClaudeAuth(): number {
  const bin = findClaudeBinary();
  if (bin.length < 3) return 0;
  // SHIP-V1-GAPS.md followup §5: argv-form so a space-containing `bin`
  // doesn't shell-break. POSIX can exec the binary directly (argv-form is
  // already injection-safe). Windows CANNOT: `findClaudeBinary` returns
  // `claude.cmd` (the npm-global shim — the normal install), and neither
  // the Rust process API nor Node can execute a .cmd/.bat directly — it
  // must go through `cmd.exe /c` with the (usually space-containing) path
  // quoted, exactly like the session-spawn path below. The prior direct
  // `spawnSync(bin, ...)` always failed on a normal Windows install, so
  // Hone reported "Claude Code not authenticated" even when it was, which
  // silently disabled the entire AI chat feature on Windows.
  try {
    if (__platform__ === 3) {
      const rw = spawnSync('cmd.exe', ['/c', shellEscape(bin) + ' auth status']);
      if (rw.status === 0) return 1;
      return 0;
    }
    const r = spawnSync(bin, ['auth', 'status']);
    if (r.status === 0) return 1;
    return 0;
  } catch (e) {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Build the log file path for a Claude Code session.
 */
function makeLogPath(sessionTag: string): string {
  let p = getAppDataDir();
  p += '/claude-session-';
  p += sessionTag;
  p += '.log';
  return p;
}

/**
 * Shell-escape a string for safe embedding in shell commands.
 * SHIP-V1-GAPS.md followup §5: per-platform quoting. POSIX wraps in single
 * quotes (which preserve everything literally except `'`). Windows cmd.exe
 * has no single-quote semantics — wraps in double quotes and escapes
 * embedded double-quotes by doubling them (`""`). The string we build here
 * is piped through `cmd.exe /c` on Windows so it MUST follow cmd quoting.
 */
function shellEscape(s: string): string {
  if (__platform__ === 3) {
    let result = '"';
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      if (ch === 34) result += '""';
      else result += s.slice(i, i + 1);
    }
    result += '"';
    return result;
  }
  let result = "'";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 39) {
      result += "'\\''";
    } else {
      result += s.slice(i, i + 1);
    }
  }
  result += "'";
  return result;
}

/**
 * Start a new Claude Code session.
 *
 * @param prompt - User's prompt text
 * @param workspaceRoot - Workspace root directory
 * @param resumeId - Optional session ID to resume (from previous session)
 * @param logFilePath - Log file path (caller generates this so it can poll directly)
 * @param model - Optional model override (empty = use default)
 * @param permissionMode - Permission mode (empty = 'acceptEdits')
 * @param maxTurns - Max turns (0 = use default 25)
 */
export function startClaudeSession(prompt: string, workspaceRoot: string, resumeId: string, logFilePath: string, model: string, permissionMode: string, maxTurns: number): number {
  const bin = findClaudeBinary();
  if (bin.length < 3) {
    setClaudeError('Claude Code not found. Install: npm install -g @anthropic-ai/claude-code');
    return 0;
  }

  // Clean up any previous session
  stopClaudeSession();
  resetClaudeState();
  setClaudeStarting();

  // Use caller-provided log file path
  claudeLogFile = logFilePath;

  // Build a session tag for the prompt file
  const sessionTag = String(Date.now());

  // Write prompt to a temp file to avoid shell injection
  let promptFile = getAppDataDir();
  promptFile += '/claude-prompt-';
  promptFile += sessionTag;
  promptFile += '.txt';
  try {
    writeFileSync(promptFile, prompt);
  } catch (e) {
    setClaudeError('Failed to write prompt file');
    return 0;
  }

  // Build the shell command. Unset CLAUDECODE to prevent "nested session"
  // error if Hone was launched from Claude Code.
  //
  // Platform branches:
  // - POSIX: `unset CLAUDECODE;` clears the env var; `$(cat <file>)` substitutes
  //   the prompt content from a temp file, avoiding argv-size limits and any
  //   need to escape newlines/quotes in long prompts.
  // - Windows cmd.exe: `unset` and `$(...)` don't exist. Use `set "VAR="` to
  //   clear, and inline the prompt via shellEscape (which on Windows wraps in
  //   double quotes and doubles internal `"`s). Note: cmd.exe argv length is
  //   capped at ~8192 chars total, so prompts approaching that size may fail
  //   on Windows where they would have succeeded on POSIX (the cat indirection
  //   avoids this on POSIX). For typical chat prompts this is not a concern.
  let cmd = '';
  if (__platform__ === 3) {
    cmd = 'set "CLAUDECODE=" && ';
    cmd += shellEscape(bin);
    cmd += ' -p ';
    cmd += shellEscape(prompt);
  } else {
    cmd = 'unset CLAUDECODE; ';
    cmd += shellEscape(bin);
    cmd += ' -p "$(cat ';
    cmd += shellEscape(promptFile);
    cmd += ')"';
  }
  cmd += ' --output-format stream-json';
  cmd += ' --verbose';

  if (maxTurns > 0) {
    cmd += ' --max-turns ';
    cmd += String(maxTurns);
  } else {
    cmd += ' --max-turns 25';
  }

  if (permissionMode.length > 0) {
    cmd += ' --permission-mode ';
    cmd += shellEscape(permissionMode);
  } else {
    cmd += ' --permission-mode acceptEdits';
  }

  if (model.length > 0) {
    cmd += ' --model ';
    cmd += shellEscape(model);
  }

  if (workspaceRoot.length > 0) {
    cmd += ' --add-dir ';
    cmd += shellEscape(workspaceRoot);
  }

  if (resumeId.length > 0) {
    cmd += ' --resume ';
    cmd += shellEscape(resumeId);
    claudeResumeId = resumeId;
  }

  // Redirect output to log file
  cmd += ' > ';
  cmd += shellEscape(claudeLogFile);
  cmd += ' 2>&1';

  // SHIP-V1-GAPS.md followup §5: per-platform shell + null-device.
  const shellBin = __platform__ === 3 ? 'cmd.exe' : '/bin/sh';
  const shellArg = __platform__ === 3 ? '/c' : '-c';
  const nullDev = __platform__ === 3 ? 'NUL' : '/dev/null';
  const result = spawnBackground(shellBin, [shellArg, cmd], nullDev);
  claudePid = result.pid;
  claudeHandleId = result.handleId;

  if (claudePid < 1) {
    setClaudeError('Failed to spawn Claude Code process');
    claudeAlive = 0;
    claudeHandleId = 0;
    return 0;
  }

  claudeAlive = 1;
  claudeLastOffset = 0;

  // NOTE: Polling is driven by chat-panel.ts setInterval (same-module pattern).
  // Do NOT start setInterval here — Perry setInterval from cross-module calls may not fire.

  // Clean up prompt file after a delay (give process time to read it)
  setTimeout(() => { cleanupPromptFile(promptFile); }, 10000);

  return claudePid;
}

function cleanupPromptFile(path: string): void {
  try { unlinkSync(path); } catch (e) {}
}

/**
 * Stop the current Claude Code session.
 */
export function stopClaudeSession(): void {
  if (claudeAlive > 0 && claudePid > 0) {
    // SHIP-V1-GAPS.md followup §5: cross-platform kill.
    try {
      const pidStr = String(claudePid);
      if (__platform__ === 3) {
        spawnSync('taskkill', ['/F', '/PID', pidStr]);
      } else {
        spawnSync('kill', [pidStr]);
      }
    } catch (e) {}
  }
  claudeAlive = 0;
  claudeHandleId = 0;
  claudePid = 0;

  // Clean up log file
  if (claudeLogFile.length > 0) {
    try { unlinkSync(claudeLogFile); } catch (e) {}
    claudeLogFile = '';
  }
  claudeLastOffset = 0;
}

/**
 * Check if the Claude process is still running.
 */
export function isClaudeAlive(): number {
  return claudeAlive;
}

/**
 * Get the current resume session ID (set after system event received).
 */
export function getClaudeResumeId(): string {
  return claudeResumeId;
}

export function setClaudeResumeId(id: string): void {
  claudeResumeId = id;
}

// NOTE: Log file polling is now done entirely in chat-panel.ts (same-module pattern).
// claude-process.ts only manages the subprocess lifecycle.
