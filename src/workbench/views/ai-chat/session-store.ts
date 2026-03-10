/**
 * Session persistence for AI Chat.
 *
 * Storage:
 *   ~/.hone/chats/index.txt  — one line per session: S|<id>|<mode>|<timestamp>|<title>
 *   ~/.hone/chats/<id>.txt   — message file (U/A/T + encoded content lines)
 *
 * All state is module-level (Perry closures capture by value).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { getChatsDir } from '../../paths';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let chatsDir = '';
let indexPath = '';
let chatsDirReady: number = 0;

let activeSessionId = '';
let activeSessionMode: number = 0;
let activeSessionTitle = '';

// Output vars for getSessionAt()
let parsedId = '';
let parsedMode: number = 0;
let parsedTimestamp = '';
let parsedTitle = '';
let parsedModel: number = 0;

let activeSessionModel: number = 0;

let sessionCount: number = 0;

// Cache of index file content (refreshed on read)
let indexCache = '';

// ---------------------------------------------------------------------------
// Directory setup
// ---------------------------------------------------------------------------

export function ensureChatsDir(): void {
  if (chatsDirReady > 0) return;

  // getChatsDir() handles creating ~/.hone/ and ~/.hone/chats/ on all platforms
  chatsDir = getChatsDir();

  // Build indexPath as a fresh string (Perry: += on aliased string can modify source)
  indexPath = '';
  indexPath += chatsDir;
  indexPath += '/index.txt';

  // Create index if missing
  if (!existsSync(indexPath)) {
    try { writeFileSync(indexPath, ''); } catch (e) {}
  }

  chatsDirReady = 1;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function getSessionFilePath(id: string): string {
  // Build fresh string (Perry: += on aliased string can modify source)
  let p = '';
  p += chatsDir;
  p += '/';
  p += id;
  p += '.txt';
  return p;
}

// ---------------------------------------------------------------------------
// Index I/O
// ---------------------------------------------------------------------------

function readIndex(): string {
  try {
    indexCache = readFileSync(indexPath);
  } catch (e) {
    indexCache = '';
  }
  return indexCache;
}

function writeIndex(content: string): void {
  try { writeFileSync(indexPath, content); } catch (e) {}
  indexCache = content;
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export function createNewSession(mode: number): string {
  const id = String(Date.now());
  let entry = 'S|';
  entry += id;
  entry += '|';
  entry += String(mode);
  entry += '|';
  entry += id;
  entry += '|New chat';

  // Append to index
  let idx = readIndex();
  if (idx.length > 0) {
    idx += '\n';
  }
  idx += entry;
  writeIndex(idx);

  // Create empty message file
  const filePath = getSessionFilePath(id);
  try { writeFileSync(filePath, ''); } catch (e) {}

  activeSessionId = id;
  activeSessionMode = mode;
  activeSessionTitle = 'New chat';

  return id;
}

export function loadSessionMessages(id: string): string {
  const filePath = getSessionFilePath(id);
  try {
    return readFileSync(filePath);
  } catch (e) {
    return '';
  }
}

export function saveSessionMessages(id: string, content: string): void {
  const filePath = getSessionFilePath(id);
  try { writeFileSync(filePath, content); } catch (e) {}
}

export function updateSessionTitle(id: string, title: string): void {
  const idx = readIndex();
  let result = '';
  let lineStart = 0;
  let firstLine: number = 1;

  for (let i = 0; i <= idx.length; i++) {
    if (i === idx.length || idx.charCodeAt(i) === 10) {
      const line = idx.slice(lineStart, i);

      if (firstLine < 1) result += '\n';
      firstLine = 0;

      // Check if this line contains our session id
      if (lineMatchesId(line, id) > 0) {
        // Parse all fields and rebuild with new title, preserving model
        let f0 = ''; let f1 = ''; let f2 = ''; let f3 = ''; let f5 = '';
        let fIdx = 0;
        let fS = 0;
        for (let j = 0; j <= line.length; j++) {
          if (j === line.length || line.charCodeAt(j) === 124) {
            const fV = line.slice(fS, j);
            if (fIdx === 0) f0 = fV;
            if (fIdx === 1) f1 = fV;
            if (fIdx === 2) f2 = fV;
            if (fIdx === 3) f3 = fV;
            if (fIdx === 5) f5 = fV;
            fIdx += 1;
            fS = j + 1;
          }
        }
        let newLine = f0;
        newLine += '|'; newLine += f1;
        newLine += '|'; newLine += f2;
        newLine += '|'; newLine += f3;
        newLine += '|'; newLine += title;
        if (f5.length > 0) {
          newLine += '|'; newLine += f5;
        }
        result += newLine;
      } else {
        result += line;
      }

      lineStart = i + 1;
    }
  }

  writeIndex(result);
}

export function updateSessionMode(id: string, mode: number): void {
  const idx = readIndex();
  let result = '';
  let lineStart = 0;
  let firstLine: number = 1;

  for (let i = 0; i <= idx.length; i++) {
    if (i === idx.length || idx.charCodeAt(i) === 10) {
      const line = idx.slice(lineStart, i);

      if (firstLine < 1) result += '\n';
      firstLine = 0;

      if (lineMatchesId(line, id) > 0) {
        // Parse existing fields: S|id|mode|timestamp|title
        let field0 = '';
        let field1 = '';
        let field3 = '';
        let field4 = '';
        let field5 = '';
        let fieldIdx = 0;
        let fStart = 0;
        for (let j = 0; j <= line.length; j++) {
          if (j === line.length || line.charCodeAt(j) === 124) {
            const fVal = line.slice(fStart, j);
            if (fieldIdx === 0) field0 = fVal;
            if (fieldIdx === 1) field1 = fVal;
            if (fieldIdx === 3) field3 = fVal;
            if (fieldIdx === 4) field4 = fVal;
            if (fieldIdx === 5) field5 = fVal;
            fieldIdx += 1;
            fStart = j + 1;
          }
        }
        let newLine = field0;
        newLine += '|';
        newLine += field1;
        newLine += '|';
        newLine += String(mode);
        newLine += '|';
        newLine += field3;
        newLine += '|';
        newLine += field4;
        if (field5.length > 0) {
          newLine += '|';
          newLine += field5;
        }
        result += newLine;
      } else {
        result += line;
      }

      lineStart = i + 1;
    }
  }

  writeIndex(result);
}

export function updateSessionModel(id: string, model: number): void {
  const idx = readIndex();
  let result = '';
  let lineStart = 0;
  let firstLine: number = 1;

  for (let i = 0; i <= idx.length; i++) {
    if (i === idx.length || idx.charCodeAt(i) === 10) {
      const line = idx.slice(lineStart, i);

      if (firstLine < 1) result += '\n';
      firstLine = 0;

      if (lineMatchesId(line, id) > 0) {
        // Parse existing fields: S|id|mode|timestamp|title[|model]
        let field0 = '';
        let field1 = '';
        let field2 = '';
        let field3 = '';
        let field4 = '';
        let fieldIdx = 0;
        let fStart = 0;
        for (let j = 0; j <= line.length; j++) {
          if (j === line.length || line.charCodeAt(j) === 124) {
            const fVal = line.slice(fStart, j);
            if (fieldIdx === 0) field0 = fVal;
            if (fieldIdx === 1) field1 = fVal;
            if (fieldIdx === 2) field2 = fVal;
            if (fieldIdx === 3) field3 = fVal;
            if (fieldIdx === 4) field4 = fVal;
            fieldIdx += 1;
            fStart = j + 1;
          }
        }
        let newLine = field0;
        newLine += '|'; newLine += field1;
        newLine += '|'; newLine += field2;
        newLine += '|'; newLine += field3;
        newLine += '|'; newLine += field4;
        newLine += '|'; newLine += String(model);
        result += newLine;
      } else {
        result += line;
      }

      lineStart = i + 1;
    }
  }

  writeIndex(result);
}

export function deleteSession(id: string): void {
  // Remove message file
  const filePath = getSessionFilePath(id);
  try { unlinkSync(filePath); } catch (e) {}

  // Remove from index
  const idx = readIndex();
  let result = '';
  let lineStart = 0;
  let firstLine: number = 1;

  for (let i = 0; i <= idx.length; i++) {
    if (i === idx.length || idx.charCodeAt(i) === 10) {
      const line = idx.slice(lineStart, i);

      if (line.length > 2 && lineMatchesId(line, id) < 1) {
        if (firstLine < 1) result += '\n';
        firstLine = 0;
        result += line;
      }

      lineStart = i + 1;
    }
  }

  writeIndex(result);
}

// ---------------------------------------------------------------------------
// Session list reading
// ---------------------------------------------------------------------------

/** Count sessions and cache index. Returns session count. */
export function getSessionList(): number {
  const idx = readIndex();
  sessionCount = 0;
  let lineStart = 0;
  for (let i = 0; i <= idx.length; i++) {
    if (i === idx.length || idx.charCodeAt(i) === 10) {
      const line = idx.slice(lineStart, i);
      // Valid line starts with 'S|'
      if (line.length > 2 && line.charCodeAt(0) === 83 && line.charCodeAt(1) === 124) {
        sessionCount += 1;
      }
      lineStart = i + 1;
    }
  }
  return sessionCount;
}

/**
 * Get session at index (0-based, ordered as in file — oldest first).
 * Caller can reverse iteration for most-recent-first display.
 * Sets parsedId, parsedMode, parsedTimestamp, parsedTitle.
 */
export function getSessionAt(idx: number): void {
  parsedId = '';
  parsedMode = 0;
  parsedTimestamp = '';
  parsedTitle = '';

  const content = indexCache;
  let lineStart = 0;
  let sessionIdx = 0;

  for (let i = 0; i <= content.length; i++) {
    if (i === content.length || content.charCodeAt(i) === 10) {
      const line = content.slice(lineStart, i);

      if (line.length > 2 && line.charCodeAt(0) === 83 && line.charCodeAt(1) === 124) {
        if (sessionIdx === idx) {
          parseIndexLine(line);
          return;
        }
        sessionIdx += 1;
      }

      lineStart = i + 1;
    }
  }
}

function parseIndexLine(line: string): void {
  // S|<id>|<mode>|<timestamp>|<title>
  let fieldIdx = 0;
  let fStart = 0;
  for (let i = 0; i <= line.length; i++) {
    if (i === line.length || line.charCodeAt(i) === 124) {
      const fVal = line.slice(fStart, i);
      if (fieldIdx === 1) parsedId = fVal;
      if (fieldIdx === 2) {
        if (fVal.length > 0) {
          const c0 = fVal.charCodeAt(0);
          if (c0 === 48) parsedMode = 0;       // '0'
          else if (c0 === 49) parsedMode = 1;   // '1'
          else if (c0 === 50) parsedMode = 2;   // '2'
          else if (c0 === 51) parsedMode = 3;   // '3' (Claude Code)
        }
      }
      if (fieldIdx === 3) parsedTimestamp = fVal;
      if (fieldIdx === 4) parsedTitle = fVal;
      if (fieldIdx === 5) {
        parsedModel = 0;
        if (fVal.length > 0) {
          // Parse multi-digit model ID (0–15+)
          let num = 0;
          for (let d = 0; d < fVal.length; d++) {
            const dc = fVal.charCodeAt(d);
            if (dc >= 48 && dc <= 57) {
              num = num * 10 + (dc - 48);
            }
          }
          parsedModel = num;
        }
      }
      fieldIdx += 1;
      fStart = i + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Title generation
// ---------------------------------------------------------------------------

export function generateTitle(firstMsg: string): string {
  let title = '';
  let len = firstMsg.length;
  if (len > 40) len = 40;
  for (let i = 0; i < len; i++) {
    const ch = firstMsg.charCodeAt(i);
    // Strip pipes (124) and newlines (10, 13)
    if (ch === 124 || ch === 10 || ch === 13) {
      title += ' ';
    } else {
      title += firstMsg.slice(i, i + 1);
    }
  }
  return title;
}

// ---------------------------------------------------------------------------
// Active session accessors
// ---------------------------------------------------------------------------

export function getActiveSessionId(): string {
  return activeSessionId;
}

export function setActiveSessionId(id: string): void {
  activeSessionId = id;
}

export function getActiveSessionMode(): number {
  return activeSessionMode;
}

export function setActiveSessionMode(mode: number): void {
  activeSessionMode = mode;
}

export function getActiveSessionTitle(): string {
  return activeSessionTitle;
}

export function setActiveSessionTitle(title: string): void {
  activeSessionTitle = title;
}

export function getActiveSessionModel(): number { return activeSessionModel; }
export function setActiveSessionModel(model: number): void { activeSessionModel = model; }

// Output var accessors
export function getParsedId(): string { return parsedId; }
export function getParsedMode(): number { return parsedMode; }
export function getParsedTimestamp(): string { return parsedTimestamp; }
export function getParsedTitle(): string { return parsedTitle; }
export function getParsedModel(): number { return parsedModel; }

// ---------------------------------------------------------------------------
// Claude Code session UUID persistence
// ---------------------------------------------------------------------------

/**
 * Store a Claude Code session UUID for a given session ID.
 * Written to ~/.hone/chats/<id>.claude (separate file from messages).
 */
export function saveClaudeSessionUUID(sessionId: string, claudeUUID: string): void {
  if (sessionId.length < 1 || claudeUUID.length < 1) return;
  let p = '';
  p += chatsDir;
  p += '/';
  p += sessionId;
  p += '.claude';
  try { writeFileSync(p, claudeUUID); } catch (e) {}
}

/**
 * Load a Claude Code session UUID for a given session ID.
 * Returns empty string if not found.
 */
export function loadClaudeSessionUUID(sessionId: string): string {
  if (sessionId.length < 1) return '';
  let p = '';
  p += chatsDir;
  p += '/';
  p += sessionId;
  p += '.claude';
  try {
    const content = readFileSync(p);
    // Trim trailing newlines
    let end = content.length;
    while (end > 0) {
      const ch = content.charCodeAt(end - 1);
      if (ch === 10 || ch === 13 || ch === 32) { end -= 1; }
      else { break; }
    }
    if (end < content.length) return content.slice(0, end);
    return content;
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if an index line contains the given session id (field 1). */
function lineMatchesId(line: string, id: string): number {
  // Line format: S|<id>|...
  if (line.length < 3) return 0;
  if (line.charCodeAt(0) !== 83 || line.charCodeAt(1) !== 124) return 0;

  // Find second pipe
  let pipePos = -1;
  for (let i = 2; i < line.length; i++) {
    if (line.charCodeAt(i) === 124) {
      pipePos = i;
      break;
    }
  }
  if (pipePos < 0) return 0;

  const lineId = line.slice(2, pipePos);
  if (lineId.length !== id.length) return 0;
  for (let i = 0; i < id.length; i++) {
    if (lineId.charCodeAt(i) !== id.charCodeAt(i)) return 0;
  }
  return 1;
}

/** Find the most recent session (last S| line in index). Returns id or empty. */
export function getMostRecentSessionId(): string {
  const idx = readIndex();
  let lastId = '';
  let lineStart = 0;

  for (let i = 0; i <= idx.length; i++) {
    if (i === idx.length || idx.charCodeAt(i) === 10) {
      const line = idx.slice(lineStart, i);
      if (line.length > 2 && line.charCodeAt(0) === 83 && line.charCodeAt(1) === 124) {
        // Extract id (field 1)
        let pipePos = -1;
        for (let j = 2; j < line.length; j++) {
          if (line.charCodeAt(j) === 124) { pipePos = j; break; }
        }
        if (pipePos > 2) {
          lastId = line.slice(2, pipePos);
        }
      }
      lineStart = i + 1;
    }
  }

  return lastId;
}

/** Load active session metadata from index by id. Sets activeSessionMode and activeSessionTitle. */
export function loadSessionMeta(id: string): void {
  const idx = readIndex();
  let lineStart = 0;

  for (let i = 0; i <= idx.length; i++) {
    if (i === idx.length || idx.charCodeAt(i) === 10) {
      const line = idx.slice(lineStart, i);
      if (lineMatchesId(line, id) > 0) {
        parseIndexLine(line);
        activeSessionId = parsedId;
        activeSessionMode = parsedMode;
        activeSessionTitle = parsedTitle;
        activeSessionModel = parsedModel;
        return;
      }
      lineStart = i + 1;
    }
  }
}
