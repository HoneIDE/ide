/**
 * Resizable split panel engine.
 *
 * The grid is a binary tree of splits. Each internal node is a horizontal
 * or vertical split with a configurable ratio. Each leaf node is a panel
 * slot that hosts a registered panel or an editor group.
 *
 * The grid adapts to layout mode:
 * - full:    sidebar + editor area + bottom panel (standard 3-region)
 * - split:   narrow sidebar + editor (2-column, no bottom panel visible)
 * - compact: single panel, no splits (panels swap via bottom tab bar)
 */

import type { LayoutMode } from '../../platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SplitDirection = 'horizontal' | 'vertical';

export interface GridSplit {
  kind: 'split';
  direction: SplitDirection;
  /** Ratio of the first child (0.0–1.0). Second child gets the remainder. */
  ratio: number;
  /** Minimum size of the first child in points. */
  minFirst: number;
  /** Minimum size of the second child in points. */
  minSecond: number;
  first: GridNode;
  second: GridNode;
}

export interface GridLeaf {
  kind: 'leaf';
  /** Panel ID or 'editor-area' for the main editor region. */
  panelId: string;
  /** Whether this leaf is currently visible. */
  visible: boolean;
}

export type GridNode = GridSplit | GridLeaf;

/** Serialized grid state for persistence. */
export interface GridState {
  root: GridNode;
  layoutMode: LayoutMode;
}

/** Computed rectangle for a grid leaf after layout. */
export interface GridRect {
  panelId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

// ---------------------------------------------------------------------------
// Default layouts
// ---------------------------------------------------------------------------

export function createDefaultLayout(mode: LayoutMode): GridNode {
  switch (mode) {
    case 'full':
      return {
        kind: 'split',
        direction: 'horizontal',
        ratio: 0.22,
        minFirst: 200,
        minSecond: 400,
        first: { kind: 'leaf', panelId: 'sidebar', visible: true },
        second: {
          kind: 'split',
          direction: 'vertical',
          ratio: 0.7,
          minFirst: 200,
          minSecond: 120,
          first: { kind: 'leaf', panelId: 'editor-area', visible: true },
          second: { kind: 'leaf', panelId: 'bottom-panel', visible: true },
        },
      };
    case 'split':
      return {
        kind: 'split',
        direction: 'horizontal',
        ratio: 0.3,
        minFirst: 180,
        minSecond: 300,
        first: { kind: 'leaf', panelId: 'sidebar', visible: true },
        second: { kind: 'leaf', panelId: 'editor-area', visible: true },
      };
    case 'compact':
      // In compact mode, there's only one visible panel at a time.
      // The active panel is controlled by the bottom tab bar.
      return { kind: 'leaf', panelId: 'editor-area', visible: true };
  }
}

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

/**
 * Compute the absolute rectangles for all leaves in the grid tree,
 * given the available viewport.
 */
export function computeGridRects(
  node: GridNode,
  x: number,
  y: number,
  width: number,
  height: number,
): GridRect[] {
  if (node.kind === 'leaf') {
    return [{ panelId: node.panelId, x, y, width, height, visible: node.visible }];
  }

  const { direction, ratio, minFirst, minSecond, first, second } = node;

  let firstSize: number;
  let secondSize: number;

  if (direction === 'horizontal') {
    firstSize = clampSplit(width * ratio, minFirst, width - minSecond, width);
    secondSize = width - firstSize;
    return [
      ...computeGridRects(first, x, y, firstSize, height),
      ...computeGridRects(second, x + firstSize, y, secondSize, height),
    ];
  } else {
    firstSize = clampSplit(height * ratio, minFirst, height - minSecond, height);
    secondSize = height - firstSize;
    return [
      ...computeGridRects(first, x, y, width, firstSize),
      ...computeGridRects(second, x, y + firstSize, width, secondSize),
    ];
  }
}

function clampSplit(desired: number, min: number, max: number, total: number): number {
  if (total <= 0) return 0;
  const clamped = Math.max(min, Math.min(max, desired));
  return Math.max(0, Math.min(total, clamped));
}

// ---------------------------------------------------------------------------
// Grid mutations
// ---------------------------------------------------------------------------

/** Find a leaf by panelId and return a path of indices to reach it. */
export function findLeaf(node: GridNode, panelId: string): GridLeaf | null {
  if (node.kind === 'leaf') {
    return node.panelId === panelId ? node : null;
  }
  return findLeaf(node.first, panelId) ?? findLeaf(node.second, panelId);
}

/** Set the visibility of a leaf panel. Returns a new tree (immutable). */
export function setLeafVisible(node: GridNode, panelId: string, visible: boolean): GridNode {
  if (node.kind === 'leaf') {
    if (node.panelId === panelId) {
      return { ...node, visible };
    }
    return node;
  }
  return {
    ...node,
    first: setLeafVisible(node.first, panelId, visible),
    second: setLeafVisible(node.second, panelId, visible),
  };
}

/** Update the split ratio for a given split node. */
export function setSplitRatio(
  node: GridNode,
  /** Path to the split: 'first' or 'second' at each level. */
  path: ('first' | 'second')[],
  ratio: number,
): GridNode {
  if (path.length === 0) {
    if (node.kind === 'split') {
      return { ...node, ratio: Math.max(0, Math.min(1, ratio)) };
    }
    return node;
  }

  if (node.kind === 'leaf') return node;

  const [head, ...rest] = path;
  if (head === 'first') {
    return { ...node, first: setSplitRatio(node.first, rest, ratio) };
  }
  return { ...node, second: setSplitRatio(node.second, rest, ratio) };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeGrid(node: GridNode, layoutMode: LayoutMode): GridState {
  return { root: node, layoutMode };
}

export function deserializeGrid(state: GridState): GridNode {
  return state.root;
}

/**
 * Transition the grid when the layout mode changes.
 * Rather than trying to morph the tree, we create a fresh default
 * layout for the new mode. Panel visibility states are carried over.
 */
export function transitionLayout(
  _currentRoot: GridNode,
  newMode: LayoutMode,
): GridNode {
  // Collect visibility from current tree
  const visibility = collectVisibility(_currentRoot);

  // Create fresh layout for the new mode
  const newRoot = createDefaultLayout(newMode);

  // Restore visibility where panel IDs match
  return applyVisibility(newRoot, visibility);
}

function collectVisibility(node: GridNode): Map<string, boolean> {
  const map = new Map<string, boolean>();
  if (node.kind === 'leaf') {
    map.set(node.panelId, node.visible);
  } else {
    for (const [k, v] of collectVisibility(node.first)) map.set(k, v);
    for (const [k, v] of collectVisibility(node.second)) map.set(k, v);
  }
  return map;
}

function applyVisibility(node: GridNode, visibility: Map<string, boolean>): GridNode {
  if (node.kind === 'leaf') {
    const v = visibility.get(node.panelId);
    if (v !== undefined) {
      return { ...node, visible: v };
    }
    return node;
  }
  return {
    ...node,
    first: applyVisibility(node.first, visibility),
    second: applyVisibility(node.second, visibility),
  };
}
