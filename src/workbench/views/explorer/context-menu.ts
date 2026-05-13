/**
 * File explorer context menus — right-click on files, folders, empty space.
 *
 * Perry-safe: module-level state, for-loops, no closures capturing mutable vars.
 * Closures capture path/name by value and pass to module-level action functions.
 */
import { menuCreate, menuAddItem, menuAddSeparator } from 'perry/ui';
import { t } from 'perry/i18n';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';

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
  let tmpPath = '/tmp/hone_clip.tmp';
  try {
    writeFileSync(tmpPath, text);
    execSync('pbcopy < /tmp/hone_clip.tmp');
  } catch (e) {
    try { execSync('cmd /c clip < /tmp/hone_clip.tmp'); } catch (e2) {}
  }
  try { unlinkSync(tmpPath); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Parse osascript dialog result — extracts "text returned:" value
// ---------------------------------------------------------------------------

function parseDialogResult(result: string): string {
  let text = '';
  let needle = 'text returned:';
  let trIdx = -1;
  for (let i = 0; i < result.length; i++) {
    let found = 1;
    for (let j = 0; j < needle.length; j++) {
      if (i + j >= result.length) { found = 0; break; }
      if (result.charCodeAt(i + j) !== needle.charCodeAt(j)) { found = 0; break; }
    }
    if (found > 0) { trIdx = i + needle.length; break; }
  }
  if (trIdx < 0) return '';
  for (let i = trIdx; i < result.length; i++) {
    const c = result.charCodeAt(i);
    if (c === 10 || c === 13) break;
    text += result.charAt(i);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Compute parent directory from a path
// ---------------------------------------------------------------------------

function getParentDir(path: string): string {
  let lastSlash = -1;
  for (let i = 0; i < path.length; i++) {
    if (path.charCodeAt(i) === 47) lastSlash = i;
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

function onNewFolder(parentDir: string): void {
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
  let tmpPath = '/tmp/hone_reveal.tmp';
  try {
    writeFileSync(tmpPath, _pendingPath);
    execSync('cat /tmp/hone_reveal.tmp | xargs -I{} open -R "{}"');
  } catch (e) {
    try {
      execSync('cat /tmp/hone_reveal.tmp | xargs -I{} explorer /select,"{}"');
    } catch (e2) {}
  }
  try { unlinkSync(tmpPath); } catch (e) {}
}

function doOpenTerminal(): void {
  _openInTerminal(_pendingParentDir);
}

function doNewFile(): void {
  let result = '';
  try {
    result = execSync("osascript -e 'display dialog \"" + t('Enter file name:') + "\" default answer \"untitled.ts\" buttons {\"" + t('Cancel') + "\",\"" + t('Create') + "\"} default button \"" + t('Create') + "\"'") as unknown as string;
  } catch (e) {
    return;
  }
  let fileName = parseDialogResult(result);
  if (fileName.length < 1) return;
  let filePath = '';
  filePath += _pendingParentDir;
  filePath += '/';
  filePath += fileName;
  try {
    writeFileSync(filePath, '');
  } catch (e) {
    return;
  }
  _refreshSidebar();
  _openFileInEditor(filePath, fileName);
}

function doNewFolder(): void {
  let result = '';
  try {
    result = execSync("osascript -e 'display dialog \"" + t('Enter folder name:') + "\" default answer \"new-folder\" buttons {\"" + t('Cancel') + "\",\"" + t('Create') + "\"} default button \"" + t('Create') + "\"'") as unknown as string;
  } catch (e) {
    return;
  }
  let folderName = parseDialogResult(result);
  if (folderName.length < 1) return;
  let dirPath = '';
  dirPath += _pendingParentDir;
  dirPath += '/';
  dirPath += folderName;
  try {
    mkdirSync(dirPath);
  } catch (e) {
    return;
  }
  _refreshSidebar();
}

function doRename(): void {
  let prompt = "osascript -e 'display dialog \"" + t('Rename to:') + "\" default answer \"";
  prompt += _pendingName;
  prompt += "\" buttons {\"" + t('Cancel') + "\",\"" + t('Rename') + "\"} default button \"" + t('Rename') + "\"'";
  let result = '';
  try {
    result = execSync(prompt) as unknown as string;
  } catch (e) {
    return;
  }
  let newName = parseDialogResult(result);
  if (newName.length < 1) return;
  let parentDir = getParentDir(_pendingPath);
  let newPath = '';
  newPath += parentDir;
  newPath += '/';
  newPath += newName;
  try {
    let tmpSrc = '/tmp/hone_rename_src.tmp';
    let tmpDst = '/tmp/hone_rename_dst.tmp';
    writeFileSync(tmpSrc, _pendingPath);
    writeFileSync(tmpDst, newPath);
    execSync('mv "$(cat /tmp/hone_rename_src.tmp)" "$(cat /tmp/hone_rename_dst.tmp)"');
    try { unlinkSync(tmpSrc); } catch (e) {}
    try { unlinkSync(tmpDst); } catch (e) {}
  } catch (e) {
    return;
  }
  _refreshSidebar();
}

function doDeleteItem(): void {
  let prompt = "osascript -e 'display alert \"" + t('Delete') + "\" message \"" + t('Move to Trash?') + " \\\"";
  prompt += _pendingName;
  prompt += "\\\"\" buttons {\"" + t('Cancel') + "\",\"" + t('Move to Trash') + "\"} cancel button \"" + t('Cancel') + "\" default button \"" + t('Cancel') + "\"'";
  try {
    execSync(prompt);
  } catch (e) {
    // User cancelled
    return;
  }
  // Move to Trash via Finder (safer)
  try {
    let tmpPath = '/tmp/hone_trash.tmp';
    writeFileSync(tmpPath, _pendingPath);
    execSync("osascript -e 'tell application \"Finder\" to delete (POSIX file (do shell script \"cat /tmp/hone_trash.tmp\") as alias)'");
    try { unlinkSync(tmpPath); } catch (e) {}
  } catch (e) {
    // Fallback: rm -rf
    try {
      let tmpPath = '/tmp/hone_rm.tmp';
      writeFileSync(tmpPath, _pendingPath);
      execSync('cat /tmp/hone_rm.tmp | xargs -I{} rm -rf "{}"');
      try { unlinkSync(tmpPath); } catch (e2) {}
    } catch (e2) {
      return;
    }
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
