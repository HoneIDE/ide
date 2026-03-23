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
import { execSync } from 'child_process';
import { spawn } from 'perry/thread';
import { setFg, setBtnFg } from '../../ui-helpers';
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
      output = execSync('git -C ' + wsRoot + ' log --oneline --format="%h|%an|%ar|%s" -50') as unknown as string;
    } catch (e) {
      return { hashes: [] as string[], authors: [] as string[], dates: [] as string[], messages: [] as string[], count: 0 };
    }

    const hashes: string[] = [];
    const authors: string[] = [];
    const dates: string[] = [];
    const messages: string[] = [];
    let count = 0;

    if (output.length < 1) {
      return { hashes: hashes, authors: authors, dates: dates, messages: messages, count: 0 };
    }

    let lineStart = 0;
    for (let i = 0; i <= output.length; i = i + 1) {
      if (i === output.length || output.charCodeAt(i) === 10) {
        if (i > lineStart + 5 && count < 50) {
          const line = output.slice(lineStart, i);
          // Inline parseLogLine
          let sep1 = -1;
          for (let j = 0; j < line.length; j = j + 1) {
            if (line.charCodeAt(j) === 124) { sep1 = j; break; }
          }
          if (sep1 >= 1) {
            let sep2 = -1;
            for (let j = sep1 + 1; j < line.length; j = j + 1) {
              if (line.charCodeAt(j) === 124) { sep2 = j; break; }
            }
            if (sep2 >= 0) {
              let sep3 = -1;
              for (let j = sep2 + 1; j < line.length; j = j + 1) {
                if (line.charCodeAt(j) === 124) { sep3 = j; break; }
              }
              if (sep3 >= 0) {
                hashes[count] = line.slice(0, sep1);
                authors[count] = line.slice(sep1 + 1, sep2);
                dates[count] = line.slice(sep2 + 1, sep3);
                messages[count] = line.slice(sep3 + 1);
                count = count + 1;
              }
            }
          }
        }
        lineStart = i + 1;
      }
    }

    return { hashes: hashes, authors: authors, dates: dates, messages: messages, count: count };
  }).then((result) => { applyLogResult(result); });
}

function applyLogResult(r: { hashes: string[]; authors: string[]; dates: string[]; messages: string[]; count: number }): void {
  logHashes = r.hashes;
  logAuthors = r.authors;
  logDates = r.dates;
  logMessages = r.messages;
  logCount = r.count;
  if (logReady > 0) {
    updateLogUI();
  }
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

    // Hash label (monospace, muted)
    const hashLabel = Text(hash);
    textSetFontSize(hashLabel, 10);
    textSetFontFamily(hashLabel, 10, 'Menlo');
    setFg(hashLabel, getSecondaryTextColor());

    // Message (primary text)
    const msgLabel = Text(msg);
    textSetFontSize(msgLabel, 11);
    setFg(msgLabel, getSideBarForeground());

    // Author + date (muted)
    let meta = author;
    meta += ', ';
    meta += date;
    const metaLabel = Text(meta);
    textSetFontSize(metaLabel, 10);
    setFg(metaLabel, getSecondaryTextColor());

    const commitRow = VStack(1, []);
    widgetAddChild(commitRow, HStack(4, [hashLabel, msgLabel]));
    widgetAddChild(commitRow, metaLabel);
    widgetAddChild(logContainer, commitRow);
  }

  widgetAddChild(logContainer, Spacer());
}
