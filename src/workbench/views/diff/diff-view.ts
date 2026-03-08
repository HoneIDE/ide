/**
 * Diff view — side-by-side editor comparison.
 *
 * Creates two read-only Editor instances showing HEAD (left) and working copy (right)
 * with green/red line backgrounds for added/deleted lines.
 *
 * All state is module-level (Perry closures capture by value).
 */

import {
  VStack, HStack, Text, Spacer,
  textSetFontSize, textSetFontWeight,
  widgetAddChild, widgetClearChildren,
  widgetSetHugging, widgetSetHidden, widgetSetWidth,
  widgetMatchParentHeight,
  stackSetDistribution,
  embedNSView,
} from 'perry/ui';
import { Editor } from '@honeide/editor/perry';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
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
let diffContainer: unknown = null;
let diffHeaderWidget: unknown = null;
let diffEditorsWidget: unknown = null;
let diffActive: number = 0;
let diffFilePath = '';
let panelColors: ResolvedUIColors = null as any;

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

function execGit(cmd: string): string {
  let result = '';
  try {
    result = execSync(cmd) as unknown as string;
  } catch (e) {
    return '';
  }
  return result;
}

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

  // Get HEAD version of the file
  let oldContent = '';
  if (staged > 0) {
    oldContent = execGit('git -C ' + wsRoot + ' show HEAD:' + relPath);
  } else {
    oldContent = execGit('git -C ' + wsRoot + ' show HEAD:' + relPath);
  }

  // Read working copy
  const newContent = safeReadFile(filePath);

  // Get unified diff
  let diffText = '';
  if (staged > 0) {
    diffText = execGit('git -C ' + wsRoot + ' diff --cached -- ' + relPath);
  } else {
    diffText = execGit('git -C ' + wsRoot + ' diff -- ' + relPath);
  }

  const oldLineCount = countLines(oldContent);
  const newLineCount = countLines(newContent);

  // Parse diff to get line types
  const parsed = parseDiffOutput(diffText, oldLineCount, newLineCount);
  const oldLineTypes = parsed.oldLineTypes;
  const newLineTypes = parsed.newLineTypes;

  // Build header
  widgetClearChildren(diffContainer);

  const headerRow = HStack(8, []);
  if (panelColors) setBg(headerRow, getEditorBackground());

  const leftLabel = Text(relPath + ' (HEAD)');
  textSetFontSize(leftLabel, 11);
  textSetFontWeight(leftLabel, 11, 0.5);
  if (panelColors) setFg(leftLabel, getEditorForeground());

  const rightLabel = Text(relPath + ' (Working Copy)');
  textSetFontSize(rightLabel, 11);
  textSetFontWeight(rightLabel, 11, 0.5);
  if (panelColors) setFg(rightLabel, getEditorForeground());

  widgetAddChild(headerRow, leftLabel);
  widgetAddChild(headerRow, Spacer());
  widgetAddChild(headerRow, rightLabel);
  widgetAddChild(headerRow, Spacer());

  // Create two read-only editors side by side
  const leftEd = new Editor(400, 600, { readOnly: true });
  const rightEd = new Editor(400, 600, { readOnly: true });

  diffLeftEditor = leftEd;
  diffRightEditor = rightEd;

  // Set content
  leftEd.setContent(oldContent);
  rightEd.setContent(newContent);

  // Apply line backgrounds
  for (let i = 1; i <= oldLineCount; i++) {
    if (oldLineTypes[i] === 1) {
      leftEd.setLineBackground(i, DEL_R, DEL_G, DEL_B, DEL_A);
    }
  }
  for (let i = 1; i <= newLineCount; i++) {
    if (newLineTypes[i] === 1) {
      rightEd.setLineBackground(i, ADD_R, ADD_G, ADD_B, ADD_A);
    }
  }

  // If new file (no HEAD content), mark all new lines as added
  if (oldContent.length < 1 && newContent.length > 0) {
    for (let i = 1; i <= newLineCount; i++) {
      rightEd.setLineBackground(i, ADD_R, ADD_G, ADD_B, ADD_A);
    }
  }

  // If deleted file (no working copy), mark all old lines as deleted
  if (newContent.length < 1 && oldContent.length > 0) {
    for (let i = 1; i <= oldLineCount; i++) {
      leftEd.setLineBackground(i, DEL_R, DEL_G, DEL_B, DEL_A);
    }
  }

  // Render
  leftEd.render();
  rightEd.render();

  // Embed directly into HStack (no VStack wrappers — they prevent
  // the VStack Fill distribution from sizing the HStack properly).
  const leftNsview = hone_editor_nsview(leftEd.nativeHandle as number);
  const leftWidget = embedNSView(leftNsview);
  widgetSetHugging(leftWidget, 1);

  const rightNsview = hone_editor_nsview(rightEd.nativeHandle as number);
  const rightWidget = embedNSView(rightNsview);
  widgetSetHugging(rightWidget, 1);

  const editorsRow = HStack(0, [leftWidget, rightWidget]);
  stackSetDistribution(editorsRow, 1); // FillEqually — both editors get equal width
  widgetSetHugging(editorsRow, 1);

  // Pin each editor to fill the HStack height
  widgetMatchParentHeight(leftWidget);
  widgetMatchParentHeight(rightWidget);

  // Store widgets for external layout (render.ts adds them to editorPane directly)
  diffHeaderWidget = headerRow;
  diffEditorsWidget = editorsRow;

  diffActive = 1;
  diffFilePath = filePath;
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
