/**
 * Plugin panel bridge — registers and renders declarative panels from plugins.
 *
 * Plugins create panels via host.panelCreate() and update content via host.panelUpdate().
 * This module maps that to the workbench panel registry + declarative renderer.
 * Perry-safe: module-level state, for-loops, no closures on `this`.
 */

import {
  VStack, Text, ScrollView,
  textSetFontSize, textSetFontWeight,
  widgetAddChild, widgetClearChildren,
  scrollViewSetChild,
} from 'perry/ui';
import { setFg } from '../../ui-helpers';
import { registerPanel, type PanelDescriptor } from '../../layout/panel-registry';
import { renderPanelElements, type PluginPanelElement } from './panel-renderer';
import type { ResolvedUIColors } from '../../theme/theme-loader';

// Per-panel state
interface PluginPanel {
  id: number;
  title: string;
  pluginName: string;
  location: string;
  container: unknown;
  contentWrapper: unknown;
  elements: PluginPanelElement[];
  unregister: (() => void) | null;
}

let panels: Map<number, PluginPanel> = new Map();
let nextPanelId: number = 1;
let currentColors: ResolvedUIColors | null = null;

/** Set the current theme colors (called on theme change). */
export function setPluginPanelColors(colors: ResolvedUIColors): void {
  currentColors = colors;
}

/**
 * Create a plugin panel. Returns a numeric handle.
 */
export function pluginPanelCreate(
  pluginName: string,
  title: string,
  icon: string,
  location: string,
): number {
  const id = nextPanelId;
  nextPanelId++;

  // Create the container widget
  const scrollView = ScrollView();
  const content = VStack(4, []);
  scrollViewSetChild(scrollView, content);

  // Register with the panel registry
  let loc: 'sidebar' | 'bottom' = 'sidebar';
  if (location === 'bottom') loc = 'bottom';

  const panelId = 'plugin:' + pluginName + ':' + String(id);
  const descriptor: PanelDescriptor = {
    id: panelId,
    title: title,
    icon: icon.length > 0 ? icon : 'puzzlepiece.fill',
    defaultLocation: loc,
    supportedModes: [],
    minWidth: 200,
    minHeight: loc === 'bottom' ? 100 : 0,
    order: 100 + id, // After built-in panels
    compactTab: null,
  };
  const unregister = registerPanel(descriptor);

  const panel: PluginPanel = {
    id: id,
    title: title,
    pluginName: pluginName,
    location: location,
    container: scrollView,
    contentWrapper: content,
    elements: [],
    unregister: unregister,
  };

  panels.set(id, panel);
  return id;
}

/**
 * Update a plugin panel's content.
 */
export function pluginPanelUpdate(handle: number, elements: PluginPanelElement[]): void {
  const panel = panels.get(handle);
  if (panel === undefined) return;

  panel.elements = elements;

  // Re-render: clear old content and render new elements
  widgetClearChildren(panel.contentWrapper);

  if (currentColors !== null) {
    // Add title
    const title = Text(panel.title);
    textSetFontSize(title, 11);
    textSetFontWeight(title, 11, 0.7);
    setFg(title, currentColors.sideBarForeground);
    widgetAddChild(panel.contentWrapper, title);

    // Render declarative elements
    renderPanelElements(panel.contentWrapper, elements, currentColors);
  }
}

/**
 * Dispose a plugin panel.
 */
export function pluginPanelDispose(handle: number): void {
  const panel = panels.get(handle);
  if (panel === undefined) return;

  // Unregister from panel registry
  if (panel.unregister !== null) {
    panel.unregister();
  }

  panels.delete(handle);
}

/**
 * Get the container widget for a plugin panel (for embedding in sidebar/bottom).
 */
export function getPluginPanelWidget(handle: number): unknown {
  const panel = panels.get(handle);
  if (panel === undefined) return null;
  return panel.container;
}

/**
 * Clean up all panels for a plugin (on deactivate).
 */
export function pluginPanelCleanup(pluginName: string): void {
  const toRemove: number[] = [];
  const entries = Array.from(panels.entries());
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][1].pluginName === pluginName) {
      toRemove.push(entries[i][0]);
    }
  }
  for (let i = 0; i < toRemove.length; i++) {
    pluginPanelDispose(toRemove[i]);
  }
}
