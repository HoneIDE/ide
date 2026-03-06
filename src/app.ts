/**
 * Hone IDE — application entry point.
 *
 * This is the Perry App() entry that bootstraps the entire IDE:
 *   1. Load theme key (EditorTheme).
 *   2. Detect platform context.
 *   3. Register built-in commands and panels.
 *   4. Build native menu bar (macOS).
 *   5. Render the workbench shell.
 *   6. App() run.
 */

import { App } from 'perry/ui';

import { getPlatformContext } from './platform';
import type { PlatformContext } from './platform';

import { loadBuiltinThemes } from './workbench/theme/load-builtin-themes';
import { setupNativeMenuBar } from './workbench/native-menu';
import { renderWorkbench } from './workbench/render';

// 1. Load built-in themes (Hone Dark as default)
loadBuiltinThemes('Hone Dark');

// 2. Detect platform
const ctx: PlatformContext = getPlatformContext();

// 3. Native menu bar must be set up before App()
setupNativeMenuBar();

// 4. Render the workbench
const body = renderWorkbench(ctx.layoutMode);

// 5. Run
App({ title: 'Hone', width: 1200, height: 800, body: body });
