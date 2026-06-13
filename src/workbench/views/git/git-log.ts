/**
 * Git commit log — scrollable commit history panel.
 *
 * Shows recent commits with author, date, and message.
 * Perry-safe: module-level state, for-loops.
 */
import {
  VStack, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  buttonSetBordered,
  widgetAddChild, widgetClearChildren,
} from 'perry/ui';
import { spawnText } from '../../../process-compat';
import { spawn } from 'perry/thread';
import { setFg, setBtnFg, monoFont } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getSecondaryTextColor } from '../../theme/theme-colors';

let logContainer: unknown = null;
let logReady: number = 0;
let logWorkspaceRoot: string = '';

// Commit data — parallel arrays
let logHashes: string[] = [];
let logAuthors: string[] = [];
let logDates: string[] = [];
let logMessages: string[] = [];
// SHIP-V1-GAPS.md #103: ref decorations (`HEAD -> main, tag: v1.0`) and
// parent hashes (space-separated; 2+ means merge commit).
let logDecorations: string[] = [];
let logParents: string[] = [];
let logCount: number = 0;

export function setGitLogWorkspaceRoot(root: string): void {
  logWorkspaceRoot = root;
}

/** Render the commit log into a container (e.g., below the git panel). */
export function renderGitLog(container: unknown, _colors: ResolvedUIColors): void {
  logContainer = container;
  logReady = 1;
  refreshGitLog();
}

/** Refresh the commit log from git (async — runs on background thread). */
export function refreshGitLog(): void {
  const wsRoot = logWorkspaceRoot;
  if (wsRoot.length < 1) return;

  spawn(() => {
    let output = '';
    try {
      // SHIP-V1-GAPS.md #103: %P = parent hashes (space-separated, 2+ = merge),
      // %D = ref decorations (HEAD -> main, tag: v1.0, origin/main).
      const r = spawnText('git', ['-C', wsRoot, 'log', '--decorate=short', '--format=%h|%P|%an|%ar|%D|%s', '-50']);
      if (r.status === 0) output = r.stdout;
    } catch (e) {
      return { hashes: [] as string[], authors: [] as string[], dates: [] as string[], messages: [] as string[], decorations: [] as string[], parents: [] as string[], count: 0 };
    }

    const hashes: string[] = [];
    const authors: string[] = [];
    const dates: string[] = [];
    const messages: string[] = [];
    const decorations: string[] = [];
    const parents: string[] = [];
    let count = 0;

    if (output.length < 1) {
      return { hashes: hashes, authors: authors, dates: dates, messages: messages, decorations: decorations, parents: parents, count: 0 };
    }

    let lineStart = 0;
    for (let i = 0; i <= output.length; i = i + 1) {
      if (i === output.length || output.charCodeAt(i) === 10) {
        if (i > lineStart + 5 && count < 50) {
          const line = output.slice(lineStart, i);
          // Split on '|' — 6 fields: hash, parents, author, date, decorations, message.
          let sep1 = -1;
          for (let j = 0; j < line.length; j = j + 1) {
            if (line.charCodeAt(j) === 124) { sep1 = j; break; }
          }
          if (sep1 < 1) { lineStart = i + 1; continue; }
          let sep2 = -1;
          for (let j = sep1 + 1; j < line.length; j = j + 1) {
            if (line.charCodeAt(j) === 124) { sep2 = j; break; }
          }
          if (sep2 < 0) { lineStart = i + 1; continue; }
          let sep3 = -1;
          for (let j = sep2 + 1; j < line.length; j = j + 1) {
            if (line.charCodeAt(j) === 124) { sep3 = j; break; }
          }
          if (sep3 < 0) { lineStart = i + 1; continue; }
          let sep4 = -1;
          for (let j = sep3 + 1; j < line.length; j = j + 1) {
            if (line.charCodeAt(j) === 124) { sep4 = j; break; }
          }
          if (sep4 < 0) { lineStart = i + 1; continue; }
          let sep5 = -1;
          for (let j = sep4 + 1; j < line.length; j = j + 1) {
            if (line.charCodeAt(j) === 124) { sep5 = j; break; }
          }
          if (sep5 < 0) { lineStart = i + 1; continue; }

          hashes[count] = line.slice(0, sep1);
          parents[count] = line.slice(sep1 + 1, sep2);
          authors[count] = line.slice(sep2 + 1, sep3);
          dates[count] = line.slice(sep3 + 1, sep4);
          decorations[count] = line.slice(sep4 + 1, sep5);
          messages[count] = line.slice(sep5 + 1);
          count = count + 1;
        }
        lineStart = i + 1;
      }
    }

    return { hashes: hashes, authors: authors, dates: dates, messages: messages, decorations: decorations, parents: parents, count: count };
  }).then((result) => { applyLogResult(result); });
}

function applyLogResult(r: { hashes: string[]; authors: string[]; dates: string[]; messages: string[]; decorations: string[]; parents: string[]; count: number }): void {
  logHashes = r.hashes;
  logAuthors = r.authors;
  logDates = r.dates;
  logMessages = r.messages;
  logDecorations = r.decorations;
  logParents = r.parents;
  logCount = r.count;
  if (logReady > 0) {
    updateLogUI();
  }
}

/**
 * Render the comma-separated decoration list (`HEAD -> main, tag: v1.0,
 * origin/main`) as colored badges. Returns null when there are no
 * decorations. SHIP-V1-GAPS.md #103.
 */
function parseAndRenderDecorations(decor: string): unknown {
  if (decor.length === 0) return null;
  const row = HStack(4, []);
  // Split on ", " — Perry-safe manual iteration.
  let start = 0;
  for (let i = 0; i <= decor.length; i++) {
    if (i === decor.length || (decor.charCodeAt(i) === 44 && i + 1 < decor.length && decor.charCodeAt(i + 1) === 32)) {
      if (i > start) {
        const piece = decor.slice(start, i);
        appendDecoration(row, piece);
      }
      start = i + 2; // skip ", "
    }
  }
  return row;
}

function appendDecoration(row: unknown, piece: string): void {
  // Classify the decoration to pick a color:
  //   "HEAD -> branch" → cyan
  //   "HEAD"           → cyan
  //   "tag: v1.0"      → yellow
  //   bare branch      → green
  //   "origin/main"    → muted
  let color = '#A6E3A1'; // local branch (green)
  if (piece.length >= 4 && piece.charCodeAt(0) === 72 && piece.charCodeAt(1) === 69 && piece.charCodeAt(2) === 65 && piece.charCodeAt(3) === 68) {
    color = '#74c7ec';
  } else if (piece.length >= 5 && piece.charCodeAt(0) === 116 && piece.charCodeAt(1) === 97 && piece.charCodeAt(2) === 103) {
    color = '#F9E2AF';
  } else {
    // Remote-tracking branches contain '/' before the slash count > 0.
    for (let k = 0; k < piece.length; k++) {
      if (piece.charCodeAt(k) === 47) { color = '#6c7086'; break; }
    }
  }
  const badge = Text(piece);
  textSetFontSize(badge, 10);
  setFg(badge, color);
  widgetAddChild(row, badge);
}

function parseLogLine(line: string): void {
  if (logCount >= 50) return;

  // Find first | (hash separator)
  let sep1 = -1;
  for (let i = 0; i < line.length; i = i + 1) {
    if (line.charCodeAt(i) === 124) { sep1 = i; break; }
  }
  if (sep1 < 1) return;

  // Find second | (author separator)
  let sep2 = -1;
  for (let i = sep1 + 1; i < line.length; i = i + 1) {
    if (line.charCodeAt(i) === 124) { sep2 = i; break; }
  }
  if (sep2 < 0) return;

  // Find third | (date separator)
  let sep3 = -1;
  for (let i = sep2 + 1; i < line.length; i = i + 1) {
    if (line.charCodeAt(i) === 124) { sep3 = i; break; }
  }
  if (sep3 < 0) return;

  logHashes[logCount] = line.slice(0, sep1);
  logAuthors[logCount] = line.slice(sep1 + 1, sep2);
  logDates[logCount] = line.slice(sep2 + 1, sep3);
  logMessages[logCount] = line.slice(sep3 + 1);
  logCount = logCount + 1;
}

function updateLogUI(): void {
  if (logReady < 1 || !logContainer) return;
  widgetClearChildren(logContainer);

  const title = Text('COMMIT LOG');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(logContainer, title);

  if (logCount < 1) {
    const empty = Text('No commits');
    textSetFontSize(empty, 11);
    setFg(empty, getSecondaryTextColor());
    widgetAddChild(logContainer, empty);
    return;
  }

  for (let i = 0; i < logCount; i = i + 1) {
    const hash = logHashes[i];
    const author = logAuthors[i];
    const date = logDates[i];
    const msg = logMessages[i];
    const decor = logDecorations[i];
    const parents = logParents[i];

    // SHIP-V1-GAPS.md #103: parents column. Two-or-more parent hashes (space
    // separated) means a merge commit — render a small "⤴" marker so users
    // see where branches converge.
    let parentCount = 0;
    if (parents.length > 0) {
      parentCount = 1;
      for (let p = 0; p < parents.length; p++) {
        if (parents.charCodeAt(p) === 32) parentCount = parentCount + 1;
      }
    }
    const isMerge = parentCount >= 2 ? 1 : 0;

    const indicator = Text(isMerge > 0 ? '◇' : '●');
    textSetFontSize(indicator, 12);
    setFg(indicator, isMerge > 0 ? '#89b4fa' : getSideBarForeground());

    // Hash label (monospace, muted)
    const hashLabel = Text(hash);
    textSetFontSize(hashLabel, 10);
    textSetFontFamily(hashLabel, 10, monoFont());
    setFg(hashLabel, getSecondaryTextColor());

    // Message (primary text)
    const msgLabel = Text(msg);
    textSetFontSize(msgLabel, 11);
    setFg(msgLabel, getSideBarForeground());

    const headerRow = HStack(4, [indicator, hashLabel, msgLabel]);

    // Decorations row (`HEAD -> main`, `tag: v1.0`, etc.)
    const decorRow = parseAndRenderDecorations(decor);

    // Author + date (muted)
    let meta = author;
    meta += ', ';
    meta += date;
    if (isMerge > 0) {
      meta += '  (merge)';
    }
    const metaLabel = Text(meta);
    textSetFontSize(metaLabel, 10);
    setFg(metaLabel, getSecondaryTextColor());

    const commitRow = VStack(1, []);
    widgetAddChild(commitRow, headerRow);
    if (decorRow !== null) widgetAddChild(commitRow, decorRow);
    widgetAddChild(commitRow, metaLabel);
    widgetAddChild(logContainer, commitRow);
  }

  widgetAddChild(logContainer, Spacer());
}
