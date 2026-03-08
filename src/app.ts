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
  getLayoutModeNum,
  type PlatformContext,
  type LayoutMode,
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
import { loadBuiltinThemes } from './workbench/theme/load-builtin-themes';
import { renderWorkbench } from './workbench/render';
import { setupNativeMenuBar } from './workbench/native-menu';

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

// 2. Detect platform — use numeric getter (cross-module string returns broken in Perry iOS)
const _layoutNum = getLayoutModeNum();

// Map number to string in same module (strings created locally work)
let _layoutMode: LayoutMode = 'full';
if (_layoutNum === 0) _layoutMode = 'compact';
if (_layoutNum === 1) _layoutMode = 'split';

setupNativeMenuBar();

// 4. Render the workbench
const body = renderWorkbench(_layoutMode);

// 5. Run
App({ title: 'Hone', width: 1200, height: 800, body: body });
