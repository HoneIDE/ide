/**
 * Recent items store — persists recently opened files/folders.
 *
 * Storage format: ~/.hone/recent.ini
 *   D=/path/to/folder
 *   F=/path/to/file
 *
 * All state is module-level (Perry closures capture by value).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getAppDataDir } from '../../paths';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let recentPaths: string[] = [];
let recentTypes: number[] = []; // 0 = file, 1 = folder
let recentCount: number = 0;
let recentLoaded: number = 0;

const MAX_RECENT = 10;

// ---------------------------------------------------------------------------
// File path helper
// ---------------------------------------------------------------------------

function getRecentFilePath(): string {
  let p = getAppDataDir();
  p += '/recent.ini';
  return p;
}

// ---------------------------------------------------------------------------
// Read accessors
// ---------------------------------------------------------------------------

export function getRecentCount(): number {
  return recentCount;
}

export function getRecentPath(idx: number): string {
  if (idx < 0 || idx >= recentCount) return '';
  return recentPaths[idx];
}

export function getRecentType(idx: number): number {
  if (idx < 0 || idx >= recentCount) return 0;
  return recentTypes[idx];
}

// ---------------------------------------------------------------------------
// Path comparison (Perry string === unreliable for array strings)
// ---------------------------------------------------------------------------

function pathsEqual(a: string, b: string): number {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return 0;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

export function initRecentItems(): void {
  if (recentLoaded > 0) return;
  recentLoaded = 1;
  const filePath = getRecentFilePath();
  let content = '';
  try {
    if (existsSync(filePath)) {
      content = readFileSync(filePath, 'utf8');
    }
  } catch (e: any) { return; }
  if (content.length < 3) return;

  // Parse line by line
  let lineStart = 0;
  for (let i = 0; i <= content.length; i++) {
    if (i === content.length || content.charCodeAt(i) === 10) {
      if (i > lineStart + 2) {
        const line = content.slice(lineStart, i);
        // Strip trailing \r
        let lineEnd = line.length;
        if (lineEnd > 0 && line.charCodeAt(lineEnd - 1) === 13) {
          lineEnd = lineEnd - 1;
        }
        const cleanLine = line.slice(0, lineEnd);
        if (cleanLine.length > 2 && cleanLine.charCodeAt(1) === 61) {
          // D= or F=
          const typeChar = cleanLine.charCodeAt(0);
          const path = cleanLine.slice(2);
          if (path.length > 0 && recentCount < MAX_RECENT) {
            if (typeChar === 68) {
              // 'D' = folder
              recentPaths.push(path);
              recentTypes.push(1);
              recentCount = recentCount + 1;
            } else if (typeChar === 70) {
              // 'F' = file
              recentPaths.push(path);
              recentTypes.push(0);
              recentCount = recentCount + 1;
            }
          }
        }
      }
      lineStart = i + 1;
    }
  }
}

function saveRecent(): void {
  let content = '';
  for (let i = 0; i < recentCount; i++) {
    if (recentTypes[i] > 0) {
      content += 'D=';
    } else {
      content += 'F=';
    }
    content += recentPaths[i];
    content += '\n';
  }
  try {
    writeFileSync(getRecentFilePath(), content);
  } catch (e: any) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Add / Remove
// ---------------------------------------------------------------------------

function addRecentItem(path: string, type: number): void {
  // Remove duplicate if exists
  const newPaths: string[] = [];
  const newTypes: number[] = [];
  let newCount = 0;
  for (let i = 0; i < recentCount; i++) {
    if (pathsEqual(recentPaths[i], path) > 0) continue;
    newPaths.push(recentPaths[i]);
    newTypes.push(recentTypes[i]);
    newCount = newCount + 1;
  }
  // Prepend new item
  recentPaths = [path];
  recentTypes = [type];
  recentCount = 1;
  // Re-add old items up to MAX
  for (let i = 0; i < newCount && recentCount < MAX_RECENT; i++) {
    recentPaths.push(newPaths[i]);
    recentTypes.push(newTypes[i]);
    recentCount = recentCount + 1;
  }
  saveRecent();
}

export function addRecentFile(path: string): void {
  addRecentItem(path, 0);
}

export function addRecentFolder(path: string): void {
  addRecentItem(path, 1);
}

export function clearRecentItems(): void {
  recentPaths = [];
  recentTypes = [];
  recentCount = 0;
  saveRecent();
}
