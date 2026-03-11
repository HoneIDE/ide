/**
 * Perry-compatible theme color provider.
 * Individual let variables + getter functions avoid the 37-field object crash.
 */

// Editor (defaults = Hone Dark / Catppuccin)
let _edBg = '#1e1e2e';
let _edFg = '#cdd6f4';
let _edSelBg = '#45475a';
let _edLineHiBg = '#2a2b3d';
let _edCursorFg = '#f5e0dc';
let _edLineNumFg = '#6c7086';
let _edLineNumActFg = '#cdd6f4';

// Activity bar
let _actBg = '#181825';
let _actFg = '#cdd6f4';
let _actInact = '#6c7086';

// Sidebar
let _sbBg = '#181825';
let _sbFg = '#cdd6f4';

// Title bar
let _titleBg = '#181825';
let _titleFg = '#cdd6f4';

// Tabs
let _tabActBg = '#1e1e2e';
let _tabActFg = '#cdd6f4';
let _tabInBg = '#181825';
let _tabInFg = '#6c7086';
let _tabBorder = '#181825';

// Status bar
let _stBg = '#181825';
let _stFg = '#cdd6f4';

// Panel
let _panBg = '#181825';
let _panBorder = '#313244';

// Inputs
let _inputBg = '#313244';
let _inputFg = '#cdd6f4';
let _inputBorder = '#45475a';
let _inputPlaceholder = '#6c7086';

// Buttons
let _btnBg = '#89b4fa';
let _btnFg = '#1e1e2e';
let _btnHoverBg = '#74c7ec';

// Lists
let _listActSelBg = '#45475a';
let _listActSelFg = '#cdd6f4';
let _listHoverBg = '#313244';

// Command palette
let _cmdPalBg = '#1e1e2e';
let _cmdPalFg = '#cdd6f4';

// Focus
let _focusBorder = '#89b4fa';

// Badges
let _badgeBg = '#89b4fa';
let _badgeFg = '#1e1e2e';

// Track current theme type: 0=dark, 1=light
let _isDark = 1;

/** Returns 1 if current theme is dark, 0 if light. */
export function isCurrentThemeDark(): number { return _isDark; }

/** Apply Hone Dark (Catppuccin-based) colors. */
export function applyDarkColors(): void {
  _isDark = 1;
  _edBg = '#1e1e2e';
  _edFg = '#cdd6f4';
  _edSelBg = '#45475a';
  _edLineHiBg = '#2a2b3d';
  _edCursorFg = '#f5e0dc';
  _edLineNumFg = '#6c7086';
  _edLineNumActFg = '#cdd6f4';
  _actBg = '#181825';
  _actFg = '#cdd6f4';
  _actInact = '#6c7086';
  _sbBg = '#181825';
  _sbFg = '#cdd6f4';
  _titleBg = '#181825';
  _titleFg = '#cdd6f4';
  _tabActBg = '#1e1e2e';
  _tabActFg = '#cdd6f4';
  _tabInBg = '#181825';
  _tabInFg = '#6c7086';
  _tabBorder = '#181825';
  _stBg = '#181825';
  _stFg = '#cdd6f4';
  _panBg = '#181825';
  _panBorder = '#313244';
  _inputBg = '#313244';
  _inputFg = '#cdd6f4';
  _inputBorder = '#45475a';
  _inputPlaceholder = '#6c7086';
  _btnBg = '#89b4fa';
  _btnFg = '#1e1e2e';
  _btnHoverBg = '#74c7ec';
  _listActSelBg = '#45475a';
  _listActSelFg = '#cdd6f4';
  _listHoverBg = '#313244';
  _cmdPalBg = '#1e1e2e';
  _cmdPalFg = '#cdd6f4';
  _focusBorder = '#89b4fa';
  _badgeBg = '#89b4fa';
  _badgeFg = '#1e1e2e';
}

/** Apply Hone Light colors. */
export function applyLightColors(): void {
  _isDark = 0;
  _edBg = '#ffffff';
  _edFg = '#333333';
  _edSelBg = '#add6ff';
  _edLineHiBg = '#f5f5f5';
  _edCursorFg = '#000000';
  _edLineNumFg = '#237893';
  _edLineNumActFg = '#0b216f';
  _actBg = '#2c2c2c';
  _actFg = '#ffffff';
  _actInact = '#888888';
  _sbBg = '#f3f3f3';
  _sbFg = '#616161';
  _titleBg = '#dddddd';
  _titleFg = '#333333';
  _tabActBg = '#ffffff';
  _tabActFg = '#333333';
  _tabInBg = '#ececec';
  _tabInFg = '#8e8e8e';
  _tabBorder = '#f3f3f3';
  _stBg = '#007acc';
  _stFg = '#ffffff';
  _panBg = '#ffffff';
  _panBorder = '#e0e0e0';
  _inputBg = '#ffffff';
  _inputFg = '#616161';
  _inputBorder = '#cecece';
  _inputPlaceholder = '#767676';
  _btnBg = '#007acc';
  _btnFg = '#ffffff';
  _btnHoverBg = '#0062a3';
  _listActSelBg = '#0060c0';
  _listActSelFg = '#ffffff';
  _listHoverBg = '#e8e8e8';
  _cmdPalBg = '#ffffff';
  _cmdPalFg = '#333333';
  _focusBorder = '#0090f1';
  _badgeBg = '#c4c4c4';
  _badgeFg = '#333333';
}

// Editor
export function getEditorBackground(): string { return _edBg; }
export function getEditorForeground(): string { return _edFg; }
export function getEditorSelectionBackground(): string { return _edSelBg; }
export function getEditorLineHighlightBackground(): string { return _edLineHiBg; }
export function getEditorCursorForeground(): string { return _edCursorFg; }
export function getEditorLineNumberForeground(): string { return _edLineNumFg; }
export function getEditorLineNumberActiveForeground(): string { return _edLineNumActFg; }

// Activity bar
export function getActivityBarBackground(): string { return _actBg; }
export function getActivityBarForeground(): string { return _actFg; }
export function getActivityBarInactiveForeground(): string { return _actInact; }

// Sidebar
export function getSideBarBackground(): string { return _sbBg; }
export function getSideBarForeground(): string { return _sbFg; }

// Title bar
export function getTitleBarBackground(): string { return _titleBg; }
export function getTitleBarForeground(): string { return _titleFg; }

// Tabs
export function getTabActiveBackground(): string { return _tabActBg; }
export function getTabActiveForeground(): string { return _tabActFg; }
export function getTabInactiveBackground(): string { return _tabInBg; }
export function getTabInactiveForeground(): string { return _tabInFg; }
export function getTabBorder(): string { return _tabBorder; }

// Status bar
export function getStatusBarBackground(): string { return _stBg; }
export function getStatusBarForeground(): string { return _stFg; }

// Panel
export function getPanelBackground(): string { return _panBg; }
export function getPanelBorder(): string { return _panBorder; }

// Inputs
export function getInputBackground(): string { return _inputBg; }
export function getInputForeground(): string { return _inputFg; }
export function getInputBorder(): string { return _inputBorder; }
export function getInputPlaceholderForeground(): string { return _inputPlaceholder; }

// Buttons
export function getButtonBackground(): string { return _btnBg; }
export function getButtonForeground(): string { return _btnFg; }
export function getButtonHoverBackground(): string { return _btnHoverBg; }

// Lists
export function getListActiveSelectionBackground(): string { return _listActSelBg; }
export function getListActiveSelectionForeground(): string { return _listActSelFg; }
export function getListHoverBackground(): string { return _listHoverBg; }

// Command palette
export function getCommandPaletteBackground(): string { return _cmdPalBg; }
export function getCommandPaletteForeground(): string { return _cmdPalFg; }

// Focus
export function getFocusBorder(): string { return _focusBorder; }

// Badges
export function getBadgeBackground(): string { return _badgeBg; }
export function getBadgeForeground(): string { return _badgeFg; }

// ---------------------------------------------------------------------------
// Semantic status colors (theme-aware)
// ---------------------------------------------------------------------------

// These adapt for light vs dark mode so views don't need hardcoded colors.

/** Git added / success / info green */
export function getStatusAddedColor(): string {
  if (_isDark > 0) return '#73C991';
  return '#2EA043';
}

/** Git modified / warning orange */
export function getStatusModifiedColor(): string {
  if (_isDark > 0) return '#E2C08D';
  return '#BF8803';
}

/** Git deleted / error red */
export function getStatusDeletedColor(): string {
  if (_isDark > 0) return '#E57373';
  return '#D73737';
}

/** Muted/secondary text */
export function getSecondaryTextColor(): string {
  if (_isDark > 0) return '#707070';
  return '#6e7681';
}

/** Notification background (default/info) */
export function getNotificationBackground(): string {
  if (_isDark > 0) return '#333333';
  return '#e8e8e8';
}

/** Notification text foreground */
export function getNotificationForeground(): string {
  if (_isDark > 0) return '#CCCCCC';
  return '#333333';
}

/** Notification error background */
export function getNotificationErrorBackground(): string {
  if (_isDark > 0) return '#5A1D1D';
  return '#FDDEDE';
}

/** Notification warning background */
export function getNotificationWarningBackground(): string {
  if (_isDark > 0) return '#4D3B00';
  return '#FFF4CE';
}

/** Notification info background */
export function getNotificationInfoBackground(): string {
  if (_isDark > 0) return '#1A3A5C';
  return '#DBEAFE';
}
