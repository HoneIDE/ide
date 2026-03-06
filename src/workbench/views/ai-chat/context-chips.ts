/**
 * Context attachment UI — file/selection context chips.
 * Uses module-level arrays for storage (Perry constraint: max 8 context items).
 */
import {
  HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontFamily,
  buttonSetBordered,
  widgetAddChild, widgetSetBackgroundColor,
} from 'perry/ui';
import { setFg, setBtnFg } from '../../ui-helpers';
import { jsonEscape } from './sse-parser';
import type { ResolvedUIColors } from '../../theme/theme-loader';

// Module-level state — 8 context slots (avoid arrays-of-strings in Perry)
let ctx0Path = ''; let ctx0Content = '';
let ctx1Path = ''; let ctx1Content = '';
let ctx2Path = ''; let ctx2Content = '';
let ctx3Path = ''; let ctx3Content = '';
let ctx4Path = ''; let ctx4Content = '';
let ctx5Path = ''; let ctx5Content = '';
let ctx6Path = ''; let ctx6Content = '';
let ctx7Path = ''; let ctx7Content = '';
let contextCount: number = 0;

// Callback for re-rendering chips
let renderChipsCb: (() => void) | null = null;

export function setChipsRenderCallback(cb: () => void): void {
  renderChipsCb = cb;
}

function getCtxPath(idx: number): string {
  if (idx === 0) return ctx0Path;
  if (idx === 1) return ctx1Path;
  if (idx === 2) return ctx2Path;
  if (idx === 3) return ctx3Path;
  if (idx === 4) return ctx4Path;
  if (idx === 5) return ctx5Path;
  if (idx === 6) return ctx6Path;
  if (idx === 7) return ctx7Path;
  return '';
}

function getCtxContent(idx: number): string {
  if (idx === 0) return ctx0Content;
  if (idx === 1) return ctx1Content;
  if (idx === 2) return ctx2Content;
  if (idx === 3) return ctx3Content;
  if (idx === 4) return ctx4Content;
  if (idx === 5) return ctx5Content;
  if (idx === 6) return ctx6Content;
  if (idx === 7) return ctx7Content;
  return '';
}

function setCtx(idx: number, path: string, content: string): void {
  if (idx === 0) { ctx0Path = path; ctx0Content = content; }
  if (idx === 1) { ctx1Path = path; ctx1Content = content; }
  if (idx === 2) { ctx2Path = path; ctx2Content = content; }
  if (idx === 3) { ctx3Path = path; ctx3Content = content; }
  if (idx === 4) { ctx4Path = path; ctx4Content = content; }
  if (idx === 5) { ctx5Path = path; ctx5Content = content; }
  if (idx === 6) { ctx6Path = path; ctx6Content = content; }
  if (idx === 7) { ctx7Path = path; ctx7Content = content; }
}

/** Add file context. Returns 1 on success, 0 if full. */
export function addFileContext(path: string, content: string): number {
  if (contextCount >= 8) return 0;
  // Check for duplicate
  for (let i = 0; i < contextCount; i++) {
    const existingPath = getCtxPath(i);
    if (existingPath.length === path.length) {
      let same = 1;
      for (let j = 0; j < path.length; j++) {
        if (existingPath.charCodeAt(j) !== path.charCodeAt(j)) { same = 0; break; }
      }
      if (same > 0) return 0; // already attached
    }
  }
  setCtx(contextCount, path, content);
  contextCount += 1;
  return 1;
}

/** Remove context at index, shift remaining down. */
export function removeContext(idx: number): void {
  if (idx < 0 || idx >= contextCount) return;
  // Shift down
  for (let i = idx; i < contextCount - 1; i++) {
    setCtx(i, getCtxPath(i + 1), getCtxContent(i + 1));
  }
  contextCount -= 1;
  setCtx(contextCount, '', '');
}

/** Clear all context. */
export function clearContext(): void {
  for (let i = 0; i < 8; i++) {
    setCtx(i, '', '');
  }
  contextCount = 0;
}

/** Get context count. */
export function getContextCount(): number {
  return contextCount;
}

/** Build XML-tagged context string for system prompt. */
export function buildContextString(): string {
  if (contextCount < 1) return '';
  let result = '\n\nAttached context:\n';
  for (let i = 0; i < contextCount; i++) {
    const path = getCtxPath(i);
    let content = getCtxContent(i);
    if (content.length > 8000) {
      content = content.slice(0, 8000) + '\n... (truncated)';
    }
    result += '<file path="' + path + '">\n' + content + '\n</file>\n';
  }
  return result;
}

/** Rough token estimate: chars / 4. */
export function getContextTokenEstimate(): number {
  let total = 0;
  for (let i = 0; i < contextCount; i++) {
    total += getCtxContent(i).length;
  }
  return Math.floor(total / 4);
}

/** Get file name from full path. */
function getFileName(path: string): string {
  let lastSlash = -1;
  for (let i = 0; i < path.length; i++) {
    if (path.charCodeAt(i) === 47) lastSlash = i;
  }
  if (lastSlash >= 0) return path.slice(lastSlash + 1);
  return path;
}

// Remove callbacks for individual slots (called from chip x buttons)
function removeCtx0(): void { removeContext(0); if (renderChipsCb) renderChipsCb(); }
function removeCtx1(): void { removeContext(1); if (renderChipsCb) renderChipsCb(); }
function removeCtx2(): void { removeContext(2); if (renderChipsCb) renderChipsCb(); }
function removeCtx3(): void { removeContext(3); if (renderChipsCb) renderChipsCb(); }
function removeCtx4(): void { removeContext(4); if (renderChipsCb) renderChipsCb(); }
function removeCtx5(): void { removeContext(5); if (renderChipsCb) renderChipsCb(); }
function removeCtx6(): void { removeContext(6); if (renderChipsCb) renderChipsCb(); }
function removeCtx7(): void { removeContext(7); if (renderChipsCb) renderChipsCb(); }

function getRemoveFn(idx: number): () => void {
  if (idx === 0) return removeCtx0;
  if (idx === 1) return removeCtx1;
  if (idx === 2) return removeCtx2;
  if (idx === 3) return removeCtx3;
  if (idx === 4) return removeCtx4;
  if (idx === 5) return removeCtx5;
  if (idx === 6) return removeCtx6;
  return removeCtx7;
}

/** Render chips into a container. */
export function renderChips(container: unknown, colors: ResolvedUIColors): void {
  if (contextCount < 1) return;

  for (let i = 0; i < contextCount; i++) {
    const path = getCtxPath(i);
    const name = getFileName(path);
    const contentLen = getCtxContent(i).length;
    let tokenEst = Math.floor(contentLen / 4);

    let label = name;
    label += ' (~';
    label += String(tokenEst);
    label += ' tokens)';

    const chipLabel = Text(label);
    textSetFontSize(chipLabel, 10);
    textSetFontFamily(chipLabel, 10, 'Menlo');
    setFg(chipLabel, colors.sideBarForeground);

    const removeFn = getRemoveFn(i);
    const xBtn = Button('\u00D7', () => { removeFn(); });
    buttonSetBordered(xBtn, 0);
    textSetFontSize(xBtn, 10);
    setBtnFg(xBtn, colors.sideBarForeground);

    const chip = HStack(4, [chipLabel, xBtn]);
    widgetSetBackgroundColor(chip, 0.2, 0.2, 0.25, 1.0);
    widgetAddChild(container, chip);
  }

  // Total estimate
  const totalTokens = getContextTokenEstimate();
  if (totalTokens > 0) {
    let estLabel = 'Total: ~';
    estLabel += String(totalTokens);
    estLabel += ' tokens';
    const estText = Text(estLabel);
    textSetFontSize(estText, 9);
    setFg(estText, colors.sideBarForeground);
    widgetAddChild(container, estText);
  }
}
