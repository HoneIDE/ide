/**
 * Activity bar — the main navigation strip.
 *
 * Desktop / tablet: vertical icon strip on the left edge.
 * Phone: horizontal bottom tab bar with 4 fixed icons (Files, Editor, AI, Terminal).
 *
 * Each icon corresponds to a panel group. Clicking toggles the sidebar
 * to show that panel (desktop/tablet) or switches the active full-screen
 * panel (phone).
 */

import type { LayoutMode, DeviceClass } from '../../platform';
import { MIN_TOUCH_TARGET, MIN_TOUCH_SPACING } from '../../platform';
import type { PanelDescriptor } from './panel-registry';
import { getAllPanels, getPanelsForMode } from './panel-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityBarItem {
  id: string;
  icon: string;
  title: string;
  /** Badge text (e.g. "3" for git changes). Empty string = no badge. */
  badge: string;
  active: boolean;
}

/**
 * Compact bottom tab definition.
 * On phone, the activity bar is replaced by 4 fixed bottom tabs.
 */
export interface CompactTab {
  id: 'files' | 'editor' | 'ai' | 'terminal';
  icon: string;
  title: string;
  active: boolean;
}

export interface ActivityBarLayout {
  orientation: 'vertical' | 'horizontal';
  itemSize: number;
  spacing: number;
  items: ActivityBarItem[] | CompactTab[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _activePanelId: string = 'explorer';
let _activeCompactTab: CompactTab['id'] = 'editor';
const _badges: Map<string, string> = new Map();
const _listeners: Set<() => void> = new Set();

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getActivityBarLayout(
  layoutMode: LayoutMode,
  deviceClass: DeviceClass,
): ActivityBarLayout {
  if (layoutMode === 'compact') {
    return {
      orientation: 'horizontal',
      itemSize: MIN_TOUCH_TARGET,
      spacing: MIN_TOUCH_SPACING,
      items: getCompactTabs(),
    };
  }

  const isTouch = deviceClass === 'tablet';
  const itemSize = isTouch ? MIN_TOUCH_TARGET : 36;
  const spacing = isTouch ? MIN_TOUCH_SPACING : 4;

  const panels = getPanelsForMode(layoutMode).filter(
    p => p.defaultLocation === 'sidebar',
  );

  const items: ActivityBarItem[] = panels.map(p => ({
    id: p.id,
    icon: p.icon,
    title: p.title,
    badge: _badges.get(p.id) ?? '',
    active: p.id === _activePanelId,
  }));

  return { orientation: 'vertical', itemSize, spacing, items };
}

export function getCompactTabs(): CompactTab[] {
  return [
    { id: 'files', icon: 'files', title: 'Files', active: _activeCompactTab === 'files' },
    { id: 'editor', icon: 'code', title: 'Editor', active: _activeCompactTab === 'editor' },
    { id: 'ai', icon: 'sparkle', title: 'AI', active: _activeCompactTab === 'ai' },
    { id: 'terminal', icon: 'terminal', title: 'Terminal', active: _activeCompactTab === 'terminal' },
  ];
}

export function getActivePanelId(): string {
  return _activePanelId;
}

export function getActiveCompactTab(): CompactTab['id'] {
  return _activeCompactTab;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function setActivePanel(panelId: string): void {
  if (_activePanelId === panelId) {
    // Toggle: clicking the active panel hides the sidebar (desktop/tablet only)
    _activePanelId = '';
  } else {
    _activePanelId = panelId;
  }
  notifyListeners();
}

export function setActiveCompactTab(tab: CompactTab['id']): void {
  _activeCompactTab = tab;
  notifyListeners();
}

export function setBadge(panelId: string, badge: string): void {
  if (badge) {
    _badges.set(panelId, badge);
  } else {
    _badges.delete(panelId);
  }
  notifyListeners();
}

export function clearBadges(): void {
  _badges.clear();
  notifyListeners();
}

/** Reset state. Used in tests. */
export function resetActivityBar(): void {
  _activePanelId = 'explorer';
  _activeCompactTab = 'editor';
  _badges.clear();
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------

export function onActivityBarChange(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

function notifyListeners(): void {
  for (const fn of _listeners) fn();
}
