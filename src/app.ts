/**
 * Hone IDE — application entry point.
 *
 * This is the Perry App() entry point that bootstraps the entire IDE:
 * 1. Load themes from @honeide/themes
 * 2. Detect platform and screen dimensions
 * 3. Register built-in commands and panels
 * 4. Build the visual workbench
 */

import { App } from 'perry/ui';
import {
  getPlatformContext,
  onPlatformContextChange,
  type PlatformContext,
} from './platform';
import { createDefaultLayout, type GridNode } from './workbench/layout/grid';
import { TabManager } from './workbench/layout/tab-manager';
import {
  registerPanel,
  BUILTIN_PANELS,
} from './workbench/layout/panel-registry';
import { registerBuiltinCommands } from './commands';
import { getDefaultKeybindings, type Keybinding } from './keybindings';
import { loadTheme, setActiveTheme, type ThemeData } from './workbench/theme/theme-loader';
import { HONE_DARK } from './workbench/theme/builtin-themes';
import { renderWorkbench } from './workbench/render';

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

export interface AppState {
  ctx: PlatformContext;
  grid: GridNode;
  tabManager: TabManager;
  keybindings: Keybinding[];
  initialized: boolean;
}

let _appState: AppState | null = null;

export function getAppState(): AppState | null {
  return _appState;
}

// ---------------------------------------------------------------------------
// Initialization (disabled for now — async not supported by Perry on Windows)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Perry app entry point
// ---------------------------------------------------------------------------

// Load the default theme (embedded — no filesystem reads)
loadTheme(HONE_DARK);
setActiveTheme('Hone Dark');

// Initialize core systems
const ctx = getPlatformContext();
registerBuiltinCommands();
for (let i = 0; i < BUILTIN_PANELS.length; i = i + 1) {
  registerPanel(BUILTIN_PANELS[i]);
}

// Build the visual workbench
const workbench = renderWorkbench(ctx.layoutMode);

// Launch the Perry native app
App({
  title: 'Hone',
  width: 1280,
  height: 800,
  body: workbench,
});
