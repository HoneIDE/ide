/**
 * Quick Open — fuzzy file finder overlay.
 *
 * Desktop: Ctrl+P / Cmd+P → overlay at top of editor area
 * Tablet: Cmd+P (with hardware keyboard) or pull-down gesture
 * Phone: swipe-down gesture from top, or search icon in Files tab
 *
 * Wires to the FileIndex from hone-core for fuzzy matching.
 * Supports keyboard navigation (up/down/enter) on desktop and
 * touch selection on mobile.
 */

import type { LayoutMode } from '../../../platform';
import { MIN_TOUCH_TARGET } from '../../../platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuickOpenItem {
  /** Relative file path. */
  path: string;
  /** Filename for display. */
  filename: string;
  /** Directory portion of the path (for secondary label). */
  directory: string;
  /** Match score. */
  score: number;
  /** Indices in path where query characters matched (for highlighting). */
  matchIndices: number[];
  /** Whether this item is currently focused (keyboard navigation). */
  focused: boolean;
}

export interface QuickOpenState {
  /** Whether the quick open overlay is visible. */
  visible: boolean;
  /** Current query text. */
  query: string;
  /** Filtered and scored results. */
  items: QuickOpenItem[];
  /** Index of the focused item (for keyboard navigation). */
  focusedIndex: number;
  /** Whether a search is in progress. */
  loading: boolean;
}

export interface QuickOpenLayout {
  /** Max width of the overlay in points. */
  maxWidth: number;
  /** Max height of the overlay (or 'full' for full-screen on phone). */
  maxHeight: number | 'full';
  /** Row height per result item. */
  itemHeight: number;
  /** Max visible results before scrolling. */
  maxVisibleItems: number;
  /** Position: 'top-center' on desktop, 'full' on phone. */
  position: 'top-center' | 'full';
}

// ---------------------------------------------------------------------------
// QuickOpen
// ---------------------------------------------------------------------------

type SearchProvider = (query: string) => QuickOpenItem[];
type SelectHandler = (path: string, preview: boolean) => void;
type ChangeListener = (state: QuickOpenState) => void;

export class QuickOpen {
  private _state: QuickOpenState = {
    visible: false,
    query: '',
    items: [],
    focusedIndex: 0,
    loading: false,
  };

  private _searchProvider: SearchProvider | null = null;
  private _onSelect: SelectHandler | null = null;
  private _listeners: Set<ChangeListener> = new Set();

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /**
   * Set the search provider (bridges to FileIndex.search).
   */
  setSearchProvider(provider: SearchProvider): void {
    this._searchProvider = provider;
  }

  /**
   * Set the handler called when a result is selected.
   */
  setSelectHandler(handler: SelectHandler): void {
    this._onSelect = handler;
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getState(): QuickOpenState {
    return { ...this._state };
  }

  get isVisible(): boolean {
    return this._state.visible;
  }

  getLayout(layoutMode: LayoutMode): QuickOpenLayout {
    if (layoutMode === 'compact') {
      return {
        maxWidth: Infinity,
        maxHeight: 'full',
        itemHeight: MIN_TOUCH_TARGET,
        maxVisibleItems: 20,
        position: 'full',
      };
    }

    return {
      maxWidth: 600,
      maxHeight: 400,
      itemHeight: 26,
      maxVisibleItems: 12,
      position: 'top-center',
    };
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  show(): void {
    this._state.visible = true;
    this._state.query = '';
    this._state.items = this._search('');
    this._state.focusedIndex = 0;
    this._state.loading = false;
    this._updateFocus();
    this._notify();
  }

  hide(): void {
    this._state.visible = false;
    this._state.query = '';
    this._state.items = [];
    this._notify();
  }

  /**
   * Update the query text and re-search.
   */
  setQuery(query: string): void {
    this._state.query = query;
    this._state.items = this._search(query);
    this._state.focusedIndex = 0;
    this._updateFocus();
    this._notify();
  }

  /**
   * Move focus up in the results list.
   */
  focusUp(): void {
    if (this._state.items.length === 0) return;
    this._state.focusedIndex = Math.max(0, this._state.focusedIndex - 1);
    this._updateFocus();
    this._notify();
  }

  /**
   * Move focus down in the results list.
   */
  focusDown(): void {
    if (this._state.items.length === 0) return;
    this._state.focusedIndex = Math.min(
      this._state.items.length - 1,
      this._state.focusedIndex + 1,
    );
    this._updateFocus();
    this._notify();
  }

  /**
   * Accept the focused item (open the file).
   * @param preview If true, open as preview tab. Default true.
   */
  accept(preview: boolean = true): void {
    const item = this._state.items[this._state.focusedIndex];
    if (!item) return;

    this._onSelect?.(item.path, preview);
    this.hide();
  }

  /**
   * Accept a specific item by index (for touch tap on mobile).
   */
  acceptIndex(index: number, preview: boolean = false): void {
    const item = this._state.items[index];
    if (!item) return;

    this._onSelect?.(item.path, preview);
    this.hide();
  }

  // -----------------------------------------------------------------------
  // Listeners
  // -----------------------------------------------------------------------

  onChange(listener: ChangeListener): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private _search(query: string): QuickOpenItem[] {
    if (!this._searchProvider) return [];

    return this._searchProvider(query).map(item => ({
      ...item,
      directory: getDirectory(item.path),
      focused: false,
    }));
  }

  private _updateFocus(): void {
    for (let i = 0; i < this._state.items.length; i++) {
      this._state.items[i].focused = i === this._state.focusedIndex;
    }
  }

  private _notify(): void {
    const state = this.getState();
    for (const fn of this._listeners) fn(state);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDirectory(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (lastSlash === -1) return '';
  return path.substring(0, lastSlash);
}
