/**
 * Device list — shows paired/connected devices in the sync panel.
 *
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight,
  textSetString, textSetColor,
  buttonSetBordered,
  widgetAddChild, widgetClearChildren,
  widgetSetWidth,
} from 'perry/ui';
import { setFg, setBtnFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

// --- Module-level state ---

let deviceListContainer: unknown = null;
let deviceListColors: ResolvedUIColors = null as any;

// Device data (parallel arrays — Perry-safe)
let deviceIds: string[] = [];
let deviceNames: string[] = [];
let devicePlatforms: string[] = [];
let deviceStatuses: string[] = [];  // 'connected' | 'paired' | 'offline'
let deviceCount: number = 0;

// --- Public API ---

export function buildDeviceList(colors: ResolvedUIColors): unknown {
  deviceListColors = colors;
  deviceListContainer = VStack(4, []);
  return deviceListContainer;
}

export function setDeviceListColors(colors: ResolvedUIColors): void {
  deviceListColors = colors;
}

export function addDevice(id: string, name: string, platform: string, status: string): void {
  // Check if already exists
  for (let i = 0; i < deviceCount; i++) {
    if (deviceIds[i] === id) {
      deviceStatuses[i] = status;
      refreshDeviceList();
      return;
    }
  }
  deviceIds.push(id);
  deviceNames.push(name);
  devicePlatforms.push(platform);
  deviceStatuses.push(status);
  deviceCount = deviceCount + 1;
  refreshDeviceList();
}

export function removeDevice(id: string): void {
  for (let i = 0; i < deviceCount; i++) {
    if (deviceIds[i] === id) {
      deviceIds.splice(i, 1);
      deviceNames.splice(i, 1);
      devicePlatforms.splice(i, 1);
      deviceStatuses.splice(i, 1);
      deviceCount = deviceCount - 1;
      refreshDeviceList();
      return;
    }
  }
}

export function updateDeviceStatus(id: string, status: string): void {
  for (let i = 0; i < deviceCount; i++) {
    if (deviceIds[i] === id) {
      deviceStatuses[i] = status;
      refreshDeviceList();
      return;
    }
  }
}

export function getDeviceCount(): number {
  return deviceCount;
}

function refreshDeviceList(): void {
  if (!deviceListContainer) return;
  widgetClearChildren(deviceListContainer);

  for (let i = 0; i < deviceCount; i++) {
    const row = buildDeviceRow(deviceNames[i], devicePlatforms[i], deviceStatuses[i]);
    widgetAddChild(deviceListContainer, row);
  }
}

function buildDeviceRow(name: string, platform: string, status: string): unknown {
  const nameLabel = Text(name);
  textSetFontSize(nameLabel, 12);
  if (deviceListColors) setFg(nameLabel, deviceListColors.sideBarForeground);

  const platformLabel = Text(platform);
  textSetFontSize(platformLabel, 10);
  if (deviceListColors) textSetColor(platformLabel, 0.5, 0.5, 0.5, 1.0);

  const statusLabel = Text(status);
  textSetFontSize(statusLabel, 10);
  if (status === 'connected') {
    textSetColor(statusLabel, 0.3, 0.8, 0.3, 1.0); // green
  } else if (status === 'offline') {
    textSetColor(statusLabel, 0.5, 0.5, 0.5, 1.0); // gray
  } else {
    if (deviceListColors) setFg(statusLabel, deviceListColors.sideBarForeground);
  }

  const row = HStack(8, [nameLabel, platformLabel, Spacer(), statusLabel]);
  return row;
}
