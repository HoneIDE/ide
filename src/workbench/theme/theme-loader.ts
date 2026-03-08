/**
 * Theme loader — loads theme JSON files from @honeide/themes and
 * provides resolved color values to the UI.
 *
 * Themes follow the VSCode color theme JSON format:
 * - `colors`: flat map of dotted keys → hex color strings
 * - `tokenColors`: TextMate grammar rules for syntax highlighting
 * - `semanticTokenColors`: semantic token overrides
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemeType = 'dark' | 'light' | 'hc-dark' | 'hc-light';

export interface TokenColorRule {
  name?: string;
  scope: string | string[];
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

export interface SemanticTokenColors {
  [selector: string]: string | { foreground?: string; fontStyle?: string };
}

export interface ThemeData {
  name: string;
  type: ThemeType;
  colors: Record<string, string>;
  tokenColors: TokenColorRule[];
  semanticHighlighting?: boolean;
  semanticTokenColors?: SemanticTokenColors;
}

export interface LoadedTheme {
  data: ThemeData;
  /** Resolved UI colors with defaults filled in. */
  uiColors: ResolvedUIColors;
}

/** All UI color keys used by the workbench, resolved to concrete hex values. */
export interface ResolvedUIColors {
  // Editor
  editorBackground: string;
  editorForeground: string;
  editorSelectionBackground: string;
  editorLineHighlightBackground: string;
  editorCursorForeground: string;
  editorLineNumberForeground: string;
  editorLineNumberActiveForeground: string;

  // Activity bar
  activityBarBackground: string;
  activityBarForeground: string;
  activityBarInactiveForeground: string;

  // Sidebar
  sideBarBackground: string;
  sideBarForeground: string;

  // Title bar
  titleBarBackground: string;
  titleBarForeground: string;

  // Tabs
  tabActiveBackground: string;
  tabActiveForeground: string;
  tabInactiveBackground: string;
  tabInactiveForeground: string;
  tabBorder: string;

  // Status bar
  statusBarBackground: string;
  statusBarForeground: string;

  // Panel (bottom)
  panelBackground: string;
  panelBorder: string;

  // Inputs
  inputBackground: string;
  inputForeground: string;
  inputBorder: string;
  inputPlaceholderForeground: string;

  // Buttons
  buttonBackground: string;
  buttonForeground: string;
  buttonHoverBackground: string;

  // Lists
  listActiveSelectionBackground: string;
  listActiveSelectionForeground: string;
  listHoverBackground: string;

  // Command palette
  commandPaletteBackground: string;
  commandPaletteForeground: string;

  // Focus
  focusBorder: string;

  // Badges
  badgeBackground: string;
  badgeForeground: string;
}

// ---------------------------------------------------------------------------
// Default colors per theme type
// ---------------------------------------------------------------------------

export const DARK_DEFAULTS: ResolvedUIColors = {
  editorBackground: '#1e1e1e',
  editorForeground: '#d4d4d4',
  editorSelectionBackground: '#264f78',
  editorLineHighlightBackground: '#2a2d2e',
  editorCursorForeground: '#aeafad',
  editorLineNumberForeground: '#858585',
  editorLineNumberActiveForeground: '#c6c6c6',
  activityBarBackground: '#333333',
  activityBarForeground: '#ffffff',
  activityBarInactiveForeground: '#888888',
  sideBarBackground: '#252526',
  sideBarForeground: '#cccccc',
  titleBarBackground: '#3c3c3c',
  titleBarForeground: '#cccccc',
  tabActiveBackground: '#1e1e1e',
  tabActiveForeground: '#ffffff',
  tabInactiveBackground: '#2d2d2d',
  tabInactiveForeground: '#969696',
  tabBorder: '#252526',
  statusBarBackground: '#007acc',
  statusBarForeground: '#ffffff',
  panelBackground: '#1e1e1e',
  panelBorder: '#80808059',
  inputBackground: '#3c3c3c',
  inputForeground: '#cccccc',
  inputBorder: '#3c3c3c',
  inputPlaceholderForeground: '#a6a6a6',
  buttonBackground: '#0e639c',
  buttonForeground: '#ffffff',
  buttonHoverBackground: '#1177bb',
  listActiveSelectionBackground: '#04395e',
  listActiveSelectionForeground: '#ffffff',
  listHoverBackground: '#2a2d2e',
  commandPaletteBackground: '#252526',
  commandPaletteForeground: '#cccccc',
  focusBorder: '#007fd4',
  badgeBackground: '#4d4d4d',
  badgeForeground: '#ffffff',
};

const LIGHT_DEFAULTS: ResolvedUIColors = {
  editorBackground: '#ffffff',
  editorForeground: '#333333',
  editorSelectionBackground: '#add6ff',
  editorLineHighlightBackground: '#f5f5f5',
  editorCursorForeground: '#000000',
  editorLineNumberForeground: '#237893',
  editorLineNumberActiveForeground: '#0b216f',
  activityBarBackground: '#2c2c2c',
  activityBarForeground: '#ffffff',
  activityBarInactiveForeground: '#888888',
  sideBarBackground: '#f3f3f3',
  sideBarForeground: '#616161',
  titleBarBackground: '#dddddd',
  titleBarForeground: '#333333',
  tabActiveBackground: '#ffffff',
  tabActiveForeground: '#333333',
  tabInactiveBackground: '#ececec',
  tabInactiveForeground: '#8e8e8e',
  tabBorder: '#f3f3f3',
  statusBarBackground: '#007acc',
  statusBarForeground: '#ffffff',
  panelBackground: '#ffffff',
  panelBorder: '#80808059',
  inputBackground: '#ffffff',
  inputForeground: '#616161',
  inputBorder: '#cecece',
  inputPlaceholderForeground: '#767676',
  buttonBackground: '#007acc',
  buttonForeground: '#ffffff',
  buttonHoverBackground: '#0062a3',
  listActiveSelectionBackground: '#0060c0',
  listActiveSelectionForeground: '#ffffff',
  listHoverBackground: '#e8e8e8',
  commandPaletteBackground: '#ffffff',
  commandPaletteForeground: '#333333',
  focusBorder: '#0090f1',
  badgeBackground: '#c4c4c4',
  badgeForeground: '#333333',
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

// Perry-compatible: no Map, no Set, no for..of, no shorthand objects
let _activeTheme: LoadedTheme | null = null;
let _loadedThemeData: ThemeData | null = null;
let _loadedThemeColors: ResolvedUIColors | null = null;

// Simple listener array (max 8 listeners)
let _listenerCount = 0;
let _listener0: ((theme: LoadedTheme) => void) | null = null;
let _listener1: ((theme: LoadedTheme) => void) | null = null;
let _listener2: ((theme: LoadedTheme) => void) | null = null;

/**
 * Load a theme from raw JSON data.
 */
export function loadTheme(data: ThemeData): LoadedTheme {
  // Perry: just use DARK_DEFAULTS for now (resolveUIColors bracket access may crash)
  const uiColors = DARK_DEFAULTS;
  const loaded: LoadedTheme = { data: data, uiColors: uiColors };

  _loadedThemeData = data;
  _loadedThemeColors = uiColors;
  _activeTheme = loaded;
  return loaded;
}

/** Get the DARK_DEFAULTS directly — Perry workaround for cross-module stale reads */
export function getDarkDefaults(): ResolvedUIColors {
  return DARK_DEFAULTS;
}

/** Get individual color by index — Perry workaround */
export function getDarkColor(idx: number): string {
  if (idx === 0) return '#1e1e1e';  // editorBackground
  if (idx === 1) return '#d4d4d4';  // editorForeground
  if (idx === 2) return '#333333';  // activityBarBackground
  if (idx === 3) return '#ffffff';  // activityBarForeground
  if (idx === 4) return '#888888';  // activityBarInactiveForeground
  if (idx === 5) return '#252526';  // sideBarBackground
  if (idx === 6) return '#cccccc';  // sideBarForeground
  if (idx === 7) return '#007acc';  // statusBarBackground
  if (idx === 8) return '#ffffff';  // statusBarForeground
  if (idx === 9) return '#80808059'; // panelBorder
  return '#1e1e1e';
}

/**
 * Set the active theme by name.
 * Perry: just return the already-loaded theme (single theme support for now)
 */
export function setActiveTheme(name: string): LoadedTheme | null {
  if (_activeTheme) {
    // Notify listeners
    if (_listener0) _listener0(_activeTheme);
    if (_listener1) _listener1(_activeTheme);
    if (_listener2) _listener2(_activeTheme);
  }
  return _activeTheme;
}

export function getActiveTheme(): LoadedTheme | null {
  return _activeTheme;
}

export function getLoadedThemeNames(): string[] {
  const names: string[] = [];
  if (_loadedThemeData) {
    names.push(_loadedThemeData.name);
  }
  return names;
}

export function getLoadedTheme(name: string): LoadedTheme | undefined {
  return _activeTheme ?? undefined;
}

export function onThemeChange(listener: (theme: LoadedTheme) => void): () => void {
  if (_listenerCount === 0) {
    _listener0 = listener;
  } else if (_listenerCount === 1) {
    _listener1 = listener;
  } else {
    _listener2 = listener;
  }
  _listenerCount = _listenerCount + 1;
  return () => {};
}

/** Clear all loaded themes. Used in tests. */
export function clearThemes(): void {
  _activeTheme = null;
  _loadedThemeData = null;
  _loadedThemeColors = null;
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve theme colors from the JSON `colors` map to the strongly-typed
 * ResolvedUIColors, filling in defaults for any missing keys.
 */
function resolveUIColors(
  colors: Record<string, string>,
  defaults: ResolvedUIColors,
): ResolvedUIColors {
  // Perry: bracket access with dotted string keys crashes, and 37-field object literals crash.
  // Just return defaults.
  return defaults;
}

/**
 * Get a raw color from the active theme by its dotted key (e.g. 'editor.background').
 * Returns undefined if the key is not set.
 */
export function getThemeColor(key: string): string | undefined {
  return _activeTheme?.data.colors[key];
}

/**
 * Check if the active theme is a dark theme.
 */
export function isDarkTheme(): boolean {
  if (!_activeTheme) return true;
  return _activeTheme.data.type === 'dark' || _activeTheme.data.type === 'hc-dark';
}
