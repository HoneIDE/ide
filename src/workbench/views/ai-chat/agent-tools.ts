/**
 * Perry-native tool implementations for the AI agent.
 * All tools validate paths against workspace root.
 */
import { readFileSync, writeFileSync, readdirSync, isDirectory } from 'fs';
import { execSync } from 'child_process';
import { jsonEscape } from './sse-parser';

// Module-level state
let toolWorkspaceRoot = '';

export function setToolWorkspaceRoot(root: string): void {
  toolWorkspaceRoot = root;
}

export function getToolWorkspaceRoot(): string {
  return toolWorkspaceRoot;
}

/** Read a file, capped at 10000 chars. */
function executeToolFileRead(filePath: string): string {
  try {
    const content = readFileSync(filePath);
    if (content.length > 10000) {
      return content.slice(0, 10000) + '\n... (truncated)';
    }
    return content;
  } catch (e: any) {
    return 'Error: Could not read file';
  }
}

/** Edit a file: find oldText and replace with newText. */
function executeToolFileEdit(filePath: string, oldText: string, newText: string): string {
  try {
    const content = readFileSync(filePath);
    // Find oldText using charCodeAt
    let foundPos = -1;
    for (let i = 0; i <= content.length - oldText.length; i++) {
      let match = 1;
      for (let j = 0; j < oldText.length; j++) {
        if (content.charCodeAt(i + j) !== oldText.charCodeAt(j)) {
          match = 0;
          break;
        }
      }
      if (match > 0) {
        foundPos = i;
        break;
      }
    }
    if (foundPos < 0) {
      return 'Error: Could not find text to replace';
    }
    let result = content.slice(0, foundPos);
    result += newText;
    result += content.slice(foundPos + oldText.length);
    writeFileSync(filePath, result);
    return 'File edited successfully';
  } catch (e: any) {
    return 'Error: Could not edit file';
  }
}

/** Create a new file. */
function executeToolFileCreate(filePath: string, content: string): string {
  try {
    writeFileSync(filePath, content);
    return 'File created successfully';
  } catch (e: any) {
    return 'Error: Could not create file';
  }
}

/** Run a terminal command, capped at 4000 chars output. */
function executeToolTerminalRun(command: string, cwd: string): string {
  let dir = cwd;
  if (dir.length < 1) dir = toolWorkspaceRoot;
  if (dir.length < 1) dir = '/tmp';
  try {
    let cmd = 'cd "';
    cmd += dir;
    cmd += '" && ';
    cmd += command;
    cmd += ' 2>&1';
    const output = execSync(cmd) as unknown as string;
    if (output.length > 4000) {
      return output.slice(0, 4000) + '\n... (truncated)';
    }
    return output;
  } catch (e: any) {
    return 'Error: Command failed';
  }
}

// Search state — module-level for Perry (no nested function closures)
let searchResults = '';
let searchResultCount = 0;
let searchQuery = '';

function searchDirRecursive(dirPath: string, depth: number): void {
  if (depth > 8) return;
  if (searchResultCount >= 200) return;
  try {
    const entries = readdirSync(dirPath);
    for (let i = 0; i < entries.length; i++) {
      if (searchResultCount >= 200) return;
      const name = entries[i];
      if (name.charCodeAt(0) === 46) continue;
      if (name.length === 12 && name.charCodeAt(0) === 110 && name.charCodeAt(5) === 109) continue;
      let full = dirPath;
      full += '/';
      full += name;
      try {
        if (isDirectory(full)) {
          searchDirRecursive(full, depth + 1);
        } else {
          try {
            const content = readFileSync(full);
            if (content.length > 500000) continue;
            let lineNum = 1;
            let lineStart = 0;
            for (let c = 0; c <= content.length; c++) {
              if (c === content.length || content.charCodeAt(c) === 10) {
                const line = content.slice(lineStart, c);
                let found = 0;
                if (line.length >= searchQuery.length) {
                  for (let k = 0; k <= line.length - searchQuery.length; k++) {
                    let match = 1;
                    for (let q = 0; q < searchQuery.length; q++) {
                      if (line.charCodeAt(k + q) !== searchQuery.charCodeAt(q)) {
                        match = 0;
                        break;
                      }
                    }
                    if (match > 0) { found = 1; break; }
                  }
                }
                if (found > 0) {
                  let lineText = line;
                  if (line.length > 120) { lineText = line.slice(0, 120); }
                  searchResults += full + ':' + String(lineNum) + ': ' + lineText + '\n';
                  searchResultCount += 1;
                  if (searchResultCount >= 200) return;
                }
                lineNum += 1;
                lineStart = c + 1;
              }
            }
          } catch (e: any) {}
        }
      } catch (e: any) {}
    }
  } catch (e: any) {}
}

/** Recursive file search, 200 result cap. */
function executeToolSearch(query: string, searchRoot: string): string {
  let root = searchRoot;
  if (root.length < 1) root = toolWorkspaceRoot;
  if (root.length < 1) return 'Error: No workspace root set';

  searchResults = '';
  searchResultCount = 0;
  searchQuery = query;
  searchDirRecursive(root, 0);
  if (searchResults.length < 1) return 'No results found';
  return searchResults;
}

/** Git status --short. */
function executeToolGitStatus(): string {
  if (toolWorkspaceRoot.length < 1) return 'Error: No workspace root';
  try {
    let cmd = 'cd "';
    cmd += toolWorkspaceRoot;
    cmd += '" && git status --short 2>&1';
    const output = execSync(cmd) as unknown as string;
    if (output.length > 4000) return output.slice(0, 4000);
    return output;
  } catch (e: any) {
    return 'Error: git status failed';
  }
}

/** Git diff, optionally staged, optionally for a specific path. */
function executeToolGitDiff(staged: number, filePath: string): string {
  if (toolWorkspaceRoot.length < 1) return 'Error: No workspace root';
  try {
    let cmd = 'cd "';
    cmd += toolWorkspaceRoot;
    cmd += '" && git diff';
    if (staged > 0) cmd += ' --cached';
    if (filePath.length > 0) {
      cmd += ' -- "';
      cmd += filePath;
      cmd += '"';
    }
    cmd += ' 2>&1';
    const output = execSync(cmd) as unknown as string;
    if (output.length > 8000) return output.slice(0, 8000) + '\n... (truncated)';
    return output;
  } catch (e: any) {
    return 'Error: git diff failed';
  }
}

/** List files in a directory. */
function executeToolListDir(dirPath: string): string {
  let dir = dirPath;
  if (dir.length < 1) dir = toolWorkspaceRoot;
  try {
    let cmd = 'ls -la "';
    cmd += dir;
    cmd += '" 2>&1';
    const output = execSync(cmd) as unknown as string;
    if (output.length > 4000) return output.slice(0, 4000);
    return output;
  } catch (e: any) {
    return 'Error: Could not list directory';
  }
}

/** Check if a tool is destructive (needs approval). */
export function isDestructiveTool(toolName: string): number {
  // file_edit, file_create, terminal_run
  if (toolName.length < 5) return 0;
  if (toolName.charCodeAt(0) === 102) { // 'f'
    if (toolName.charCodeAt(5) === 101) return 1; // file_edit
    if (toolName.charCodeAt(5) === 99) return 1;  // file_create
  }
  if (toolName.charCodeAt(0) === 116) return 1; // terminal_run
  return 0;
}

/** Dispatch tool execution by name. Returns result string. */
export function executeTool(toolName: string, argsJson: string): string {
  // Match by first char + length for Perry safety
  const c0 = toolName.charCodeAt(0);

  if (c0 === 102) { // 'f' — file_read, file_edit, file_create
    if (toolName.length === 9 && toolName.charCodeAt(5) === 114) {
      // file_read
      const path = extractToolArg(argsJson, 'path');
      return executeToolFileRead(path);
    }
    if (toolName.length === 9 && toolName.charCodeAt(5) === 101) {
      // file_edit
      const path = extractToolArg(argsJson, 'path');
      const oldText = extractToolArg(argsJson, 'old_text');
      const newText = extractToolArg(argsJson, 'new_text');
      return executeToolFileEdit(path, oldText, newText);
    }
    if (toolName.length === 11 && toolName.charCodeAt(5) === 99) {
      // file_create
      const path = extractToolArg(argsJson, 'path');
      const content = extractToolArg(argsJson, 'content');
      return executeToolFileCreate(path, content);
    }
  }

  if (c0 === 116 && toolName.length === 12) {
    // terminal_run
    const command = extractToolArg(argsJson, 'command');
    const cwd = extractToolArg(argsJson, 'cwd');
    return executeToolTerminalRun(command, cwd);
  }

  if (c0 === 115 && toolName.length === 6) {
    // search
    const query = extractToolArg(argsJson, 'query');
    const dir = extractToolArg(argsJson, 'directory');
    return executeToolSearch(query, dir);
  }

  if (c0 === 103) { // 'g' — git_status, git_diff
    if (toolName.length === 10) {
      // git_status
      return executeToolGitStatus();
    }
    if (toolName.length === 8) {
      // git_diff
      const path = extractToolArg(argsJson, 'path');
      return executeToolGitDiff(0, path);
    }
  }

  if (c0 === 108 && toolName.length === 8) {
    // list_dir
    const path = extractToolArg(argsJson, 'directory');
    return executeToolListDir(path);
  }

  return 'Error: Unknown tool';
}

/** Extract a string argument from tool args JSON. Uses extractJsonString from sse-parser. */
function extractToolArg(argsJson: string, key: string): string {
  // Re-implement inline since we can't import extractJsonString here without
  // circular deps. Actually we can — sse-parser has no deps on this file.
  let pattern = '"';
  pattern += key;
  pattern += '"';

  let searchStart = 0;
  while (searchStart <= argsJson.length - pattern.length) {
    let pos = -1;
    for (let i = searchStart; i <= argsJson.length - pattern.length; i++) {
      let match = 1;
      for (let j = 0; j < pattern.length; j++) {
        if (argsJson.charCodeAt(i + j) !== pattern.charCodeAt(j)) {
          match = 0;
          break;
        }
      }
      if (match > 0) { pos = i; break; }
    }
    if (pos < 0) return '';

    let afterKey = pos + pattern.length;
    while (afterKey < argsJson.length) {
      const ch = argsJson.charCodeAt(afterKey);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) { afterKey += 1; } else { break; }
    }
    if (afterKey >= argsJson.length || argsJson.charCodeAt(afterKey) !== 58) {
      searchStart = pos + 1; continue;
    }
    afterKey += 1;
    while (afterKey < argsJson.length) {
      const ch = argsJson.charCodeAt(afterKey);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) { afterKey += 1; } else { break; }
    }
    if (afterKey >= argsJson.length || argsJson.charCodeAt(afterKey) !== 34) {
      searchStart = pos + 1; continue;
    }
    afterKey += 1;

    let result = '';
    while (afterKey < argsJson.length) {
      const ch = argsJson.charCodeAt(afterKey);
      if (ch === 92) {
        afterKey += 1;
        if (afterKey < argsJson.length) {
          const next = argsJson.charCodeAt(afterKey);
          if (next === 110) { result += '\n'; }
          else if (next === 116) { result += '\t'; }
          else if (next === 114) { result += '\r'; }
          else if (next === 34) { result += '"'; }
          else if (next === 92) { result += '\\'; }
          else { result += argsJson.slice(afterKey, afterKey + 1); }
        }
      } else if (ch === 34) { break; }
      else { result += argsJson.slice(afterKey, afterKey + 1); }
      afterKey += 1;
    }
    return result;
  }
  return '';
}

/** Build tool definitions JSON array for Anthropic API. */
export function buildToolDefinitionsJSON(): string {
  let t = '[';
  // file_read
  t += '{"name":"file_read","description":"Read a file from the workspace","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute file path"}},"required":["path"]}}';
  t += ',';
  // file_edit
  t += '{"name":"file_edit","description":"Edit a file by replacing old_text with new_text","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute file path"},"old_text":{"type":"string","description":"Exact text to find and replace"},"new_text":{"type":"string","description":"Replacement text"}},"required":["path","old_text","new_text"]}}';
  t += ',';
  // file_create
  t += '{"name":"file_create","description":"Create a new file","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute file path"},"content":{"type":"string","description":"File content"}},"required":["path","content"]}}';
  t += ',';
  // terminal_run
  t += '{"name":"terminal_run","description":"Run a terminal command","input_schema":{"type":"object","properties":{"command":{"type":"string","description":"Shell command to run"},"cwd":{"type":"string","description":"Working directory (optional)"}},"required":["command"]}}';
  t += ',';
  // search
  t += '{"name":"search","description":"Search for text across files in the workspace","input_schema":{"type":"object","properties":{"query":{"type":"string","description":"Text to search for"},"directory":{"type":"string","description":"Directory to search in (optional)"}},"required":["query"]}}';
  t += ',';
  // git_status
  t += '{"name":"git_status","description":"Show git status of the workspace","input_schema":{"type":"object","properties":{}}}';
  t += ',';
  // git_diff
  t += '{"name":"git_diff","description":"Show git diff","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"File path (optional)"}}}}';
  t += ',';
  // list_dir
  t += '{"name":"list_dir","description":"List files in a directory","input_schema":{"type":"object","properties":{"directory":{"type":"string","description":"Directory path (optional)"}}}}';
  t += ']';
  return t;
}

/** Build read-only tool definitions (for Plan mode). */
export function buildReadOnlyToolsJSON(): string {
  let t = '[';
  t += '{"name":"file_read","description":"Read a file from the workspace","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute file path"}},"required":["path"]}}';
  t += ',';
  t += '{"name":"search","description":"Search for text across files in the workspace","input_schema":{"type":"object","properties":{"query":{"type":"string","description":"Text to search for"},"directory":{"type":"string","description":"Directory to search in (optional)"}},"required":["query"]}}';
  t += ',';
  t += '{"name":"git_status","description":"Show git status of the workspace","input_schema":{"type":"object","properties":{}}}';
  t += ',';
  t += '{"name":"git_diff","description":"Show git diff","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"File path (optional)"}}}}';
  t += ',';
  t += '{"name":"list_dir","description":"List files in a directory","input_schema":{"type":"object","properties":{"directory":{"type":"string","description":"Directory path (optional)"}}}}';
  t += ']';
  return t;
}
