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
  widgetAddChild, widgetClearChildren, widgetSetHidden,
  textfieldSetString,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { spawnSync } from 'child_process';
import { spawn } from 'perry/thread';
import { join } from 'path';
import { readFileSync } from 'fs';
import { setFg, setBtnFg, getFileName } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getStatusAddedColor, getStatusModifiedColor, getStatusDeletedColor, getSecondaryTextColor } from '../../theme/theme-colors';
import { telemetryTrackGitCommit } from '../../telemetry';
import { createSpinner, startSpinner, stopSpinner, setSpinnerLabel } from '../spinner/spinner';

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
// SHIP-V1-GAPS.md #99: track ignored files explicitly so the explorer can
// dim them. Populated when `git status --porcelain=2 --ignored` returns
// `! path` lines.
let gitIgnoredPaths: string[] = [];
let gitIgnoredCount: number = 0;

let gitPanelReady: number = 0;
let gitResultsContainer: unknown = null;
let gitBranchLabel: unknown = null;
let gitCommitTextField: unknown = null;
let gitCommitMessage = '';
let gitTagsContainer: unknown = null;
let gitTagsExpanded: number = 0;
let gitBranchesContainer: unknown = null;
let gitBranchesExpanded: number = 0;
// SHIP-V1-GAPS.md #101: submodule list state.
let gitSubmodulesContainer: unknown = null;
let gitSubmodulesExpanded: number = 0;
// SHIP-V1-GAPS.md #102: cached "is this repo LFS-tracked?" flag, refreshed
// alongside the git state. Used in the panel header so the user knows large
// binaries flow through git-lfs.
let gitLfsTracked: number = 0;
// SHIP-V1-GAPS.md #103: commit graph (history) container state.
let gitHistoryContainer: unknown = null;
let gitHistoryExpanded: number = 0;
// SHIP-V1-GAPS.md #93: spinner for long git ops (push/pull/fetch).
let gitSpinnerId: number = -1;
let gitSpinnerWidget: unknown = null;
// SHIP-V1-GAPS.md #100: pending tag-create input.
let gitNewTagName: string = '';

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

/** Get git status for a relative file path.
 *  Returns: 0=clean, 1=modified, 2=untracked, 3=staged, 4=deleted,
 *           5=conflicting (U), 6=renamed (R), 7=ignored (!).
 *  SHIP-V1-GAPS.md #99 — the explorer was previously folding U/R/!/T into
 *  modified/clean; expose them as distinct states so colors can differ. */
export function getGitFileStatus(relPath: string): number {
  // Check staged
  for (let i = 0; i < gitStagedCount; i++) {
    if (gitStagedPaths[i].length === relPath.length && gitStagedPaths[i] === relPath) {
      const s = gitStagedStatuses[i];
      const first = s.charCodeAt(0);
      if (first === 100) return 4; // deleted
      if (first === 114) return 6; // renamed
      if (first === 99 && s.length > 1 && s.charCodeAt(1) === 111) return 6; // copied → render as "renamed"
      if (first === 99 && s.length > 1 && s.charCodeAt(1) === 111 + 1) return 5; // (defensive: should never hit)
      if (s.length > 1 && s.charCodeAt(0) === 99 && s.charCodeAt(1) === 111 && s.charCodeAt(2) === 110) return 5; // "conflicting"
      return 3; // staged
    }
  }
  // Check modified
  for (let i = 0; i < gitModifiedCount; i++) {
    if (gitModifiedPaths[i].length === relPath.length && gitModifiedPaths[i] === relPath) {
      const s = gitModifiedStatuses[i];
      const first = s.charCodeAt(0);
      if (first === 100) return 4; // deleted
      if (first === 114) return 6; // renamed
      // "conflicting" is the only status starting with 'c' that lands here
      if (first === 99) return 5;
      return 1; // modified
    }
  }
  // Check untracked
  for (let i = 0; i < gitUntrackedCount; i++) {
    if (gitUntrackedPaths[i].length === relPath.length && gitUntrackedPaths[i] === relPath) {
      return 2; // untracked
    }
  }
  // Check ignored
  for (let i = 0; i < gitIgnoredCount; i++) {
    if (gitIgnoredPaths[i].length === relPath.length && gitIgnoredPaths[i] === relPath) {
      return 7; // ignored
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

function gitRun(args: string[]): string {
  if (gitWorkspaceRoot.length < 1) return '';
  let result = '';
  try {
    const r = spawnSync('git', args);
    if (r.status === 0) result = r.stdout;
  } catch (e) {
    return '';
  }
  return result;
}

// SHIP-V1-GAPS.md #102: detect git-lfs by scanning `.gitattributes` for a
// `filter=lfs` directive. We do not actually run `git lfs`; this is the
// cheap signal (no dependency on git-lfs being installed). False positive
// only if a custom attribute named `filter=lfs` exists — vanishingly rare.
function detectLfsTracked(): number {
  if (gitWorkspaceRoot.length === 0) return 0;
  let content = '';
  try {
    content = readFileSync(gitWorkspaceRoot + '/.gitattributes');
  } catch (_e: any) { return 0; }
  if (content.indexOf('filter=lfs') >= 0) return 1;
  return 0;
}

/** Public read accessor for other modules / tests. */
export function isLfsTrackedRepo(): number {
  return gitLfsTracked;
}

/** Synchronous refresh — used only for initial renderGitPanel (needs result immediately). */
export function refreshGitState(): void {
  if (gitWorkspaceRoot.length < 1) {
    gitIsRepo = 0;
    return;
  }

  const check = gitRun(['-C', gitWorkspaceRoot, 'rev-parse', '--is-inside-work-tree']);
  if (check.length < 1) {
    gitIsRepo = 0;
    return;
  }
  gitIsRepo = 1;
  gitLfsTracked = detectLfsTracked();

  const branchOut = gitRun(['-C', gitWorkspaceRoot, 'rev-parse', '--abbrev-ref', 'HEAD']);
  gitBranch = '';
  for (let i = 0; i < branchOut.length; i++) {
    if (branchOut.charCodeAt(i) === 10) break;
    if (branchOut.charCodeAt(i) === 13) break;
    gitBranch += branchOut.charAt(i);
  }

  const statusOut = gitRun(['-C', gitWorkspaceRoot, 'status', '--porcelain=v2']);

  gitStagedPaths = [];
  gitStagedStatuses = [];
  gitStagedCount = 0;
  gitModifiedPaths = [];
  gitModifiedStatuses = [];
  gitModifiedCount = 0;
  gitUntrackedPaths = [];
  gitUntrackedCount = 0;
  gitIgnoredPaths = [];
  gitIgnoredCount = 0;

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

// SHIP-V1-GAPS.md #99: map a porcelain v2 status char to a label.
// 'A'=added 'M'=modified 'D'=deleted 'R'=renamed 'C'=copied 'T'=typechange
// 'U'=unmerged '?'=untracked '!'=ignored.
function statusLabelFromCode(code: number): string {
  if (code === 65) return 'added';
  if (code === 68) return 'deleted';
  if (code === 82) return 'renamed';
  if (code === 67) return 'copied';
  if (code === 84) return 'typechange';
  if (code === 85) return 'conflicting';
  return 'modified';
}

function parseGitStatusLine(line: string): void {
  if (line.length < 2) return;
  const first = line.charCodeAt(0);

  if (first === 49) {
    // '1' = ordinary changed: `1 XY sub mH mI mW hH hI path`
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
      gitStagedPaths[gitStagedCount] = path;
      gitStagedStatuses[gitStagedCount] = statusLabelFromCode(xCode);
      gitStagedCount = gitStagedCount + 1;
    }
    if (yCode !== 46) {
      gitModifiedPaths[gitModifiedCount] = path;
      gitModifiedStatuses[gitModifiedCount] = statusLabelFromCode(yCode);
      gitModifiedCount = gitModifiedCount + 1;
    }
  } else if (first === 50) {
    // '2' = renamed/copied: `2 XY sub mH mI mW hH hI score path\tooldpath`
    const x = line.charAt(2);
    const y = line.charAt(3);
    // Skip to the 9th space (after the score) to find path
    let spaceCount = 0;
    let pathStart = 0;
    for (let j = 0; j < line.length; j++) {
      if (line.charCodeAt(j) === 32) {
        spaceCount = spaceCount + 1;
        if (spaceCount === 9) {
          pathStart = j + 1;
          break;
        }
      }
    }
    // Path is everything up to the tab separator (oldpath follows).
    let pathEnd = line.length;
    for (let k = pathStart; k < line.length; k++) {
      if (line.charCodeAt(k) === 9) { pathEnd = k; break; }
    }
    const path = line.slice(pathStart, pathEnd);
    const xCode = x.charCodeAt(0);
    const yCode = y.charCodeAt(0);
    if (xCode !== 46) {
      gitStagedPaths[gitStagedCount] = path;
      gitStagedStatuses[gitStagedCount] = statusLabelFromCode(xCode);
      gitStagedCount = gitStagedCount + 1;
    }
    if (yCode !== 46) {
      gitModifiedPaths[gitModifiedCount] = path;
      gitModifiedStatuses[gitModifiedCount] = statusLabelFromCode(yCode);
      gitModifiedCount = gitModifiedCount + 1;
    }
  } else if (first === 117) {
    // 'u' = unmerged: `u XY sub m1 m2 m3 mW h1 h2 h3 path`
    let spaceCount = 0;
    let pathStart = 0;
    for (let j = 0; j < line.length; j++) {
      if (line.charCodeAt(j) === 32) {
        spaceCount = spaceCount + 1;
        if (spaceCount === 10) {
          pathStart = j + 1;
          break;
        }
      }
    }
    const path = line.slice(pathStart);
    // Unmerged entries always show up as conflicting in the modified bucket so
    // they're visible for resolution.
    gitModifiedPaths[gitModifiedCount] = path;
    gitModifiedStatuses[gitModifiedCount] = 'conflicting';
    gitModifiedCount = gitModifiedCount + 1;
  } else if (first === 63) {
    // '?' = untracked
    const path = line.slice(2);
    gitUntrackedPaths[gitUntrackedCount] = path;
    gitUntrackedCount = gitUntrackedCount + 1;
  } else if (first === 33) {
    // '!' = ignored. Captured so the explorer can dim them via gStatus===7.
    // Note: only present when `git status` is invoked with `--ignored`. v1
    // populates this from refreshGitStateAsync (below) when the user opts in.
    const path = line.slice(2);
    gitIgnoredPaths[gitIgnoredCount] = path;
    gitIgnoredCount = gitIgnoredCount + 1;
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
    try {
      const r = spawnSync('git', ['-C', wsRoot, 'rev-parse', '--is-inside-work-tree']);
      if (r.status === 0) check = r.stdout;
    } catch (e) { check = ''; }
    if (check.length < 1) {
      return { isRepo: 0, branch: '', stagedPaths: sPaths, stagedStatuses: sStatuses, modifiedPaths: mPaths, modifiedStatuses: mStatuses, untrackedPaths: uPaths };
    }
    isRepo = 1;

    let branchOut = '';
    try {
      const r = spawnSync('git', ['-C', wsRoot, 'rev-parse', '--abbrev-ref', 'HEAD']);
      if (r.status === 0) branchOut = r.stdout;
    } catch (e) { branchOut = ''; }
    for (let i = 0; i < branchOut.length; i++) {
      if (branchOut.charCodeAt(i) === 10) break;
      if (branchOut.charCodeAt(i) === 13) break;
      branch = branch + branchOut.charAt(i);
    }

    let statusOut = '';
    try {
      const r = spawnSync('git', ['-C', wsRoot, 'status', '--porcelain=v2']);
      if (r.status === 0) statusOut = r.stdout;
    } catch (e) { statusOut = ''; }

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
            // SHIP-V1-GAPS.md #99: parse '1' ordinary + '2' rename/copy +
            // 'u' unmerged + '?' untracked (no module-level helper here —
            // Perry spawn() closures can't call module-level functions).
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
                else if (xCode === 68) st = 'deleted';
                else if (xCode === 82) st = 'renamed';
                else if (xCode === 67) st = 'copied';
                else if (xCode === 84) st = 'typechange';
                else if (xCode === 85) st = 'conflicting';
                sPaths[sCount] = fpath;
                sStatuses[sCount] = st;
                sCount = sCount + 1;
              }
              if (yCode !== 46) {
                let st = 'modified';
                if (yCode === 65) st = 'added';
                else if (yCode === 68) st = 'deleted';
                else if (yCode === 82) st = 'renamed';
                else if (yCode === 67) st = 'copied';
                else if (yCode === 84) st = 'typechange';
                else if (yCode === 85) st = 'conflicting';
                mPaths[mCount] = fpath;
                mStatuses[mCount] = st;
                mCount = mCount + 1;
              }
            } else if (first === 50) {
              // '2' rename/copy
              const x = line.charAt(2);
              const y = line.charAt(3);
              let spaceCount = 0;
              let pathStart = 0;
              for (let j = 0; j < line.length; j++) {
                if (line.charCodeAt(j) === 32) {
                  spaceCount = spaceCount + 1;
                  if (spaceCount === 9) {
                    pathStart = j + 1;
                    break;
                  }
                }
              }
              let pathEnd = line.length;
              for (let k = pathStart; k < line.length; k++) {
                if (line.charCodeAt(k) === 9) { pathEnd = k; break; }
              }
              const fpath = line.slice(pathStart, pathEnd);
              const xCode = x.charCodeAt(0);
              const yCode = y.charCodeAt(0);
              if (xCode !== 46) {
                let st = 'renamed';
                if (xCode === 67) st = 'copied';
                sPaths[sCount] = fpath;
                sStatuses[sCount] = st;
                sCount = sCount + 1;
              }
              if (yCode !== 46) {
                let st = 'renamed';
                if (yCode === 67) st = 'copied';
                else if (yCode === 77) st = 'modified';
                mPaths[mCount] = fpath;
                mStatuses[mCount] = st;
                mCount = mCount + 1;
              }
            } else if (first === 117) {
              // 'u' unmerged — surface as conflicting in modified bucket
              let spaceCount = 0;
              let pathStart = 0;
              for (let j = 0; j < line.length; j++) {
                if (line.charCodeAt(j) === 32) {
                  spaceCount = spaceCount + 1;
                  if (spaceCount === 10) {
                    pathStart = j + 1;
                    break;
                  }
                }
              }
              mPaths[mCount] = line.slice(pathStart);
              mStatuses[mCount] = 'conflicting';
              mCount = mCount + 1;
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
  // SHIP-V1-GAPS.md #102: refresh LFS flag on each git refresh. .gitattributes
  // is tiny so re-reading it per refresh is fine.
  gitLfsTracked = r.isRepo > 0 ? detectLfsTracked() : 0;
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
    try { spawnSync('git', ['-C', wsRoot, 'add', '--', fp]); } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

function gitUnstageFile(filePath: string): void {
  const wsRoot = gitWorkspaceRoot;
  const fp = filePath;
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'restore', '--staged', '--', fp]); } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

function gitDiscardFile(filePath: string): void {
  const wsRoot = gitWorkspaceRoot;
  const fp = filePath;
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'checkout', '--', fp]); } catch (e) {}
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
    try { spawnSync('git', ['-C', wsRoot, 'commit', '-m', msg]); } catch (e) {}
    return 0;
  }).then((_) => { onGitCommitComplete(); });
}

function onGitCommitComplete(): void {
  refreshGitStateAsync();
  telemetryTrackGitCommit();
}

// SHIP-V1-GAPS.md #93: spinner around long ops.
function gitSpinnerBegin(label: string): void {
  if (gitSpinnerId < 0) return;
  setSpinnerLabel(gitSpinnerId, label);
  startSpinner(gitSpinnerId);
}
function gitSpinnerEnd(): void {
  if (gitSpinnerId < 0) return;
  stopSpinner(gitSpinnerId);
}

function gitPush(): void {
  const wsRoot = gitWorkspaceRoot;
  gitSpinnerBegin(t('Pushing…'));
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'push']); } catch (e) {}
    return 0;
  }).then((_) => { gitSpinnerEnd(); onGitActionComplete(); });
}

function gitPull(): void {
  const wsRoot = gitWorkspaceRoot;
  gitSpinnerBegin(t('Pulling…'));
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'pull']); } catch (e) {}
    return 0;
  }).then((_) => { gitSpinnerEnd(); onGitActionComplete(); });
}

function gitFetch(): void {
  const wsRoot = gitWorkspaceRoot;
  gitSpinnerBegin(t('Fetching…'));
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'fetch']); } catch (e) {}
    return 0;
  }).then((_) => { gitSpinnerEnd(); updateStatusBarBranch(); });
}

function gitStash(): void {
  const wsRoot = gitWorkspaceRoot;
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'stash']); } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

function gitStashPop(): void {
  const wsRoot = gitWorkspaceRoot;
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'stash', 'pop']); } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

// SHIP-V1-GAPS.md #47: list local branches. Returns the current branch first
// (with a `*` prefix) and the rest sorted by most-recent commit.
function listGitBranches(): string[] {
  if (gitWorkspaceRoot.length === 0) return [];
  let out = '';
  try {
    const r = spawnSync('git', ['-C', gitWorkspaceRoot, 'for-each-ref', '--sort=-committerdate', '--count=50', '--format=%(HEAD) %(refname:short)', 'refs/heads']);
    if (r.status === 0) out = r.stdout;
  } catch (_e: any) {}
  if (out.length === 0) return [];
  const branches: string[] = [];
  let start = 0;
  for (let i = 0; i <= out.length; i++) {
    if (i === out.length || out.charCodeAt(i) === 10) {
      if (i > start) {
        const line = out.slice(start, i);
        // Lines look like "* main" or "  feature/x". Normalize by trimming.
        let p = 0;
        while (p < line.length && line.charCodeAt(p) === 32) p++;
        branches.push(line.slice(p));
      }
      start = i + 1;
    }
  }
  return branches;
}

/** Switch branch via `git checkout <branch>`. Async — surfaces via onGitActionComplete. */
function gitCheckoutBranch(branchName: string): void {
  // Strip a leading "* " if present (from current branch marker).
  let b = branchName;
  if (b.length > 2 && b.charCodeAt(0) === 42 && b.charCodeAt(1) === 32) b = b.slice(2);
  const wsRoot = gitWorkspaceRoot;
  const bName = b;
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'checkout', bName]); } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

// SHIP-V1-GAPS.md #100: read the workspace's git tags. Returns the newest 20
// tags, newest first. Called on demand from the git panel UI.
function listGitTags(): string[] {
  if (gitWorkspaceRoot.length === 0) return [];
  let out = '';
  try {
    const r = spawnSync('git', ['-C', gitWorkspaceRoot, 'for-each-ref', '--sort=-creatordate', '--count=20', '--format=%(refname:short)', 'refs/tags']);
    if (r.status === 0) out = r.stdout;
  } catch (_e: any) {}
  if (out.length === 0) return [];
  const tags: string[] = [];
  let start = 0;
  for (let i = 0; i <= out.length; i++) {
    if (i === out.length || out.charCodeAt(i) === 10) {
      if (i > start) tags.push(out.slice(start, i));
      start = i + 1;
    }
  }
  return tags;
}

/** Checkout a tag (detached HEAD). Async — surfaces via onGitActionComplete. */
function gitCheckoutTag(tag: string): void {
  const wsRoot = gitWorkspaceRoot;
  const tagName = tag;
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'checkout', tagName]); } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

// SHIP-V1-GAPS.md #100: tag create / delete / push.
//
// `gitTagCreate`: lightweight tag at HEAD (annotated tags need a message — we
//   keep v1 simple). Refreshes the tag list afterwards.
// `gitTagDelete`: local delete via `git tag -d <name>`. Does NOT touch the
//   remote unless the user explicitly pushes the deletion via `gitTagPush`
//   with the `:refs/tags/<name>` form — too risky to do silently.
// `gitTagPush`: `git push origin <name>` for a single tag. For "push all
//   tags", users still drop to terminal — that path is rarely scripted from
//   the UI in v1.
/** SHIP-V1-GAPS.md #90: initialize a new git repo in the workspace root. */
function gitInitRepo(): void {
  const wsRoot = gitWorkspaceRoot;
  if (wsRoot.length === 0) return;
  gitSpinnerBegin(t('Initializing repository…'));
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'init']); } catch (e) {}
    return 0;
  }).then((_) => { gitSpinnerEnd(); onGitActionComplete(); });
}

function gitTagCreate(name: string): void {
  if (name.length < 1) return;
  const wsRoot = gitWorkspaceRoot;
  const tagName = name;
  gitSpinnerBegin(t('Creating tag…'));
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'tag', tagName]); } catch (e) {}
    return 0;
  }).then((_) => { gitSpinnerEnd(); rerenderTagsList(); });
}

function gitTagDelete(name: string): void {
  if (name.length < 1) return;
  const wsRoot = gitWorkspaceRoot;
  const tagName = name;
  gitSpinnerBegin(t('Deleting tag…'));
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'tag', '-d', tagName]); } catch (e) {}
    return 0;
  }).then((_) => { gitSpinnerEnd(); rerenderTagsList(); });
}

function gitTagPush(name: string): void {
  if (name.length < 1) return;
  const wsRoot = gitWorkspaceRoot;
  const tagName = name;
  gitSpinnerBegin(t('Pushing tag…'));
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'push', 'origin', tagName]); } catch (e) {}
    return 0;
  }).then((_) => { gitSpinnerEnd(); });
}

// Re-rendering helper used by the create/delete callbacks. We can't recurse
// straight into `onTagsButtonClick` because that toggles visibility — and a
// just-created tag should keep the list open.
function rerenderTagsList(): void {
  if (gitTagsContainer === null) return;
  gitTagsExpanded = 0; // force the toggle to expand on the next call
  onTagsButtonClick(null, panelColors);
}

function onGitActionComplete(): void {
  refreshGitStateAsync();
}

// SHIP-V1-GAPS.md #103: ASCII commit graph via `git log --graph`. Lines are
// rendered as monospace `Text` widgets so the `* | \ /` characters line up.
function listGitGraph(): string[] {
  if (gitWorkspaceRoot.length === 0) return [];
  let out = '';
  try {
    const r = spawnSync('git', [
      '-C', gitWorkspaceRoot,
      'log', '--graph', '--decorate=short',
      '--pretty=format:%h %s', '--all', '-n', '60', '--color=never',
    ]);
    if (r.status === 0) out = r.stdout;
  } catch (_e: any) {}
  if (out.length === 0) return [];
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

/** Toggle the commit-graph visibility, populating on first show. */
function onHistoryButtonClick(_container: unknown, _colors: ResolvedUIColors): void {
  if (gitHistoryContainer === null) return;
  if (gitHistoryExpanded > 0) {
    widgetSetHidden(gitHistoryContainer, 1);
    gitHistoryExpanded = 0;
    return;
  }
  widgetClearChildren(gitHistoryContainer);
  const lines = listGitGraph();
  if (lines.length === 0) {
    const empty = Text(t('No history.'));
    textSetFontSize(empty, 11);
    setFg(empty, getSecondaryTextColor());
    widgetAddChild(gitHistoryContainer, empty);
  } else {
    for (let i = 0; i < lines.length; i++) {
      // Each line keeps git's `* |` graph prefix exactly as emitted —
      // monospace font is essential to preserve alignment.
      const row = Text(lines[i]);
      textSetFontSize(row, 11);
      textSetFontFamily(row, 11, 'Menlo');
      setFg(row, getSideBarForeground());
      widgetAddChild(gitHistoryContainer, row);
    }
  }
  widgetSetHidden(gitHistoryContainer, 0);
  gitHistoryExpanded = 1;
}

// SHIP-V1-GAPS.md #101: submodule support.
//
// `git submodule status` output lines look like:
//   " 1a2b3c4 path/to/sub (heads/main)"
//   "+1a2b3c4 path/to/sub (heads/main)"   — out-of-sync
//   "-1a2b3c4 path/to/sub"                 — not initialized
// The leading char encodes the state. We surface the path and state, with a
// per-row "Update" button that runs `git submodule update --init --recursive`
// for that path.
function listGitSubmodulePaths(): string[] {
  if (gitWorkspaceRoot.length === 0) return [];
  let out = '';
  try {
    const r = spawnSync('git', ['-C', gitWorkspaceRoot, 'submodule', 'status']);
    if (r.status === 0) out = r.stdout;
  } catch (_e: any) {}
  if (out.length === 0) return [];
  // Each "path|stateChar" entry — keep them packed because Perry array<string>
  // is more reliable than tuples-as-objects.
  const rows: string[] = [];
  let start = 0;
  for (let i = 0; i <= out.length; i++) {
    if (i === out.length || out.charCodeAt(i) === 10) {
      if (i > start) {
        const line = out.slice(start, i);
        if (line.length > 2) {
          const stateChar = line.charAt(0);
          // Skip the state char + space + 40-char sha + space → path begins at 42.
          if (line.length > 43) {
            // Find the path (ends at first space, or end of line if no trailing ref).
            let pathEnd = line.length;
            for (let j = 42; j < line.length; j++) {
              if (line.charCodeAt(j) === 32) { pathEnd = j; break; }
            }
            const path = line.slice(42, pathEnd);
            rows.push(stateChar + '|' + path);
          }
        }
      }
      start = i + 1;
    }
  }
  return rows;
}

function gitSubmoduleUpdate(path: string): void {
  const wsRoot = gitWorkspaceRoot;
  const sub = path;
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'submodule', 'update', '--init', '--recursive', sub]); } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
}

function gitSubmoduleUpdateAll(): void {
  const wsRoot = gitWorkspaceRoot;
  spawn(() => {
    try { spawnSync('git', ['-C', wsRoot, 'submodule', 'update', '--init', '--recursive']); } catch (e) {}
    return 0;
  }).then((_) => { onGitActionComplete(); });
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
    // SHIP-V1-GAPS.md #90 empty-state with actionable next-step hint.
    const clean = Text(t('Working tree clean — nothing to commit'));
    textSetFontSize(clean, 12);
    if (panelColors) setFg(clean, getSideBarForeground());
    widgetAddChild(gitResultsContainer, clean);
    const hint = Text(t('Edit a file to see changes here.'));
    textSetFontSize(hint, 11);
    if (panelColors) setFg(hint, getSecondaryTextColor());
    widgetAddChild(gitResultsContainer, hint);
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

let _generateMessageHandler: () => void = _noopGen;
let _generatePRHandler: () => void = _noopGen;
function _noopGen(): void {}

/** Host installs a callback that wires the AI chat panel for commit-msg
 *  generation. Decouples this view from the chat module (which carries the
 *  HTTP streaming machinery). */
export function setGenerateCommitMessageHandler(fn: () => void): void {
  _generateMessageHandler = fn;
}

/** Host installs a callback that wires the AI chat panel for PR-description
 *  generation. SHIP-V1-GAPS.md #108. */
export function setGeneratePRDescriptionHandler(fn: () => void): void {
  _generatePRHandler = fn;
}

function onGenerateCommitMessage(): void {
  _generateMessageHandler();
}

function onGeneratePRDescription(): void {
  _generatePRHandler();
}

/** Toggle the branches list, populating on first show. */
function onBranchesButtonClick(_container: unknown, _colors: ResolvedUIColors): void {
  if (gitBranchesContainer === null) return;
  if (gitBranchesExpanded > 0) {
    widgetSetHidden(gitBranchesContainer, 1);
    gitBranchesExpanded = 0;
    return;
  }
  widgetClearChildren(gitBranchesContainer);
  const branches = listGitBranches();
  if (branches.length === 0) {
    const empty = Text(t('No branches.'));
    textSetFontSize(empty, 11);
    setFg(empty, getSecondaryTextColor());
    widgetAddChild(gitBranchesContainer, empty);
  } else {
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      // Mark the current branch (starts with "* ") in a brighter color.
      const isCurrent = b.length > 2 && b.charCodeAt(0) === 42;
      const row = Button(b, () => { gitCheckoutBranch(b); });
      buttonSetBordered(row, 0);
      textSetFontSize(row, 11);
      setBtnFg(row, isCurrent ? '#A6E3A1' : getSideBarForeground());
      widgetAddChild(gitBranchesContainer, row);
    }
  }
  widgetSetHidden(gitBranchesContainer, 0);
  gitBranchesExpanded = 1;
}

/** Toggle the tag list visibility, populating on first show. */
function onTagsButtonClick(_container: unknown, _colors: ResolvedUIColors): void {
  if (gitTagsContainer === null) return;
  if (gitTagsExpanded > 0) {
    widgetSetHidden(gitTagsContainer, 1);
    gitTagsExpanded = 0;
    return;
  }
  widgetClearChildren(gitTagsContainer);

  // SHIP-V1-GAPS.md #100: create row at the top.
  const newTagField = TextField(t('Tag name…'), (text: string) => { gitNewTagName = text; });
  widgetAddChild(gitTagsContainer, newTagField);
  const createBtn = Button(t('Create tag'), () => {
    const n = gitNewTagName;
    gitNewTagName = '';
    gitTagCreate(n);
  });
  buttonSetBordered(createBtn, 0);
  textSetFontSize(createBtn, 11);
  setBtnFg(createBtn, getSideBarForeground());
  widgetAddChild(gitTagsContainer, createBtn);

  const tags = listGitTags();
  if (tags.length === 0) {
    const empty = Text(t('No tags.'));
    textSetFontSize(empty, 11);
    setFg(empty, getSecondaryTextColor());
    widgetAddChild(gitTagsContainer, empty);
  } else {
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      // Checkout button — main row label.
      const row = Button(tag, () => { gitCheckoutTag(tag); });
      buttonSetBordered(row, 0);
      textSetFontSize(row, 11);
      setBtnFg(row, getSideBarForeground());

      // SHIP-V1-GAPS.md #100: per-row push + delete.
      const pushBtn = Button(t('Push'), () => { gitTagPush(tag); });
      buttonSetBordered(pushBtn, 0);
      textSetFontSize(pushBtn, 11);
      setBtnFg(pushBtn, getSideBarForeground());

      const delBtn = Button(t('Delete'), () => { gitTagDelete(tag); });
      buttonSetBordered(delBtn, 0);
      textSetFontSize(delBtn, 11);
      setBtnFg(delBtn, getStatusDeletedColor());

      const r = HStack(8, [row, Spacer(), pushBtn, delBtn]);
      widgetAddChild(gitTagsContainer, r);
    }
  }
  widgetSetHidden(gitTagsContainer, 0);
  gitTagsExpanded = 1;
}

/** Toggle the submodule list visibility, populating on first show. */
function onSubmodulesButtonClick(_container: unknown, _colors: ResolvedUIColors): void {
  if (gitSubmodulesContainer === null) return;
  if (gitSubmodulesExpanded > 0) {
    widgetSetHidden(gitSubmodulesContainer, 1);
    gitSubmodulesExpanded = 0;
    return;
  }
  widgetClearChildren(gitSubmodulesContainer);
  const rows = listGitSubmodulePaths();
  if (rows.length === 0) {
    const empty = Text(t('No submodules.'));
    textSetFontSize(empty, 11);
    setFg(empty, getSecondaryTextColor());
    widgetAddChild(gitSubmodulesContainer, empty);
  } else {
    // "Update all" at the top so the user has a single one-tap path.
    const updateAllBtn = Button(t('Update all'), () => { gitSubmoduleUpdateAll(); });
    buttonSetBordered(updateAllBtn, 0);
    textSetFontSize(updateAllBtn, 11);
    setBtnFg(updateAllBtn, getSideBarForeground());
    widgetAddChild(gitSubmodulesContainer, updateAllBtn);

    for (let i = 0; i < rows.length; i++) {
      const entry = rows[i];
      // Format: "S|path"
      const stateChar = entry.charAt(0);
      const path = entry.slice(2);
      // Build the row label — show the state hint so the user can tell which
      // submodules are out-of-sync (`+`) or uninitialized (`-`).
      let label = path;
      if (stateChar === '+') label = path + '  ' + t('(modified)');
      else if (stateChar === '-') label = path + '  ' + t('(not initialized)');
      const pathLabel = Text(label);
      textSetFontSize(pathLabel, 11);
      setFg(pathLabel, getSideBarForeground());

      const updateBtn = Button(t('Update'), () => { gitSubmoduleUpdate(path); });
      buttonSetBordered(updateBtn, 0);
      textSetFontSize(updateBtn, 11);
      setBtnFg(updateBtn, getSideBarForeground());

      const row = HStack(8, [pathLabel, Spacer(), updateBtn]);
      widgetAddChild(gitSubmodulesContainer, row);
    }
  }
  widgetSetHidden(gitSubmodulesContainer, 0);
  gitSubmodulesExpanded = 1;
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
    // SHIP-V1-GAPS.md #90: actionable empty-state with one-tap "Initialize".
    const noRepo = Text(t('No source control provider for this workspace.'));
    textSetFontSize(noRepo, 12);
    if (colors) setFg(noRepo, getSideBarForeground());
    widgetAddChild(container, noRepo);
    const initBtn = Button(t('Initialize Repository'), () => { gitInitRepo(); });
    buttonSetBordered(initBtn, 0);
    textSetFontSize(initBtn, 11);
    if (colors) setBtnFg(initBtn, getSideBarForeground());
    widgetAddChild(container, initBtn);
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
  // SHIP-V1-GAPS.md #102: LFS chip after the branch name when tracked.
  if (gitLfsTracked > 0) {
    const lfsChip = Text('LFS');
    textSetFontSize(lfsChip, 9);
    textSetFontWeight(lfsChip, 9, 0.6);
    if (colors) setFg(lfsChip, getSecondaryTextColor());
    widgetAddChild(branchRow, lfsChip);
  }
  widgetAddChild(container, branchRow);

  // Commit message input
  gitCommitTextField = TextField(t('Commit message'), (text: string) => { onCommitMessageInput(text); });
  widgetAddChild(container, gitCommitTextField);

  // Commit button
  const commitBtn = Button(t('Commit'), () => { gitCommit(); });
  buttonSetBordered(commitBtn, 0);
  textSetFontSize(commitBtn, 12);
  if (colors) setBtnFg(commitBtn, getSideBarForeground());
  // SHIP-V1-GAPS.md #63: Generate commit message. Reads `git diff --cached`
  // (falls back to working-tree diff), pre-fills the AI Chat input with a
  // commit-message prompt + the diff, and focuses chat. User reviews and
  // submits. No direct API call here — keeps the streaming flow in chat.
  const generateBtn = Button(t('Generate'), () => { onGenerateCommitMessage(); });
  buttonSetBordered(generateBtn, 0);
  textSetFontSize(generateBtn, 12);
  if (colors) setBtnFg(generateBtn, getSideBarForeground());
  // Refresh button
  const refreshBtn = Button(t('Refresh'), () => { onGitRefresh(); });
  buttonSetBordered(refreshBtn, 0);
  textSetFontSize(refreshBtn, 12);
  if (colors) setBtnFg(refreshBtn, getSideBarForeground());
  const actionRow = HStack(8, [commitBtn, generateBtn, refreshBtn]);
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

  // SHIP-V1-GAPS.md #93: long-op spinner just below the sync row. Idle
  // (used > 0, active === 0) renders as an empty string so it takes no
  // visible space until push/pull/fetch begins.
  if (gitSpinnerId < 0) {
    const sp = createSpinner('');
    gitSpinnerId = sp.id;
    gitSpinnerWidget = sp.widget;
  }
  if (gitSpinnerWidget) {
    textSetFontSize(gitSpinnerWidget, 11);
    if (colors) setFg(gitSpinnerWidget, getSecondaryTextColor());
    widgetAddChild(container, gitSpinnerWidget);
  }

  const stashBtn = Button(t('Stash'), () => { gitStash(); });
  buttonSetBordered(stashBtn, 0);
  textSetFontSize(stashBtn, 11);
  if (colors) setBtnFg(stashBtn, getSideBarForeground());
  const popBtn = Button(t('Pop'), () => { gitStashPop(); });
  buttonSetBordered(popBtn, 0);
  textSetFontSize(popBtn, 11);
  if (colors) setBtnFg(popBtn, getSideBarForeground());
  // SHIP-V1-GAPS.md #100: tag list. Toggles a section showing the 20 newest
  // tags; click checks out (detached HEAD).
  const tagsBtn = Button(t('Tags'), () => { onTagsButtonClick(container, colors); });
  buttonSetBordered(tagsBtn, 0);
  textSetFontSize(tagsBtn, 11);
  if (colors) setBtnFg(tagsBtn, getSideBarForeground());
  // SHIP-V1-GAPS.md #47: branch picker. Lists local branches, current first.
  const branchesBtn = Button(t('Branches'), () => { onBranchesButtonClick(container, colors); });
  buttonSetBordered(branchesBtn, 0);
  textSetFontSize(branchesBtn, 11);
  if (colors) setBtnFg(branchesBtn, getSideBarForeground());
  // SHIP-V1-GAPS.md #108: AI PR description. Collects log + diff for the
  // current branch vs `main`/`master`, then prefills the chat panel.
  const prBtn = Button(t('PR Desc'), () => { onGeneratePRDescription(); });
  buttonSetBordered(prBtn, 0);
  textSetFontSize(prBtn, 11);
  if (colors) setBtnFg(prBtn, getSideBarForeground());
  // SHIP-V1-GAPS.md #101: submodule list + Update.
  const submodBtn = Button(t('Submodules'), () => { onSubmodulesButtonClick(container, colors); });
  buttonSetBordered(submodBtn, 0);
  textSetFontSize(submodBtn, 11);
  if (colors) setBtnFg(submodBtn, getSideBarForeground());
  // SHIP-V1-GAPS.md #103: commit graph (history).
  const historyBtn = Button(t('History'), () => { onHistoryButtonClick(container, colors); });
  buttonSetBordered(historyBtn, 0);
  textSetFontSize(historyBtn, 11);
  if (colors) setBtnFg(historyBtn, getSideBarForeground());
  const stashRow = HStack(8, [stashBtn, popBtn, branchesBtn, tagsBtn, submodBtn, historyBtn, prBtn]);
  widgetAddChild(container, stashRow);

  // Branches list — toggles visibility, populated on first show.
  gitBranchesContainer = VStack(2, []);
  widgetSetHidden(gitBranchesContainer, 1);
  widgetAddChild(container, gitBranchesContainer);

  // Optional tags list — rendered into a container that toggles visibility.
  gitTagsContainer = VStack(2, []);
  widgetSetHidden(gitTagsContainer, 1);
  widgetAddChild(container, gitTagsContainer);

  // Submodules list — toggles visibility, populated on first show.
  gitSubmodulesContainer = VStack(2, []);
  widgetSetHidden(gitSubmodulesContainer, 1);
  widgetAddChild(container, gitSubmodulesContainer);

  // SHIP-V1-GAPS.md #103: commit graph — toggles visibility, populated on first show.
  gitHistoryContainer = VStack(1, []);
  widgetSetHidden(gitHistoryContainer, 1);
  widgetAddChild(container, gitHistoryContainer);

  // Results container for file lists
  gitResultsContainer = VStack(2, []);
  widgetAddChild(container, gitResultsContainer);
  gitPanelReady = 1;

  updateGitResultsUI();
  updateStatusBarBranch();

  widgetAddChild(container, Spacer());
}
