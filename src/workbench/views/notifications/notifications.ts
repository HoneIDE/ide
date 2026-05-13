/**
 * Notifications — floating notification toasts.
 *
 * SHIP-V1-GAPS.md #40: each notification owns its own auto-dismiss timer.
 * The old `pendingDismiss` single-slot pattern dropped earlier toasts when a
 * second arrived — replaced with parallel arrays keyed by a monotonic id so
 * multiple toasts can stack and each disappears on its own timeline.
 */
import {
  VStack, VStackWithInsets, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered,
  widgetAddChild, widgetRemoveChild, widgetSetHidden, widgetSetWidth,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import {
  getNotificationBackground, getNotificationForeground,
  getNotificationErrorBackground, getNotificationWarningBackground, getNotificationInfoBackground,
} from '../../theme/theme-colors';

// ---------------------------------------------------------------------------
// Module-level state — Perry closures capture by value, so timer callbacks
// reach into these arrays instead of capturing widget references directly.
// ---------------------------------------------------------------------------

let notifContainer: unknown = null;
let notifColors: ResolvedUIColors = null as any;

// Active toast registry, indexed by a monotonic id. Parallel arrays keep
// Perry happy (no object arrays with mixed widget+number fields).
let _ids: number[] = [];
let _widgets: unknown[] = [];
let _intervals: number[] = [];
let _count: number = 0;
let _nextId: number = 1;
const MAX_TOASTS = 5;

export function initNotifications(container: unknown, colors: ResolvedUIColors): void {
  notifContainer = container;
  notifColors = colors;
}

/** Count of currently-visible toasts (testing helper). */
export function getNotificationCount(): number {
  return _count;
}

/** Programmatic dismissal of every active toast. */
export function clearAllNotifications(): void {
  while (_count > 0) {
    removeAtIndex(0);
  }
}

function findIndexById(id: number): number {
  for (let i = 0; i < _count; i++) {
    if (_ids[i] === id) return i;
  }
  return -1;
}

function removeAtIndex(idx: number): void {
  if (idx < 0 || idx >= _count) return;
  const widget = _widgets[idx];
  const intervalId = _intervals[idx];
  if (intervalId > 0) clearInterval(intervalId);
  if (notifContainer && widget !== null) {
    widgetRemoveChild(notifContainer, widget);
  }
  // Compact arrays.
  for (let i = idx; i < _count - 1; i++) {
    _ids[i] = _ids[i + 1];
    _widgets[i] = _widgets[i + 1];
    _intervals[i] = _intervals[i + 1];
  }
  _count = _count - 1;
}

function dismissById(id: number): void {
  const idx = findIndexById(id);
  if (idx >= 0) removeAtIndex(idx);
}

export function showNotification(msg: string, type: string): void {
  if (!notifContainer || !notifColors) return;
  // Cap stack height — drop the oldest if we'd exceed it so the most recent
  // alert is always visible.
  if (_count >= MAX_TOASTS) {
    removeAtIndex(0);
  }

  let bgColor = getNotificationBackground();
  if (type === 'error') bgColor = getNotificationErrorBackground();
  if (type === 'warning') bgColor = getNotificationWarningBackground();
  if (type === 'info') bgColor = getNotificationInfoBackground();

  const fgColor = getNotificationForeground();

  const id = _nextId;
  _nextId = _nextId + 1;

  const msgText = Text(msg);
  textSetFontSize(msgText, 12);
  setFg(msgText, fgColor);

  // Close button captures `id` by value (Perry rule). dismissById is a
  // module-level function so it reads the live arrays.
  const closeBtn = Button('x', () => { dismissById(id); });
  buttonSetBordered(closeBtn, 0);
  textSetFontSize(closeBtn, 10);
  setBtnFg(closeBtn, fgColor);

  const notif = HStack(8, [msgText, Spacer(), closeBtn]);
  setBg(notif, bgColor);
  widgetSetWidth(notif, 300);

  widgetAddChild(notifContainer, notif);

  // Register the toast before starting its timer so the timer can find it.
  _ids.push(id);
  _widgets.push(notif);
  _intervals.push(0);
  _count = _count + 1;

  // Auto-dismiss after ~3 seconds. Each toast gets its own timer so they
  // disappear on independent timelines.
  let ticks = 0;
  const intervalId = setInterval(() => {
    ticks = ticks + 1;
    if (ticks >= 188) { // ~3s at 16ms intervals
      dismissById(id);
    }
  }, 16);
  // Replace the placeholder 0 with the real interval id.
  const idx = findIndexById(id);
  if (idx >= 0) _intervals[idx] = intervalId;
}
