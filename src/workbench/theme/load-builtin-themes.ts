/**
 * Load built-in themes from inlined theme data.
 * No filesystem reads — themes are baked into the binary via builtin-themes.ts.
 */

import { loadTheme, setActiveTheme } from './theme-loader';
import { HONE_DARK, HONE_LIGHT } from './builtin-themes';

/**
 * Load all built-in themes and activate the default.
 */
export function loadBuiltinThemes(defaultTheme: string = 'Hone Dark'): string[] {
  const loaded: string[] = [];

  loadTheme(HONE_DARK);
  loaded.push(HONE_DARK.name);

  loadTheme(HONE_LIGHT);
  loaded.push(HONE_LIGHT.name);

  if (!setActiveTheme(defaultTheme)) {
    if (loaded.length > 0) {
      setActiveTheme(loaded[0]);
    }
  }

  return loaded;
}
