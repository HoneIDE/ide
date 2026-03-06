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
  sideBarSectionHeaderBackground: string;
  sideBarTitleForeground: string;

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
  sideBarSectionHeaderBackground: '#80808033',
  sideBarTitleForeground: '#bbbbbb',
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
  sideBarSectionHeaderBackground: '#80808033',
  sideBarTitleForeground: '#616161',
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

/** Map of theme name → loaded theme data. */
const _loadedThemes: Map<string, LoadedTheme> = new Map();

let _activeTheme: LoadedTheme | null = null;
const _listeners: Set<(theme: LoadedTheme) => void> = new Set();

/**
 * Load a theme from raw JSON data (typically imported from @honeide/themes).
 */
export function loadTheme(data: ThemeData): LoadedTheme {
  const defaults = data.type === 'light' || data.type === 'hc-light'
    ? LIGHT_DEFAULTS
    : DARK_DEFAULTS;

  const uiColors = resolveUIColors(data.colors, defaults);
  const loaded: LoadedTheme = { data: data, uiColors: uiColors };

  _loadedThemes.set(data.name, loaded);
  return loaded;
}

/**
 * Set the active theme by name. The theme must have been loaded first.
 */
export function setActiveTheme(name: string): boolean {
  const theme = _loadedThemes.get(name);
  if (!theme) return false;

  _activeTheme = theme;
  // Perry: for...of on Set doesn't work, convert to array first
  const fns = Array.from(_listeners);
  for (let i = 0; i < fns.length; i++) { fns[i](theme); }
  return true;
}

export function getActiveTheme(): LoadedTheme | null {
  return _activeTheme;
}

export function getLoadedThemeNames(): string[] {
  return Array.from(_loadedThemes.keys());
}

export function getLoadedTheme(name: string): LoadedTheme | undefined {
  return _loadedThemes.get(name);
}

export function onThemeChange(listener: (theme: LoadedTheme) => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

/** Clear all loaded themes. Used in tests. */
export function clearThemes(): void {
  _loadedThemes.clear();
  _activeTheme = null;
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
  return {
    editorBackground: colors['editor.background'] ?? defaults.editorBackground,
    editorForeground: colors['editor.foreground'] ?? defaults.editorForeground,
    editorSelectionBackground: colors['editor.selectionBackground'] ?? defaults.editorSelectionBackground,
    editorLineHighlightBackground: colors['editor.lineHighlightBackground'] ?? defaults.editorLineHighlightBackground,
    editorCursorForeground: colors['editorCursor.foreground'] ?? defaults.editorCursorForeground,
    editorLineNumberForeground: colors['editorLineNumber.foreground'] ?? defaults.editorLineNumberForeground,
    editorLineNumberActiveForeground: colors['editorLineNumber.activeForeground'] ?? defaults.editorLineNumberActiveForeground,
    activityBarBackground: colors['activityBar.background'] ?? defaults.activityBarBackground,
    activityBarForeground: colors['activityBar.foreground'] ?? defaults.activityBarForeground,
    activityBarInactiveForeground: colors['activityBar.inactiveForeground'] ?? defaults.activityBarInactiveForeground,
    sideBarBackground: colors['sideBar.background'] ?? defaults.sideBarBackground,
    sideBarForeground: colors['sideBar.foreground'] ?? defaults.sideBarForeground,
    sideBarSectionHeaderBackground: colors['sideBarSectionHeader.background'] ?? defaults.sideBarSectionHeaderBackground,
    sideBarTitleForeground: colors['sideBarTitle.foreground'] ?? defaults.sideBarTitleForeground,
    titleBarBackground: colors['titleBar.activeBackground'] ?? defaults.titleBarBackground,
    titleBarForeground: colors['titleBar.activeForeground'] ?? defaults.titleBarForeground,
    tabActiveBackground: colors['tab.activeBackground'] ?? defaults.tabActiveBackground,
    tabActiveForeground: colors['tab.activeForeground'] ?? defaults.tabActiveForeground,
    tabInactiveBackground: colors['tab.inactiveBackground'] ?? defaults.tabInactiveBackground,
    tabInactiveForeground: colors['tab.inactiveForeground'] ?? defaults.tabInactiveForeground,
    tabBorder: colors['tab.border'] ?? defaults.tabBorder,
    statusBarBackground: colors['statusBar.background'] ?? defaults.statusBarBackground,
    statusBarForeground: colors['statusBar.foreground'] ?? defaults.statusBarForeground,
    panelBackground: colors['panel.background'] ?? defaults.panelBackground,
    panelBorder: colors['panel.border'] ?? defaults.panelBorder,
    inputBackground: colors['input.background'] ?? defaults.inputBackground,
    inputForeground: colors['input.foreground'] ?? defaults.inputForeground,
    inputBorder: colors['input.border'] ?? defaults.inputBorder,
    inputPlaceholderForeground: colors['input.placeholderForeground'] ?? defaults.inputPlaceholderForeground,
    buttonBackground: colors['button.background'] ?? defaults.buttonBackground,
    buttonForeground: colors['button.foreground'] ?? defaults.buttonForeground,
    buttonHoverBackground: colors['button.hoverBackground'] ?? defaults.buttonHoverBackground,
    listActiveSelectionBackground: colors['list.activeSelectionBackground'] ?? defaults.listActiveSelectionBackground,
    listActiveSelectionForeground: colors['list.activeSelectionForeground'] ?? defaults.listActiveSelectionForeground,
    listHoverBackground: colors['list.hoverBackground'] ?? defaults.listHoverBackground,
    commandPaletteBackground: colors['commandPalette.background'] ?? colors['quickInput.background'] ?? defaults.commandPaletteBackground,
    commandPaletteForeground: colors['commandPalette.foreground'] ?? colors['quickInput.foreground'] ?? defaults.commandPaletteForeground,
    focusBorder: colors['focusBorder'] ?? defaults.focusBorder,
    badgeBackground: colors['badge.background'] ?? defaults.badgeBackground,
    badgeForeground: colors['badge.foreground'] ?? defaults.badgeForeground,
  };
}

/**
 * Get a raw color from the active theme by its dotted key (e.g. 'editor.background').
 * Returns undefined if the key is not set.
 */
export function getThemeColor(key: string): string | undefined {
  if (!_activeTheme) return undefined;
  return _activeTheme.data.colors[key];
}

/**
 * Check if the active theme is a dark theme.
 */
export function isDarkTheme(): boolean {
  if (!_activeTheme) return true;
  return _activeTheme.data.type === 'dark' || _activeTheme.data.type === 'hc-dark';
}
