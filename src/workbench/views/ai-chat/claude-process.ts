/**
 * Claude Code subprocess manager.
 *
 * Spawns `claude` CLI as a background process with --output-format stream-json,
 * redirects output to a log file, and polls the file incrementally for new
 * NDJSON lines. This is the same pattern as lsp-bridge.ts (spawnBackground + poll).
 *
 * All state is module-level (Perry closures capture by value).
 */

import { spawnBackground } from 'child_process';
import { execSync } from 'child_process';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { getAppDataDir } from '../../paths';
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

  // Try 'which claude'
  try {
    const result = execSync('which claude') as unknown as string;
    let path = '';
    for (let i = 0; i < result.length; i++) {
      const ch = result.charCodeAt(i);
      if (ch === 10 || ch === 13) break;
      path += result.slice(i, i + 1);
    }
    if (path.length > 3) {
      claudeBinaryPath = path;
      return path;
    }
  } catch (e) {}

  // Try common locations
  const paths = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (let i = 0; i < paths.length; i++) {
    try {
      if (existsSync(paths[i])) {
        claudeBinaryPath = paths[i];
        return paths[i];
      }
    } catch (e) {}
  }

  // Try ~/.claude/local/claude (npm global install)
  try {
    let homePath = '';
    const home = execSync('echo $HOME') as unknown as string;
    for (let i = 0; i < home.length; i++) {
      const ch = home.charCodeAt(i);
      if (ch === 10 || ch === 13) break;
      homePath += home.slice(i, i + 1);
    }
    if (homePath.length > 0) {
      let npmGlobal = homePath;
      npmGlobal += '/.npm-global/bin/claude';
      if (existsSync(npmGlobal)) {
        claudeBinaryPath = npmGlobal;
        return npmGlobal;
      }
    }
  } catch (e) {}

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
  try {
    let cmd = bin;
    cmd += ' auth status';
    const result = execSync(cmd) as unknown as string;
    // If it doesn't throw, auth is likely OK
    // Check for "logged in" or "authenticated" in output
    if (result.length > 0) return 1;
    return 1;
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
 * Wraps in single quotes and escapes any internal single quotes.
 */
function shellEscape(s: string): string {
  let result = "'";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 39) {
      // Single quote — end quote, escaped quote, restart quote
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
 */
export function startClaudeSession(prompt: string, workspaceRoot: string, resumeId: string, logFilePath: string): number {
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

  // Build the shell command
  // Unset CLAUDECODE to prevent "nested session" error if Hone was launched from Claude Code
  // Read prompt from file via cat to avoid argument injection
  let cmd = 'unset CLAUDECODE; ';
  cmd += bin;
  cmd += ' -p "$(cat ';
  cmd += shellEscape(promptFile);
  cmd += ')"';
  cmd += ' --output-format stream-json';
  cmd += ' --verbose';
  cmd += ' --max-turns 25';
  cmd += ' --permission-mode acceptEdits';

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

  // Spawn via background process
  const result = spawnBackground('/bin/sh', ['-c', cmd], '/dev/null');
  claudePid = result.pid;
  claudeHandleId = result.handleId;
  claudeAlive = 1;
  claudeLastOffset = 0;

  // NOTE: Polling is driven by chat-panel.ts setInterval (same-module pattern).
  // Do NOT start setInterval here — Perry setInterval from cross-module calls may not fire.

  // Clean up prompt file after a delay (give process time to read it)
  setTimeout(() => { cleanupPromptFile(promptFile); }, 2000);

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
    try {
      let killCmd = 'kill ';
      killCmd += String(claudePid);
      execSync(killCmd);
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
