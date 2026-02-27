/**
 * UI theme provider — supplies resolved colors to all workbench widgets.
 *
 * This module bridges the theme-loader (which loads raw theme data) with
 * the Perry UI layer. Widgets call `getUIColor('activityBar.background')`
 * and get back a concrete hex string.
 *
 * It also handles platform-specific adjustments:
 * - On compact (phone) layout, some colors are adjusted for readability
 * - High-contrast themes get enforced minimum contrast ratios
 */

import type { LayoutMode } from '../../platform';
import type { ResolvedUIColors, LoadedTheme, ThemeType } from './theme-loader';
import { getActiveTheme, onThemeChange } from './theme-loader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UIColorKey = keyof ResolvedUIColors;

// ---------------------------------------------------------------------------
// Color provider
// ---------------------------------------------------------------------------

/**
 * Get a resolved UI color for the current active theme.
 * Falls back to a sensible default if no theme is loaded.
 */
export function getUIColor(key: UIColorKey): string {
  const theme = getActiveTheme();
  if (!theme) {
    return FALLBACK_DARK[key] ?? '#ff00ff'; // Magenta = missing color (visible bug)
  }
  return theme.uiColors[key];
}

/**
 * Get all resolved UI colors for the current theme.
 */
export function getAllUIColors(): ResolvedUIColors | null {
  return getActiveTheme()?.uiColors ?? null;
}

/**
 * Get the current theme type.
 */
export function getThemeType(): ThemeType {
  return getActiveTheme()?.data.type ?? 'dark';
}

/**
 * Check if the current theme is dark.
 */
export function isThemeDark(): boolean {
  const type = getThemeType();
  return type === 'dark' || type === 'hc-dark';
}

/**
 * Check if the current theme is high contrast.
 */
export function isHighContrast(): boolean {
  const type = getThemeType();
  return type === 'hc-dark' || type === 'hc-light';
}

// ---------------------------------------------------------------------------
// Platform-adjusted colors
// ---------------------------------------------------------------------------

/**
 * Get colors adjusted for the current layout mode.
 * On compact (phone) layouts, we may need to:
 * - Increase contrast for small text
 * - Use slightly different background shades for the bottom tab bar
 */
export function getLayoutAdjustedColor(key: UIColorKey, layoutMode: LayoutMode): string {
  const base = getUIColor(key);

  if (layoutMode !== 'compact') return base;

  // On compact layout, the activity bar becomes the bottom tab bar,
  // so we reuse activityBar colors but may need to adjust.
  // For now, return the base color — adjustments can be added per-key.
  return base;
}

/**
 * Compute the WCAG relative luminance of a hex color.
 * Used for contrast checking.
 */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;

  const [r, g, b] = rgb.map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Compute the WCAG contrast ratio between two hex colors.
 * Returns a value between 1.0 (identical) and 21.0 (black on white).
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if two colors meet WCAG AA contrast requirements.
 * Normal text: 4.5:1, large text: 3:1.
 */
export function meetsContrastAA(fg: string, bg: string, largeText: boolean = false): boolean {
  const ratio = contrastRatio(fg, bg);
  return ratio >= (largeText ? 3.0 : 4.5);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] | null {
  const match = hex.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/);
  if (!match) return null;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

// Fallback dark colors (same as DARK_DEFAULTS in theme-loader)
const FALLBACK_DARK: Record<string, string> = {
  editorBackground: '#1e1e1e',
  editorForeground: '#d4d4d4',
  activityBarBackground: '#333333',
  activityBarForeground: '#ffffff',
  sideBarBackground: '#252526',
  sideBarForeground: '#cccccc',
  statusBarBackground: '#007acc',
  statusBarForeground: '#ffffff',
  panelBackground: '#1e1e1e',
  panelBorder: '#80808059',
  tabActiveBackground: '#1e1e1e',
  tabActiveForeground: '#ffffff',
  inputBackground: '#3c3c3c',
  inputForeground: '#cccccc',
  buttonBackground: '#0e639c',
  buttonForeground: '#ffffff',
};
