/**
 * Timeline / local history panel (SHIP-V1-GAPS.md #85).
 *
 * Per-file git log view. Mounted via the sidebar-takeover pattern: a command
 * (`view.timeline`) opens it, replacing the file explorer until the user
 * navigates away. Each row shows abbreviated hash, age, author and subject;
 * clicking copies the hash to the clipboard so the user can paste it into
 * a terminal `git show` / `git checkout` / `git diff` invocation. Full per-
 * revision diff is gated on a "diff against revision" view that doesn't
 * exist yet (v1.1).
 *
 * Pure TS, argv-form spawn — Windows-safe (#1).
 */

import {
  VStack, HStack, Text, Button, Spacer, ScrollView,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  widgetAddChild, widgetClearChildren,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { spawnText } from '../../../process-compat';
import { clipboardWrite } from 'perry/ui';
import { setFg, setBtnFg, getFileName, monoFont } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getSecondaryTextColor } from '../../theme/theme-colors';

// ---------------------------------------------------------------------------
// Module-level state (Perry no-hoist)
// ---------------------------------------------------------------------------

let _container: unknown = null;
let _listContainer: unknown = null;
let _ready: number = 0;
let _activeFilePath: string = '';
let _workspaceRoot: string = '';
let _notifier: (msg: string) => void = _noopNotify;
function _noopNotify(_m: string): void {}

export function setTimelineNotifier(fn: (msg: string) => void): void {
  _notifier = fn;
}

export function setTimelineWorkspaceRoot(root: string): void {
  _workspaceRoot = root;
}

/** Mount into the sidebar container. Re-callable; clears+rebuilds. */
export function renderTimelinePanel(parent: unknown, _colors: ResolvedUIColors): void {
  _container = parent;
  _ready = 1;
  widgetClearChildren(parent);

  const title = Text(t('TIMELINE'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(parent, title);

  if (_activeFilePath.length > 0) {
    const sub = Text(getFileName(_activeFilePath));
    textSetFontSize(sub, 10);
    setFg(sub, getSecondaryTextColor());
    widgetAddChild(parent, sub);
  }

  _listContainer = VStack(2, []);
  const scroll = ScrollView();
  widgetAddChild(scroll, _listContainer);
  widgetAddChild(parent, scroll);

  rebuildRows();
}

/** Update the file the timeline is showing history for. Triggers refresh
 *  if the panel is currently mounted. */
export function setTimelineActiveFile(filePath: string): void {
  _activeFilePath = filePath;
  if (_ready > 0 && _container !== null) {
    rebuildRows();
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function rebuildRows(): void {
  if (_listContainer === null) return;
  widgetClearChildren(_listContainer);

  if (_activeFilePath.length < 1) {
    const empty = Text(t('Open a file to see its history.'));
    textSetFontSize(empty, 11);
    setFg(empty, getSecondaryTextColor());
    widgetAddChild(_listContainer, empty);
    return;
  }
  if (_workspaceRoot.length < 1) {
    const empty = Text(t('No workspace open.'));
    textSetFontSize(empty, 11);
    setFg(empty, getSecondaryTextColor());
    widgetAddChild(_listContainer, empty);
    return;
  }

  const entries = readGitFileLog(_activeFilePath);
  if (entries.length === 0) {
    const empty = Text(t('No history for this file.'));
    textSetFontSize(empty, 11);
    setFg(empty, getSecondaryTextColor());
    widgetAddChild(_listContainer, empty);
    return;
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    // entries[i] is `hash|author|age|subject` (raw line from git log).
    let p1 = -1;
    let p2 = -1;
    let p3 = -1;
    for (let j = 0; j < e.length; j++) {
      if (e.charCodeAt(j) === 124) { // '|'
        if (p1 < 0) p1 = j;
        else if (p2 < 0) p2 = j;
        else if (p3 < 0) { p3 = j; break; }
      }
    }
    if (p1 < 0 || p2 < 0 || p3 < 0) continue;
    const hash = e.slice(0, p1);
    const author = e.slice(p1 + 1, p2);
    const age = e.slice(p2 + 1, p3);
    let subject = e.slice(p3 + 1);
    if (subject.length > 64) subject = subject.slice(0, 63) + '…';

    const meta = Text(hash + '  ' + age + '  ' + author);
    textSetFontSize(meta, 10);
    textSetFontFamily(meta, monoFont());
    setFg(meta, getSecondaryTextColor());

    const subjBtn = Button(subject, () => { onRowClick(hash); });
    textSetFontSize(subjBtn, 11);
    setBtnFg(subjBtn, getSideBarForeground());

    const row = VStack(0, [meta, subjBtn]);
    widgetAddChild(_listContainer, row);
  }
}

function onRowClick(hash: string): void {
  // Copy the short hash so the user can paste into a terminal command.
  // Once a "diff against revision" tab exists this should open that instead.
  clipboardWrite(hash);
  _notifier(t('Copied commit hash: ') + hash);
}

/** Read up to 50 commits affecting `filePath`. Uses `--follow` so renames
 *  are tracked. Returns raw `hash|author|age|subject` lines. */
function readGitFileLog(filePath: string): string[] {
  let rel = filePath;
  if (filePath.length > _workspaceRoot.length) {
    let prefix = 1;
    for (let i = 0; i < _workspaceRoot.length; i++) {
      if (filePath.charCodeAt(i) !== _workspaceRoot.charCodeAt(i)) { prefix = 0; break; }
    }
    if (prefix > 0) {
      // strip workspace root + separator
      rel = filePath.slice(_workspaceRoot.length);
      if (rel.length > 0 && (rel.charCodeAt(0) === 47 || rel.charCodeAt(0) === 92)) {
        rel = rel.slice(1);
      }
    }
  }
  let out = '';
  try {
    const r = spawnText('git', [
      '-C', _workspaceRoot,
      'log', '--follow', '-n', '50',
      '--format=%h|%an|%ar|%s',
      '--', rel,
    ]);
    if (r.status === 0) out = r.stdout;
  } catch (_e: any) {}
  if (out.length < 1) return [];
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i <= out.length; i++) {
    if (i === out.length || out.charCodeAt(i) === 10) {
      if (i > start) lines.push(out.slice(start, i));
      start = i + 1;
    }
  }
  return lines;
}
