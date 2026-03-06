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
import { execSync } from 'child_process';
import { join } from 'path';
import { setFg, setBtnFg, getFileName } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

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

function gitStageFile(filePath: string): void {
  gitExec('git -C ' + gitWorkspaceRoot + ' add -- ' + filePath);
  refreshGitState();
  if (gitPanelReady > 0) {
    updateGitResultsUI();
  }
}

function gitUnstageFile(filePath: string): void {
  gitExec('git -C ' + gitWorkspaceRoot + ' restore --staged -- ' + filePath);
  refreshGitState();
  if (gitPanelReady > 0) {
    updateGitResultsUI();
  }
}

function gitDiscardFile(filePath: string): void {
  gitExec('git -C ' + gitWorkspaceRoot + ' checkout -- ' + filePath);
  refreshGitState();
  if (gitPanelReady > 0) {
    updateGitResultsUI();
  }
}

function gitCommit(): void {
  if (gitCommitMessage.length < 1) return;
  if (gitStagedCount < 1) return;
  gitExec('git -C ' + gitWorkspaceRoot + ' commit -m "' + gitCommitMessage + '"');
  gitCommitMessage = '';
  if (gitCommitTextField) {
    textfieldSetString(gitCommitTextField, '');
  }
  refreshGitState();
  if (gitPanelReady > 0) {
    updateGitResultsUI();
  }
  updateStatusBarBranch();
}

export function updateStatusBarBranch(): void {
  if (gitIsRepo > 0 && gitBranch.length > 0) {
    _statusBarUpdater(gitBranch);
  } else {
    _statusBarUpdater('No repo');
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
    const clean = Text('No changes');
    textSetFontSize(clean, 12);
    if (panelColors) setFg(clean, panelColors.sideBarForeground);
    widgetAddChild(gitResultsContainer, clean);
    return;
  }

  // Staged changes section
  if (gitStagedCount > 0) {
    const header = Text('STAGED CHANGES');
    textSetFontSize(header, 10);
    textSetFontWeight(header, 10, 0.6);
    if (panelColors) setFg(header, panelColors.sideBarForeground);
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
          setFg(statusLabel, '#73C991');
        } else if (indicator === 'D') {
          setFg(statusLabel, '#E57373');
        } else {
          setFg(statusLabel, '#E2C08D');
        }
      }
      const fileBtn = Button(fname, () => { onGitFileClick(fpath); });
      buttonSetBordered(fileBtn, 0);
      textSetFontSize(fileBtn, 12);
      if (panelColors) setBtnFg(fileBtn, panelColors.sideBarForeground);
      const unstageBtn = Button('-', () => { gitUnstageFile(fpath); });
      buttonSetBordered(unstageBtn, 0);
      textSetFontSize(unstageBtn, 11);
      if (panelColors) setBtnFg(unstageBtn, panelColors.sideBarForeground);
      widgetAddChild(row, statusLabel);
      widgetAddChild(row, fileBtn);
      widgetAddChild(row, Spacer());
      widgetAddChild(row, unstageBtn);
      widgetAddChild(gitResultsContainer, row);
    }
  }

  // Modified (unstaged) changes section
  if (gitModifiedCount > 0) {
    const header = Text('CHANGES');
    textSetFontSize(header, 10);
    textSetFontWeight(header, 10, 0.6);
    if (panelColors) setFg(header, panelColors.sideBarForeground);
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
          setFg(statusLabel, '#E57373');
        } else {
          setFg(statusLabel, '#E2C08D');
        }
      }
      const fileBtn = Button(fname, () => { onGitFileClick(fpath); });
      buttonSetBordered(fileBtn, 0);
      textSetFontSize(fileBtn, 12);
      if (panelColors) setBtnFg(fileBtn, panelColors.sideBarForeground);
      const stageBtn = Button('+', () => { gitStageFile(fpath); });
      buttonSetBordered(stageBtn, 0);
      textSetFontSize(stageBtn, 11);
      if (panelColors) setBtnFg(stageBtn, panelColors.sideBarForeground);
      const discardBtn = Button('x', () => { gitDiscardFile(fpath); });
      buttonSetBordered(discardBtn, 0);
      textSetFontSize(discardBtn, 11);
      if (panelColors) setBtnFg(discardBtn, panelColors.sideBarForeground);
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
    const header = Text('UNTRACKED');
    textSetFontSize(header, 10);
    textSetFontWeight(header, 10, 0.6);
    if (panelColors) setFg(header, panelColors.sideBarForeground);
    widgetAddChild(gitResultsContainer, header);

    for (let i = 0; i < gitUntrackedCount; i++) {
      const fpath = gitUntrackedPaths[i];
      const fname = getFileName(fpath);
      const row = HStack(4, []);
      const statusLabel = Text('U');
      textSetFontSize(statusLabel, 11);
      textSetFontFamily(statusLabel, 11, 'Menlo');
      if (panelColors) setFg(statusLabel, '#73C991');
      const fileBtn = Button(fname, () => { onGitFileClick(fpath); });
      buttonSetBordered(fileBtn, 0);
      textSetFontSize(fileBtn, 12);
      if (panelColors) setBtnFg(fileBtn, panelColors.sideBarForeground);
      const stageBtn = Button('+', () => { gitStageFile(fpath); });
      buttonSetBordered(stageBtn, 0);
      textSetFontSize(stageBtn, 11);
      if (panelColors) setBtnFg(stageBtn, panelColors.sideBarForeground);
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
  refreshGitState();
  if (gitPanelReady > 0) {
    updateGitResultsUI();
  }
  updateStatusBarBranch();
}

// ---------------------------------------------------------------------------
// Public render function
// ---------------------------------------------------------------------------

export function renderGitPanel(container: unknown, colors: ResolvedUIColors): void {
  panelColors = colors;
  gitPanelReady = 0;

  const title = Text('SOURCE CONTROL');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  if (colors) setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  refreshGitState();

  if (gitIsRepo < 1) {
    const noRepo = Text('Not a git repository');
    textSetFontSize(noRepo, 12);
    if (colors) setFg(noRepo, colors.sideBarForeground);
    widgetAddChild(container, noRepo);
    widgetAddChild(container, Spacer());
    return;
  }

  // Branch label
  gitBranchLabel = Text(gitBranch);
  textSetFontSize(gitBranchLabel, 12);
  textSetFontWeight(gitBranchLabel, 12, 0.5);
  if (colors) setFg(gitBranchLabel, colors.sideBarForeground);
  const branchRow = HStack(4, []);
  const branchIcon = Text('*');
  textSetFontSize(branchIcon, 12);
  if (colors) setFg(branchIcon, colors.sideBarForeground);
  widgetAddChild(branchRow, branchIcon);
  widgetAddChild(branchRow, gitBranchLabel);
  widgetAddChild(container, branchRow);

  // Commit message input
  gitCommitTextField = TextField('Commit message', (text: string) => { onCommitMessageInput(text); });
  widgetAddChild(container, gitCommitTextField);

  // Commit button
  const commitBtn = Button('Commit', () => { gitCommit(); });
  buttonSetBordered(commitBtn, 0);
  textSetFontSize(commitBtn, 12);
  if (colors) setBtnFg(commitBtn, colors.sideBarForeground);
  // Refresh button
  const refreshBtn = Button('Refresh', () => { onGitRefresh(); });
  buttonSetBordered(refreshBtn, 0);
  textSetFontSize(refreshBtn, 12);
  if (colors) setBtnFg(refreshBtn, colors.sideBarForeground);
  const actionRow = HStack(8, [commitBtn, refreshBtn]);
  widgetAddChild(container, actionRow);

  // Results container for file lists
  gitResultsContainer = VStack(2, []);
  widgetAddChild(container, gitResultsContainer);
  gitPanelReady = 1;

  updateGitResultsUI();
  updateStatusBarBranch();

  widgetAddChild(container, Spacer());
}
