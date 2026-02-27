/**
 * Token theme — resolves TextMate scopes to colors for syntax highlighting.
 *
 * Takes the `tokenColors` array from a theme and builds an efficient
 * lookup structure. The editor's syntax engine provides TextMate scope
 * strings, and this module resolves them to foreground color, background
 * color, and font style.
 */

import type { TokenColorRule, ThemeData } from './theme-loader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedTokenStyle {
  foreground: string | null;
  background: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

interface ScopeEntry {
  /** Scope segments split by '.', e.g. ['entity', 'name', 'function'] */
  segments: string[];
  /** Original scope string for specificity comparison. */
  scope: string;
  style: ResolvedTokenStyle;
  /** Number of segments — longer = more specific. */
  specificity: number;
}

// ---------------------------------------------------------------------------
// TokenTheme
// ---------------------------------------------------------------------------

export class TokenTheme {
  private _entries: ScopeEntry[] = [];
  private _cache: Map<string, ResolvedTokenStyle> = new Map();
  private _defaultForeground: string;

  constructor(tokenColors: TokenColorRule[], defaultForeground: string) {
    this._defaultForeground = defaultForeground;
    this._buildEntries(tokenColors);
  }

  /**
   * Create a TokenTheme from a full ThemeData object.
   */
  static fromTheme(theme: ThemeData): TokenTheme {
    const fg = theme.colors['editor.foreground'] ?? '#d4d4d4';
    return new TokenTheme(theme.tokenColors, fg);
  }

  /**
   * Resolve a TextMate scope stack to a token style.
   *
   * @param scopes Space-separated scope string or array of scope strings,
   *   ordered from outermost to innermost (e.g. "source.ts meta.function entity.name.function")
   */
  resolve(scopes: string | string[]): ResolvedTokenStyle {
    const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : scopes;

    const cached = this._cache.get(scopeStr);
    if (cached) return cached;

    const result = this._resolveUncached(scopeStr);
    this._cache.set(scopeStr, result);
    return result;
  }

  /**
   * Get the number of token color rules in this theme.
   */
  get ruleCount(): number {
    return this._entries.length;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private _buildEntries(rules: TokenColorRule[]): void {
    for (const rule of rules) {
      const style = parseStyle(rule.settings);
      const scopes = Array.isArray(rule.scope)
        ? rule.scope
        : (rule.scope ?? '').split(',').map(s => s.trim()).filter(Boolean);

      for (const scope of scopes) {
        const segments = scope.split('.');
        this._entries.push({
          segments,
          scope,
          style,
          specificity: segments.length,
        });
      }
    }

    // Sort by specificity descending — most specific rules first.
    // This allows us to return the first match.
    this._entries.sort((a, b) => b.specificity - a.specificity);
  }

  private _resolveUncached(scopeStr: string): ResolvedTokenStyle {
    // The innermost scope is the most relevant for matching.
    // Scope string: "source.ts meta.function.ts entity.name.function.ts"
    // We try matching against each scope in the stack, preferring
    // the innermost (rightmost) match with highest specificity.

    const scopeStack = scopeStr.split(' ').filter(Boolean);

    let bestMatch: ScopeEntry | null = null;
    let bestSpecificity = -1;
    let bestStackDepth = -1; // deeper in the stack = higher priority

    for (let depth = 0; depth < scopeStack.length; depth++) {
      const scope = scopeStack[depth];

      for (const entry of this._entries) {
        if (entry.specificity <= bestSpecificity && depth <= bestStackDepth) {
          continue; // Can't beat the current best
        }

        if (scopeMatches(scope, entry.segments)) {
          if (entry.specificity > bestSpecificity ||
              (entry.specificity === bestSpecificity && depth > bestStackDepth)) {
            bestMatch = entry;
            bestSpecificity = entry.specificity;
            bestStackDepth = depth;
          }
        }
      }
    }

    if (bestMatch) {
      return {
        foreground: bestMatch.style.foreground ?? this._defaultForeground,
        background: bestMatch.style.background,
        bold: bestMatch.style.bold,
        italic: bestMatch.style.italic,
        underline: bestMatch.style.underline,
        strikethrough: bestMatch.style.strikethrough,
      };
    }

    return {
      foreground: this._defaultForeground,
      background: null,
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a scope string matches a rule's scope segments.
 * "entity.name.function.ts" matches rule ["entity", "name", "function"]
 * because the scope starts with the rule's segments.
 */
function scopeMatches(scope: string, ruleSegments: string[]): boolean {
  const scopeSegments = scope.split('.');
  if (scopeSegments.length < ruleSegments.length) return false;

  for (let i = 0; i < ruleSegments.length; i++) {
    if (scopeSegments[i] !== ruleSegments[i]) return false;
  }
  return true;
}

function parseStyle(settings: TokenColorRule['settings']): ResolvedTokenStyle {
  const fontStyle = settings.fontStyle ?? '';
  return {
    foreground: settings.foreground ?? null,
    background: settings.background ?? null,
    bold: fontStyle.includes('bold'),
    italic: fontStyle.includes('italic'),
    underline: fontStyle.includes('underline'),
    strikethrough: fontStyle.includes('strikethrough'),
  };
}
