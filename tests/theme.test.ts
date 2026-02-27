/**
 * Theme engine tests — verifies theme loading, color resolution,
 * token theme matching, and contrast checking.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  loadTheme,
  setActiveTheme,
  getActiveTheme,
  getLoadedThemeNames,
  clearThemes,
  isDarkTheme,
  type ThemeData,
} from '../src/workbench/theme/theme-loader';
import { TokenTheme } from '../src/workbench/theme/token-theme';
import {
  getUIColor,
  isThemeDark,
  relativeLuminance,
  contrastRatio,
  meetsContrastAA,
} from '../src/workbench/theme/ui-theme';

// ---------------------------------------------------------------------------
// Test theme data
// ---------------------------------------------------------------------------

const DARK_THEME: ThemeData = {
  name: 'Test Dark',
  type: 'dark',
  colors: {
    'editor.background': '#1e1e2e',
    'editor.foreground': '#cdd6f4',
    'activityBar.background': '#181825',
    'activityBar.foreground': '#cdd6f4',
    'statusBar.background': '#181825',
    'statusBar.foreground': '#cdd6f4',
    'button.background': '#89b4fa',
    'button.foreground': '#1e1e2e',
  },
  tokenColors: [
    {
      scope: 'comment',
      settings: { foreground: '#6c7086', fontStyle: 'italic' },
    },
    {
      scope: 'string',
      settings: { foreground: '#a6e3a1' },
    },
    {
      scope: ['keyword', 'keyword.control'],
      settings: { foreground: '#cba6f7', fontStyle: 'bold' },
    },
    {
      scope: 'entity.name.function',
      settings: { foreground: '#89b4fa' },
    },
    {
      scope: 'constant.numeric',
      settings: { foreground: '#fab387' },
    },
    {
      scope: 'variable',
      settings: { foreground: '#cdd6f4' },
    },
    {
      scope: 'entity.name.type',
      settings: { foreground: '#f9e2af' },
    },
    {
      scope: 'punctuation',
      settings: { foreground: '#9399b2' },
    },
  ],
  semanticHighlighting: true,
  semanticTokenColors: {},
};

const LIGHT_THEME: ThemeData = {
  name: 'Test Light',
  type: 'light',
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#333333',
    'activityBar.background': '#2c2c2c',
    'activityBar.foreground': '#ffffff',
  },
  tokenColors: [
    {
      scope: 'comment',
      settings: { foreground: '#6a737d', fontStyle: 'italic' },
    },
    {
      scope: 'string',
      settings: { foreground: '#032f62' },
    },
    {
      scope: 'keyword',
      settings: { foreground: '#d73a49' },
    },
  ],
};

// ---------------------------------------------------------------------------
// Theme loader tests
// ---------------------------------------------------------------------------

describe('Theme loader', () => {
  beforeEach(() => {
    clearThemes();
  });

  test('loadTheme registers and returns loaded theme', () => {
    const loaded = loadTheme(DARK_THEME);
    expect(loaded.data.name).toBe('Test Dark');
    expect(getLoadedThemeNames()).toContain('Test Dark');
  });

  test('setActiveTheme activates the theme', () => {
    loadTheme(DARK_THEME);
    const result = setActiveTheme('Test Dark');
    expect(result).not.toBeNull();
    expect(getActiveTheme()?.data.name).toBe('Test Dark');
  });

  test('setActiveTheme returns null for unknown theme', () => {
    expect(setActiveTheme('Nonexistent')).toBeNull();
  });

  test('isDarkTheme returns true for dark themes', () => {
    loadTheme(DARK_THEME);
    setActiveTheme('Test Dark');
    expect(isDarkTheme()).toBe(true);
  });

  test('isDarkTheme returns false for light themes', () => {
    loadTheme(LIGHT_THEME);
    setActiveTheme('Test Light');
    expect(isDarkTheme()).toBe(false);
  });

  test('resolves UI colors from theme data', () => {
    const loaded = loadTheme(DARK_THEME);
    expect(loaded.uiColors.editorBackground).toBe('#1e1e2e');
    expect(loaded.uiColors.editorForeground).toBe('#cdd6f4');
    expect(loaded.uiColors.activityBarBackground).toBe('#181825');
  });

  test('fills in defaults for missing color keys', () => {
    const loaded = loadTheme(DARK_THEME);
    // These keys are not in our test theme but should have defaults
    expect(loaded.uiColors.inputBackground).toBeDefined();
    expect(loaded.uiColors.listHoverBackground).toBeDefined();
    expect(loaded.uiColors.focusBorder).toBeDefined();
  });

  test('UI color getter works with active theme', () => {
    loadTheme(DARK_THEME);
    setActiveTheme('Test Dark');
    expect(getUIColor('editorBackground')).toBe('#1e1e2e');
    expect(getUIColor('buttonBackground')).toBe('#89b4fa');
  });
});

// ---------------------------------------------------------------------------
// Token theme tests
// ---------------------------------------------------------------------------

describe('TokenTheme', () => {
  let tokenTheme: TokenTheme;

  beforeEach(() => {
    tokenTheme = TokenTheme.fromTheme(DARK_THEME);
  });

  test('rule count matches theme data', () => {
    // 8 rules (some with multiple scopes expand, keyword has 2)
    expect(tokenTheme.ruleCount).toBeGreaterThanOrEqual(8);
  });

  test('resolves simple scope', () => {
    const style = tokenTheme.resolve('comment');
    expect(style.foreground).toBe('#6c7086');
    expect(style.italic).toBe(true);
  });

  test('resolves dotted scope prefix match', () => {
    // "comment.line.double-slash.ts" should match "comment"
    const style = tokenTheme.resolve('comment.line.double-slash.ts');
    expect(style.foreground).toBe('#6c7086');
  });

  test('resolves multi-segment scope', () => {
    const style = tokenTheme.resolve('entity.name.function.ts');
    expect(style.foreground).toBe('#89b4fa');
  });

  test('more specific scope wins over less specific', () => {
    // "entity.name.function" (3 segments) should win over a hypothetical
    // "entity" (1 segment) if both existed
    const style = tokenTheme.resolve('entity.name.function.ts');
    expect(style.foreground).toBe('#89b4fa');
  });

  test('resolves scope in stack (space-separated)', () => {
    const style = tokenTheme.resolve('source.ts meta.block.ts string.quoted.double.ts');
    expect(style.foreground).toBe('#a6e3a1'); // string
  });

  test('innermost scope in stack has priority', () => {
    // Stack where inner scope is "keyword" and outer is "comment"
    // keyword is more deeply nested, so it should win
    const style = tokenTheme.resolve('comment keyword');
    expect(style.foreground).toBe('#cba6f7'); // keyword, not comment
  });

  test('resolves bold font style', () => {
    const style = tokenTheme.resolve('keyword');
    expect(style.bold).toBe(true);
    expect(style.italic).toBe(false);
  });

  test('unmatched scope falls back to default foreground', () => {
    const style = tokenTheme.resolve('some.unknown.scope');
    expect(style.foreground).toBe('#cdd6f4'); // editor.foreground
    expect(style.bold).toBe(false);
    expect(style.italic).toBe(false);
  });

  test('caches results for repeated lookups', () => {
    const style1 = tokenTheme.resolve('comment');
    const style2 = tokenTheme.resolve('comment');
    expect(style1).toBe(style2); // Same object reference = cached
  });

  test('resolves from array scope in rule', () => {
    // 'keyword.control' should match (it's in the array ['keyword', 'keyword.control'])
    const style = tokenTheme.resolve('keyword.control.if');
    expect(style.foreground).toBe('#cba6f7');
  });
});

// ---------------------------------------------------------------------------
// Contrast utility tests
// ---------------------------------------------------------------------------

describe('Contrast utilities', () => {
  test('relativeLuminance of black is 0', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  test('relativeLuminance of white is 1', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  test('contrastRatio of black on white is 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  test('contrastRatio is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
      contrastRatio('#abcdef', '#123456'),
    );
  });

  test('contrastRatio of same color is 1', () => {
    expect(contrastRatio('#abcdef', '#abcdef')).toBeCloseTo(1, 5);
  });

  test('meetsContrastAA for normal text needs 4.5:1', () => {
    // Black on white = 21:1 → passes
    expect(meetsContrastAA('#000000', '#ffffff')).toBe(true);
    // Light gray on white → should fail
    expect(meetsContrastAA('#cccccc', '#ffffff')).toBe(false);
  });

  test('meetsContrastAA for large text needs 3:1', () => {
    // Mid gray on white might pass for large text
    const ratio = contrastRatio('#767676', '#ffffff');
    expect(meetsContrastAA('#767676', '#ffffff', true)).toBe(ratio >= 3.0);
  });

  test('dark theme editor colors have sufficient contrast', () => {
    loadTheme(DARK_THEME);
    const loaded = loadTheme(DARK_THEME);
    const fg = loaded.uiColors.editorForeground;
    const bg = loaded.uiColors.editorBackground;
    const ratio = contrastRatio(fg, bg);
    expect(ratio).toBeGreaterThanOrEqual(3.0);
  });
});
