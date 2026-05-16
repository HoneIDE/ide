/**
 * File explorer context menus — right-click on files, folders, empty space.
 *
 * Perry-safe: module-level state, for-loops, no closures capturing mutable vars.
 * Closures capture path/name by value and pass to module-level action functions.
 */
import { menuCreate, menuAddItem, menuAddSeparator, clipboardWrite } from 'perry/ui';
import { t } from 'perry/i18n';
import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, isDirectory, existsSync } from 'fs';
import { join } from 'path';

// Platform constant — 0=macOS, 1=iOS, 3=Windows, 4=Linux, 5=web.
declare const __platform__: number;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _workspaceRoot = '';

// Pending action target (set by module-level functions before setTimeout)
let _pendingPath = '';
let _pendingParentDir = '';
let _pendingName = '';

// External callbacks
let _refreshSidebar: () => void = _noop;
let _openFileInEditor: (path: string, name: string) => void = _noopFile;
let _openInTerminal: (dir: string) => void = _noop1;

function _noop(): void {}
function _noopFile(_p: string, _n: string): void {}
function _noop1(_d: string): void {}

// ---------------------------------------------------------------------------
// Setter functions (wired by render.ts)
// ---------------------------------------------------------------------------

export function setContextMenuWorkspaceRoot(root: string): void {
  _workspaceRoot = root;
}

export function setContextMenuRefreshCallback(cb: () => void): void {
  _refreshSidebar = cb;
}

export function setContextMenuFileOpener(cb: (path: string, name: string) => void): void {
  _openFileInEditor = cb;
}

export function setContextMenuTerminalOpener(cb: (dir: string) => void): void {
  _openInTerminal = cb;
}

// ---------------------------------------------------------------------------
// Clipboard helper
// ---------------------------------------------------------------------------

function copyToClipboard(text: string): void {
  // Perry's clipboardWrite handles pbcopy / clip.exe / xclip per platform —
  // followup §5 mandates this in place of shelling out.
  clipboardWrite(text);
}

// Cross-platform input prompt. macOS uses AppleScript dialog; Windows uses
// PowerShell + VB InputBox; other platforms return '' (no native prompt yet).
// followup §5: prefer perry/ui Alert/Input widgets when they ship.
function promptInputCrossPlatform(title: string, defaultValue: string): string {
  if (__platform__ === 0) return promptInputMac(title, defaultValue);
  if (__platform__ === 3) return promptInputWindows(title, defaultValue);
  return '';
}

function promptInputMac(title: string, defaultValue: string): string {
  // Escape `"` and `\` for the AppleScript string literal.
  let safeTitle = '';
  for (let i = 0; i < title.length; i++) {
    const c = title.charCodeAt(i);
    if (c === 92) safeTitle += '\\\\';
    else if (c === 34) safeTitle += '\\"';
    else safeTitle += title.charAt(i);
  }
  let safeDefault = '';
  for (let i = 0; i < defaultValue.length; i++) {
    const c = defaultValue.charCodeAt(i);
    if (c === 92) safeDefault += '\\\\';
    else if (c === 34) safeDefault += '\\"';
    else safeDefault += defaultValue.charAt(i);
  }
  let script = 'try\n';
  script += '  set result to text returned of (display dialog "' + safeTitle + '" default answer "' + safeDefault + '" buttons {"Cancel","OK"} default button "OK" cancel button "Cancel")\n';
  script += '  return result\n';
  script += 'on error number -128\n';
  script += '  return ""\n';
  script += 'end try\n';
  try {
    const r = spawnSync('osascript', ['-e', script]);
    if (r.status !== 0) return '';
    let out = r.stdout;
    let end = out.length;
    while (end > 0 && (out.charCodeAt(end - 1) === 10 || out.charCodeAt(end - 1) === 13)) end--;
    return out.slice(0, end);
  } catch (_e: any) {
    return '';
  }
}

function promptInputWindows(title: string, defaultValue: string): string {
  // Escape single quotes (double them) for PS single-quoted literal.
  let safeTitle = '';
  for (let i = 0; i < title.length; i++) {
    const c = title.charCodeAt(i);
    if (c === 39) safeTitle += "''";
    else safeTitle += title.charAt(i);
  }
  let safeDefault = '';
  for (let i = 0; i < defaultValue.length; i++) {
    const c = defaultValue.charCodeAt(i);
    if (c === 39) safeDefault += "''";
    else safeDefault += defaultValue.charAt(i);
  }
  let ps = '[void][System.Reflection.Assembly]::LoadWithPartialName(\'Microsoft.VisualBasic\');';
  ps += '$r = [Microsoft.VisualBasic.Interaction]::InputBox(\'' + safeTitle + '\',\'Hone\',\'' + safeDefault + '\');';
  ps += '[Console]::Out.Write($r)';
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    if (r.status !== 0) return '';
    let out = r.stdout;
    let end = out.length;
    while (end > 0 && (out.charCodeAt(end - 1) === 10 || out.charCodeAt(end - 1) === 13)) end--;
    return out.slice(0, end);
  } catch (_e: any) {
    return '';
  }
}

// Cross-platform confirm. Returns 1 = OK, 0 = Cancel.
function confirmCrossPlatform(title: string, message: string): number {
  if (__platform__ === 0) return confirmMac(title, message);
  if (__platform__ === 3) return confirmWindows(title, message);
  return 0;
}

function confirmMac(title: string, message: string): number {
  let safeTitle = '';
  for (let i = 0; i < title.length; i++) {
    const c = title.charCodeAt(i);
    if (c === 92) safeTitle += '\\\\';
    else if (c === 34) safeTitle += '\\"';
    else safeTitle += title.charAt(i);
  }
  let safeMsg = '';
  for (let i = 0; i < message.length; i++) {
    const c = message.charCodeAt(i);
    if (c === 92) safeMsg += '\\\\';
    else if (c === 34) safeMsg += '\\"';
    else safeMsg += message.charAt(i);
  }
  let script = 'try\n';
  script += '  set result to button returned of (display alert "' + safeTitle + '" message "' + safeMsg + '" buttons {"Cancel","OK"} cancel button "Cancel" default button "OK")\n';
  script += '  if result is "OK" then return "1"\n';
  script += '  return "0"\n';
  script += 'on error number -128\n';
  script += '  return "0"\n';
  script += 'end try\n';
  try {
    const r = spawnSync('osascript', ['-e', script]);
    if (r.status !== 0) return 0;
    return r.stdout.length > 0 && r.stdout.charAt(0) === '1' ? 1 : 0;
  } catch (_e: any) {
    return 0;
  }
}

function confirmWindows(title: string, message: string): number {
  let safeTitle = '';
  for (let i = 0; i < title.length; i++) {
    const c = title.charCodeAt(i);
    if (c === 39) safeTitle += "''";
    else safeTitle += title.charAt(i);
  }
  let safeMsg = '';
  for (let i = 0; i < message.length; i++) {
    const c = message.charCodeAt(i);
    if (c === 39) safeMsg += "''";
    else safeMsg += message.charAt(i);
  }
  let ps = '[void][System.Reflection.Assembly]::LoadWithPartialName(\'System.Windows.Forms\');';
  ps += '$r = [System.Windows.Forms.MessageBox]::Show(\'' + safeMsg + '\',\'' + safeTitle + '\',\'OKCancel\',\'Question\');';
  ps += 'if ($r -eq \'OK\') { [Console]::Out.Write(\'1\') } else { [Console]::Out.Write(\'0\') }';
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    if (r.status !== 0) return 0;
    return r.stdout.length > 0 && r.stdout.charAt(0) === '1' ? 1 : 0;
  } catch (_e: any) {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Compute parent directory from a path
// ---------------------------------------------------------------------------

function getParentDir(path: string): string {
  // FUNCTIONAL (not cosmetic): accept '/' (47) AND '\' (92). On Windows
  // (backslash OS paths) the /-only scan left lastSlash=-1, so this
  // returned `_workspaceRoot` instead of the selected item's real parent —
  // New File / New Folder / rename from the explorer context menu created
  // the entry in the WORKSPACE ROOT rather than the chosen directory.
  let lastSlash = -1;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 47 || c === 92) lastSlash = i;
  }
  if (lastSlash > 0) return path.slice(0, lastSlash);
  return _workspaceRoot;
}

// ---------------------------------------------------------------------------
// Action entry points (module-level, called from closures with captured values)
// These set _pending* vars and defer the real work via setTimeout.
// ---------------------------------------------------------------------------

function onCopyPath(path: string): void {
  _pendingPath = path;
  setTimeout(() => { doCopyPath(); }, 0);
}

function onCopyRelPath(path: string): void {
  _pendingPath = path;
  setTimeout(() => { doCopyRelPath(); }, 0);
}

function onReveal(path: string): void {
  _pendingPath = path;
  setTimeout(() => { doReveal(); }, 0);
}

function onOpenTerminal(dirPath: string): void {
  _pendingParentDir = dirPath;
  setTimeout(() => { doOpenTerminal(); }, 0);
}

function onNewFile(parentDir: string): void {
  _pendingParentDir = parentDir;
  setTimeout(() => { doNewFile(); }, 0);
}

export function onNewFolder(parentDir: string): void {
  _pendingParentDir = parentDir;
  setTimeout(() => { doNewFolder(); }, 0);
}

function onRename(path: string, name: string): void {
  _pendingPath = path;
  _pendingName = name;
  setTimeout(() => { doRename(); }, 0);
}

function onDeleteItem(path: string, name: string): void {
  _pendingPath = path;
  _pendingName = name;
  setTimeout(() => { doDeleteItem(); }, 0);
}

// ---------------------------------------------------------------------------
// Deferred action implementations (read _pending* vars set above)
// ---------------------------------------------------------------------------

function doCopyPath(): void {
  copyToClipboard(_pendingPath);
}

function doCopyRelPath(): void {
  let rel = _pendingPath;
  if (_workspaceRoot.length > 0 && _pendingPath.length > _workspaceRoot.length + 1) {
    let match = 1;
    for (let i = 0; i < _workspaceRoot.length; i++) {
      if (_pendingPath.charCodeAt(i) !== _workspaceRoot.charCodeAt(i)) { match = 0; break; }
    }
    if (match > 0) {
      rel = _pendingPath.slice(_workspaceRoot.length + 1);
    }
  }
  copyToClipboard(rel);
}

function doReveal(): void {
  // SHIP-V1-GAPS.md #1: argv-form spawn. macOS: `open -R <path>` (Finder
  // selects the file). Windows: `explorer /select,<path>` (selects in File
  // Explorer). Linux: best-effort `xdg-open` on the parent dir — there's no
  // standard file-manager reveal flag.
  if (__platform__ === 3) {
    try { spawnSync('explorer', ['/select,' + _pendingPath]); } catch (_e: any) {}
  } else if (__platform__ === 0) {
    try { spawnSync('open', ['-R', _pendingPath]); } catch (_e: any) {}
  } else {
    try { spawnSync('xdg-open', [getParentDir(_pendingPath)]); } catch (_e: any) {}
  }
}

function doOpenTerminal(): void {
  _openInTerminal(_pendingParentDir);
}

function doNewFile(): void {
  const fileName = promptInputCrossPlatform(t('Enter file name:'), 'untitled.ts');
  if (fileName.length < 1) return;
  // Use `join` so the path separator matches the host OS (no more `+ '/'`).
  const filePath = join(_pendingParentDir, fileName);
  // If the name collides with an existing file, OPEN it instead of
  // `writeFileSync(path, '')` — which silently truncated the existing file
  // to empty (data loss). Opening the existing file is also the more
  // helpful behavior (matches VS Code's "New File" with a taken name).
  let collides = 0;
  try { if (existsSync(filePath)) collides = 1; } catch (_e: any) {}
  if (collides > 0) {
    _openFileInEditor(filePath, fileName);
    return;
  }
  try {
    writeFileSync(filePath, '');
  } catch (_e: any) {
    return;
  }
  _refreshSidebar();
  _openFileInEditor(filePath, fileName);
}

function doNewFolder(): void {
  const folderName = promptInputCrossPlatform(t('Enter folder name:'), 'new-folder');
  if (folderName.length < 1) return;
  const dirPath = join(_pendingParentDir, folderName);
  try {
    mkdirSync(dirPath);
  } catch (_e: any) {
    return;
  }
  _refreshSidebar();
}

function doRename(): void {
  const newName = promptInputCrossPlatform(t('Rename to:'), _pendingName);
  if (newName.length < 1) return;
  const parentDir = getParentDir(_pendingPath);
  const newPath = join(parentDir, newName);
  if (newName === _pendingName) return; // no-op rename
  // Refuse to clobber an existing target. `move /Y` (Windows) and `mv`
  // without `-i` (Unix) BOTH silently overwrite — renaming foo.ts onto an
  // existing bar.ts destroyed bar.ts with no warning. Confirm before any
  // destructive overwrite so the user can't lose a file by a name typo.
  let targetExists = 0;
  try { if (existsSync(newPath)) targetExists = 1; } catch (_e: any) {}
  if (targetExists > 0) {
    const ok = confirmCrossPlatform(t('Overwrite?'), t('A file or folder named') + ' "' + newName + '" ' + t('already exists. Overwrite it? This cannot be undone.'));
    if (ok < 1) return;
  }
  // SHIP-V1-GAPS.md #1: argv-form `mv` (Unix) or `move` (Windows). No more
  // shell-string concatenation of user-controlled paths.
  if (__platform__ === 3) {
    try {
      spawnSync('cmd', ['/c', 'move', '/Y', _pendingPath, newPath]);
    } catch (_e: any) { return; }
  } else {
    try {
      spawnSync('mv', [_pendingPath, newPath]);
    } catch (_e: any) { return; }
  }
  _refreshSidebar();
}

// Move a path to the OS Trash/Recycle Bin via the platform-native facility.
// Returns 1 on success, 0 on failure. Recoverable, unlike unlink/rm -rf.
// - Windows: Microsoft.VisualBasic.FileIO with SendToRecycleBin (works for
//   files and dirs; present wherever .NET is, i.e. all supported Windows).
// - macOS: Finder `delete` via osascript → moves to ~/.Trash.
// - Linux: `gio trash` (glib; present on essentially all desktop Linux).
function moveToTrash(p: string): number {
  if (__platform__ === 3) {
    // PowerShell single-quoted string: the only metachar is `'`, escaped by
    // doubling it. Prevents both breakage and injection for paths with `'`.
    let pe = '';
    for (let i = 0; i < p.length; i++) {
      const ch = p.charAt(i);
      if (ch === "'") pe += "''"; else pe += ch;
    }
    const ps = "Add-Type -AssemblyName Microsoft.VisualBasic; if (Test-Path -LiteralPath '" + pe + "' -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('" + pe + "','OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('" + pe + "','OnlyErrorDialogs','SendToRecycleBin') }";
    try {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
      if (r.status === 0) return 1;
    } catch (_e: any) {}
    return 0;
  }
  if (__platform__ === 0) {
    // AppleScript double-quoted string: escape `\` then `"`.
    let ae = '';
    for (let i = 0; i < p.length; i++) {
      const ch = p.charAt(i);
      if (ch === '\\') ae += '\\\\';
      else if (ch === '"') ae += '\\"';
      else ae += ch;
    }
    const script = 'tell application "Finder" to delete (POSIX file "' + ae + '" as alias)';
    try {
      const r = spawnSync('osascript', ['-e', script]);
      if (r.status === 0) return 1;
    } catch (_e: any) {}
    return 0;
  }
  // Linux / other
  try {
    const r = spawnSync('gio', ['trash', p]);
    if (r.status === 0) return 1;
  } catch (_e: any) {}
  return 0;
}

function doDeleteItem(): void {
  const confirmed = confirmCrossPlatform(t('Delete'), t('Move to Trash?') + ' "' + _pendingName + '"');
  if (confirmed < 1) return;
  // The confirm says "Move to Trash" — so actually move to Trash, don't
  // permanently destroy. Previously this ran unlinkSync / rm -rf / rmdir
  // /S /Q, which is unrecoverable: the user reads "Trash" and reasonably
  // believes they can restore it, but the file was gone forever. Try the
  // OS Trash first; only fall back to permanent delete if Trash fails AND
  // the user explicitly opts in to the irreversible delete.
  if (moveToTrash(_pendingPath) > 0) {
    _refreshSidebar();
    return;
  }
  const hard = confirmCrossPlatform(t('Trash unavailable'), t('Could not move to Trash. Permanently delete') + ' "' + _pendingName + '"? ' + t('This cannot be undone.'));
  if (hard < 1) return;
  // SHIP-V1-GAPS.md #1: argv-form spawn for the recursive delete; plain
  // files go through unlinkSync.
  let isDir = 0;
  try { if (isDirectory(_pendingPath)) isDir = 1; } catch (_e: any) {}
  if (isDir < 1) {
    try { unlinkSync(_pendingPath); } catch (_e: any) {}
  } else if (__platform__ === 3) {
    try {
      spawnSync('cmd', ['/c', 'rmdir', '/S', '/Q', _pendingPath]);
    } catch (_e: any) {}
  } else {
    try {
      spawnSync('rm', ['-rf', _pendingPath]);
    } catch (_e: any) {}
  }
  _refreshSidebar();
}

// ---------------------------------------------------------------------------
// Menu builders
// ---------------------------------------------------------------------------

/**
 * Build a context menu for a file item.
 * Closures capture filePath/fileName by value (Perry capture-by-value).
 */
export function buildFileContextMenu(filePath: string, fileName: string): unknown {
  const fPath = filePath;
  const fName = fileName;
  const parentDir = getParentDir(filePath);

  const menu = menuCreate();
  menuAddItem(menu, t('New File...'), () => { onNewFile(parentDir); });
  menuAddItem(menu, t('New Folder...'), () => { onNewFolder(parentDir); });
  menuAddSeparator(menu);
  menuAddItem(menu, t('Copy Path'), () => { onCopyPath(fPath); });
  menuAddItem(menu, t('Copy Relative Path'), () => { onCopyRelPath(fPath); });
  menuAddSeparator(menu);
  menuAddItem(menu, t('Rename...'), () => { onRename(fPath, fName); });
  menuAddItem(menu, t('Delete'), () => { onDeleteItem(fPath, fName); });
  menuAddSeparator(menu);
  menuAddItem(menu, t('Reveal in Finder'), () => { onReveal(fPath); });
  menuAddItem(menu, t('Open in Integrated Terminal'), () => { onOpenTerminal(parentDir); });
  return menu;
}

/**
 * Build a context menu for a directory item.
 */
export function buildDirContextMenu(dirPath: string, dirName: string): unknown {
  const dPath = dirPath;
  const dName = dirName;

  const menu = menuCreate();
  menuAddItem(menu, t('New File...'), () => { onNewFile(dPath); });
  menuAddItem(menu, t('New Folder...'), () => { onNewFolder(dPath); });
  menuAddSeparator(menu);
  menuAddItem(menu, t('Copy Path'), () => { onCopyPath(dPath); });
  menuAddItem(menu, t('Copy Relative Path'), () => { onCopyRelPath(dPath); });
  menuAddSeparator(menu);
  menuAddItem(menu, t('Rename...'), () => { onRename(dPath, dName); });
  menuAddItem(menu, t('Delete'), () => { onDeleteItem(dPath, dName); });
  menuAddSeparator(menu);
  menuAddItem(menu, t('Reveal in Finder'), () => { onReveal(dPath); });
  menuAddItem(menu, t('Open in Integrated Terminal'), () => { onOpenTerminal(dPath); });
  return menu;
}

/**
 * Build a context menu for empty space (root area).
 */
export function buildEmptySpaceContextMenu(): unknown {
  const root = _workspaceRoot;
  const menu = menuCreate();
  menuAddItem(menu, t('New File...'), () => { onNewFile(root); });
  menuAddItem(menu, t('New Folder...'), () => { onNewFolder(root); });
  return menu;
}
