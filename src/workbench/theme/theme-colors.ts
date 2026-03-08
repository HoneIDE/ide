/**
 * Perry-compatible theme color provider.
 * Individual let variables + getter functions avoid the 37-field object crash.
 */

// Editor
let _edBg = '#1e1e1e';
let _edFg = '#d4d4d4';
let _edSelBg = '#264f78';
let _edLineHiBg = '#2a2d2e';
let _edCursorFg = '#aeafad';
let _edLineNumFg = '#858585';
let _edLineNumActFg = '#c6c6c6';

// Activity bar
let _actBg = '#333333';
let _actFg = '#ffffff';
let _actInact = '#888888';

// Sidebar
let _sbBg = '#252526';
let _sbFg = '#cccccc';

// Title bar
let _titleBg = '#3c3c3c';
let _titleFg = '#cccccc';

// Tabs
let _tabActBg = '#1e1e1e';
let _tabActFg = '#ffffff';
let _tabInBg = '#2d2d2d';
let _tabInFg = '#969696';
let _tabBorder = '#252526';

// Status bar
let _stBg = '#007acc';
let _stFg = '#ffffff';

// Panel
let _panBg = '#1e1e1e';
let _panBorder = '#80808059';

// Inputs
let _inputBg = '#3c3c3c';
let _inputFg = '#cccccc';
let _inputBorder = '#3c3c3c';
let _inputPlaceholder = '#a6a6a6';

// Buttons
let _btnBg = '#0e639c';
let _btnFg = '#ffffff';
let _btnHoverBg = '#1177bb';

// Lists
let _listActSelBg = '#04395e';
let _listActSelFg = '#ffffff';
let _listHoverBg = '#2a2d2e';

// Command palette
let _cmdPalBg = '#252526';
let _cmdPalFg = '#cccccc';

// Focus
let _focusBorder = '#007fd4';

// Badges
let _badgeBg = '#4d4d4d';
let _badgeFg = '#ffffff';

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
