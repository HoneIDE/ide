/**
 * Notifications — floating notification messages.
 */
import {
  VStack, VStackWithInsets, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered,
  widgetAddChild, widgetRemoveChild, widgetSetHidden, widgetSetWidth,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import {
  getNotificationBackground, getNotificationForeground,
  getNotificationErrorBackground, getNotificationWarningBackground, getNotificationInfoBackground,
} from '../../theme/theme-colors';

let notifContainer: unknown = null;
let notifColors: ResolvedUIColors = null as any;
let notifCount: number = 0;

export function initNotifications(container: unknown, colors: ResolvedUIColors): void {
  notifContainer = container;
  notifColors = colors;
}

function removeNotification(widget: unknown): void {
  if (notifContainer) {
    widgetRemoveChild(notifContainer, widget);
    notifCount = notifCount - 1;
  }
}

let pendingDismiss: unknown = null;

function dismissPending(): void {
  if (pendingDismiss && notifContainer) {
    widgetRemoveChild(notifContainer, pendingDismiss);
    notifCount = notifCount - 1;
    pendingDismiss = null;
  }
}

export function showNotification(msg: string, type: string): void {
  if (!notifContainer || !notifColors) return;

  let bgColor = getNotificationBackground();
  if (type === 'error') bgColor = getNotificationErrorBackground();
  if (type === 'warning') bgColor = getNotificationWarningBackground();
  if (type === 'info') bgColor = getNotificationInfoBackground();

  const fgColor = getNotificationForeground();

  const msgText = Text(msg);
  textSetFontSize(msgText, 12);
  setFg(msgText, fgColor);

  const closeBtn = Button('x', () => { dismissPending(); });
  buttonSetBordered(closeBtn, 0);
  textSetFontSize(closeBtn, 10);
  setBtnFg(closeBtn, fgColor);

  const notif = HStack(8, [msgText, Spacer(), closeBtn]);
  setBg(notif, bgColor);
  widgetSetWidth(notif, 300);
  pendingDismiss = notif;

  widgetAddChild(notifContainer, notif);
  notifCount = notifCount + 1;

  // Auto-dismiss after ~3 seconds (Perry setInterval workaround)
  let ticks = 0;
  const intervalId = setInterval(() => {
    ticks = ticks + 1;
    if (ticks >= 188) { // ~3s at 16ms intervals
      clearInterval(intervalId);
      dismissPending();
    }
  }, 16);
}
