/**
 * Auto-update checker — version check + download + install + restart.
 *
 * Perry constraints:
 * - Module-level functions for all callbacks
 * - No JSON.parse — use indexOf/slice parsing
 * - Stream polling for HTTP (no fetch/await)
 * - execSync for binary downloads (stream API is string-only)
 * - spawnBackground for restart
 */

import { streamStart, streamPoll, streamStatus, streamClose } from 'node-fetch';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { spawn } from 'perry/thread';
import { spawnBackground } from 'child_process';
import { HONE_VERSION } from '../../version';
import { getAppDataDir } from '../../paths';

// Compile-time platform ID injected by Perry codegen
declare const __platform__: number;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _currentVersion: string = HONE_VERSION;
let _latestVersion: string = '';
let _downloadUrl: string = '';
let _sha256: string = '';
let _releaseNotes: string = '';

// 0=idle, 1=checking, 2=available, 3=downloading, 4=ready, 5=error
let _updateState: number = 0;
let _errorMessage: string = '';

let _fetchHandle: number = 0;
let _pollInterval: number = 0;
let _pollCount: number = 0;

let _lastCheckTime: number = 0;

// Callback IDs set by render.ts (module-level function refs)
let _onUpdateAvailable: number = 0;

// Architecture string cached from uname
let _archStr: string = '';

// ---------------------------------------------------------------------------
// Platform / architecture detection
// ---------------------------------------------------------------------------

function getPlatformKey(): string {
  // __platform__: 0=macOS, 1=iOS, 3=Windows, 4=Linux
  // SHIP-V1-GAPS.md followup §5: Windows arch detection. Previous code
  // hardcoded `windows-x86_64`, breaking auto-update for ARM64 Windows
  // (Surface Pro X etc). Use `PROCESSOR_ARCHITECTURE` env var which
  // Windows sets to 'AMD64' (x64) or 'ARM64'.
  if (__platform__ === 3) {
    try {
      const arch = (process as any).env && (process as any).env.PROCESSOR_ARCHITECTURE;
      if (arch && arch.length >= 5) {
        const ac = arch.charCodeAt(0);
        if (ac === 65) { // 'A' — could be AMD64 or ARM64
          if (arch.length >= 5 && arch.charCodeAt(1) === 82) return 'windows-aarch64'; // ARM64
          return 'windows-x86_64'; // AMD64
        }
      }
    } catch (_e: any) {}
    return 'windows-x86_64';
  }

  // Get architecture via uname -m (macOS / Linux)
  if (_archStr.length === 0) {
    try {
      const raw = execSync('uname -m') as unknown as string;
      // Trim newline
      let arch = '';
      for (let i = 0; i < raw.length; i++) {
        const ch = raw.charCodeAt(i);
        if (ch === 10 || ch === 13) break;
        arch += raw.slice(i, i + 1);
      }
      _archStr = arch;
    } catch (e) {
      _archStr = 'x86_64';
    }
  }

  if (__platform__ === 0) {
    // macOS — check arm64 vs x86_64
    if (_archStr.length === 5 && _archStr.charCodeAt(0) === 97) {
      // 'arm64'
      return 'macos-aarch64';
    }
    return 'macos-x86_64';
  }

  if (__platform__ === 4) {
    // Linux
    if (_archStr.length === 7 && _archStr.charCodeAt(0) === 97) {
      // 'aarch64'
      return 'linux-aarch64';
    }
    return 'linux-x86_64';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/** Compare two semver strings. Returns 1 if b > a, 0 if equal, -1 if a > b. */
export function compareVersions(a: string, b: string): number {
  // Parse major.minor.patch from each
  let aMajor = 0;
  let aMinor = 0;
  let aPatch = 0;
  let bMajor = 0;
  let bMinor = 0;
  let bPatch = 0;

  // Parse a
  let dotIdx1 = -1;
  let dotIdx2 = -1;
  for (let i = 0; i < a.length; i++) {
    if (a.charCodeAt(i) === 46) {
      if (dotIdx1 < 0) dotIdx1 = i;
      else { dotIdx2 = i; break; }
    }
  }
  if (dotIdx1 >= 0) {
    aMajor = Number(a.slice(0, dotIdx1));
    if (dotIdx2 >= 0) {
      aMinor = Number(a.slice(dotIdx1 + 1, dotIdx2));
      aPatch = Number(a.slice(dotIdx2 + 1));
    } else {
      aMinor = Number(a.slice(dotIdx1 + 1));
    }
  } else {
    aMajor = Number(a);
  }

  // Parse b
  dotIdx1 = -1;
  dotIdx2 = -1;
  for (let i = 0; i < b.length; i++) {
    if (b.charCodeAt(i) === 46) {
      if (dotIdx1 < 0) dotIdx1 = i;
      else { dotIdx2 = i; break; }
    }
  }
  if (dotIdx1 >= 0) {
    bMajor = Number(b.slice(0, dotIdx1));
    if (dotIdx2 >= 0) {
      bMinor = Number(b.slice(dotIdx1 + 1, dotIdx2));
      bPatch = Number(b.slice(dotIdx2 + 1));
    } else {
      bMinor = Number(b.slice(dotIdx1 + 1));
    }
  } else {
    bMajor = Number(b);
  }

  // Compare
  if (bMajor > aMajor) return 1;
  if (bMajor < aMajor) return -1;
  if (bMinor > aMinor) return 1;
  if (bMinor < aMinor) return -1;
  if (bPatch > aPatch) return 1;
  if (bPatch < aPatch) return -1;
  return 0;
}

// ---------------------------------------------------------------------------
// Cache file (~/.hone/update-check)
// ---------------------------------------------------------------------------

function getCacheFilePath(): string {
  let p = getAppDataDir();
  p += '/update-check';
  return p;
}

function loadCache(): void {
  try {
    const data = readFileSync(getCacheFilePath(), 'utf-8');
    // Parse lastCheck=<epoch>\nlatestVersion=<ver>
    const lcIdx = data.indexOf('lastCheck=');
    if (lcIdx >= 0) {
      const lcStart = lcIdx + 10;
      let lcEnd = lcStart;
      while (lcEnd < data.length && data.charCodeAt(lcEnd) !== 10) {
        lcEnd = lcEnd + 1;
      }
      _lastCheckTime = Number(data.slice(lcStart, lcEnd));
    }
    const lvIdx = data.indexOf('latestVersion=');
    if (lvIdx >= 0) {
      const lvStart = lvIdx + 14;
      let lvEnd = lvStart;
      while (lvEnd < data.length && data.charCodeAt(lvEnd) !== 10) {
        lvEnd = lvEnd + 1;
      }
      _latestVersion = data.slice(lvStart, lvEnd);
    }
  } catch (e) {
    // No cache file — that's fine
  }
}

function saveCache(): void {
  try {
    let data = 'lastCheck=';
    data += String(Math.floor(Date.now() / 1000));
    data += '\nlatestVersion=';
    data += _latestVersion;
    data += '\n';
    writeFileSync(getCacheFilePath(), data);
  } catch (e) {
    // Write failed — non-critical
  }
}

// ---------------------------------------------------------------------------
// Update check via stream polling
// ---------------------------------------------------------------------------

function startUpdateCheck(): void {
  if (_updateState === 1) return; // already checking
  _updateState = 1;

  const platKey = getPlatformKey();
  let url = 'https://auth.hone.codes/updates/latest?platform=';
  url += platKey;
  url += '&current=';
  url += _currentVersion;

  _fetchHandle = streamStart(url, 'GET', '', '{}');
  _pollCount = 0;
  _pollInterval = setInterval(pollUpdateResponse, 200);
}

function pollUpdateResponse(): void {
  if (_fetchHandle === 0) return;
  const status = streamStatus(_fetchHandle);
  // 0=connecting, 1=streaming, 2=done, 3=error
  _pollCount = _pollCount + 1;

  if (status < 2) {
    // Timeout after 10 seconds (50 polls × 200ms)
    if (_pollCount < 50) return;
    streamClose(_fetchHandle);
    _fetchHandle = 0;
    clearInterval(_pollInterval);
    _pollInterval = 0;
    _updateState = 0; // silently go back to idle
    return;
  }

  // Collect response
  let responseText = '';
  let line = streamPoll(_fetchHandle);
  while (line.length > 0) {
    responseText += line;
    line = streamPoll(_fetchHandle);
  }

  streamClose(_fetchHandle);
  _fetchHandle = 0;
  clearInterval(_pollInterval);
  _pollInterval = 0;

  if (status === 3 || responseText.length < 5) {
    _updateState = 0; // silent failure
    return;
  }

  // Parse response: {"version":"...","url":"...","sha256":"...","notes":"..."}
  // or {"upToDate":true}
  const utdIdx = responseText.indexOf('"upToDate"');
  if (utdIdx >= 0) {
    _updateState = 0;
    _lastCheckTime = Math.floor(Date.now() / 1000);
    saveCache();
    return;
  }

  // Extract version
  const vIdx = responseText.indexOf('"version":"');
  if (vIdx >= 0) {
    const vStart = vIdx + 11;
    const vEnd = responseText.indexOf('"', vStart);
    if (vEnd > vStart) {
      _latestVersion = responseText.slice(vStart, vEnd);
    }
  }

  // Extract url
  const uIdx = responseText.indexOf('"url":"');
  if (uIdx >= 0) {
    const uStart = uIdx + 7;
    const uEnd = responseText.indexOf('"', uStart);
    if (uEnd > uStart) {
      _downloadUrl = responseText.slice(uStart, uEnd);
    }
  }

  // Extract sha256
  const sIdx = responseText.indexOf('"sha256":"');
  if (sIdx >= 0) {
    const sStart = sIdx + 10;
    const sEnd = responseText.indexOf('"', sStart);
    if (sEnd > sStart) {
      _sha256 = responseText.slice(sStart, sEnd);
    }
  }

  // Extract notes
  const nIdx = responseText.indexOf('"notes":"');
  if (nIdx >= 0) {
    const nStart = nIdx + 9;
    const nEnd = responseText.indexOf('"', nStart);
    if (nEnd > nStart) {
      _releaseNotes = responseText.slice(nStart, nEnd);
    }
  }

  // Compare versions
  if (_latestVersion.length > 0 && compareVersions(_currentVersion, _latestVersion) === 1) {
    _updateState = 2; // available
    _lastCheckTime = Math.floor(Date.now() / 1000);
    saveCache();
    // Notify UI
    if (_onUpdateAvailable > 0) {
      notifyUpdateAvailable();
    }
  } else {
    _updateState = 0;
    _lastCheckTime = Math.floor(Date.now() / 1000);
    saveCache();
  }
}

// ---------------------------------------------------------------------------
// Notification callback (set by render.ts)
// ---------------------------------------------------------------------------

let _notifyFn: (() => void) | null = null;

function notifyUpdateAvailable(): void {
  if (_notifyFn !== null) {
    _notifyFn();
  }
}

export function setOnUpdateAvailable(fn: () => void): void {
  _notifyFn = fn;
  _onUpdateAvailable = 1;
}

// ---------------------------------------------------------------------------
// Public getters
// ---------------------------------------------------------------------------

export function isUpdateAvailable(): number {
  if (_updateState === 2) return 1;
  return 0;
}

export function getLatestVersion(): string {
  return _latestVersion;
}

export function getReleaseNotes(): string {
  return _releaseNotes;
}

export function getUpdateState(): number {
  return _updateState;
}

export function getUpdateError(): string {
  return _errorMessage;
}

export function getCurrentVersion(): string {
  return _currentVersion;
}

// ---------------------------------------------------------------------------
// Init (called at startup)
// ---------------------------------------------------------------------------

export function initUpdateChecker(): void {
  // Skip on mobile platforms
  if (__platform__ === 1) return; // iOS
  if (__platform__ === 2) return; // Android

  loadCache();

  // Check if cache is stale (>24h = 86400s)
  const now = Math.floor(Date.now() / 1000);
  if (_lastCheckTime > 0 && (now - _lastCheckTime) < 86400) {
    // Cache is fresh — check if we already know about a newer version
    if (_latestVersion.length > 0 && compareVersions(_currentVersion, _latestVersion) === 1) {
      _updateState = 2;
      // Defer notification so render.ts has time to set up the callback
      setTimeout(deferredNotify, 500);
    }
    return;
  }

  // Cache is stale or missing — check now
  startUpdateCheck();
}

function deferredNotify(): void {
  if (_onUpdateAvailable > 0) {
    notifyUpdateAvailable();
  }
}

/** Force check from menu — bypasses cache. */
export function checkForUpdatesManual(): void {
  _updateState = 0;
  _latestVersion = '';
  _downloadUrl = '';
  _sha256 = '';
  _releaseNotes = '';
  _errorMessage = '';
  startUpdateCheck();
}

// ---------------------------------------------------------------------------
// Platform-specific install logic
// ---------------------------------------------------------------------------

/** Get the path to the running binary. Uses __filename if available, else ps. */
function getBinaryPath(): string {
  try {
    if (__platform__ === 0) {
      // macOS: use ps to get the executable path
      const raw = execSync('ps -o comm= -p $$') as unknown as string;
      let path = '';
      for (let i = 0; i < raw.length; i++) {
        const ch = raw.charCodeAt(i);
        if (ch === 10 || ch === 13) break;
        path += raw.slice(i, i + 1);
      }
      return path;
    }
    if (__platform__ === 4) {
      // Linux: readlink /proc/self/exe
      const raw = execSync('readlink /proc/self/exe') as unknown as string;
      let path = '';
      for (let i = 0; i < raw.length; i++) {
        const ch = raw.charCodeAt(i);
        if (ch === 10 || ch === 13) break;
        path += raw.slice(i, i + 1);
      }
      return path;
    }
    if (__platform__ === 3) {
      // Windows: Perry doesn't expose process.execPath, so probe known
      // install locations in the order modern Windows installers use them.
      // Per-user installs (LOCALAPPDATA\Programs\Hone) come first because
      // they don't need UAC and are the default for Squirrel/Velopack/MSIX.
      // Both `Hone.exe` (appBundle.name) and `hone-ide.exe` (--output flag)
      // are checked since dev/release builds use different names.
      const env = (process as any).env;
      let localAppData = '';
      let programFiles = '';
      let programFilesX86 = '';
      if (env) {
        if (env.LOCALAPPDATA) localAppData = env.LOCALAPPDATA;
        if (env.ProgramFiles) programFiles = env.ProgramFiles;
        // `ProgramFiles(x86)` env var contains parentheses — bracket lookup
        const pfx86 = env['ProgramFiles(x86)'];
        if (pfx86) programFilesX86 = pfx86;
      }
      // Probe in priority order
      if (localAppData.length > 0) {
        let p = localAppData;
        p += '\\Programs\\Hone\\Hone.exe';
        if (existsSync(p)) return p;
        let p2 = localAppData;
        p2 += '\\Programs\\Hone\\hone-ide.exe';
        if (existsSync(p2)) return p2;
      }
      if (programFiles.length > 0) {
        let p = programFiles;
        p += '\\Hone\\Hone.exe';
        if (existsSync(p)) return p;
        let p2 = programFiles;
        p2 += '\\Hone\\hone-ide.exe';
        if (existsSync(p2)) return p2;
      }
      if (programFilesX86.length > 0) {
        let p = programFilesX86;
        p += '\\Hone\\Hone.exe';
        if (existsSync(p)) return p;
      }
      // Final fallback — legacy hardcoded location
      return 'C:\\Program Files\\Hone\\hone-ide.exe';
    }
  } catch (e) {}
  return '';
}

/** Walk up from binary path to find .app bundle (macOS). */
function getAppBundlePath(): string {
  const binPath = getBinaryPath();
  if (binPath.length === 0) return '';
  // Expected: /path/to/Hone.app/Contents/MacOS/Hone
  // Walk up 3 levels: MacOS → Contents → Hone.app
  let slashCount = 0;
  let endIdx = binPath.length;
  for (let i = binPath.length - 1; i >= 0; i--) {
    if (binPath.charCodeAt(i) === 47) {
      slashCount = slashCount + 1;
      if (slashCount === 3) {
        endIdx = i;
        break;
      }
    }
  }
  return binPath.slice(0, endIdx);
}

/** Get parent directory of a path. */
function getParentDir(path: string): string {
  let lastSlash = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path.charCodeAt(i) === 47 || path.charCodeAt(i) === 92) {
      lastSlash = i;
      break;
    }
  }
  if (lastSlash < 0) return path;
  return path.slice(0, lastSlash);
}

/** Perform download, verify, replace, and restart. */
export function performUpdate(): void {
  if (_downloadUrl.length === 0) {
    _updateState = 5;
    _errorMessage = 'No download URL available';
    return;
  }

  _updateState = 3; // downloading

  // Run the download + install on a background thread
  const platform = __platform__;
  spawn(() => {
    try {
      if (platform === 0) {
        performUpdateMacOS();
      } else if (platform === 4) {
        performUpdateLinux();
      } else if (platform === 3) {
        performUpdateWindows();
      } else {
        return 'Platform not supported for auto-update';
      }
    } catch (e: any) {
      return 'Update failed. The previous version has been restored.';
    }
    return '';
  }).then((error) => { onUpdateComplete(error); });
}

function onUpdateComplete(error: string): void {
  if (error.length > 0) {
    _updateState = 5;
    _errorMessage = error;
  }
}

function performUpdateMacOS(): void {
  const appPath = getAppBundlePath();
  if (appPath.length === 0) {
    _updateState = 5;
    _errorMessage = 'Could not detect app bundle path';
    return;
  }
  const parentDir = getParentDir(appPath);

  // Download + verify + replace
  let script = 'curl -fsSL -o /tmp/hone-update.tar.gz "';
  script += _downloadUrl;
  script += '" && echo "';
  script += _sha256;
  script += '  /tmp/hone-update.tar.gz" | shasum -a 256 -c -';
  script += ' && mv "';
  script += appPath;
  script += '" "';
  script += appPath;
  script += '.bak"';
  script += ' && tar xzf /tmp/hone-update.tar.gz -C "';
  script += parentDir;
  script += '" && rm /tmp/hone-update.tar.gz';

  try {
    execSync(script);
  } catch (e: any) {
    // Rollback
    try {
      let rollback = 'mv "';
      rollback += appPath;
      rollback += '.bak" "';
      rollback += appPath;
      rollback += '"';
      execSync(rollback);
    } catch (e2: any) {}
    _updateState = 5;
    _errorMessage = 'Download or verification failed';
    return;
  }

  _updateState = 4; // ready

  // Restart: launch new binary, then the old process should exit
  let newBin = appPath;
  newBin += '/Contents/MacOS/Hone';
  spawnBackground(newBin, [], '/dev/null');

  // Clean up backup
  try {
    let rmCmd = 'rm -rf "';
    rmCmd += appPath;
    rmCmd += '.bak"';
    execSync(rmCmd);
  } catch (e: any) {}
}

function performUpdateLinux(): void {
  const binPath = getBinaryPath();
  if (binPath.length === 0) {
    _updateState = 5;
    _errorMessage = 'Could not detect binary path';
    return;
  }
  const parentDir = getParentDir(binPath);

  let script = 'curl -fsSL -o /tmp/hone-update.tar.gz "';
  script += _downloadUrl;
  script += '" && echo "';
  script += _sha256;
  script += '  /tmp/hone-update.tar.gz" | sha256sum -c -';
  script += ' && mv "';
  script += binPath;
  script += '" "';
  script += binPath;
  script += '.bak"';
  script += ' && tar xzf /tmp/hone-update.tar.gz -C "';
  script += parentDir;
  script += '" && rm /tmp/hone-update.tar.gz';

  try {
    execSync(script);
  } catch (e: any) {
    // Rollback
    try {
      let rollback = 'mv "';
      rollback += binPath;
      rollback += '.bak" "';
      rollback += binPath;
      rollback += '"';
      execSync(rollback);
    } catch (e2: any) {}
    _updateState = 5;
    _errorMessage = 'Download or verification failed';
    return;
  }

  _updateState = 4;
  spawnBackground(binPath, [], '/dev/null');

  try {
    let rmCmd = 'rm -f "';
    rmCmd += binPath;
    rmCmd += '.bak"';
    execSync(rmCmd);
  } catch (e: any) {}
}

function performUpdateWindows(): void {
  const exePath = getBinaryPath();
  if (exePath.length === 0) {
    _updateState = 5;
    _errorMessage = 'Could not detect binary path';
    return;
  }
  // Find parent dir (backslash-separated on Windows)
  let lastBackslash = -1;
  for (let i = exePath.length - 1; i >= 0; i--) {
    if (exePath.charCodeAt(i) === 92) { lastBackslash = i; break; }
  }
  let parentDir = exePath;
  if (lastBackslash > 0) parentDir = exePath.slice(0, lastBackslash);

  let tempZip = parentDir;
  tempZip += '\\hone-update.zip';

  let ps = 'powershell -NoProfile -Command "';
  ps += "Invoke-WebRequest -Uri '";
  ps += _downloadUrl;
  ps += "' -OutFile '";
  ps += tempZip;
  ps += "'; ";
  ps += "$h = (Get-FileHash '";
  ps += tempZip;
  ps += "' -Algorithm SHA256).Hash.ToLower(); ";
  ps += "if ($h -ne '";
  ps += _sha256;
  ps += "') { throw 'Hash mismatch' }; ";
  ps += "Rename-Item '";
  ps += exePath;
  ps += "' '";
  ps += exePath;
  ps += ".bak'; ";
  ps += "Expand-Archive '";
  ps += tempZip;
  ps += "' -DestinationPath '";
  ps += parentDir;
  ps += "' -Force; ";
  ps += "Remove-Item '";
  ps += tempZip;
  ps += "'\"";

  try {
    execSync(ps);
  } catch (e: any) {
    // Rollback
    try {
      let rollback = 'powershell -NoProfile -Command "Rename-Item \'';
      rollback += exePath;
      rollback += ".bak' '";
      rollback += exePath;
      rollback += "'\"";
      execSync(rollback);
    } catch (e2: any) {}
    _updateState = 5;
    _errorMessage = 'Download or verification failed';
    return;
  }

  _updateState = 4;
  spawnBackground(exePath, [], 'NUL');
}
