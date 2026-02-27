/**
 * Panel registry — registers named panels that can be placed in the workbench.
 *
 * Each panel has metadata: icon, title, default location, which layout
 * modes it supports, and minimum dimensions.
 */

import type { LayoutMode } from '../../platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PanelLocation = 'sidebar' | 'editor' | 'bottom' | 'overlay';

export interface PanelDescriptor {
  /** Unique panel identifier (e.g. 'explorer', 'search', 'ai-chat'). */
  id: string;
  /** Display title. */
  title: string;
  /** Icon identifier (resolved by the theme/icon system). */
  icon: string;
  /** Where this panel lives by default. */
  defaultLocation: PanelLocation;
  /** Layout modes where this panel is available. Empty = all modes. */
  supportedModes: LayoutMode[];
  /** Minimum width in points (for sidebar/editor panels). */
  minWidth: number;
  /** Minimum height in points (for bottom panels). */
  minHeight: number;
  /**
   * Priority for ordering in the activity bar / bottom tab bar.
   * Lower numbers appear first.
   */
  order: number;
  /**
   * On compact (phone) layout, which bottom tab this panel belongs to.
   * null = not shown in bottom tabs.
   */
  compactTab: 'files' | 'editor' | 'ai' | 'terminal' | null;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _panels: Map<string, PanelDescriptor> = new Map();
const _onChangeCallbacks: Set<() => void> = new Set();

export function registerPanel(descriptor: PanelDescriptor): () => void {
  _panels.set(descriptor.id, descriptor);
  notifyChange();
  return () => {
    _panels.delete(descriptor.id);
    notifyChange();
  };
}

export function getPanel(id: string): PanelDescriptor | undefined {
  return _panels.get(id);
}

export function getAllPanels(): PanelDescriptor[] {
  return Array.from(_panels.values()).sort((a, b) => a.order - b.order);
}

export function getPanelsForLocation(location: PanelLocation): PanelDescriptor[] {
  return getAllPanels().filter(p => p.defaultLocation === location);
}

export function getPanelsForMode(mode: LayoutMode): PanelDescriptor[] {
  return getAllPanels().filter(
    p => p.supportedModes.length === 0 || p.supportedModes.includes(mode),
  );
}

export function getPanelsForCompactTab(tab: PanelDescriptor['compactTab']): PanelDescriptor[] {
  return getAllPanels().filter(p => p.compactTab === tab);
}

export function onPanelRegistryChange(callback: () => void): () => void {
  _onChangeCallbacks.add(callback);
  return () => { _onChangeCallbacks.delete(callback); };
}

/** Clear all registered panels. Used in tests. */
export function clearPanelRegistry(): void {
  _panels.clear();
}

function notifyChange(): void {
  for (const cb of _onChangeCallbacks) {
    cb();
  }
}

// ---------------------------------------------------------------------------
// Built-in panel descriptors (registered in commands.ts during app init)
// ---------------------------------------------------------------------------

export const BUILTIN_PANELS: PanelDescriptor[] = [
  {
    id: 'explorer',
    title: 'Explorer',
    icon: 'files',
    defaultLocation: 'sidebar',
    supportedModes: [],
    minWidth: 200,
    minHeight: 0,
    order: 10,
    compactTab: 'files',
  },
  {
    id: 'search',
    title: 'Search',
    icon: 'search',
    defaultLocation: 'sidebar',
    supportedModes: [],
    minWidth: 200,
    minHeight: 0,
    order: 20,
    compactTab: 'files',
  },
  {
    id: 'source-control',
    title: 'Source Control',
    icon: 'git-branch',
    defaultLocation: 'sidebar',
    supportedModes: [],
    minWidth: 200,
    minHeight: 0,
    order: 30,
    compactTab: 'files',
  },
  {
    id: 'debug',
    title: 'Debug',
    icon: 'bug',
    defaultLocation: 'sidebar',
    supportedModes: [],
    minWidth: 200,
    minHeight: 0,
    order: 40,
    compactTab: null,
  },
  {
    id: 'extensions',
    title: 'Extensions',
    icon: 'extensions',
    defaultLocation: 'sidebar',
    supportedModes: [],
    minWidth: 200,
    minHeight: 0,
    order: 50,
    compactTab: null,
  },
  {
    id: 'ai-chat',
    title: 'AI Chat',
    icon: 'sparkle',
    defaultLocation: 'sidebar',
    supportedModes: [],
    minWidth: 300,
    minHeight: 0,
    order: 60,
    compactTab: 'ai',
  },
  {
    id: 'terminal',
    title: 'Terminal',
    icon: 'terminal',
    defaultLocation: 'bottom',
    supportedModes: [],
    minWidth: 0,
    minHeight: 120,
    order: 70,
    compactTab: 'terminal',
  },
  {
    id: 'problems',
    title: 'Problems',
    icon: 'warning',
    defaultLocation: 'bottom',
    supportedModes: [],
    minWidth: 0,
    minHeight: 100,
    order: 80,
    compactTab: null,
  },
  {
    id: 'output',
    title: 'Output',
    icon: 'output',
    defaultLocation: 'bottom',
    supportedModes: [],
    minWidth: 0,
    minHeight: 100,
    order: 90,
    compactTab: null,
  },
];
