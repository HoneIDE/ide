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
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the IDE. Called before rendering, or directly in tests.
 */
export async function initializeApp(themeData?: ThemeData): Promise<AppState> {
  // 1. Platform detection
  const ctx = getPlatformContext();

  // 2. Load and activate theme
  if (themeData) {
    loadTheme(themeData);
    setActiveTheme(themeData.name);
  }

  // 3. Register built-in commands
  registerBuiltinCommands();

  // 4. Register built-in panels
  for (const panel of BUILTIN_PANELS) {
    registerPanel(panel);
  }

  // 5. Create layout grid for current layout mode
  const grid = createDefaultLayout(ctx.layoutMode);

  // 6. Create tab manager
  const tabManager = new TabManager();
  tabManager.enforceLayoutConstraints(ctx.layoutMode);

  // 7. Get keybindings
  const keybindings = getDefaultKeybindings(ctx.platform);

  // 8. Assemble state
  const state: AppState = {
    ctx,
    grid,
    tabManager,
    keybindings,
    initialized: true,
  };
  _appState = state;

  // 9. Listen for platform changes (orientation, resize)
  onPlatformContextChange((newCtx) => {
    if (!_appState) return;
    _appState.ctx = newCtx;
    _appState.grid = createDefaultLayout(newCtx.layoutMode);
    _appState.tabManager.enforceLayoutConstraints(newCtx.layoutMode);
  });

  return state;
}

// ---------------------------------------------------------------------------
// Perry app entry point
// ---------------------------------------------------------------------------

// Load the default theme (embedded — no filesystem reads)
loadTheme(HONE_DARK);
setActiveTheme('Hone Dark');

// Initialize core systems
const ctx = getPlatformContext();
registerBuiltinCommands();
for (const panel of BUILTIN_PANELS) {
  registerPanel(panel);
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
