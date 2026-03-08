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
  VStack, HStack, Text, Button, Spacer, ScrollView,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString, textSetColor,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetClearChildren,
  widgetSetBackgroundColor, widgetSetWidth,
} from 'perry/ui';
import { setFg, setBtnFg } from '../../ui-helpers';
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

export function buildReviewPanel(colors: ResolvedUIColors): unknown {
  reviewColors = colors;

  const title = Text('Changes Queue');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.6);
  setFg(title, colors.sideBarForeground);

  // Batch action buttons
  const acceptAllBtn = Button('Accept All', () => { _acceptAllCallback(); });
  buttonSetBordered(acceptAllBtn, 0);
  setBtnFg(acceptAllBtn, colors.buttonForeground);

  const rejectAllBtn = Button('Reject All', () => { _rejectAllCallback(); });
  buttonSetBordered(rejectAllBtn, 0);
  setBtnFg(rejectAllBtn, colors.buttonForeground);

  const undoBtn = Button('Undo Last', () => { _undoCallback(1); });
  buttonSetBordered(undoBtn, 0);
  setBtnFg(undoBtn, colors.buttonForeground);

  const batchRow = HStack(4, [acceptAllBtn, rejectAllBtn, undoBtn, Spacer()]);

  reviewContainer = VStack(4, []);

  const panel = VStack(8, [
    title,
    batchRow,
    ScrollView(reviewContainer),
  ]);

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

  // Count pending
  let pendingCount = 0;
  for (let i = 0; i < propCount; i++) {
    if (propStatuses[i] === 'pending') {
      pendingCount = pendingCount + 1;
    }
  }

  if (pendingCount === 0 && conflictCount === 0) {
    const emptyLabel = Text('No pending changes');
    textSetFontSize(emptyLabel, 12);
    if (reviewColors) textSetColor(emptyLabel, 0.5, 0.5, 0.5, 1.0);
    widgetAddChild(reviewContainer, emptyLabel);
    return;
  }

  if (pendingCount === 0) return;

  // Collect unique group IDs for pending proposals
  const groupIds: string[] = [];
  const ungroupedIndices: number[] = [];

  for (let i = 0; i < propCount; i++) {
    if (propStatuses[i] !== 'pending') continue;
    const gid = propGroupIds[i] || '';
    if (gid.length === 0) {
      ungroupedIndices.push(i);
    } else {
      let found = false;
      for (let j = 0; j < groupIds.length; j++) {
        if (groupIds[j] === gid) { found = true; break; }
      }
      if (!found) groupIds.push(gid);
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

function buildGroupCard(groupId: string): unknown {
  // Collect proposals in this group
  const indices: number[] = [];
  let totalFiles = 0;
  let firstSource = '';
  for (let i = 0; i < propCount; i++) {
    if (propStatuses[i] === 'pending' && propGroupIds[i] === groupId) {
      indices.push(i);
      totalFiles = totalFiles + propFileCounts[i];
      if (firstSource.length === 0) firstSource = propSources[i];
    }
  }

  // Group header
  const groupLabel = Text('Group: ' + groupId);
  textSetFontSize(groupLabel, 11);
  textSetFontWeight(groupLabel, 11, 0.6);
  if (reviewColors) textSetColor(groupLabel, 0.4, 0.7, 1.0, 1.0); // blue accent

  const metaLabel = Text(indices.length + ' proposal(s), ' + totalFiles + ' file(s) | From: ' + firstSource);
  textSetFontSize(metaLabel, 10);
  if (reviewColors) textSetColor(metaLabel, 0.5, 0.5, 0.5, 1.0);

  // List descriptions
  const descContainer = VStack(2, []);
  for (let i = 0; i < indices.length; i++) {
    const desc = Text('- ' + propDescriptions[indices[i]]);
    textSetFontSize(desc, 11);
    if (reviewColors) setFg(desc, reviewColors.sideBarForeground);
    widgetAddChild(descContainer, desc);
  }

  // Group accept/reject
  const acceptGroupBtn = Button('Accept Group', () => { acceptGroup(groupId); });
  buttonSetBordered(acceptGroupBtn, 0);
  textSetColor(acceptGroupBtn, 0.3, 0.8, 0.3, 1.0);

  const rejectGroupBtn = Button('Reject Group', () => { rejectGroup(groupId); });
  buttonSetBordered(rejectGroupBtn, 0);
  textSetColor(rejectGroupBtn, 0.8, 0.3, 0.3, 1.0);

  const btnRow = HStack(4, [acceptGroupBtn, rejectGroupBtn, Spacer()]);

  const card = VStack(2, [groupLabel, metaLabel, descContainer, btnRow]);
  if (reviewColors) {
    widgetSetBackgroundColor(card,
      reviewColors.editorBackground[0] || 0.15,
      reviewColors.editorBackground[1] || 0.15,
      reviewColors.editorBackground[2] || 0.15,
      1.0);
  }
  return card;
}

function buildProposalCard(idx: number): unknown {
  const id = propIds[idx];
  const desc = propDescriptions[idx];
  const source = propSources[idx];
  const fileCount = propFileCounts[idx];

  // Description
  const descLabel = Text(desc);
  textSetFontSize(descLabel, 12);
  textSetFontWeight(descLabel, 12, 0.6);
  if (reviewColors) setFg(descLabel, reviewColors.sideBarForeground);

  // Source + file count
  const metaLabel = Text('From: ' + source + ' | ' + fileCount + ' file(s)');
  textSetFontSize(metaLabel, 10);
  if (reviewColors) textSetColor(metaLabel, 0.5, 0.5, 0.5, 1.0);

  // Accept/Reject buttons
  const acceptBtn = Button('Accept', () => { acceptProposal(idx); });
  buttonSetBordered(acceptBtn, 0);
  textSetColor(acceptBtn, 0.3, 0.8, 0.3, 1.0);

  const rejectBtn = Button('Reject', () => { rejectProposal(idx); });
  buttonSetBordered(rejectBtn, 0);
  textSetColor(rejectBtn, 0.8, 0.3, 0.3, 1.0);

  const btnRow = HStack(4, [acceptBtn, rejectBtn, Spacer()]);

  const card = VStack(2, [descLabel, metaLabel, btnRow]);
  if (reviewColors) {
    widgetSetBackgroundColor(card,
      reviewColors.editorBackground[0] || 0.15,
      reviewColors.editorBackground[1] || 0.15,
      reviewColors.editorBackground[2] || 0.15,
      1.0);
  }

  return card;
}

function buildConflictCard(idx: number): unknown {
  const msg = conflictMessages[idx];

  const conflictLabel = Text(msg);
  textSetFontSize(conflictLabel, 11);
  textSetColor(conflictLabel, 0.9, 0.6, 0.2, 1.0); // orange

  const keepBtn = Button('Keep Current', () => { resolveConflict(idx, 'keep'); });
  buttonSetBordered(keepBtn, 0);
  textSetColor(keepBtn, 0.3, 0.8, 0.3, 1.0);

  const forceBtn = Button('Force Revert', () => { resolveConflict(idx, 'force'); });
  buttonSetBordered(forceBtn, 0);
  textSetColor(forceBtn, 0.8, 0.5, 0.2, 1.0); // orange

  const skipBtn = Button('Skip', () => { resolveConflict(idx, 'skip'); });
  buttonSetBordered(skipBtn, 0);
  textSetColor(skipBtn, 0.5, 0.5, 0.5, 1.0);

  const btnRow = HStack(4, [keepBtn, forceBtn, skipBtn, Spacer()]);

  const card = VStack(2, [conflictLabel, btnRow]);
  widgetSetBackgroundColor(card, 0.25, 0.18, 0.1, 1.0); // dark orange bg

  return card;
}

function acceptProposal(idx: number): void {
  if (idx >= 0 && idx < propCount) {
    _acceptCallback(propIds[idx]);
  }
}

function rejectProposal(idx: number): void {
  if (idx >= 0 && idx < propCount) {
    _rejectCallback(propIds[idx]);
  }
}

function acceptGroup(groupId: string): void {
  _acceptGroupCallback(groupId);
}

function rejectGroup(groupId: string): void {
  _rejectGroupCallback(groupId);
}

function resolveConflict(idx: number, action: string): void {
  _resolveConflictCallback(idx, action);
}
