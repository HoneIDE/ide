/**
 * Git panel — extracted from render.ts.
 *
 * Renders source control UI in the sidebar container.
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, Text, Button, Spacer,
  TextField,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString,
  buttonSetBordered,
  widgetAddChild, widgetClearChildren,
  textfieldSetString,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { execSync } from 'child_process';
import { spawn } from 'perry/thread';
import { join } from 'path';
import { setFg, setBtnFg, getFileName } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getStatusAddedColor, getStatusModifiedColor, getStatusDeletedColor } from '../../theme/theme-colors';
import { telemetryTrackGitCommit } from '../../telemetry';

// ---------------------------------------------------------------------------
// Module-level state (must be declared BEFORE any function — Perry no-hoist)
// ---------------------------------------------------------------------------

let gitWorkspaceRoot = '';
let gitIsRepo: number = 0;
let gitBranch = '';

let gitStagedPaths: string[] = [];
let gitStagedStatuses: string[] = [];
let gitStagedCount: number = 0;
let gitModifiedPaths: string[] = [];
let gitModifiedStatuses: string[] = [];
let gitModifiedCount: number = 0;
let gitUntrackedPaths: string[] = [];
let gitUntrackedCount: number = 0;

let gitPanelReady: number = 0;
let gitResultsContainer: unknown = null;
let gitBranchLabel: unknown = null;
let gitCommitTextField: unknown = null;
let gitCommitMessage = '';

// Generation counter for async refresh — discard stale results
let gitRefreshGeneration: number = 0;

// Stored from render call
let panelColors: ResolvedUIColors = null as any;

// External callbacks
let _fileOpener: (path: string, name: string) => void = _noopOpener;
let _statusBarUpdater: (branch: string) => void = _noopStatusBar;
let _diffOpener: (filePath: string, relPath: string) => void = _noopDiffOpener;

function _noopOpener(p: string, n: string): void {}
function _noopStatusBar(b: string): void {}
function _noopDiffOpener(fp: string, rp: string): void {}

// ---------------------------------------------------------------------------
// Public API — setters
// ---------------------------------------------------------------------------

export function setGitWorkspaceRoot(root: string): void {
  gitWorkspaceRoot = root;
}

export function setGitFileOpener(fn: (path: string, name: string) => void): void {
  _fileOpener = fn;
}

export function setGitStatusBarUpdater(fn: (branch: string) => void): void {
  _statusBarUpdater = fn;
}

export function setGitDiffOpener(fn: (filePath: string, relPath: string) => void): void {
  _diffOpener = fn;
}

export function getGitBranch(): string {
  return gitBranch;
}

/** Get git status for a relative file path. Returns: 0=clean, 1=modified, 2=untracked, 3=staged, 4=deleted. */
export function getGitFileStatus(relPath: string): number {
  // Check staged
  for (let i = 0; i < gitStagedCount; i++) {
    if (gitStagedPaths[i].length === relPath.length && gitStagedPaths[i] === relPath) {
      const s = gitStagedStatuses[i];
      if (s.charCodeAt(0) === 100) return 4; // deleted
      return 3; // staged
    }
  }
  // Check modified
  for (let i = 0; i < gitModifiedCount; i++) {
    if (gitModifiedPaths[i].length === relPath.length && gitModifiedPaths[i] === relPath) {
      const s = gitModifiedStatuses[i];
      if (s.charCodeAt(0) === 100) return 4; // deleted
      return 1; // modified
    }
  }
  // Check untracked
  for (let i = 0; i < gitUntrackedCount; i++) {
    if (gitUntrackedPaths[i].length === relPath.length && gitUntrackedPaths[i] === relPath) {
      return 2; // untracked
    }
  }
  return 0; // clean
}

/** Get aggregated git status for a directory (relative path). Returns: 0=clean, 1=modified, 2=untracked, 3=staged, 4=deleted. */
export function getGitDirStatus(dirRelPath: string): number {
  const prefixLen = dirRelPath.length + 1; // +1 for '/'
  // Check staged
  for (let i = 0; i < gitStagedCount; i++) {
    const p = gitStagedPaths[i];
    if (p.length > prefixLen) {
      let match = 1;
      for (let c = 0; c < dirRelPath.length; c++) {
        if (p.charCodeAt(c) !== dirRelPath.charCodeAt(c)) { match = 0; break; }
      }
      if (match > 0 && p.charCodeAt(dirRelPath.length) === 47) return 3;
    }
  }
  // Check modified
  for (let i = 0; i < gitModifiedCount; i++) {
    const p = gitModifiedPaths[i];
    if (p.length > prefixLen) {
      let match = 1;
      for (let c = 0; c < dirRelPath.length; c++) {
        if (p.charCodeAt(c) !== dirRelPath.charCodeAt(c)) { match = 0; break; }
      }
      if (match > 0 && p.charCodeAt(dirRelPath.length) === 47) return 1;
    }
  }
  // Check untracked
  for (let i = 0; i < gitUntrackedCount; i++) {
    const p = gitUntrackedPaths[i];
    if (p.length > prefixLen) {
      let match = 1;
      for (let c = 0; c < dirRelPath.length; c++) {
        if (p.charCodeAt(c) !== dirRelPath.charCodeAt(c)) { match = 0; break; }
      }
      if (match > 0 && p.charCodeAt(dirRelPath.length) === 47) return 2;
    }
  }
  return 0;
}

export function getGitChangedCount(): number {
  return gitStagedCount + gitModifiedCount + gitUntrackedCount;
}

export function resetGitPanelReady(): void {
  gitPanelReady = 0;
}

// ---------------------------------------------------------------------------
// Git commands
// ---------------------------------------------------------------------------

function gitExec(cmd: string): string {
  if (gitWorkspaceRoot.length < 1) return '';
  let result = '';
  try {
    result = execSync(cmd) as unknown as string;
  } catch (e) {
    return '';
  }
  return result;
}

/** Synchronous refresh — used only for initial renderGitPanel (needs result immediately). */
export function refreshGitState(): void {
  if (gitWorkspaceRoot.length < 1) {
    gitIsRepo = 0;
    return;
  }

  const check = gitExec('git -C ' + gitWorkspaceRoot + ' rev-parse --is-inside-work-tree');
  if (check.length < 1) {
    gitIsRepo = 0;
    return;
  }
  gitIsRepo = 1;

  const branchOut = gitExec('git -C ' + gitWorkspaceRoot + ' rev-parse --abbrev-ref HEAD');
  gitBranch = '';
  for (let i = 0; i < branchOut.length; i++) {
    if (branchOut.charCodeAt(i) === 10) break;
    if (branchOut.charCodeAt(i) === 13) break;
    gitBranch += branchOut.charAt(i);
  }

  const statusOut = gitExec('git -C ' + gitWorkspaceRoot + ' status --porcelain=v2');

  gitStagedPaths = [];
  gitStagedStatuses = [];
  gitStagedCount = 0;
  gitModifiedPaths = [];
  gitModifiedStatuses = [];
  gitModifiedCount = 0;
  gitUntrackedPaths = [];
  gitUntrackedCount = 0;

  let lineStart = 0;
  for (let i = 0; i <= statusOut.length; i++) {
    if (i === statusOut.length || statusOut.charCodeAt(i) === 10) {
      if (i > lineStart) {
        const line = statusOut.slice(lineStart, i);
        parseGitStatusLine(line);
      }
      lineStart = i + 1;
    }
  }
}

function parseGitStatusLine(line: string): void {
  if (line.length < 2) return;
  const first = line.charCodeAt(0);

  if (first === 49) {
    // '1' = ordinary changed
    const x = line.charAt(2);
    const y = line.charAt(3);
    let spaceCount = 0;
    let pathStart = 0;
    for (let j = 0; j < line.length; j++) {
      if (line.charCodeAt(j) === 32) {
        spaceCount = spaceCount + 1;
        if (spaceCount === 8) {
          pathStart = j + 1;
          break;
        }
      }
    }
    const path = line.slice(pathStart);
    const xCode = x.charCodeAt(0);
    const yCode = y.charCodeAt(0);
    if (xCode !== 46) {
      let statusStr = 'modified';
      if (xCode === 65) statusStr = 'added';
      if (xCode === 68) statusStr = 'deleted';
      gitStagedPaths[gitStagedCount] = path;
      gitStagedStatuses[gitStagedCount] = statusStr;
      gitStagedCount = gitStagedCount + 1;
    }
    if (yCode !== 46) {
      let statusStr = 'modified';
      if (yCode === 68) statusStr = 'deleted';
      gitModifiedPaths[gitModifiedCount] = path;
      gitModifiedStatuses[gitModifiedCount] = statusStr;
      gitModifiedCount = gitModifiedCount + 1;
    }
  } else if (first === 63) {
    // '?' = untracked
    const path = line.slice(2);
    gitUntrackedPaths[gitUntrackedCount] = path;
    gitUntrackedCount = gitUntrackedCount + 1;
  }
}

// ---------------------------------------------------------------------------
// Async git refresh — runs all git commands on a background thread
// ---------------------------------------------------------------------------

interface GitRefreshResult {
  isRepo: number;
  branch: string;
  stagedPaths: string[];
  stagedStatuses: string[];
  modifiedPaths: string[];
  modifiedStatuses: string[];
  untrackedPaths: string[];
}

/** Async refresh — runs git commands off the main thread. UI stays responsive. */
export function refreshGitStateAsync(): void {
  const wsRoot = gitWorkspaceRoot;
  if (wsRoot.length < 1) {
    gitIsRepo = 0;
    return;
  }

  gitRefreshGeneration = gitRefreshGeneration + 1;
  const gen = gitRefreshGeneration;

  spawn(() => {
    // All git commands run on a background OS thread
    let isRepo = 0;
    let branch = '';
    const sPaths: string[] = [];
    const sStatuses: string[] = [];
    const mPaths: string[] = [];
    const mStatuses: string[] = [];
    const uPaths: string[] = [];

    let check = '';
    try { check = execSync('git -C ' + wsRoot + ' rev-parse --is-inside-work-tree') as unknown as string; } catch (e) { check = ''; }
    if (check.length < 1) {
      return { isRepo: 0, branch: '', stagedPaths: sPaths, stagedStatuses: sStatuses, modifiedPaths: mPaths, modifiedStatuses: mStatuses, untrackedPaths: uPaths };
    }
    isRepo = 1;

    let branchOut = '';
    try { branchOut = execSync('git -C ' + wsRoot + ' rev-parse --abbrev-ref HEAD') as unknown as string; } catch (e) { branchOut = ''; }
    for (let i = 0; i < branchOut.length; i++) {
      if (branchOut.charCodeAt(i) === 10) break;
      if (branchOut.charCodeAt(i) === 13) break;
      branch = branch + branchOut.charAt(i);
    }

    let statusOut = '';
    try { statusOut = execSync('git -C ' + wsRoot + ' status --porcelain=v2') as unknown as string; } catch (e) { statusOut = ''; }

    // Parse status lines (inline — can't call module-level parseGitStatusLine from spawn)
    let sCount = 0;
    let mCount = 0;
    let uCount = 0;
    let lineStart = 0;
    for (let i = 0; i <= statusOut.length; i++) {
      if (i === statusOut.length || statusOut.charCodeAt(i) === 10) {
        if (i > lineStart) {
          const line = statusOut.slice(lineStart, i);
          if (line.length >= 2) {
            const first = line.charCodeAt(0);
            if (first === 49) {
              const x = line.charAt(2);
              const y = line.charAt(3);
              let spaceCount = 0;
              let pathStart = 0;
              for (let j = 0; j < line.length; j++) {
                if (line.charCodeAt(j) === 32) {
                  spaceCount = spaceCount + 1;
                  if (spaceCount === 8) {
                    pathStart = j + 1;
                    break;
                  }
                }
              }
              const fpath = line.slice(pathStart);
              const xCode = x.charCodeAt(0);
              const yCode = y.charCodeAt(0);
              if (xCode !== 46) {
                let st = 'modified';
                if (xCode === 65) st = 'added';
                if (xCode === 68) st = 'deleted';
                sPaths[sCount] = fpath;
                sStatuses[sCount] = st;
                sCount = sCount + 1;
              }
              if (yCode !== 46) {
                let st = 'modified';
                if (yCode === 68) st = 'deleted';
                mPaths[mCount] = fpath;
                mStatuses[mCount] = st;
                mCount = mCount + 1;
              }
            } else if (first === 63) {
              uPaths[uCount] = line.slice(2);
              uCount = uCount + 1;
            }
          }
        }
        lineStart = i + 1;
      }
    }

    return { isRepo: isRepo, branch: branch, stagedPaths: sPaths, stagedStatuses: sStatuses, modifiedPaths: mPaths, modifiedStatuses: mStatuses, untrackedPaths: uPaths };
  }).then((result) => { applyGitRefreshResult(result, gen); });
}

function applyGitRefreshResult(r: GitRefreshResult, gen: number): void {
  // Discard stale result if a newer refresh was triggered
  if (gen !== gitRefreshGeneration) return;

  gitIsRepo = r.isRepo;
  gitBranch = r.branch;
  gitStagedPaths = r.stagedPaths;
  gitStagedStatuses = r.stagedStatuses;
  gitStagedCount = r.stagedPaths.length;
  gitModifiedPaths = r.modifiedPaths;
  gitModifiedStatuses = r.modifiedStatuses;
  gitModifiedCount = r.modifiedPaths.length;
  gitUntrackedPaths = r.untrackedPaths;
  gitUntrackedCount = r.untrackedPaths.length;

  if (gitPanelReady > 0) {
    updateGitResultsUI();
  }
  updateStatusBarBranch();
}

// ---------------------------------------------------------------------------
// Async git actions — each runs its command on a background thread
// ---------------------------------------------------------------------------

function gitStageFile(filePath: string): void {
  const wsRoot = gitWorkspaceRoot;
  const fp = filePath;
  spawn(() => {
    try { execSync('git -C ' + wsRoot + ' add -- ' + fp) as unknown as string; } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

function gitUnstageFile(filePath: string): void {
  const wsRoot = gitWorkspaceRoot;
  const fp = filePath;
  spawn(() => {
    try { execSync('git -C ' + wsRoot + ' restore --staged -- ' + fp) as unknown as string; } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

function gitDiscardFile(filePath: string): void {
  const wsRoot = gitWorkspaceRoot;
  const fp = filePath;
  spawn(() => {
    try { execSync('git -C ' + wsRoot + ' checkout -- ' + fp) as unknown as string; } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

function gitCommit(): void {
  if (gitCommitMessage.length < 1) return;
  if (gitStagedCount < 1) return;
  const wsRoot = gitWorkspaceRoot;
  const msg = gitCommitMessage;
  gitCommitMessage = '';
  if (gitCommitTextField) {
    textfieldSetString(gitCommitTextField, '');
  }
  spawn(() => {
    try { execSync('git -C ' + wsRoot + ' commit -m "' + msg + '"') as unknown as string; } catch (e) {}
    return 0;
  }).then((_) => { onGitCommitComplete(); });
}

function onGitCommitComplete(): void {
  refreshGitStateAsync();
  telemetryTrackGitCommit();
}

function gitPush(): void {
  const wsRoot = gitWorkspaceRoot;
  spawn(() => {
    try { execSync('git -C ' + wsRoot + ' push') as unknown as string; } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

function gitPull(): void {
  const wsRoot = gitWorkspaceRoot;
  spawn(() => {
    try { execSync('git -C ' + wsRoot + ' pull') as unknown as string; } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

function gitFetch(): void {
  const wsRoot = gitWorkspaceRoot;
  spawn(() => {
    try { execSync('git -C ' + wsRoot + ' fetch') as unknown as string; } catch (e) {}
    return 0;
  }).then((_) => { updateStatusBarBranch(); });
}

function gitStash(): void {
  const wsRoot = gitWorkspaceRoot;
  spawn(() => {
    try { execSync('git -C ' + wsRoot + ' stash') as unknown as string; } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

function gitStashPop(): void {
  const wsRoot = gitWorkspaceRoot;
  spawn(() => {
    try { execSync('git -C ' + wsRoot + ' stash pop') as unknown as string; } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

function onGitActionComplete(): void {
  refreshGitStateAsync();
}

export function updateStatusBarBranch(): void {
  if (gitIsRepo > 0 && gitBranch.length > 0) {
    _statusBarUpdater(gitBranch);
  } else {
    _statusBarUpdater(t('No repo'));
  }
}

function updateGitResultsUI(): void {
  if (gitPanelReady < 1) return;
  widgetClearChildren(gitResultsContainer);

  if (gitBranchLabel && gitBranch.length > 0) {
    textSetString(gitBranchLabel, gitBranch);
  }

  const totalChanges = gitStagedCount + gitModifiedCount + gitUntrackedCount;
  if (totalChanges < 1) {
    const clean = Text(t('No changes'));
    textSetFontSize(clean, 12);
    if (panelColors) setFg(clean, getSideBarForeground());
    widgetAddChild(gitResultsContainer, clean);
    return;
  }

  // Staged changes section
  if (gitStagedCount > 0) {
    const header = Text(t('STAGED CHANGES'));
    textSetFontSize(header, 10);
    textSetFontWeight(header, 10, 0.6);
    if (panelColors) setFg(header, getSideBarForeground());
    widgetAddChild(gitResultsContainer, header);

    for (let i = 0; i < gitStagedCount; i++) {
      const fpath = gitStagedPaths[i];
      const fname = getFileName(fpath);
      const status = gitStagedStatuses[i];
      const row = HStack(4, []);
      let indicator = 'M';
      if (status.charCodeAt(0) === 97) indicator = 'A';
      if (status.charCodeAt(0) === 100) indicator = 'D';
      const statusLabel = Text(indicator);
      textSetFontSize(statusLabel, 11);
      textSetFontFamily(statusLabel, 11, 'Menlo');
      if (panelColors) {
        if (indicator === 'A') {
          setFg(statusLabel, getStatusAddedColor());
        } else if (indicator === 'D') {
          setFg(statusLabel, getStatusDeletedColor());
        } else {
          setFg(statusLabel, getStatusModifiedColor());
        }
      }
      const fileBtn = Button(fname, () => { onGitFileClick(fpath); });
      buttonSetBordered(fileBtn, 0);
      textSetFontSize(fileBtn, 12);
      if (panelColors) setBtnFg(fileBtn, getSideBarForeground());
      const unstageBtn = Button('-', () => { gitUnstageFile(fpath); });
      buttonSetBordered(unstageBtn, 0);
      textSetFontSize(unstageBtn, 11);
      if (panelColors) setBtnFg(unstageBtn, getSideBarForeground());
      widgetAddChild(row, statusLabel);
      widgetAddChild(row, fileBtn);
      widgetAddChild(row, Spacer());
      widgetAddChild(row, unstageBtn);
      widgetAddChild(gitResultsContainer, row);
    }
  }

  // Modified (unstaged) changes section
  if (gitModifiedCount > 0) {
    const header = Text(t('CHANGES'));
    textSetFontSize(header, 10);
    textSetFontWeight(header, 10, 0.6);
    if (panelColors) setFg(header, getSideBarForeground());
    widgetAddChild(gitResultsContainer, header);

    for (let i = 0; i < gitModifiedCount; i++) {
      const fpath = gitModifiedPaths[i];
      const fname = getFileName(fpath);
      const status = gitModifiedStatuses[i];
      const row = HStack(4, []);
      let indicator = 'M';
      if (status.charCodeAt(0) === 100) indicator = 'D';
      const statusLabel = Text(indicator);
      textSetFontSize(statusLabel, 11);
      textSetFontFamily(statusLabel, 11, 'Menlo');
      if (panelColors) {
        if (indicator === 'D') {
          setFg(statusLabel, getStatusDeletedColor());
        } else {
          setFg(statusLabel, getStatusModifiedColor());
        }
      }
      const fileBtn = Button(fname, () => { onGitFileClick(fpath); });
      buttonSetBordered(fileBtn, 0);
      textSetFontSize(fileBtn, 12);
      if (panelColors) setBtnFg(fileBtn, getSideBarForeground());
      const stageBtn = Button('+', () => { gitStageFile(fpath); });
      buttonSetBordered(stageBtn, 0);
      textSetFontSize(stageBtn, 11);
      if (panelColors) setBtnFg(stageBtn, getSideBarForeground());
      const discardBtn = Button('x', () => { gitDiscardFile(fpath); });
      buttonSetBordered(discardBtn, 0);
      textSetFontSize(discardBtn, 11);
      if (panelColors) setBtnFg(discardBtn, getSideBarForeground());
      widgetAddChild(row, statusLabel);
      widgetAddChild(row, fileBtn);
      widgetAddChild(row, Spacer());
      widgetAddChild(row, stageBtn);
      widgetAddChild(row, discardBtn);
      widgetAddChild(gitResultsContainer, row);
    }
  }

  // Untracked files section
  if (gitUntrackedCount > 0) {
    const header = Text(t('UNTRACKED'));
    textSetFontSize(header, 10);
    textSetFontWeight(header, 10, 0.6);
    if (panelColors) setFg(header, getSideBarForeground());
    widgetAddChild(gitResultsContainer, header);

    for (let i = 0; i < gitUntrackedCount; i++) {
      const fpath = gitUntrackedPaths[i];
      const fname = getFileName(fpath);
      const row = HStack(4, []);
      const statusLabel = Text('U');
      textSetFontSize(statusLabel, 11);
      textSetFontFamily(statusLabel, 11, 'Menlo');
      if (panelColors) setFg(statusLabel, getStatusAddedColor());
      const fileBtn = Button(fname, () => { onGitFileClick(fpath); });
      buttonSetBordered(fileBtn, 0);
      textSetFontSize(fileBtn, 12);
      if (panelColors) setBtnFg(fileBtn, getSideBarForeground());
      const stageBtn = Button('+', () => { gitStageFile(fpath); });
      buttonSetBordered(stageBtn, 0);
      textSetFontSize(stageBtn, 11);
      if (panelColors) setBtnFg(stageBtn, getSideBarForeground());
      widgetAddChild(row, statusLabel);
      widgetAddChild(row, fileBtn);
      widgetAddChild(row, Spacer());
      widgetAddChild(row, stageBtn);
      widgetAddChild(gitResultsContainer, row);
    }
  }
}

function onGitFileClick(filePath: string): void {
  const fullPath = join(gitWorkspaceRoot, filePath);
  const name = getFileName(filePath);
  // Modified/staged files open in diff view; untracked files open normally.
  // Check if the file is modified or staged (has a HEAD version to diff against).
  let isDiffable = 0;
  for (let i = 0; i < gitStagedCount; i++) {
    if (gitStagedPaths[i].length === filePath.length && gitStagedPaths[i] === filePath) {
      isDiffable = 1;
      break;
    }
  }
  if (isDiffable < 1) {
    for (let i = 0; i < gitModifiedCount; i++) {
      if (gitModifiedPaths[i].length === filePath.length && gitModifiedPaths[i] === filePath) {
        isDiffable = 1;
        break;
      }
    }
  }
  if (isDiffable > 0) {
    _diffOpener(fullPath, filePath);
  } else {
    _fileOpener(fullPath, name);
  }
}

function onCommitMessageInput(text: string): void {
  gitCommitMessage = text;
}

function onGitRefresh(): void {
  refreshGitStateAsync();
}

// ---------------------------------------------------------------------------
// Public render function
// ---------------------------------------------------------------------------

export function renderGitPanel(container: unknown, colors: ResolvedUIColors): void {
  panelColors = colors;
  gitPanelReady = 0;

  const title = Text(t('SOURCE CONTROL'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  if (colors) setFg(title, getSideBarForeground());
  widgetAddChild(container, title);

  refreshGitState();

  if (gitIsRepo < 1) {
    const noRepo = Text(t('Not a git repository'));
    textSetFontSize(noRepo, 12);
    if (colors) setFg(noRepo, getSideBarForeground());
    widgetAddChild(container, noRepo);
    widgetAddChild(container, Spacer());
    return;
  }

  // Branch label
  gitBranchLabel = Text(gitBranch);
  textSetFontSize(gitBranchLabel, 12);
  textSetFontWeight(gitBranchLabel, 12, 0.5);
  if (colors) setFg(gitBranchLabel, getSideBarForeground());
  const branchRow = HStack(4, []);
  const branchIcon = Text('*');
  textSetFontSize(branchIcon, 12);
  if (colors) setFg(branchIcon, getSideBarForeground());
  widgetAddChild(branchRow, branchIcon);
  widgetAddChild(branchRow, gitBranchLabel);
  widgetAddChild(container, branchRow);

  // Commit message input
  gitCommitTextField = TextField(t('Commit message'), (text: string) => { onCommitMessageInput(text); });
  widgetAddChild(container, gitCommitTextField);

  // Commit button
  const commitBtn = Button(t('Commit'), () => { gitCommit(); });
  buttonSetBordered(commitBtn, 0);
  textSetFontSize(commitBtn, 12);
  if (colors) setBtnFg(commitBtn, getSideBarForeground());
  // Refresh button
  const refreshBtn = Button(t('Refresh'), () => { onGitRefresh(); });
  buttonSetBordered(refreshBtn, 0);
  textSetFontSize(refreshBtn, 12);
  if (colors) setBtnFg(refreshBtn, getSideBarForeground());
  const actionRow = HStack(8, [commitBtn, refreshBtn]);
  widgetAddChild(container, actionRow);

  // Push / Pull / Fetch / Stash buttons
  const pushBtn = Button(t('Push'), () => { gitPush(); });
  buttonSetBordered(pushBtn, 0);
  textSetFontSize(pushBtn, 11);
  if (colors) setBtnFg(pushBtn, getSideBarForeground());
  const pullBtn = Button(t('Pull'), () => { gitPull(); });
  buttonSetBordered(pullBtn, 0);
  textSetFontSize(pullBtn, 11);
  if (colors) setBtnFg(pullBtn, getSideBarForeground());
  const fetchBtn = Button(t('Fetch'), () => { gitFetch(); });
  buttonSetBordered(fetchBtn, 0);
  textSetFontSize(fetchBtn, 11);
  if (colors) setBtnFg(fetchBtn, getSideBarForeground());
  const syncRow = HStack(8, [pushBtn, pullBtn, fetchBtn]);
  widgetAddChild(container, syncRow);

  const stashBtn = Button(t('Stash'), () => { gitStash(); });
  buttonSetBordered(stashBtn, 0);
  textSetFontSize(stashBtn, 11);
  if (colors) setBtnFg(stashBtn, getSideBarForeground());
  const popBtn = Button(t('Pop'), () => { gitStashPop(); });
  buttonSetBordered(popBtn, 0);
  textSetFontSize(popBtn, 11);
  if (colors) setBtnFg(popBtn, getSideBarForeground());
  const stashRow = HStack(8, [stashBtn, popBtn]);
  widgetAddChild(container, stashRow);

  // Results container for file lists
  gitResultsContainer = VStack(2, []);
  widgetAddChild(container, gitResultsContainer);
  gitPanelReady = 1;

  updateGitResultsUI();
  updateStatusBarBranch();

  widgetAddChild(container, Spacer());
}
