/**
 * Workbench runtime settings with disk persistence.
 *
 * Perry-native — no V8 runtime needed.
 * Settings persist to ~/.hone/settings.ini (simple key=value format).
 * Loaded on module init, saved on every update.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';

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
  /** Last opened folder path */
  lastOpenFolder: string;
}

type SettingsChangeListener = (settings: WorkbenchSettings) => void;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

let _homeDir: string = '';

function getHomeDir(): string {
  if (_homeDir.length > 0) return _homeDir;
  try {
    const result = execSync('/bin/echo $HOME');
    // Trim trailing newline
    let dir = result;
    if (dir.length > 0 && dir.charCodeAt(dir.length - 1) === 10) {
      dir = dir.slice(0, dir.length - 1);
    }
    _homeDir = dir;
  } catch (e: any) {
    _homeDir = '/tmp';
  }
  return _homeDir;
}

function getSettingsPath(): string {
  let p = '';
  p += getHomeDir();
  p += '/.hone/settings.ini';
  return p;
}

function getSettingsDir(): string {
  let p = '';
  p += getHomeDir();
  p += '/.hone';
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
let _settings_lastOpenFolder: string = '';
let _settingsLoaded: number = 0;

const _listeners: SettingsChangeListener[] = [];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Load settings from disk. Call once after module system is ready. */
export function initSettings(): void {
  if (_settingsLoaded > 0) return;
  _settingsLoaded = 1;
  const path = getSettingsPath();
  let text = '';
  try {
    if (existsSync(path)) {
      text = readFileSync(path);
    }
  } catch (e: any) {
    return;
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
    if (key === 'lastOpenFolder') _settings_lastOpenFolder = val;
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
    lastOpenFolder: _settings_lastOpenFolder,
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
  out += 'lastOpenFolder=';
  out += _settings_lastOpenFolder;
  out += '\n';
  return out;
}

function persistToDisk(): void {
  try {
    ensureDir(getSettingsDir());
    writeFileSync(getSettingsPath(), serializeFromVars());
  } catch (e: any) { /* ignore */ }
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
  if (key === 'lastOpenFolder') _settings_lastOpenFolder = value;
  persistToDisk();
  notifyListeners();
}

/** Update a number setting. */
export function setNumberSetting(key: string, value: number): void {
  if (key === 'activePanelIndex') _settings_activePanelIndex = value;
  if (key === 'editorFontSize') _settings_editorFontSize = value;
  if (key === 'editorTabSize') _settings_editorTabSize = value;
  persistToDisk();
  notifyListeners();
}

/** Update a boolean setting (stored as 0/1). */
export function setBoolSetting(key: string, value: number): void {
  if (key === 'statusBarVisible') _settings_statusBarVisible = value;
  if (key === 'sidebarVisible') _settings_sidebarVisible = value;
  if (key === 'terminalVisible') _settings_terminalVisible = value;
  if (key === 'aiInlineCompletionEnabled') _settings_aiInlineCompletionEnabled = value;
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
    if (k === 'lastOpenFolder') _settings_lastOpenFolder = (patch as any).lastOpenFolder;
  }
  persistToDisk();
  notifyListeners();
}

function notifyListeners(): void {
  const snap = buildSnapshot();
  for (let i = 0; i < _listeners.length; i++) {
    _listeners[i](snap);
  }
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
