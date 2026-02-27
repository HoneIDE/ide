/**
 * Load all built-in themes from @honeide/themes.
 *
 * Reads the actual theme JSON files and registers them with the theme loader.
 * The default theme is "Hone Dark".
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadTheme, setActiveTheme, type ThemeData } from './theme-loader';

// Resolve the themes directory from @honeide/themes package
function getThemesDir(): string {
  // When running from hone-ide, themes are in node_modules/@honeide/themes/themes/
  // Use require.resolve to find the package, or fall back to relative path
  try {
    const pkgPath = require.resolve('@honeide/themes/themes/hone-dark.json');
    return dirname(pkgPath);
  } catch {
    // Fallback: relative from hone-ide root
    return join(__dirname, '..', '..', '..', 'node_modules', '@honeide', 'themes', 'themes');
  }
}

const BUILTIN_THEME_FILES = [
  'hone-dark.json',
  'hone-light.json',
  'monokai.json',
  'solarized-dark.json',
  'solarized-light.json',
  'nord.json',
  'dracula.json',
  'one-dark.json',
  'github-dark.json',
  'github-light.json',
  'catppuccin.json',
];

/**
 * Load all built-in themes and activate the default.
 * Returns the names of all loaded themes.
 */
export function loadBuiltinThemes(defaultTheme: string = 'Hone Dark'): string[] {
  const themesDir = getThemesDir();
  const loaded: string[] = [];

  for (const file of BUILTIN_THEME_FILES) {
    try {
      const json = readFileSync(join(themesDir, file), 'utf-8');
      const data: ThemeData = JSON.parse(json);
      loadTheme(data);
      loaded.push(data.name);
    } catch (err) {
      console.warn(`Failed to load theme ${file}:`, err);
    }
  }

  // Activate the default theme
  if (!setActiveTheme(defaultTheme)) {
    // Fallback to first loaded theme
    if (loaded.length > 0) {
      setActiveTheme(loaded[0]);
    }
  }

  return loaded;
}
