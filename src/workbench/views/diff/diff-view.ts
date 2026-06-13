/**
 * Diff view — side-by-side editor comparison.
 *
 * Creates two read-only Editor instances showing HEAD (left) and working copy (right)
 * with green/red line backgrounds for added/deleted lines.
 *
 * All state is module-level (Perry closures capture by value).
 */

import {
  VStack, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered,
  widgetAddChild, widgetClearChildren,
  widgetSetHugging, widgetSetHidden, widgetSetWidth,
  widgetMatchParentHeight,
  stackSetDistribution,
  embedNSView,
} from 'perry/ui';
import { Editor } from '@honeide/editor/perry';
import { readFileSync } from 'fs';
import { spawnText } from '../../../process-compat';
import { spawn } from 'perry/thread';
import { parseDiffOutput, countLines } from './diff-parser';
import { setBg, setFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getEditorBackground, getEditorForeground } from '../../theme/theme-colors';

// FFI function from @honeide/editor — returns raw NSView* for an EditorView
declare function hone_editor_nsview(handle: number): number;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let diffLeftEditor: Editor | null = null;
let diffRightEditor: Editor | null = null;
// SHIP-V1-GAPS.md #104: inline mode uses a single editor with unified content.
let diffInlineEditor: Editor | null = null;
let diffContainer: unknown = null;
let diffHeaderWidget: unknown = null;
let diffEditorsWidget: unknown = null;
let diffActive: number = 0;
let diffFilePath = '';
let panelColors: ResolvedUIColors = null as any;

// Strip a leading UTF-8 BOM (U+FEFF) so it isn't a phantom leading char in
// the read-only diff editors. See iter-64 main-editor fix for the rationale.
function stripLeadingBOM(s: string): string {
  if (s.length > 0 && s.charCodeAt(0) === 0xFEFF) return s.slice(1);
  return s;
}

// SHIP-V1-GAPS.md #104: view mode (0 = side-by-side, 1 = inline).
let diffViewMode: number = 0;
// Cached payload so a toggle can re-render without re-fetching from git.
let lastDiffFilePath: string = '';
let lastDiffRelPath: string = '';
let lastDiffOldContent: string = '';
let lastDiffNewContent: string = '';
let lastDiffText: string = '';

// Diff line background colors (RGBA 0.0–1.0)
const DEL_R = 0.55;
const DEL_G = 0.12;
const DEL_B = 0.12;
const DEL_A = 0.60;

const ADD_R = 0.12;
const ADD_G = 0.55;
const ADD_B = 0.12;
const ADD_A = 0.60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeReadFile(filePath: string): string {
  let content = '';
  try {
    content = readFileSync(filePath);
  } catch (e) {
    return '';
  }
  return content;
}

function getFileName(path: string): string {
  let lastSlash = -1;
  for (let i = 0; i < path.length; i++) {
    if (path.charCodeAt(i) === 47) lastSlash = i;
  }
  if (lastSlash >= 0) return path.slice(lastSlash + 1);
  return path;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Build the diff view layout into a container. Call once during init. */
export function renderDiffView(container: unknown, colors: ResolvedUIColors): void {
  panelColors = colors;
  diffContainer = container;
}

/** Set theme colors for the diff view. */
export function setDiffThemeColors(colors: ResolvedUIColors): void {
  panelColors = colors;
}

/** Returns 1 if the diff view is currently showing, 0 otherwise. */
export function isDiffActive(): number {
  return diffActive;
}

/**
 * Open a side-by-side diff for a file.
 * Data fetching (git show, readFileSync, git diff) runs on a background thread.
 * UI construction happens on the main thread via .then().
 *
 * @param filePath  Absolute path to the working copy file
 * @param relPath   Path relative to workspace root (for git commands)
 * @param wsRoot    Workspace root directory
 * @param staged    If > 0, use `git diff --cached` for staged changes
 */
export function openDiffForFile(filePath: string, relPath: string, wsRoot: string, staged: number): void {
  // Close any existing diff first
  if (diffActive > 0) {
    closeDiffView();
  }

  if (!diffContainer) return;

  // Capture immutable values for spawn closure
  const fp = filePath;
  const rp = relPath;
  const ws = wsRoot;
  const stg = staged;

  spawn(() => {
    // All git commands + file reads run on a background thread.
    // SHIP-V1-GAPS.md #1: argv-form. `rp` and `ws` are user-controlled
    // (workspace + relative path) and could contain spaces or shell
    // metacharacters; previous shell-string form was an injection vector.
    let oldContent = '';
    try {
      const r = spawnText('git', ['-C', ws, 'show', 'HEAD:' + rp]);
      if (r.status === 0) oldContent = r.stdout;
    } catch (e) { oldContent = ''; }

    let newContent = '';
    try { newContent = readFileSync(fp); } catch (e) { newContent = ''; }

    let diffText = '';
    if (stg > 0) {
      try {
        const r = spawnText('git', ['-C', ws, 'diff', '--cached', '--', rp]);
        if (r.status === 0) diffText = r.stdout;
      } catch (e) { diffText = ''; }
    } else {
      try {
        const r = spawnText('git', ['-C', ws, 'diff', '--', rp]);
        if (r.status === 0) diffText = r.stdout;
      } catch (e) { diffText = ''; }
    }

    return { oldContent: oldContent, newContent: newContent, diffText: diffText };
  }).then((data) => { buildDiffUI(fp, rp, data); });
}

interface DiffData {
  oldContent: string;
  newContent: string;
  diffText: string;
}

/** Build diff UI on the main thread after data is fetched. */
function buildDiffUI(filePath: string, relPath: string, data: DiffData): void {
  if (!diffContainer) return;

  // Cache for in-place mode toggle.
  lastDiffFilePath = filePath;
  lastDiffRelPath = relPath;
  lastDiffOldContent = data.oldContent;
  lastDiffNewContent = data.newContent;
  lastDiffText = data.diffText;

  renderCurrentDiffMode();
}

/** Render the diff in the current `diffViewMode` using cached data. */
function renderCurrentDiffMode(): void {
  if (!diffContainer) return;

  // Tear down any prior editors first.
  if (diffEditorsWidget) widgetClearChildren(diffEditorsWidget);
  if (diffLeftEditor !== null) { diffLeftEditor.dispose(); diffLeftEditor = null; }
  if (diffRightEditor !== null) { diffRightEditor.dispose(); diffRightEditor = null; }
  if (diffInlineEditor !== null) { diffInlineEditor.dispose(); diffInlineEditor = null; }

  widgetClearChildren(diffContainer);

  // ---- Header ----
  const headerRow = HStack(8, []);
  if (panelColors) setBg(headerRow, getEditorBackground());

  if (diffViewMode === 0) {
    const leftLabel = Text(lastDiffRelPath + ' (HEAD)');
    textSetFontSize(leftLabel, 11);
    textSetFontWeight(leftLabel, 11, 0.5);
    if (panelColors) setFg(leftLabel, getEditorForeground());

    const rightLabel = Text(lastDiffRelPath + ' (Working Copy)');
    textSetFontSize(rightLabel, 11);
    textSetFontWeight(rightLabel, 11, 0.5);
    if (panelColors) setFg(rightLabel, getEditorForeground());

    widgetAddChild(headerRow, leftLabel);
    widgetAddChild(headerRow, Spacer());
    widgetAddChild(headerRow, rightLabel);
    widgetAddChild(headerRow, Spacer());
  } else {
    const inlineLabel = Text(lastDiffRelPath + ' (inline)');
    textSetFontSize(inlineLabel, 11);
    textSetFontWeight(inlineLabel, 11, 0.5);
    if (panelColors) setFg(inlineLabel, getEditorForeground());
    widgetAddChild(headerRow, inlineLabel);
    widgetAddChild(headerRow, Spacer());
  }

  // Mode-toggle button — SHIP-V1-GAPS.md #104.
  const toggleLabel = diffViewMode === 0 ? 'Inline' : 'Side by side';
  const toggleBtn = Button(toggleLabel, () => { toggleDiffViewMode(); });
  buttonSetBordered(toggleBtn, 0);
  textSetFontSize(toggleBtn, 11);
  widgetAddChild(headerRow, toggleBtn);

  // ---- Editors ----
  let editorsRow: unknown;
  if (diffViewMode === 0) {
    editorsRow = buildSideBySideEditors();
  } else {
    editorsRow = buildInlineEditor();
  }
  widgetSetHugging(editorsRow, 1);

  widgetAddChild(diffContainer, headerRow);
  widgetAddChild(diffContainer, editorsRow);

  diffHeaderWidget = headerRow;
  diffEditorsWidget = editorsRow;

  diffActive = 1;
  diffFilePath = lastDiffFilePath;
}

function buildSideBySideEditors(): unknown {
  const oldContent = lastDiffOldContent;
  const newContent = lastDiffNewContent;
  const diffText = lastDiffText;

  const oldLineCount = countLines(oldContent);
  const newLineCount = countLines(newContent);
  const parsed = parseDiffOutput(diffText, oldLineCount, newLineCount);
  const oldLineTypes = parsed.oldLineTypes;
  const newLineTypes = parsed.newLineTypes;

  const leftEd = new Editor(400, 600, { readOnly: true });
  const rightEd = new Editor(400, 600, { readOnly: true });
  diffLeftEditor = leftEd;
  diffRightEditor = rightEd;

  // Strip a leading UTF-8 BOM from each side so a Notepad/VS-authored file
  // doesn't show a phantom zero-width char at line 1 in the diff pane (same
  // class as the iter-64 main-editor fix; here it's display-only, read-only
  // editors — no save path — so a local strip is sufficient).
  leftEd.setContent(stripLeadingBOM(oldContent));
  rightEd.setContent(stripLeadingBOM(newContent));

  for (let i = 1; i <= oldLineCount; i++) {
    if (oldLineTypes[i] === 1) leftEd.setLineBackground(i, DEL_R, DEL_G, DEL_B, DEL_A);
  }
  for (let i = 1; i <= newLineCount; i++) {
    if (newLineTypes[i] === 1) rightEd.setLineBackground(i, ADD_R, ADD_G, ADD_B, ADD_A);
  }
  if (oldContent.length < 1 && newContent.length > 0) {
    for (let i = 1; i <= newLineCount; i++) rightEd.setLineBackground(i, ADD_R, ADD_G, ADD_B, ADD_A);
  }
  if (newContent.length < 1 && oldContent.length > 0) {
    for (let i = 1; i <= oldLineCount; i++) leftEd.setLineBackground(i, DEL_R, DEL_G, DEL_B, DEL_A);
  }

  leftEd.render();
  rightEd.render();

  const leftNsview = hone_editor_nsview(leftEd.nativeHandle as number);
  const leftWidget = embedNSView(leftNsview);
  widgetSetHugging(leftWidget, 1);

  const rightNsview = hone_editor_nsview(rightEd.nativeHandle as number);
  const rightWidget = embedNSView(rightNsview);
  widgetSetHugging(rightWidget, 1);

  const editorsRow = HStack(0, [leftWidget, rightWidget]);
  stackSetDistribution(editorsRow, 1);
  widgetMatchParentHeight(leftWidget);
  widgetMatchParentHeight(rightWidget);
  return editorsRow;
}

function buildInlineEditor(): unknown {
  // Build a unified-diff body: walk hunks, emitting context / deletion /
  // addition lines. Each emitted line's index in the visible editor maps
  // 1:1 to the entry we record so we can paint backgrounds afterwards.
  const diffText = lastDiffText;

  let body = '';
  const lineTypes: number[] = [0]; // index 0 unused
  let inHunk = 0;
  let pos = 0;
  while (pos < diffText.length) {
    let lineEnd = pos;
    while (lineEnd < diffText.length && diffText.charCodeAt(lineEnd) !== 10) lineEnd = lineEnd + 1;
    // Strip a trailing CR so CRLF-committed files (the Git-for-Windows
    // core.autocrlf=true default) don't render a stray control glyph at the
    // end of every diff line. git diff terminates its OWN lines with \n, but
    // reproduces file content verbatim — so each +/-/context line of a CRLF
    // file arrives as "<content>\r" before that \n. The buffer's insert()
    // (unlike its constructor) does NOT normalize line endings, so the \r
    // would land in the editor as-is. Invisible on macOS/Linux (LF-only).
    let contentEnd = lineEnd;
    if (contentEnd > pos && diffText.charCodeAt(contentEnd - 1) === 13) contentEnd = contentEnd - 1;
    const lineLen = contentEnd - pos;

    if (lineLen >= 2 && diffText.charCodeAt(pos) === 64 && diffText.charCodeAt(pos + 1) === 64) {
      inHunk = 1;
      // Emit the hunk header as a separator line.
      body += diffText.slice(pos, contentEnd);
      body += '\n';
      lineTypes.push(2); // hunk header
    } else if (inHunk > 0 && lineLen >= 1) {
      const c = diffText.charCodeAt(pos);
      if (c === 45) { // '-'
        body += diffText.slice(pos, contentEnd);
        body += '\n';
        lineTypes.push(1); // deletion
      } else if (c === 43) { // '+'
        body += diffText.slice(pos, contentEnd);
        body += '\n';
        lineTypes.push(3); // addition
      } else if (c === 32) { // ' '
        body += diffText.slice(pos, contentEnd);
        body += '\n';
        lineTypes.push(0); // context
      } else if (c === 92) {
        // "\ No newline at end of file" — drop.
      } else {
        inHunk = 0;
      }
    }
    pos = lineEnd + 1;
  }

  // Fall back to the raw diff if we found no hunks (e.g. binary file).
  if (lineTypes.length <= 1) {
    body = diffText;
    const lc = countLines(diffText);
    for (let i = 1; i <= lc; i++) lineTypes.push(0);
  }

  const ed = new Editor(800, 600, { readOnly: true });
  diffInlineEditor = ed;
  ed.setContent(body);
  for (let i = 1; i < lineTypes.length; i++) {
    const t = lineTypes[i];
    if (t === 1) ed.setLineBackground(i, DEL_R, DEL_G, DEL_B, DEL_A);
    else if (t === 3) ed.setLineBackground(i, ADD_R, ADD_G, ADD_B, ADD_A);
  }
  ed.render();

  const nsview = hone_editor_nsview(ed.nativeHandle as number);
  const w = embedNSView(nsview);
  widgetSetHugging(w, 1);
  const row = HStack(0, [w]);
  widgetMatchParentHeight(w);
  return row;
}

/** Public toggle so callers can wire a top-level keybinding to it. */
export function toggleDiffViewMode(): void {
  if (diffActive < 1) return;
  diffViewMode = diffViewMode === 0 ? 1 : 0;
  renderCurrentDiffMode();
}

/** Close the diff view and dispose editors. */
export function closeDiffView(): void {
  // IMPORTANT: Clear the HStack children FIRST to detach embedded NSViews
  // from the Auto Layout hierarchy. Then dispose editors (which destroy
  // the native NSViews). If we dispose first, the HStack still holds
  // references to destroyed NSViews and Auto Layout crashes.
  if (diffEditorsWidget) {
    widgetClearChildren(diffEditorsWidget);
  }
  if (diffLeftEditor !== null) {
    diffLeftEditor.dispose();
    diffLeftEditor = null;
  }
  if (diffRightEditor !== null) {
    diffRightEditor.dispose();
    diffRightEditor = null;
  }
  if (diffInlineEditor !== null) {
    diffInlineEditor.dispose();
    diffInlineEditor = null;
  }
  diffHeaderWidget = null;
  diffEditorsWidget = null;
  diffActive = 0;
  diffFilePath = '';
}

/** Get the diff header widget (for adding to external layout). */
export function getDiffHeaderWidget(): unknown {
  return diffHeaderWidget;
}

/** Get the diff editors widget (for adding to external layout). */
export function getDiffEditorsWidget(): unknown {
  return diffEditorsWidget;
}

/** Get the file path of the currently displayed diff. */
export function getDiffFilePath(): string {
  return diffFilePath;
}
