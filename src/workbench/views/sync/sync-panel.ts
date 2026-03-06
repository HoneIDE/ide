/**
 * Sync panel — main sync UI in sidebar.
 *
 * Shows connection status, pairing code (host) or connection entry (guest),
 * and connected devices list.
 *
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, Text, Button, Spacer,
  TextField,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString, textSetColor,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetClearChildren,
  widgetSetBackgroundColor, widgetSetWidth,
} from 'perry/ui';
import { setFg, setBtnFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import {
  isHostActive, generateHostPairingCode, getHostPairingCode,
  getGuestCount, getGuestNames,
} from '../../sync-host';

// --- Module-level state ---

let syncPanelReady: number = 0;
let syncContainer: unknown = null;
let syncStatusLabel: unknown = null;
let syncCodeLabel: unknown = null;
let panelColors: ResolvedUIColors = null as any;

// --- Public API ---

export function setSyncPanelColors(colors: ResolvedUIColors): void {
  panelColors = colors;
}

export function buildSyncPanel(colors: ResolvedUIColors): unknown {
  panelColors = colors;

  // Title
  const title = Text('Sync');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 600);
  setFg(title, colors.sidebarForeground);

  // Status
  syncStatusLabel = Text('Not connected');
  textSetFontSize(syncStatusLabel, 12);
  setFg(syncStatusLabel, colors.sidebarForeground);

  // Pairing code display
  syncCodeLabel = Text('');
  textSetFontSize(syncCodeLabel, 24);
  textSetFontWeight(syncCodeLabel, 700);
  textSetFontFamily(syncCodeLabel, 'Menlo');
  setFg(syncCodeLabel, colors.sidebarForeground);

  // Generate code button
  const genBtn = Button('Generate Pairing Code', () => {
    generatePairingCodeAction();
  });
  buttonSetBordered(genBtn, 0);
  setBtnFg(genBtn, colors.buttonForeground);

  // Results area for devices
  syncContainer = VStack(4, []);

  const panel = VStack(8, [
    title,
    syncStatusLabel,
    syncCodeLabel,
    genBtn,
    syncContainer,
  ]);

  syncPanelReady = 1;
  return panel;
}

function generatePairingCodeAction(): void {
  const code = generateHostPairingCode();
  if (syncCodeLabel) {
    textSetString(syncCodeLabel, code);
  }
  if (syncStatusLabel) {
    textSetString(syncStatusLabel, 'Waiting for connection...');
  }
}

export function refreshSyncPanel(): void {
  if (syncPanelReady === 0) return;
  if (!syncContainer) return;

  widgetClearChildren(syncContainer);

  // Show connected devices
  const count = getGuestCount();
  if (count > 0) {
    const header = Text('Connected Devices');
    textSetFontSize(header, 11);
    textSetFontWeight(header, 600);
    if (panelColors) setFg(header, panelColors.sidebarForeground);
    widgetAddChild(syncContainer, header);

    const names = getGuestNames();
    for (let i = 0; i < count; i++) {
      const deviceLabel = Text(names[i]);
      textSetFontSize(deviceLabel, 12);
      if (panelColors) setFg(deviceLabel, panelColors.sidebarForeground);
      widgetAddChild(syncContainer, deviceLabel);
    }
  }

  // Update status
  if (syncStatusLabel) {
    if (isHostActive() === 1) {
      if (count > 0) {
        textSetString(syncStatusLabel, count + ' device(s) connected');
      } else {
        const code = getHostPairingCode();
        if (code.length > 0) {
          textSetString(syncStatusLabel, 'Waiting for connection...');
        } else {
          textSetString(syncStatusLabel, 'Host active — generate a code to pair');
        }
      }
    } else {
      textSetString(syncStatusLabel, 'Not connected');
    }
  }
}
