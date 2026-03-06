/**
 * Sync Guest — mobile/secondary IDE connects as a guest.
 *
 * Sends API requests to the host, maintains offline queue,
 * and flushes on reconnect.
 *
 * All state is module-level (Perry closures capture by value).
 */

// --- Module-level state ---

let guestActive: number = 0;
let guestDeviceId = '';
let guestDeviceName = '';
let guestPlatform = '';
let guestToken = '';
let guestHostUrl = '';
let guestConnected: number = 0;

// Offline queue (pending messages when disconnected)
let offlinePayloads: string[] = [];
let offlineCount: number = 0;
const MAX_OFFLINE = 100;

// Transport send function
let _sendFn: (data: string) => void = _noopData;

// Event listeners
let _onConnected: () => void = _noopVoid;
let _onDisconnected: (reason: string) => void = _noopReason;
let _onMessage: (data: string) => void = _noopData;

function _noopVoid(): void {}
function _noopReason(r: string): void {}
function _noopData(d: string): void {}

// --- Public API ---

export function initSyncGuest(deviceId: string, deviceName: string, platform: string): void {
  guestDeviceId = deviceId;
  guestDeviceName = deviceName;
  guestPlatform = platform;
  guestActive = 1;
}

export function setGuestToken(token: string): void {
  guestToken = token;
}

export function getGuestToken(): string {
  return guestToken;
}

export function setHostUrl(url: string): void {
  guestHostUrl = url;
}

export function getHostUrl(): string {
  return guestHostUrl;
}

export function isGuestConnected(): number {
  return guestConnected;
}

export function isGuestActive(): number {
  return guestActive;
}

export function markConnected(): void {
  guestConnected = 1;
  _onConnected();
  flushOfflineQueue();
}

export function markDisconnected(reason: string): void {
  guestConnected = 0;
  _onDisconnected(reason);
}

// --- Offline queue ---

export function enqueueOffline(payload: string): void {
  if (offlineCount >= MAX_OFFLINE) return;
  offlinePayloads.push(payload);
  offlineCount = offlineCount + 1;
}

export function getOfflineCount(): number {
  return offlineCount;
}

export function flushOfflineQueue(): void {
  if (guestConnected === 0) return;
  for (let i = 0; i < offlineCount; i++) {
    _sendFn(offlinePayloads[i]);
  }
  offlinePayloads = [];
  offlineCount = 0;
}

export function sendOrQueue(payload: string): void {
  if (guestConnected === 1) {
    _sendFn(payload);
  } else {
    enqueueOffline(payload);
  }
}

export function stopSyncGuest(): void {
  guestActive = 0;
  guestConnected = 0;
  offlinePayloads = [];
  offlineCount = 0;
  _sendFn = _noopData;
}

export function getGuestDeviceId(): string {
  return guestDeviceId;
}

// --- Event setters ---

export function setOnConnected(fn: () => void): void {
  _onConnected = fn;
}

export function setOnDisconnected(fn: (reason: string) => void): void {
  _onDisconnected = fn;
}

export function setOnMessage(fn: (data: string) => void): void {
  _onMessage = fn;
}

export function setSendFn(fn: (data: string) => void): void {
  _sendFn = fn;
}
