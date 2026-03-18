/**
 * Plugin notification bridge — shows toast notifications from plugins.
 *
 * Perry-safe: module-level state, for-loops, no closures on `this`.
 */

import {
  VStack, HStack, Text, Button, Spacer,
  textSetColor, textSetFontSize, textSetFontWeight,
  buttonSetBordered,
  widgetAddChild, widgetSetBackgroundColor, widgetSetWidth,
  widgetSetHidden,
} from 'perry/ui';
import { setFg, setBtnFg } from '../../ui-helpers';

// Notification queue
let notificationContainer: unknown = null;
let activeNotifications: unknown[] = [];
let nextNotifId: number = 1;

// Auto-dismiss timeout (milliseconds)
const DISMISS_TIMEOUT: number = 5000;

/**
 * Set the container widget for notifications (called once during init).
 */
export function setNotificationContainer(container: unknown): void {
  notificationContainer = container;
}

/**
 * Show a notification from a plugin.
 */
export function pluginNotify(
  pluginName: string,
  message: string,
  severity: string,
): void {
  if (notificationContainer === null) return;

  const id = nextNotifId;
  nextNotifId++;

  // Choose color based on severity
  let bgR = 0.2;
  let bgG = 0.2;
  let bgB = 0.2;
  let fgColor = '#CCCCCC';

  if (severity === 'warning') {
    bgR = 0.3; bgG = 0.25; bgB = 0.1;
    fgColor = '#FFCC00';
  }
  if (severity === 'error') {
    bgR = 0.3; bgG = 0.1; bgB = 0.1;
    fgColor = '#FF4444';
  }

  // Build notification widget
  const notif = HStack(8, []);
  widgetSetBackgroundColor(notif, bgR, bgG, bgB, 0.95);

  const msgText = Text(message);
  textSetFontSize(msgText, 13);
  setFg(msgText, fgColor);
  widgetAddChild(notif, msgText);

  widgetAddChild(notif, Spacer());

  const dismissBtn = Button('x', () => { dismissNotification(id); });
  buttonSetBordered(dismissBtn, 0);
  textSetFontSize(dismissBtn, 11);
  setBtnFg(dismissBtn, '#888888');
  widgetAddChild(notif, dismissBtn);

  widgetAddChild(notificationContainer, notif);
  activeNotifications.push(notif);

  // Auto-dismiss after timeout
  setTimeout(() => { dismissNotification(id); }, DISMISS_TIMEOUT);
}

/** Module-level dismiss function. Perry-safe. */
function dismissNotification(id: number): void {
  // Simple: hide the oldest notification
  if (activeNotifications.length > 0) {
    const notif = activeNotifications[0];
    widgetSetHidden(notif, 1);
    activeNotifications.shift();
  }
}
