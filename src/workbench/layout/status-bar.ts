/**
 * Status bar — bottom information strip.
 *
 * Desktop / tablet: full status bar with left, center, and right segments.
 *   Left: branch name, sync status, errors/warnings count
 *   Center: (optional) progress indicator
 *   Right: cursor position (Ln:Col), language, encoding, indentation, AI model
 *
 * Phone: thin single-line strip showing only the most critical info
 *   (language, Ln:Col). Tap to expand to full status bar as a popup.
 */

import type { LayoutMode } from '../../platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatusBarAlignment = 'left' | 'center' | 'right';

export interface StatusBarEntry {
  /** Unique identifier. */
  id: string;
  /** Display text (may include icons via icon font codes). */
  text: string;
  /** Tooltip on hover / long-press. */
  tooltip: string;
  alignment: StatusBarAlignment;
  /** Priority within its alignment group. Higher = closer to the edge. */
  priority: number;
  /** Command to execute when clicked/tapped. */
  command: string | null;
  /** Whether this entry is visible. */
  visible: boolean;
  /** Background color override (e.g. for error indicators). */
  backgroundColor: string | null;
  /** Foreground color override. */
  color: string | null;
  /**
   * Whether to show this entry on compact (phone) layout.
   * Most entries are hidden on phone to save space.
   */
  showInCompact: boolean;
}

export interface StatusBarLayout {
  height: number;
  entries: StatusBarEntry[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const _entries: Map<string, StatusBarEntry> = new Map();
const _listeners: Set<() => void> = new Set();

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function createStatusBarEntry(
  id: string,
  options: Partial<Omit<StatusBarEntry, 'id'>> & { alignment: StatusBarAlignment },
): StatusBarEntry {
  const entry: StatusBarEntry = {
    id,
    text: options.text ?? '',
    tooltip: options.tooltip ?? '',
    alignment: options.alignment,
    priority: options.priority ?? 0,
    command: options.command ?? null,
    visible: options.visible ?? true,
    backgroundColor: options.backgroundColor ?? null,
    color: options.color ?? null,
    showInCompact: options.showInCompact ?? false,
  };
  _entries.set(id, entry);
  notifyListeners();
  return entry;
}

export function updateStatusBarEntry(id: string, updates: Partial<Omit<StatusBarEntry, 'id'>>): void {
  const entry = _entries.get(id);
  if (!entry) return;
  Object.assign(entry, updates);
  notifyListeners();
}

export function removeStatusBarEntry(id: string): void {
  _entries.delete(id);
  notifyListeners();
}

export function getStatusBarLayout(layoutMode: LayoutMode): StatusBarLayout {
  const isCompact = layoutMode === 'compact';
  const height = isCompact ? 24 : 28;

  let entries = Array.from(_entries.values()).filter(e => e.visible);

  if (isCompact) {
    entries = entries.filter(e => e.showInCompact);
  }

  // Sort: within each alignment, higher priority = closer to the edge
  entries.sort((a, b) => {
    if (a.alignment !== b.alignment) {
      const order = { left: 0, center: 1, right: 2 };
      return order[a.alignment] - order[b.alignment];
    }
    // For left alignment, higher priority = further left (closer to edge)
    // For right alignment, higher priority = further right (closer to edge)
    return b.priority - a.priority;
  });

  return { height, entries };
}

export function getAllEntries(): StatusBarEntry[] {
  return Array.from(_entries.values());
}

/** Clear all entries. Used in tests. */
export function clearStatusBar(): void {
  _entries.clear();
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------

export function onStatusBarChange(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

function notifyListeners(): void {
  for (const fn of _listeners) fn();
}
