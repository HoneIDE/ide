/**
 * Sync panel — main sync UI in sidebar.
 *
 * Shows QR code for pairing (primary), fallback text code,
 * connection status, and connected devices list.
 *
 * "Scan once, synced forever" — QR encodes relay URL + room ID + pairing code.
 *
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, Text, Button, Spacer,
  QRCode, qrCodeSetData,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString, textSetColor,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetClearChildren,
  widgetSetBackgroundColor, widgetSetWidth, widgetSetHeight,
  widgetSetHidden,
} from 'perry/ui';
import { setFg, setBtnFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import {
  isHostActive, generateHostPairingCode, getHostPairingCode,
  getHostPairingUrl, getGuestCount, getGuestNames,
} from '../../sync-host';

// --- Module-level state ---

let syncPanelReady: number = 0;
let syncContainer: unknown = null;
let syncStatusLabel: unknown = null;
let syncCodeLabel: unknown = null;
let syncQrWidget: unknown = null;
let syncQrContainer: unknown = null;
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

  // QR code — initially hidden, shown when code is generated
  syncQrWidget = QRCode('placeholder', 180);
  widgetSetHidden(syncQrWidget, 1);

  // Fallback text code display
  syncCodeLabel = Text('');
  textSetFontSize(syncCodeLabel, 24);
  textSetFontWeight(syncCodeLabel, 700);
  textSetFontFamily(syncCodeLabel, 'Menlo');
  setFg(syncCodeLabel, colors.sidebarForeground);

  // Instruction text (shown with QR)
  const instrLabel = Text('Scan with Hone on your phone');
  textSetFontSize(instrLabel, 11);
  textSetColor(instrLabel, 0.5, 0.5, 0.5, 1.0);

  // QR container groups QR + instruction + fallback code
  syncQrContainer = VStack(6, [syncQrWidget, instrLabel, syncCodeLabel]);
  widgetSetHidden(syncQrContainer, 1);

  // Generate code button
  const genBtn = Button('Pair Device', () => {
    generatePairingCodeAction();
  });
  buttonSetBordered(genBtn, 0);
  setBtnFg(genBtn, colors.buttonForeground);

  // Devices area
  syncContainer = VStack(4, []);

  const panel = VStack(8, [
    title,
    syncStatusLabel,
    syncQrContainer,
    genBtn,
    syncContainer,
  ]);

  syncPanelReady = 1;
  return panel;
}

function generatePairingCodeAction(): void {
  const code = generateHostPairingCode();

  // Update text code (fallback)
  if (syncCodeLabel) {
    textSetString(syncCodeLabel, code);
  }

  // Update QR code with the full pairing URL
  const url = getHostPairingUrl();
  if (syncQrWidget && url.length > 0) {
    qrCodeSetData(syncQrWidget, url);
    widgetSetHidden(syncQrWidget, 0);
  }

  // Show QR container
  if (syncQrContainer) {
    widgetSetHidden(syncQrContainer, 0);
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
      const dot = Text('  \u2022 ');
      textSetFontSize(dot, 12);
      textSetColor(dot, 0.3, 0.8, 0.3, 1.0); // green dot

      const deviceLabel = Text(names[i]);
      textSetFontSize(deviceLabel, 12);
      if (panelColors) setFg(deviceLabel, panelColors.sidebarForeground);

      const row = HStack(2, [dot, deviceLabel]);
      widgetAddChild(syncContainer, row);
    }
  }

  // Update status
  if (syncStatusLabel) {
    if (isHostActive() === 1) {
      if (count > 0) {
        textSetString(syncStatusLabel, count + ' device(s) connected');
        // Hide QR when paired
        if (syncQrContainer) {
          widgetSetHidden(syncQrContainer, 1);
        }
      } else {
        const code = getHostPairingCode();
        if (code.length > 0) {
          textSetString(syncStatusLabel, 'Waiting for connection...');
        } else {
          textSetString(syncStatusLabel, 'Ready to pair');
        }
      }
    } else {
      textSetString(syncStatusLabel, 'Not connected');
    }
  }
}
