/**
 * Review panel — Changes Queue review UI.
 *
 * Shows pending change proposals with diff display,
 * accept/reject buttons, batch operations, group review,
 * and undo conflict resolution.
 *
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, Text, Button, Spacer, ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString, textSetColor,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetClearChildren,
  widgetSetBackgroundColor, widgetSetWidth,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

// --- Module-level state ---

let reviewContainer: unknown = null;
let reviewColors: ResolvedUIColors = null as any;
let reviewPanelReady: number = 0;

// Proposal data (parallel arrays)
let propIds: string[] = [];
let propDescriptions: string[] = [];
let propSources: string[] = [];
let propStatuses: string[] = [];
let propFileCounts: number[] = [];
let propGroupIds: string[] = [];
let propCount: number = 0;

// Undo conflict data (parallel arrays)
let conflictMessages: string[] = [];
let conflictCount: number = 0;

// Callbacks
let _acceptCallback: (proposalId: string) => void = _noopId;
let _rejectCallback: (proposalId: string) => void = _noopId;
let _acceptAllCallback: () => void = _noopVoid;
let _rejectAllCallback: () => void = _noopVoid;
let _acceptGroupCallback: (groupId: string) => void = _noopId;
let _rejectGroupCallback: (groupId: string) => void = _noopId;
let _undoCallback: (count: number) => void = _noopCount;
let _resolveConflictCallback: (conflictIdx: number, action: string) => void = _noopResolve;

function _noopId(id: string): void {}
function _noopVoid(): void {}
function _noopCount(n: number): void {}
function _noopResolve(idx: number, action: string): void {}

// --- Public API ---

// Perry-safe string utils: `===` on dynamic strings is flaky per CLAUDE.md.
function strEquals(a: string, b: string): number {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return 0;
  }
  return 1;
}
function isPendingStatus(s: string): number {
  if (s.length !== 7) return 0;
  if (s.charCodeAt(0) !== 112) return 0; // 'p'
  if (s.charCodeAt(1) !== 101) return 0; // 'e'
  if (s.charCodeAt(2) !== 110) return 0; // 'n'
  if (s.charCodeAt(3) !== 100) return 0; // 'd'
  if (s.charCodeAt(4) !== 105) return 0; // 'i'
  if (s.charCodeAt(5) !== 110) return 0; // 'n'
  if (s.charCodeAt(6) !== 103) return 0; // 'g'
  return 1;
}

// SHIP-V1-GAPS.md #14: original buildReviewPanel hit a Perry AOT verifier
// error. Rewritten to use the same closure-via-named-function pattern as
// git-panel / chat-panel — `() => { onAcceptAll(); }` instead of capturing
// the module-level `_acceptAllCallback` directly. Each handler reads the
// current callback value at call time (Perry captures closure vars by value,
// so direct capture breaks once `setReviewCallbacks` updates the let).
function onAcceptAllPressed(): void { _acceptAllCallback(); }
function onRejectAllPressed(): void { _rejectAllCallback(); }
function onUndoLastPressed(): void { _undoCallback(1); }

export function buildReviewPanel(colors: ResolvedUIColors): unknown {
  reviewColors = colors;

  const title = Text('Changes Queue');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.6);
  setFg(title, colors.sideBarForeground);

  const acceptAllBtn = Button('Accept All', () => { onAcceptAllPressed(); });
  buttonSetBordered(acceptAllBtn, 0);
  setBtnFg(acceptAllBtn, colors.buttonForeground);

  const rejectAllBtn = Button('Reject All', () => { onRejectAllPressed(); });
  buttonSetBordered(rejectAllBtn, 0);
  setBtnFg(rejectAllBtn, colors.buttonForeground);

  const undoBtn = Button('Undo Last', () => { onUndoLastPressed(); });
  buttonSetBordered(undoBtn, 0);
  setBtnFg(undoBtn, colors.buttonForeground);

  const batchRow = HStack(4, [acceptAllBtn, rejectAllBtn, undoBtn, Spacer()]);

  reviewContainer = VStack(4, []);
  const scrolled = ScrollView();
  scrollViewSetChild(scrolled, reviewContainer);

  const panel = VStack(8, [title, batchRow, scrolled]);
  reviewPanelReady = 1;
  return panel;
}

export function setReviewColors(colors: ResolvedUIColors): void {
  reviewColors = colors;
}

export function setReviewCallbacks(
  onAccept: (proposalId: string) => void,
  onReject: (proposalId: string) => void,
  onAcceptAll: () => void,
  onRejectAll: () => void,
): void {
  _acceptCallback = onAccept;
  _rejectCallback = onReject;
  _acceptAllCallback = onAcceptAll;
  _rejectAllCallback = onRejectAll;
}

export function setGroupCallbacks(
  onAcceptGroup: (groupId: string) => void,
  onRejectGroup: (groupId: string) => void,
): void {
  _acceptGroupCallback = onAcceptGroup;
  _rejectGroupCallback = onRejectGroup;
}

export function setUndoCallbacks(
  onUndo: (count: number) => void,
  onResolveConflict: (conflictIdx: number, action: string) => void,
): void {
  _undoCallback = onUndo;
  _resolveConflictCallback = onResolveConflict;
}

export function setProposals(
  ids: string[],
  descriptions: string[],
  sources: string[],
  statuses: string[],
  fileCounts: number[],
  groupIds?: string[],
): void {
  propIds = ids;
  propDescriptions = descriptions;
  propSources = sources;
  propStatuses = statuses;
  propFileCounts = fileCounts;
  propGroupIds = groupIds || [];
  propCount = ids.length;
  refreshReviewPanel();
}

export function setUndoConflicts(messages: string[]): void {
  conflictMessages = messages;
  conflictCount = messages.length;
  refreshReviewPanel();
}

export function clearUndoConflicts(): void {
  conflictMessages = [];
  conflictCount = 0;
  refreshReviewPanel();
}

export function getProposalCount(): number {
  return propCount;
}

function refreshReviewPanel(): void {
  if (reviewPanelReady === 0) return;
  if (!reviewContainer) return;

  widgetClearChildren(reviewContainer);

  // Show undo conflicts first (if any)
  if (conflictCount > 0) {
    const conflictHeader = Text('Undo Conflicts');
    textSetFontSize(conflictHeader, 11);
    textSetFontWeight(conflictHeader, 11, 0.6);
    textSetColor(conflictHeader, 0.9, 0.6, 0.2, 1.0); // orange
    widgetAddChild(reviewContainer, conflictHeader);

    for (let i = 0; i < conflictCount; i++) {
      const card = buildConflictCard(i);
      widgetAddChild(reviewContainer, card);
    }
  }

  // Count pending. Perry-safe: use length+charCodeAt instead of `===` on
  // dynamic strings (per CLAUDE.md and the same fix that #14 needed for
  // closure callbacks). `'pending'` = length 7, starts with `p`.
  let pendingCount = 0;
  for (let i = 0; i < propCount; i++) {
    if (isPendingStatus(propStatuses[i]) > 0) {
      pendingCount = pendingCount + 1;
    }
  }

  if (pendingCount === 0 && conflictCount === 0) {
    const emptyLabel = Text('No pending changes');
    textSetFontSize(emptyLabel, 12);
    if (reviewColors !== null) textSetColor(emptyLabel, 0.5, 0.5, 0.5, 1.0);
    widgetAddChild(reviewContainer, emptyLabel);
    return;
  }

  if (pendingCount === 0) return;

  // Collect unique group IDs for pending proposals.
  const groupIds: string[] = [];
  const ungroupedIndices: number[] = [];

  for (let i = 0; i < propCount; i++) {
    if (isPendingStatus(propStatuses[i]) < 1) continue;
    const gid = i < propGroupIds.length ? propGroupIds[i] : '';
    if (gid.length === 0) {
      ungroupedIndices.push(i);
    } else {
      let found = 0;
      for (let j = 0; j < groupIds.length; j++) {
        if (strEquals(groupIds[j], gid) > 0) { found = 1; break; }
      }
      if (found < 1) groupIds.push(gid);
    }
  }

  // Render grouped proposals
  for (let g = 0; g < groupIds.length; g++) {
    const gid = groupIds[g];
    const groupCard = buildGroupCard(gid);
    widgetAddChild(reviewContainer, groupCard);
  }

  // Render ungrouped proposals
  for (let u = 0; u < ungroupedIndices.length; u++) {
    const card = buildProposalCard(ungroupedIndices[u]);
    widgetAddChild(reviewContainer, card);
  }
}

// SHIP-V1-GAPS.md #14 v1.1-prep: rewrites of buildGroupCard /
// buildProposalCard / buildConflictCard to be Perry-AOT compatible. The
// originals had two patterns Perry's verifier rejects: (a) closure direct-
// capture of module-level lets, and (b) `(reviewColors.editorBackground as
// unknown as number[])[0]` which casts a hex string to a number array. The
// rewrites route callbacks through named module-level dispatchers + use
// `setBg(widget, hexString)` which goes through ui-helpers' hexToRGBA.
//
// Module-level dispatchers — read current callback value at call time so
// setReviewCallbacks updates take effect.
let _pendingAcceptIdx: number = -1;
let _pendingRejectIdx: number = -1;
let _pendingGroupId: string = '';
let _pendingConflictIdx: number = -1;
let _pendingConflictAction: string = '';
function dispatchAccept(): void { if (_pendingAcceptIdx >= 0 && _pendingAcceptIdx < propCount) { _acceptCallback(propIds[_pendingAcceptIdx]); } }
function dispatchReject(): void { if (_pendingRejectIdx >= 0 && _pendingRejectIdx < propCount) { _rejectCallback(propIds[_pendingRejectIdx]); } }
function dispatchAcceptGroup(): void { if (_pendingGroupId.length > 0) { _acceptGroupCallback(_pendingGroupId); } }
function dispatchRejectGroup(): void { if (_pendingGroupId.length > 0) { _rejectGroupCallback(_pendingGroupId); } }
function dispatchResolveConflict(): void { if (_pendingConflictIdx >= 0) { _resolveConflictCallback(_pendingConflictIdx, _pendingConflictAction); } }

function buildGroupCard(groupId: string): unknown {
  // Collect proposals in this group. Use length+charCodeAt for string equality
  // to dodge Perry's `===` quirks on dynamic strings.
  const indices: number[] = [];
  let totalFiles = 0;
  let firstSource = '';
  for (let i = 0; i < propCount; i++) {
    if (propStatuses[i].length !== 7) continue; // 'pending' is length 7
    // confirm 'pending' literally
    if (propStatuses[i].charCodeAt(0) !== 112) continue; // 'p'
    // group match by length+charCodeAt
    const pg = propGroupIds[i];
    if (pg.length !== groupId.length) continue;
    let match = 1;
    for (let c = 0; c < pg.length; c++) {
      if (pg.charCodeAt(c) !== groupId.charCodeAt(c)) { match = 0; break; }
    }
    if (match < 1) continue;
    indices.push(i);
    totalFiles = totalFiles + propFileCounts[i];
    if (firstSource.length === 0) firstSource = propSources[i];
  }

  const groupLabel = Text('Group: ' + groupId);
  textSetFontSize(groupLabel, 11);
  textSetFontWeight(groupLabel, 11, 0.6);
  textSetColor(groupLabel, 0.4, 0.7, 1.0, 1.0);

  const metaLabel = Text(String(indices.length) + ' proposal(s), ' + String(totalFiles) + ' file(s) | From: ' + firstSource);
  textSetFontSize(metaLabel, 10);
  textSetColor(metaLabel, 0.5, 0.5, 0.5, 1.0);

  const descContainer = VStack(2, []);
  for (let i = 0; i < indices.length; i++) {
    const desc = Text('- ' + propDescriptions[indices[i]]);
    textSetFontSize(desc, 11);
    if (reviewColors !== null) setFg(desc, reviewColors.sideBarForeground);
    widgetAddChild(descContainer, desc);
  }

  const acceptGroupBtn = Button('Accept Group', () => { _pendingGroupId = groupId; dispatchAcceptGroup(); });
  buttonSetBordered(acceptGroupBtn, 0);
  textSetColor(acceptGroupBtn, 0.3, 0.8, 0.3, 1.0);

  const rejectGroupBtn = Button('Reject Group', () => { _pendingGroupId = groupId; dispatchRejectGroup(); });
  buttonSetBordered(rejectGroupBtn, 0);
  textSetColor(rejectGroupBtn, 0.8, 0.3, 0.3, 1.0);

  const btnRow = HStack(4, [acceptGroupBtn, rejectGroupBtn, Spacer()]);

  const card = VStack(2, [groupLabel, metaLabel, descContainer, btnRow]);
  if (reviewColors !== null) setBg(card, reviewColors.editorBackground);
  return card;
}

function buildProposalCard(idx: number): unknown {
  const desc = propDescriptions[idx];
  const source = propSources[idx];
  const fileCount = propFileCounts[idx];

  const descLabel = Text(desc);
  textSetFontSize(descLabel, 12);
  textSetFontWeight(descLabel, 12, 0.6);
  if (reviewColors !== null) setFg(descLabel, reviewColors.sideBarForeground);

  const metaLabel = Text('From: ' + source + ' | ' + String(fileCount) + ' file(s)');
  textSetFontSize(metaLabel, 10);
  textSetColor(metaLabel, 0.5, 0.5, 0.5, 1.0);

  const acceptBtn = Button('Accept', () => { _pendingAcceptIdx = idx; dispatchAccept(); });
  buttonSetBordered(acceptBtn, 0);
  textSetColor(acceptBtn, 0.3, 0.8, 0.3, 1.0);

  const rejectBtn = Button('Reject', () => { _pendingRejectIdx = idx; dispatchReject(); });
  buttonSetBordered(rejectBtn, 0);
  textSetColor(rejectBtn, 0.8, 0.3, 0.3, 1.0);

  const btnRow = HStack(4, [acceptBtn, rejectBtn, Spacer()]);

  const card = VStack(2, [descLabel, metaLabel, btnRow]);
  if (reviewColors !== null) setBg(card, reviewColors.editorBackground);
  return card;
}

function buildConflictCard(idx: number): unknown {
  const msg = conflictMessages[idx];

  const conflictLabel = Text(msg);
  textSetFontSize(conflictLabel, 11);
  textSetColor(conflictLabel, 0.9, 0.6, 0.2, 1.0);

  const keepBtn = Button('Keep Current', () => { _pendingConflictIdx = idx; _pendingConflictAction = 'keep'; dispatchResolveConflict(); });
  buttonSetBordered(keepBtn, 0);
  textSetColor(keepBtn, 0.3, 0.8, 0.3, 1.0);

  const forceBtn = Button('Force Revert', () => { _pendingConflictIdx = idx; _pendingConflictAction = 'force'; dispatchResolveConflict(); });
  buttonSetBordered(forceBtn, 0);
  textSetColor(forceBtn, 0.8, 0.5, 0.2, 1.0);

  const skipBtn = Button('Skip', () => { _pendingConflictIdx = idx; _pendingConflictAction = 'skip'; dispatchResolveConflict(); });
  buttonSetBordered(skipBtn, 0);
  textSetColor(skipBtn, 0.5, 0.5, 0.5, 1.0);

  const btnRow = HStack(4, [keepBtn, forceBtn, skipBtn, Spacer()]);

  const card = VStack(2, [conflictLabel, btnRow]);
  widgetSetBackgroundColor(card, 0.25, 0.18, 0.1, 1.0);

  return card;
}

