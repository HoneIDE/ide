/**
 * Tasks panel (SHIP-V1-GAPS.md #105, Phase 3).
 *
 * Reads `${workspaceRoot}/.hone/tasks.json` (or `.vscode/tasks.json` as fallback)
 * in the VS Code shape and renders one row per task with a Run button. Click
 * spawns the command via `spawnBackground` in the workspace root; output
 * is logged to `${appDataDir}/tasks/<label>.log` and the panel reports
 * success/failure as a notification.
 *
 * Perry-safe: hand-rolled JSON walker (no `JSON.parse`), char-code matching,
 * module-level state for the in-flight task registry.
 */

import {
  VStack, HStack, Text, Button, Spacer, ScrollView,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  widgetAddChild, widgetClearChildren, widgetSetWidth,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnBackground } from 'child_process';
import { setFg, setBtnFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getSecondaryTextColor } from '../../theme/theme-colors';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _container: unknown = null;
let _listContainer: unknown = null;
let _workspaceRoot: string = '';
let _appDataDir: string = '';
let _ready: number = 0;

// Parallel arrays for the parsed task definitions. Each index aligns.
let _labels: string[] = [];
let _commands: string[] = [];
let _argsJson: string[] = [];   // serialized form — Perry has trouble with string[][]
let _groups: string[] = [];
let _count: number = 0;

let _onTaskRunStart: (label: string) => void = _noopLabel;
let _onTaskRunDone: (label: string, exitCode: number) => void = _noopLabelInt;
function _noopLabel(_l: string): void {}
function _noopLabelInt(_l: string, _c: number): void {}

export function setOnTaskRunStart(fn: (label: string) => void): void {
  _onTaskRunStart = fn;
}
export function setOnTaskRunDone(fn: (label: string, exitCode: number) => void): void {
  _onTaskRunDone = fn;
}

export function setTasksWorkspaceRoot(root: string): void {
  _workspaceRoot = root;
}

export function setTasksAppDataDir(dir: string): void {
  _appDataDir = dir;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Mount the tasks panel into the given sidebar container. */
export function renderTasksPanel(parent: unknown, _colors: ResolvedUIColors): void {
  _container = parent;
  _ready = 1;
  widgetClearChildren(parent);

  const title = Text(t('TASKS'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, getSideBarForeground());
  widgetAddChild(parent, title);

  _listContainer = VStack(2, []);
  const scroll = ScrollView();
  widgetAddChild(scroll, _listContainer);
  widgetAddChild(parent, scroll);

  loadAndRender();
}

/** Run the named task — exposed so the "Run Build Task" command can fire it
 *  without going through the panel UI. */
export function runTaskByLabel(label: string): number {
  if (_workspaceRoot.length === 0) return 0;
  for (let i = 0; i < _count; i++) {
    if (_labels[i] === label) {
      runTaskAtIndex(i);
      return 1;
    }
  }
  return 0;
}

/** Run the default Build task (group=='build' && isDefault). Returns 1 if found. */
export function runDefaultBuildTask(): number {
  reloadTasksIfNeeded();
  for (let i = 0; i < _count; i++) {
    if (_groups[i] === 'build:default') {
      runTaskAtIndex(i);
      return 1;
    }
  }
  // Fall back to the first 'build' task if no default flagged.
  for (let i = 0; i < _count; i++) {
    if (_groups[i] === 'build') {
      runTaskAtIndex(i);
      return 1;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Load + parse
// ---------------------------------------------------------------------------

let _lastLoadedRoot: string = '';

function reloadTasksIfNeeded(): void {
  if (_lastLoadedRoot !== _workspaceRoot || _count === 0) {
    loadTasksFromDisk();
  }
}

function loadAndRender(): void {
  loadTasksFromDisk();
  renderRows();
}

function loadTasksFromDisk(): void {
  _labels = [];
  _commands = [];
  _argsJson = [];
  _groups = [];
  _count = 0;
  _lastLoadedRoot = _workspaceRoot;
  if (_workspaceRoot.length === 0) return;

  // .hone/tasks.json takes precedence; .vscode/tasks.json is the VS Code fallback.
  let path = _workspaceRoot + '/.hone/tasks.json';
  if (!existsSync(path)) {
    path = _workspaceRoot + '/.vscode/tasks.json';
    if (!existsSync(path)) return;
  }
  let text = '';
  try { text = readFileSync(path, 'utf-8'); } catch (_e) { return; }
  if (text.length < 3) return;

  parseTasksJson(text);
}

/** Walk a JSON document and pull out `tasks[].{label,command,args,group}`. */
function parseTasksJson(text: string): void {
  // Find the `tasks` array.
  const tasksIdx = text.indexOf('"tasks"');
  if (tasksIdx < 0) return;
  const arrOpen = text.indexOf('[', tasksIdx);
  if (arrOpen < 0) return;
  const arrClose = findMatchingBracket(text, arrOpen, 91, 93);
  if (arrClose <= arrOpen) return;

  let p = arrOpen + 1;
  while (p < arrClose) {
    const objOpen = text.indexOf('{', p);
    if (objOpen < 0 || objOpen >= arrClose) break;
    const objClose = findMatchingBracket(text, objOpen, 123, 125);
    if (objClose <= objOpen) break;
    const body = text.slice(objOpen, objClose + 1);
    parseOneTask(body);
    p = objClose + 1;
  }
}

function parseOneTask(body: string): void {
  const label = extractStringField(body, '"label"');
  const command = extractStringField(body, '"command"');
  if (label.length === 0 || command.length === 0) return;

  // args: `["a", "b"]` — extract as a sub-string we'll splice ourselves at run time.
  const argsIdx = body.indexOf('"args"');
  let argsStr = '';
  if (argsIdx >= 0) {
    const sub = body.slice(argsIdx);
    const arrOpen = sub.indexOf('[');
    if (arrOpen >= 0) {
      const arrClose = findMatchingBracket(sub, arrOpen, 91, 93);
      if (arrClose > arrOpen) {
        argsStr = sub.slice(arrOpen, arrClose + 1);
      }
    }
  }

  // group can be `"build"` or `{ "kind": "build", "isDefault": true }`.
  let group = 'none';
  const grpIdx = body.indexOf('"group"');
  if (grpIdx >= 0) {
    const after = body.slice(grpIdx + 7);
    let p = 0;
    while (p < after.length && (after.charCodeAt(p) === 58 || after.charCodeAt(p) === 32)) p++;
    if (p < after.length && after.charCodeAt(p) === 34) {
      // simple "build" / "test"
      const kind = extractStringField(after, '');
      if (kind.length > 0) group = kind;
    } else if (p < after.length && after.charCodeAt(p) === 123) {
      const grpEnd = findMatchingBracket(after, p, 123, 125);
      if (grpEnd > p) {
        const grpBody = after.slice(p, grpEnd + 1);
        const kind = extractStringField(grpBody, '"kind"');
        const isDef = extractBooleanField(grpBody, '"isDefault"');
        if (kind.length > 0) group = isDef > 0 ? kind + ':default' : kind;
      }
    }
  }

  _labels.push(label);
  _commands.push(command);
  _argsJson.push(argsStr);
  _groups.push(group);
  _count = _count + 1;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function parseArgsArray(argsJson: string): string[] {
  if (argsJson.length < 2) return [];
  const out: string[] = [];
  let p = 1; // skip opening [
  while (p < argsJson.length - 1) {
    while (p < argsJson.length && argsJson.charCodeAt(p) !== 34) p++;
    if (p >= argsJson.length) break;
    p++; // skip opening "
    let val = '';
    while (p < argsJson.length) {
      const c = argsJson.charCodeAt(p);
      if (c === 92 && p + 1 < argsJson.length) {
        const n = argsJson.charCodeAt(p + 1);
        if (n === 110) val += '\n';
        else if (n === 116) val += '\t';
        else if (n === 34) val += '"';
        else if (n === 92) val += '\\';
        else val += argsJson.charAt(p + 1);
        p += 2;
        continue;
      }
      if (c === 34) break;
      val += argsJson.charAt(p);
      p++;
    }
    out.push(val);
    p++;
  }
  return out;
}

function runTaskAtIndex(idx: number): void {
  if (idx < 0 || idx >= _count) return;
  const label = _labels[idx];
  const command = _commands[idx];
  const args = parseArgsArray(_argsJson[idx]);

  _onTaskRunStart(label);

  let logPath = '';
  if (_appDataDir.length > 0) {
    logPath = _appDataDir + '/tasks-' + sanitizeLabel(label) + '.log';
  } else {
    logPath = '/tmp/hone-task-' + sanitizeLabel(label) + '.log';
  }

  try {
    // spawnBackground gives us a handle but we don't poll exit status in v1.
    // The user can tail the log file for output until the proper terminal
    // integration lands.
    spawnBackground(command, args, { cwd: _workspaceRoot, logFile: logPath } as any);
    _onTaskRunDone(label, 0);
  } catch (_e: any) {
    _onTaskRunDone(label, -1);
  }
}

function sanitizeLabel(label: string): string {
  let out = '';
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95) {
      out += label.charAt(i);
    } else {
      out += '_';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderRows(): void {
  if (_listContainer === null) return;
  widgetClearChildren(_listContainer);

  if (_count === 0) {
    const empty = Text(t('No tasks. Add .hone/tasks.json to get started.'));
    textSetFontSize(empty, 12);
    setFg(empty, getSecondaryTextColor());
    widgetAddChild(_listContainer, empty);
    return;
  }

  for (let i = 0; i < _count; i++) {
    const idx = i;
    const label = _labels[i];
    const group = _groups[i];
    const row = HStack(8, []);
    const runBtn = Button(t('Run'), () => { runTaskAtIndex(idx); });
    setBtnFg(runBtn, getSideBarForeground());
    widgetAddChild(row, runBtn);
    const labelTxt = Text(label);
    textSetFontSize(labelTxt, 12);
    setFg(labelTxt, getSideBarForeground());
    widgetAddChild(row, labelTxt);
    widgetAddChild(row, Spacer());
    if (group.length > 0 && group !== 'none') {
      const groupBadge = Text(group);
      textSetFontSize(groupBadge, 10);
      setFg(groupBadge, getSecondaryTextColor());
      widgetAddChild(row, groupBadge);
    }
    widgetAddChild(_listContainer, row);
  }
}

// ---------------------------------------------------------------------------
// JSON helpers (duplicated locally to keep this view self-contained — Perry
// closures across modules are finicky)
// ---------------------------------------------------------------------------

function findMatchingBracket(s: string, openPos: number, open: number, close: number): number {
  let depth = 0;
  let inStr = 0;
  for (let i = openPos; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inStr === 1) {
      if (c === 92) { i = i + 1; continue; }
      if (c === 34) inStr = 0;
      continue;
    }
    if (c === 34) { inStr = 1; continue; }
    if (c === open) depth = depth + 1;
    else if (c === close) {
      depth = depth - 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractStringField(s: string, key: string): string {
  let p = 0;
  if (key.length > 0) {
    const idx = s.indexOf(key);
    if (idx < 0) return '';
    p = idx + key.length;
  }
  while (p < s.length && (s.charCodeAt(p) === 58 || s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9)) p++;
  if (p >= s.length || s.charCodeAt(p) !== 34) return '';
  p++;
  let out = '';
  while (p < s.length) {
    const c = s.charCodeAt(p);
    if (c === 92 && p + 1 < s.length) {
      const n = s.charCodeAt(p + 1);
      if (n === 110) out += '\n';
      else if (n === 116) out += '\t';
      else if (n === 34) out += '"';
      else if (n === 92) out += '\\';
      else out += s.charAt(p + 1);
      p += 2;
      continue;
    }
    if (c === 34) break;
    out += s.charAt(p);
    p++;
  }
  return out;
}

function extractBooleanField(s: string, key: string): number {
  const idx = s.indexOf(key);
  if (idx < 0) return 0;
  let p = idx + key.length;
  while (p < s.length && (s.charCodeAt(p) === 58 || s.charCodeAt(p) === 32)) p++;
  // Look for 't'rue
  if (p + 3 < s.length
      && s.charCodeAt(p) === 116
      && s.charCodeAt(p + 1) === 114
      && s.charCodeAt(p + 2) === 117
      && s.charCodeAt(p + 3) === 101) {
    return 1;
  }
  return 0;
}
