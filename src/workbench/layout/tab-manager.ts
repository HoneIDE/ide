/**
 * Tab manager — manages editor tabs across tab groups.
 *
 * Supports:
 * - Multiple tab groups (split editors on desktop/tablet)
 * - Single tab group on compact (phone) layout
 * - Tab open, close, move, pin, dirty state tracking
 * - Tab reordering (drag on desktop, long-press drag on tablet)
 * - Most-recently-used ordering for tab switching
 */

import type { LayoutMode } from '../../platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Tab {
  /** Unique tab identifier. */
  id: string;
  /** File path or resource URI this tab represents. */
  uri: string;
  /** Display title (filename). */
  title: string;
  /** Whether this tab has unsaved changes. */
  dirty: boolean;
  /** Pinned tabs stick to the left and can't be auto-closed. */
  pinned: boolean;
  /** Whether this is a preview tab (italic title, replaced on next open). */
  preview: boolean;
}

export interface TabGroup {
  /** Unique group identifier. */
  id: string;
  /** Ordered list of tabs in this group. */
  tabs: Tab[];
  /** ID of the currently active tab, or null if no tabs. */
  activeTabId: string | null;
}

export interface TabManagerState {
  groups: TabGroup[];
  activeGroupId: string;
}

// ---------------------------------------------------------------------------
// TabManager
// ---------------------------------------------------------------------------

type TabChangeListener = (state: TabManagerState) => void;

export class TabManager {
  private _groups: Map<string, TabGroup> = new Map();
  private _activeGroupId: string;
  private _listeners: Set<TabChangeListener> = new Set();
  private _mru: string[] = []; // Most-recently-used tab IDs
  private _nextGroupId = 1;
  private _nextTabId = 1;

  constructor() {
    const initialGroup = this._createGroup();
    this._activeGroupId = initialGroup.id;
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getState(): TabManagerState {
    return {
      groups: Array.from(this._groups.values()),
      activeGroupId: this._activeGroupId,
    };
  }

  getActiveGroup(): TabGroup {
    return this._groups.get(this._activeGroupId)!;
  }

  getActiveTab(): Tab | null {
    const group = this.getActiveGroup();
    if (!group.activeTabId) return null;
    return group.tabs.find(t => t.id === group.activeTabId) ?? null;
  }

  getGroupCount(): number {
    return this._groups.size;
  }

  getTabCount(): number {
    let count = 0;
    for (const g of this._groups.values()) count += g.tabs.length;
    return count;
  }

  findTabByUri(uri: string): { group: TabGroup; tab: Tab } | null {
    for (const group of this._groups.values()) {
      const tab = group.tabs.find(t => t.uri === uri);
      if (tab) return { group, tab };
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  /**
   * Open a file in a tab. If already open, activates it.
   * If the active tab is a preview tab, replaces it.
   */
  openTab(uri: string, title: string, options?: { preview?: boolean; groupId?: string }): Tab {
    const preview = options?.preview ?? false;
    const groupId = options?.groupId ?? this._activeGroupId;

    // If already open anywhere, just activate
    const existing = this.findTabByUri(uri);
    if (existing) {
      // Promote from preview to permanent on re-open
      if (existing.tab.preview && !preview) {
        existing.tab.preview = false;
      }
      this._activateTab(existing.group.id, existing.tab.id);
      return existing.tab;
    }

    const group = this._groups.get(groupId);
    if (!group) throw new Error(`Tab group ${groupId} not found`);

    // If opening as preview and there's an existing preview tab, replace it
    if (preview) {
      const previewIdx = group.tabs.findIndex(t => t.preview);
      if (previewIdx !== -1) {
        const oldPreview = group.tabs[previewIdx];
        this._removeMru(oldPreview.id);
        group.tabs.splice(previewIdx, 1);
      }
    }

    const tab: Tab = {
      id: `tab-${this._nextTabId++}`,
      uri,
      title,
      dirty: false,
      pinned: false,
      preview,
    };

    // Append at the end (pinTab will move pinned tabs to the front)
    group.tabs.push(tab);

    this._activateTab(group.id, tab.id);
    return tab;
  }

  closeTab(tabId: string): void {
    for (const group of this._groups.values()) {
      const idx = group.tabs.findIndex(t => t.id === tabId);
      if (idx === -1) continue;

      group.tabs.splice(idx, 1);
      this._removeMru(tabId);

      // If we closed the active tab, activate the nearest or MRU
      if (group.activeTabId === tabId) {
        group.activeTabId = this._findNextActive(group, idx);
      }

      // If the group is now empty and it's not the only group, remove it
      if (group.tabs.length === 0 && this._groups.size > 1) {
        this._groups.delete(group.id);
        if (this._activeGroupId === group.id) {
          this._activeGroupId = this._groups.keys().next().value!;
        }
      }

      this._notify();
      return;
    }
  }

  closeAllInGroup(groupId: string): void {
    const group = this._groups.get(groupId);
    if (!group) return;

    for (const tab of group.tabs) {
      this._removeMru(tab.id);
    }
    group.tabs = [];
    group.activeTabId = null;

    if (this._groups.size > 1) {
      this._groups.delete(groupId);
      if (this._activeGroupId === groupId) {
        this._activeGroupId = this._groups.keys().next().value!;
      }
    }

    this._notify();
  }

  moveTab(tabId: string, toGroupId: string, toIndex: number): void {
    // Find and remove from source
    let tab: Tab | null = null;
    for (const group of this._groups.values()) {
      const idx = group.tabs.findIndex(t => t.id === tabId);
      if (idx !== -1) {
        tab = group.tabs.splice(idx, 1)[0];
        if (group.activeTabId === tabId) {
          group.activeTabId = this._findNextActive(group, idx);
        }
        // Clean up empty groups
        if (group.tabs.length === 0 && this._groups.size > 1) {
          this._groups.delete(group.id);
        }
        break;
      }
    }

    if (!tab) return;

    // Insert into target
    const targetGroup = this._groups.get(toGroupId);
    if (!targetGroup) return;

    const clamped = Math.max(0, Math.min(toIndex, targetGroup.tabs.length));
    targetGroup.tabs.splice(clamped, 0, tab);
    this._activateTab(toGroupId, tab.id);
  }

  reorderTab(groupId: string, fromIndex: number, toIndex: number): void {
    const group = this._groups.get(groupId);
    if (!group) return;
    if (fromIndex < 0 || fromIndex >= group.tabs.length) return;
    if (toIndex < 0 || toIndex >= group.tabs.length) return;
    if (fromIndex === toIndex) return;

    const [tab] = group.tabs.splice(fromIndex, 1);
    group.tabs.splice(toIndex, 0, tab);
    this._notify();
  }

  pinTab(tabId: string): void {
    const found = this._findTab(tabId);
    if (!found) return;
    found.tab.pinned = true;
    found.tab.preview = false;

    // Move to the pinned section (start of the list)
    const group = found.group;
    const idx = group.tabs.indexOf(found.tab);
    group.tabs.splice(idx, 1);
    const insertIdx = group.tabs.findLastIndex(t => t.pinned) + 1;
    group.tabs.splice(insertIdx, 0, found.tab);
    this._notify();
  }

  unpinTab(tabId: string): void {
    const found = this._findTab(tabId);
    if (!found) return;
    found.tab.pinned = false;
    this._notify();
  }

  setDirty(tabId: string, dirty: boolean): void {
    const found = this._findTab(tabId);
    if (!found) return;
    found.tab.dirty = dirty;
    this._notify();
  }

  activateTab(tabId: string): void {
    const found = this._findTab(tabId);
    if (!found) return;
    this._activateTab(found.group.id, tabId);
  }

  activateGroup(groupId: string): void {
    if (this._groups.has(groupId)) {
      this._activeGroupId = groupId;
      this._notify();
    }
  }

  /**
   * Split the active tab into a new group.
   * On compact mode, this is a no-op (only one group allowed).
   * The tab is duplicated (same URI) in the new group, not moved.
   */
  splitTab(tabId: string, layoutMode: LayoutMode): TabGroup | null {
    if (layoutMode === 'compact') return null;

    const found = this._findTab(tabId);
    if (!found) return null;

    const newGroup = this._createGroup();
    const newTab: Tab = {
      id: `tab-${this._nextTabId++}`,
      uri: found.tab.uri,
      title: found.tab.title,
      dirty: found.tab.dirty,
      pinned: false,
      preview: false,
    };
    newGroup.tabs.push(newTab);
    this._activateTab(newGroup.id, newTab.id);
    return newGroup;
  }

  /**
   * Enforce layout constraints. Called when layout mode changes.
   * In compact mode, merge all groups into one.
   */
  enforceLayoutConstraints(layoutMode: LayoutMode): void {
    if (layoutMode === 'compact' && this._groups.size > 1) {
      // Merge all tabs into the first group
      const groups = Array.from(this._groups.values());
      const target = groups[0];
      for (let i = 1; i < groups.length; i++) {
        for (const tab of groups[i].tabs) {
          target.tabs.push(tab);
        }
        this._groups.delete(groups[i].id);
      }
      this._activeGroupId = target.id;
      this._notify();
    }
  }

  // -----------------------------------------------------------------------
  // Listeners
  // -----------------------------------------------------------------------

  onChange(listener: TabChangeListener): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private _createGroup(): TabGroup {
    const group: TabGroup = {
      id: `group-${this._nextGroupId++}`,
      tabs: [],
      activeTabId: null,
    };
    this._groups.set(group.id, group);
    return group;
  }

  private _activateTab(groupId: string, tabId: string): void {
    const group = this._groups.get(groupId);
    if (!group) return;
    group.activeTabId = tabId;
    this._activeGroupId = groupId;
    this._pushMru(tabId);
    this._notify();
  }

  private _findTab(tabId: string): { group: TabGroup; tab: Tab } | null {
    for (const group of this._groups.values()) {
      const tab = group.tabs.find(t => t.id === tabId);
      if (tab) return { group, tab };
    }
    return null;
  }

  private _findNextActive(group: TabGroup, closedIdx: number): string | null {
    if (group.tabs.length === 0) return null;
    // Try the MRU list first
    for (const mruId of this._mru) {
      if (group.tabs.some(t => t.id === mruId)) return mruId;
    }
    // Fall back to the nearest tab
    const idx = Math.min(closedIdx, group.tabs.length - 1);
    return group.tabs[idx].id;
  }

  private _pushMru(tabId: string): void {
    this._removeMru(tabId);
    this._mru.unshift(tabId);
    // Keep MRU bounded
    if (this._mru.length > 50) this._mru.length = 50;
  }

  private _removeMru(tabId: string): void {
    const idx = this._mru.indexOf(tabId);
    if (idx !== -1) this._mru.splice(idx, 1);
  }

  private _notify(): void {
    const state = this.getState();
    for (const fn of this._listeners) fn(state);
  }
}
