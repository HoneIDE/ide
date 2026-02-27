/**
 * File tree view model — manages the tree state for the file explorer.
 *
 * Owns the tree of FileTreeItemData nodes and handles:
 * - Building the tree from filesystem entries
 * - Expand/collapse directories (lazy loading)
 * - Selection (single on phone, multi with Ctrl/Cmd on desktop)
 * - Flat list computation for virtual scrolling
 * - Integration with the workspace service for reading directories
 */

import type { LayoutMode } from '../../../platform';
import type { FileTreeItemData, FileItemType } from './file-tree-item';
import { resolveFileIcon, getTreeItemHeight } from './file-tree-item';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileTreeState {
  /** Root items (top-level entries in the workspace folder). */
  roots: FileTreeItemData[];
  /** Flattened visible items (for virtual scroll rendering). */
  flatList: FileTreeItemData[];
  /** Currently selected item IDs. */
  selectedIds: Set<string>;
  /** ID of the focused (keyboard-navigated) item. */
  focusedId: string | null;
  /** Total number of visible items. */
  visibleCount: number;
}

export interface FileEntryInput {
  name: string;
  path: string;
  relativePath: string;
  type: FileItemType;
}

type TreeChangeListener = (state: FileTreeState) => void;

// ---------------------------------------------------------------------------
// FileTree
// ---------------------------------------------------------------------------

export class FileTree {
  private _roots: FileTreeItemData[] = [];
  private _flatList: FileTreeItemData[] = [];
  private _selectedIds: Set<string> = new Set();
  private _focusedId: string | null = null;
  private _expandedDirs: Set<string> = new Set();
  private _listeners: Set<TreeChangeListener> = new Set();
  private _itemMap: Map<string, FileTreeItemData> = new Map();

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getState(): FileTreeState {
    return {
      roots: this._roots,
      flatList: this._flatList,
      selectedIds: this._selectedIds,
      focusedId: this._focusedId,
      visibleCount: this._flatList.length,
    };
  }

  getItem(id: string): FileTreeItemData | undefined {
    return this._itemMap.get(id);
  }

  get visibleCount(): number {
    return this._flatList.length;
  }

  get selectedCount(): number {
    return this._selectedIds.size;
  }

  isExpanded(id: string): boolean {
    return this._expandedDirs.has(id);
  }

  /**
   * Get a range of visible items for virtual scrolling.
   */
  getVisibleRange(startIndex: number, count: number): FileTreeItemData[] {
    return this._flatList.slice(startIndex, startIndex + count);
  }

  /**
   * Compute how many items are visible in a given viewport height.
   */
  getVisibleItemCount(viewportHeight: number, layoutMode: LayoutMode): number {
    const rowHeight = getTreeItemHeight(layoutMode);
    return Math.ceil(viewportHeight / rowHeight);
  }

  // -----------------------------------------------------------------------
  // Tree construction
  // -----------------------------------------------------------------------

  /**
   * Set the root entries of the tree (top-level directory contents).
   */
  setRootEntries(entries: FileEntryInput[]): void {
    this._roots = entries.map(e => this._createItem(e, 0));
    this._rebuildFlatList();
    this._notify();
  }

  /**
   * Set the children of a directory node (after lazy-loading).
   */
  setDirectoryChildren(parentId: string, entries: FileEntryInput[]): void {
    const parent = this._itemMap.get(parentId);
    if (!parent || parent.type !== 'directory') return;

    parent.children = entries.map(e => this._createItem(e, parent.depth + 1));
    this._rebuildFlatList();
    this._notify();
  }

  /**
   * Add a single entry to a parent directory (e.g. after file creation).
   */
  addEntry(parentId: string, entry: FileEntryInput): void {
    const parent = this._itemMap.get(parentId);
    if (!parent || parent.type !== 'directory') return;

    const item = this._createItem(entry, parent.depth + 1);
    parent.children.push(item);

    // Keep sorted: directories first, then alphabetical
    parent.children.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    this._rebuildFlatList();
    this._notify();
  }

  /**
   * Remove an entry from the tree.
   */
  removeEntry(id: string): void {
    const item = this._itemMap.get(id);
    if (!item) return;

    // Find and remove from parent's children or from roots
    const removed = this._removeFromParent(this._roots, id);
    if (removed) {
      this._itemMap.delete(id);
      this._selectedIds.delete(id);
      this._expandedDirs.delete(id);
      if (this._focusedId === id) this._focusedId = null;
      this._rebuildFlatList();
      this._notify();
    }
  }

  /**
   * Rename an entry.
   */
  renameEntry(id: string, newName: string, newPath: string, newRelativePath: string): void {
    const item = this._itemMap.get(id);
    if (!item) return;

    // Update the item map key
    this._itemMap.delete(id);
    item.id = newPath;
    item.name = newName;
    item.path = newPath;
    item.relativePath = newRelativePath;
    item.icon = resolveFileIcon(newName, item.type);
    item.renaming = false;
    this._itemMap.set(newPath, item);

    this._rebuildFlatList();
    this._notify();
  }

  // -----------------------------------------------------------------------
  // Expand / Collapse
  // -----------------------------------------------------------------------

  /**
   * Toggle the expand state of a directory.
   * Returns true if the directory is now expanded (caller should load children).
   */
  toggleExpand(id: string): boolean {
    const item = this._itemMap.get(id);
    if (!item || item.type !== 'directory') return false;

    if (this._expandedDirs.has(id)) {
      this._expandedDirs.delete(id);
      item.expanded = false;
    } else {
      this._expandedDirs.add(id);
      item.expanded = true;
    }

    this._rebuildFlatList();
    this._notify();
    return item.expanded;
  }

  expandDirectory(id: string): void {
    const item = this._itemMap.get(id);
    if (!item || item.type !== 'directory') return;
    this._expandedDirs.add(id);
    item.expanded = true;
    this._rebuildFlatList();
    this._notify();
  }

  collapseDirectory(id: string): void {
    const item = this._itemMap.get(id);
    if (!item || item.type !== 'directory') return;
    this._expandedDirs.delete(id);
    item.expanded = false;
    this._rebuildFlatList();
    this._notify();
  }

  collapseAll(): void {
    this._expandedDirs.clear();
    for (const item of this._itemMap.values()) {
      if (item.type === 'directory') item.expanded = false;
    }
    this._rebuildFlatList();
    this._notify();
  }

  // -----------------------------------------------------------------------
  // Selection
  // -----------------------------------------------------------------------

  /**
   * Select a single item (clears previous selection).
   */
  select(id: string): void {
    this._selectedIds.clear();
    this._selectedIds.add(id);
    this._focusedId = id;

    this._updateSelectionState();
    this._notify();
  }

  /**
   * Toggle selection of an item (for multi-select with Ctrl/Cmd).
   */
  toggleSelect(id: string): void {
    if (this._selectedIds.has(id)) {
      this._selectedIds.delete(id);
    } else {
      this._selectedIds.add(id);
    }
    this._focusedId = id;

    this._updateSelectionState();
    this._notify();
  }

  /**
   * Clear all selection.
   */
  clearSelection(): void {
    this._selectedIds.clear();
    this._updateSelectionState();
    this._notify();
  }

  /**
   * Start renaming the selected item.
   */
  startRename(id: string): void {
    const item = this._itemMap.get(id);
    if (!item) return;
    item.renaming = true;
    this._notify();
  }

  cancelRename(id: string): void {
    const item = this._itemMap.get(id);
    if (!item) return;
    item.renaming = false;
    this._notify();
  }

  // -----------------------------------------------------------------------
  // Keyboard navigation
  // -----------------------------------------------------------------------

  moveFocusUp(): void {
    if (!this._focusedId || this._flatList.length === 0) {
      this._focusedId = this._flatList[0]?.id ?? null;
      return;
    }
    const idx = this._flatList.findIndex(i => i.id === this._focusedId);
    if (idx > 0) {
      this._focusedId = this._flatList[idx - 1].id;
      this._notify();
    }
  }

  moveFocusDown(): void {
    if (!this._focusedId || this._flatList.length === 0) {
      this._focusedId = this._flatList[0]?.id ?? null;
      return;
    }
    const idx = this._flatList.findIndex(i => i.id === this._focusedId);
    if (idx < this._flatList.length - 1) {
      this._focusedId = this._flatList[idx + 1].id;
      this._notify();
    }
  }

  // -----------------------------------------------------------------------
  // Listeners
  // -----------------------------------------------------------------------

  onChange(listener: TreeChangeListener): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private _createItem(entry: FileEntryInput, depth: number): FileTreeItemData {
    const expanded = this._expandedDirs.has(entry.path);
    const item: FileTreeItemData = {
      id: entry.path,
      name: entry.name,
      path: entry.path,
      relativePath: entry.relativePath,
      type: entry.type,
      depth,
      expanded,
      selected: this._selectedIds.has(entry.path),
      renaming: false,
      icon: resolveFileIcon(entry.name, entry.type),
      children: [],
    };
    this._itemMap.set(entry.path, item);
    return item;
  }

  private _rebuildFlatList(): void {
    this._flatList = [];
    this._flatten(this._roots);
  }

  private _flatten(items: FileTreeItemData[]): void {
    for (const item of items) {
      this._flatList.push(item);
      if (item.type === 'directory' && item.expanded && item.children.length > 0) {
        this._flatten(item.children);
      }
    }
  }

  private _updateSelectionState(): void {
    for (const item of this._itemMap.values()) {
      item.selected = this._selectedIds.has(item.id);
    }
  }

  private _removeFromParent(children: FileTreeItemData[], id: string): boolean {
    const idx = children.findIndex(c => c.id === id);
    if (idx !== -1) {
      children.splice(idx, 1);
      return true;
    }
    for (const child of children) {
      if (child.type === 'directory' && this._removeFromParent(child.children, id)) {
        return true;
      }
    }
    return false;
  }

  private _notify(): void {
    const state = this.getState();
    for (const fn of this._listeners) fn(state);
  }
}
