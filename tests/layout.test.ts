/**
 * Layout tests — verifies the grid, tab manager, activity bar, and status bar
 * across all device presets.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  ALL_DEVICES,
  PHONE_DEVICES,
  TABLET_DEVICES,
  DESKTOP_DEVICES,
  type DevicePreset,
} from './devices';
import {
  createDefaultLayout,
  computeGridRects,
  findLeaf,
  setLeafVisible,
  setSplitRatio,
  serializeGrid,
  deserializeGrid,
  transitionLayout,
  type GridNode,
} from '../src/workbench/layout/grid';
import { TabManager } from '../src/workbench/layout/tab-manager';
import {
  getActivityBarLayout,
  setActivePanel,
  setActiveCompactTab,
  setBadge,
  resetActivityBar,
} from '../src/workbench/layout/activity-bar';
import {
  createStatusBarEntry,
  getStatusBarLayout,
  clearStatusBar,
} from '../src/workbench/layout/status-bar';
import {
  registerPanel,
  BUILTIN_PANELS,
  clearPanelRegistry,
} from '../src/workbench/layout/panel-registry';
import {
  selectLayoutMode,
  classifyDevice,
  MIN_TOUCH_TARGET,
} from '../src/platform';

// ---------------------------------------------------------------------------
// Setup: register built-in panels for all tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearPanelRegistry();
  resetActivityBar();
  clearStatusBar();
  for (const panel of BUILTIN_PANELS) {
    registerPanel(panel);
  }
});

// ===========================================================================
// Grid layout tests
// ===========================================================================

describe('Grid layout', () => {
  test('creates correct default layout for each mode', () => {
    const full = createDefaultLayout('full');
    expect(full.kind).toBe('split');
    if (full.kind === 'split') {
      expect(full.direction).toBe('horizontal');
      // Full mode should have sidebar + (editor + bottom panel)
      expect(full.first.kind).toBe('leaf');
      expect(full.second.kind).toBe('split');
    }

    const split = createDefaultLayout('split');
    expect(split.kind).toBe('split');
    if (split.kind === 'split') {
      expect(split.direction).toBe('horizontal');
      expect(split.first.kind).toBe('leaf');
      expect(split.second.kind).toBe('leaf');
    }

    const compact = createDefaultLayout('compact');
    expect(compact.kind).toBe('leaf');
    if (compact.kind === 'leaf') {
      expect(compact.panelId).toBe('editor-area');
    }
  });

  test('computeGridRects produces valid rectangles for full layout', () => {
    const root = createDefaultLayout('full');
    const rects = computeGridRects(root, 0, 0, 1400, 900);

    expect(rects.length).toBe(3); // sidebar, editor-area, bottom-panel
    const sidebar = rects.find(r => r.panelId === 'sidebar')!;
    const editor = rects.find(r => r.panelId === 'editor-area')!;
    const bottom = rects.find(r => r.panelId === 'bottom-panel')!;

    expect(sidebar).toBeDefined();
    expect(editor).toBeDefined();
    expect(bottom).toBeDefined();

    // Sidebar should be on the left
    expect(sidebar.x).toBe(0);
    expect(sidebar.width).toBeGreaterThanOrEqual(200); // minFirst

    // Editor and bottom should be to the right of sidebar
    expect(editor.x).toBe(sidebar.width);
    expect(bottom.x).toBe(sidebar.width);

    // Editor should be above bottom
    expect(editor.y).toBe(0);
    expect(bottom.y).toBe(editor.height);

    // No gaps, no overlaps in total width
    expect(sidebar.width + editor.width).toBe(1400);
    expect(editor.height + bottom.height).toBe(900);
  });

  test('computeGridRects produces valid rectangles for split layout', () => {
    const root = createDefaultLayout('split');
    const rects = computeGridRects(root, 0, 0, 820, 1180);

    expect(rects.length).toBe(2); // sidebar, editor-area
    const total = rects.reduce((w, r) => w + r.width, 0);
    // Total width of siblings should equal viewport (not sum of all)
    expect(rects[0].width + rects[1].width).toBe(820);
  });

  test('computeGridRects handles compact layout (single leaf)', () => {
    const root = createDefaultLayout('compact');
    const rects = computeGridRects(root, 0, 0, 393, 852);

    expect(rects.length).toBe(1);
    expect(rects[0].panelId).toBe('editor-area');
    expect(rects[0].width).toBe(393);
    expect(rects[0].height).toBe(852);
  });

  describe('across all devices', () => {
    for (const device of ALL_DEVICES) {
      test(`${device.name}: grid produces non-overlapping rects`, () => {
        const { layoutMode, screen } = device.context;
        const root = createDefaultLayout(layoutMode);
        const rects = computeGridRects(root, 0, 0, screen.width, screen.height);

        // All rects should have positive dimensions
        for (const r of rects) {
          expect(r.width).toBeGreaterThan(0);
          expect(r.height).toBeGreaterThan(0);
        }

        // No rect should extend beyond the viewport
        for (const r of rects) {
          expect(r.x + r.width).toBeLessThanOrEqual(screen.width + 0.01);
          expect(r.y + r.height).toBeLessThanOrEqual(screen.height + 0.01);
        }
      });
    }
  });

  test('findLeaf locates panels by ID', () => {
    const root = createDefaultLayout('full');
    expect(findLeaf(root, 'sidebar')).not.toBeNull();
    expect(findLeaf(root, 'editor-area')).not.toBeNull();
    expect(findLeaf(root, 'bottom-panel')).not.toBeNull();
    expect(findLeaf(root, 'nonexistent')).toBeNull();
  });

  test('setLeafVisible toggles visibility immutably', () => {
    const root = createDefaultLayout('full');
    const updated = setLeafVisible(root, 'sidebar', false);

    // Original is unchanged
    expect(findLeaf(root, 'sidebar')!.visible).toBe(true);
    // Updated has sidebar hidden
    expect(findLeaf(updated, 'sidebar')!.visible).toBe(false);
  });

  test('setSplitRatio clamps to [0, 1]', () => {
    const root = createDefaultLayout('full');
    const wider = setSplitRatio(root, [], 0.5);
    if (wider.kind === 'split') {
      expect(wider.ratio).toBe(0.5);
    }

    const overclamped = setSplitRatio(root, [], 2.0);
    if (overclamped.kind === 'split') {
      expect(overclamped.ratio).toBe(1.0);
    }

    const underclamped = setSplitRatio(root, [], -1.0);
    if (underclamped.kind === 'split') {
      expect(underclamped.ratio).toBe(0.0);
    }
  });

  test('serialization roundtrip preserves structure', () => {
    const root = createDefaultLayout('full');
    const state = serializeGrid(root, 'full');
    const restored = deserializeGrid(state);

    expect(JSON.stringify(restored)).toBe(JSON.stringify(root));
  });

  test('transitionLayout creates fresh layout for new mode', () => {
    const fullRoot = createDefaultLayout('full');
    const compactRoot = transitionLayout(fullRoot, 'compact');

    expect(compactRoot.kind).toBe('leaf');
    if (compactRoot.kind === 'leaf') {
      expect(compactRoot.panelId).toBe('editor-area');
    }
  });
});

// ===========================================================================
// Layout mode selection tests
// ===========================================================================

describe('Layout mode selection', () => {
  for (const device of ALL_DEVICES) {
    test(`${device.name}: selects ${device.expectedLayoutMode} layout`, () => {
      const { deviceClass, screen } = device.context;
      const mode = selectLayoutMode(deviceClass, screen);
      expect(mode).toBe(device.expectedLayoutMode);
    });
  }

  test('all phones get compact layout', () => {
    for (const device of PHONE_DEVICES) {
      const mode = selectLayoutMode(device.context.deviceClass, device.context.screen);
      expect(mode).toBe('compact');
    }
  });

  test('desktop devices always get full layout', () => {
    for (const device of DESKTOP_DEVICES) {
      const mode = selectLayoutMode(device.context.deviceClass, device.context.screen);
      expect(mode).toBe('full');
    }
  });
});

// ===========================================================================
// Tab manager tests
// ===========================================================================

describe('TabManager', () => {
  let tm: TabManager;

  beforeEach(() => {
    tm = new TabManager();
  });

  test('starts with one empty group', () => {
    expect(tm.getGroupCount()).toBe(1);
    expect(tm.getTabCount()).toBe(0);
    expect(tm.getActiveTab()).toBeNull();
  });

  test('openTab creates a tab and activates it', () => {
    const tab = tm.openTab('/file.ts', 'file.ts');
    expect(tab.uri).toBe('/file.ts');
    expect(tab.title).toBe('file.ts');
    expect(tm.getActiveTab()?.id).toBe(tab.id);
    expect(tm.getTabCount()).toBe(1);
  });

  test('opening same URI twice reuses existing tab', () => {
    tm.openTab('/file.ts', 'file.ts');
    tm.openTab('/file.ts', 'file.ts');
    expect(tm.getTabCount()).toBe(1);
  });

  test('closeTab removes the tab', () => {
    const tab = tm.openTab('/file.ts', 'file.ts');
    tm.closeTab(tab.id);
    expect(tm.getTabCount()).toBe(0);
  });

  test('closing active tab activates the nearest remaining tab', () => {
    const a = tm.openTab('/a.ts', 'a.ts');
    const b = tm.openTab('/b.ts', 'b.ts');
    const c = tm.openTab('/c.ts', 'c.ts');

    // c is active (last opened). Close it → should activate b
    tm.closeTab(c.id);
    expect(tm.getActiveTab()?.id).toBe(b.id);
  });

  test('preview tab is replaced on next open', () => {
    tm.openTab('/a.ts', 'a.ts', { preview: true });
    expect(tm.getTabCount()).toBe(1);

    tm.openTab('/b.ts', 'b.ts', { preview: true });
    expect(tm.getTabCount()).toBe(1); // Replaced, not added
    expect(tm.getActiveTab()?.uri).toBe('/b.ts');
  });

  test('re-opening a preview tab promotes it to permanent', () => {
    const tab = tm.openTab('/a.ts', 'a.ts', { preview: true });
    expect(tab.preview).toBe(true);

    tm.openTab('/a.ts', 'a.ts'); // Re-open without preview
    expect(tm.findTabByUri('/a.ts')?.tab.preview).toBe(false);
  });

  test('pinTab moves tab to start of list', () => {
    tm.openTab('/a.ts', 'a.ts');
    const b = tm.openTab('/b.ts', 'b.ts');
    tm.openTab('/c.ts', 'c.ts');

    tm.pinTab(b.id);
    const tabs = tm.getActiveGroup().tabs;
    expect(tabs[0].id).toBe(b.id);
    expect(tabs[0].pinned).toBe(true);
  });

  test('setDirty marks tab as dirty', () => {
    const tab = tm.openTab('/a.ts', 'a.ts');
    expect(tab.dirty).toBe(false);

    tm.setDirty(tab.id, true);
    expect(tm.findTabByUri('/a.ts')?.tab.dirty).toBe(true);
  });

  test('reorderTab moves tab within group', () => {
    const a = tm.openTab('/a.ts', 'a.ts');
    const b = tm.openTab('/b.ts', 'b.ts');
    const c = tm.openTab('/c.ts', 'c.ts');

    const groupId = tm.getActiveGroup().id;
    tm.reorderTab(groupId, 2, 0); // Move c to position 0
    const tabs = tm.getActiveGroup().tabs;
    expect(tabs[0].id).toBe(c.id);
  });

  test('splitTab creates a new group on desktop', () => {
    const tab = tm.openTab('/a.ts', 'a.ts');
    const newGroup = tm.splitTab(tab.id, 'full');
    expect(newGroup).not.toBeNull();
    expect(tm.getGroupCount()).toBe(2);
  });

  test('splitTab is a no-op on compact layout', () => {
    const tab = tm.openTab('/a.ts', 'a.ts');
    const result = tm.splitTab(tab.id, 'compact');
    expect(result).toBeNull();
    expect(tm.getGroupCount()).toBe(1);
  });

  test('enforceLayoutConstraints merges groups in compact mode', () => {
    const a = tm.openTab('/a.ts', 'a.ts');
    tm.splitTab(a.id, 'full'); // Duplicates tab into a new group
    expect(tm.getGroupCount()).toBe(2);

    tm.enforceLayoutConstraints('compact');
    expect(tm.getGroupCount()).toBe(1);
    expect(tm.getTabCount()).toBe(2); // Both tab instances preserved
  });

  test('closeAllInGroup removes the group if others exist', () => {
    const a = tm.openTab('/a.ts', 'a.ts');
    tm.splitTab(a.id, 'full'); // Creates second group with duplicated tab
    expect(tm.getGroupCount()).toBe(2);

    const groups = tm.getState().groups;
    tm.closeAllInGroup(groups[1].id);
    expect(tm.getGroupCount()).toBe(1);
  });
});

// ===========================================================================
// Activity bar tests
// ===========================================================================

describe('Activity bar', () => {
  test('desktop: vertical layout with sidebar panels', () => {
    const layout = getActivityBarLayout('full', 'desktop');
    expect(layout.orientation).toBe('vertical');
    expect(layout.items.length).toBeGreaterThan(0);
  });

  test('phone: horizontal layout with 4 compact tabs', () => {
    const layout = getActivityBarLayout('compact', 'phone');
    expect(layout.orientation).toBe('horizontal');
    expect(layout.items.length).toBe(4);
    const ids = layout.items.map(i => i.id);
    expect(ids).toEqual(['files', 'editor', 'ai', 'terminal']);
  });

  test('touch targets meet minimum size on tablet', () => {
    const layout = getActivityBarLayout('full', 'tablet');
    expect(layout.itemSize).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  test('touch targets meet minimum size on phone', () => {
    const layout = getActivityBarLayout('compact', 'phone');
    expect(layout.itemSize).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  test('desktop items are smaller (keyboard-mouse optimized)', () => {
    const layout = getActivityBarLayout('full', 'desktop');
    expect(layout.itemSize).toBeLessThan(MIN_TOUCH_TARGET);
  });

  test('setBadge shows badge on panel', () => {
    setBadge('source-control', '3');
    const layout = getActivityBarLayout('full', 'desktop');
    const scmItem = layout.items.find(i => 'id' in i && i.id === 'source-control');
    expect(scmItem && 'badge' in scmItem ? scmItem.badge : '').toBe('3');
  });

  test('setActivePanel toggles active state', () => {
    setActivePanel('search');
    const layout1 = getActivityBarLayout('full', 'desktop');
    const searchItem = layout1.items.find(i => 'id' in i && i.id === 'search');
    expect(searchItem && 'active' in searchItem ? searchItem.active : false).toBe(true);

    // Clicking the same panel again toggles it off
    setActivePanel('search');
    const layout2 = getActivityBarLayout('full', 'desktop');
    const searchItem2 = layout2.items.find(i => 'id' in i && i.id === 'search');
    expect(searchItem2 && 'active' in searchItem2 ? searchItem2.active : true).toBe(false);
  });

  describe('across all devices', () => {
    for (const device of ALL_DEVICES) {
      test(`${device.name}: activity bar renders with valid layout`, () => {
        const { layoutMode, deviceClass } = device.context;
        const layout = getActivityBarLayout(layoutMode, deviceClass);

        expect(layout.items.length).toBeGreaterThan(0);
        expect(layout.itemSize).toBeGreaterThan(0);
        expect(layout.spacing).toBeGreaterThanOrEqual(0);

        if (layoutMode === 'compact') {
          expect(layout.orientation).toBe('horizontal');
          expect(layout.items.length).toBe(4);
        } else {
          expect(layout.orientation).toBe('vertical');
        }
      });
    }
  });
});

// ===========================================================================
// Status bar tests
// ===========================================================================

describe('Status bar', () => {
  beforeEach(() => {
    clearStatusBar();
  });

  test('entries are sorted by alignment then priority', () => {
    createStatusBarEntry('left-low', { alignment: 'left', priority: 1 });
    createStatusBarEntry('left-high', { alignment: 'left', priority: 10 });
    createStatusBarEntry('right-item', { alignment: 'right', priority: 5 });

    const layout = getStatusBarLayout('full');
    const ids = layout.entries.map(e => e.id);
    expect(ids.indexOf('left-high')).toBeLessThan(ids.indexOf('left-low'));
    expect(ids.indexOf('left-low')).toBeLessThan(ids.indexOf('right-item'));
  });

  test('compact layout filters to showInCompact entries only', () => {
    createStatusBarEntry('visible', { alignment: 'left', showInCompact: true, text: 'Ln 1' });
    createStatusBarEntry('hidden', { alignment: 'right', showInCompact: false, text: 'UTF-8' });

    const full = getStatusBarLayout('full');
    expect(full.entries.length).toBe(2);

    const compact = getStatusBarLayout('compact');
    expect(compact.entries.length).toBe(1);
    expect(compact.entries[0].id).toBe('visible');
  });

  test('compact layout has smaller height', () => {
    const full = getStatusBarLayout('full');
    const compact = getStatusBarLayout('compact');
    expect(compact.height).toBeLessThan(full.height);
  });

  describe('across all devices', () => {
    for (const device of ALL_DEVICES) {
      test(`${device.name}: status bar has valid height`, () => {
        createStatusBarEntry('branch', { alignment: 'left', showInCompact: true, text: 'main' });

        const layout = getStatusBarLayout(device.context.layoutMode);
        expect(layout.height).toBeGreaterThan(0);

        if (device.context.layoutMode === 'compact') {
          expect(layout.height).toBeLessThanOrEqual(28);
        }
      });
    }
  });
});

// ===========================================================================
// Device classification tests
// ===========================================================================

describe('Device classification', () => {
  test('macOS/Windows/Linux are always desktop', () => {
    for (const p of ['macos', 'windows', 'linux'] as const) {
      expect(classifyDevice(p, { width: 100, height: 100, scaleFactor: 1, orientation: 'portrait' })).toBe('desktop');
    }
  });

  test('iOS is always phone', () => {
    expect(classifyDevice('ios', { width: 430, height: 932, scaleFactor: 3, orientation: 'portrait' })).toBe('phone');
  });

  test('iPadOS is always tablet', () => {
    expect(classifyDevice('ipados', { width: 1024, height: 1366, scaleFactor: 2, orientation: 'portrait' })).toBe('tablet');
  });

  test('Android uses short side to distinguish phone from tablet', () => {
    // Phone: short side < 600
    expect(classifyDevice('android', { width: 412, height: 915, scaleFactor: 2, orientation: 'portrait' })).toBe('phone');
    // Tablet: short side >= 600
    expect(classifyDevice('android', { width: 800, height: 1280, scaleFactor: 2, orientation: 'portrait' })).toBe('tablet');
  });

  test('Web classifies by viewport width', () => {
    expect(classifyDevice('web', { width: 375, height: 812, scaleFactor: 2, orientation: 'portrait' })).toBe('phone');
    expect(classifyDevice('web', { width: 768, height: 1024, scaleFactor: 2, orientation: 'portrait' })).toBe('tablet');
    expect(classifyDevice('web', { width: 1440, height: 900, scaleFactor: 1, orientation: 'landscape' })).toBe('desktop');
  });
});
