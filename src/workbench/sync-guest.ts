/**
 * Sync Guest — mobile/secondary IDE connects as a guest.
 *
 * Sends API requests to the host, maintains offline queue,
 * and flushes on reconnect. Persists connection info to disk
 * for automatic reconnection.
 *
 * All state is module-level (Perry closures capture by value).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { getHomeDir, getAppDataDir } from './paths';

// --- Module-level state ---

let guestActive: number = 0;
let guestDeviceId = '';
let guestDeviceName = '';
let guestPlatform = '';
let guestToken = '';
let guestHostUrl = '';
let guestRoomId = '';
let guestRelayUrl = 'wss://sync.hone.codes/ws';
let guestConnected: number = 0;

// Auto-reconnect state
let reconnectEnabled: number = 0;
let reconnectAttempts: number = 0;
let maxReconnectAttempts: number = 10;
let reconnectBaseDelay: number = 1000; // 1s, doubles each attempt

// Offline queue (pending messages when disconnected)
let offlinePayloads: string[] = [];
let offlineCount: number = 0;
const MAX_OFFLINE = 100;

// Message ID counter for deduplication
let msgIdCounter: number = 0;

// Transport send function
let _sendFn: (data: string) => void = _noopData;

// Event listeners
let _onConnected: () => void = _noopVoid;
let _onDisconnected: (reason: string) => void = _noopReason;
let _onMessage: (data: string) => void = _noopData;
let _onReconnecting: (attempt: number) => void = _noopAttempt;
let _onQueueWarning: (count: number, max: number) => void = _noopAttempt2;
let _onQueueFull: (count: number, max: number) => void = _noopAttempt2;

// App lifecycle state (background/foreground)
let appInBackground: number = 0;
let foregroundReconnectPending: number = 0;

function _noopVoid(): void {}
function _noopReason(r: string): void {}
function _noopData(d: string): void {}
function _noopAttempt(n: number): void {}
function _noopAttempt2(count: number, max: number): void {}

// --- Persistence ---

function getSyncPath(): string {
  let p = getAppDataDir();
  p += '/sync-connection.ini';
  return p;
}

function ensureHoneDir(): void {
  // getAppDataDir() already creates ~/.hone/ if needed
  getAppDataDir();
}

function persistConnection(): void {
  if (guestRoomId.length === 0) return;
  try {
    ensureHoneDir();
    let out = '';
    out += 'relayUrl=';
    out += guestRelayUrl;
    out += '\n';
    out += 'roomId=';
    out += guestRoomId;
    out += '\n';
    out += 'token=';
    out += guestToken;
    out += '\n';
    out += 'hostUrl=';
    out += guestHostUrl;
    out += '\n';
    out += 'deviceId=';
    out += guestDeviceId;
    out += '\n';
    out += 'deviceName=';
    out += guestDeviceName;
    out += '\n';
    out += 'platform=';
    out += guestPlatform;
    out += '\n';
    writeFileSync(getSyncPath(), out);
  } catch (e: any) { /* ignore */ }
}

function loadStoredConnection(): number {
  try {
    const path = getSyncPath();
    if (!existsSync(path)) return 0;
    const text = readFileSync(path);
    if (text.length < 10) return 0;

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length < 3) continue;
      let eqIdx = -1;
      for (let j = 0; j < line.length; j++) {
        if (line.charCodeAt(j) === 61) { eqIdx = j; break; }
      }
      if (eqIdx < 1) continue;
      const key = line.slice(0, eqIdx);
      const val = line.slice(eqIdx + 1);
      if (key === 'relayUrl') guestRelayUrl = val;
      if (key === 'roomId') guestRoomId = val;
      if (key === 'token') guestToken = val;
      if (key === 'hostUrl') guestHostUrl = val;
      if (key === 'deviceId') guestDeviceId = val;
      if (key === 'deviceName') guestDeviceName = val;
      if (key === 'platform') guestPlatform = val;
    }

    return (guestRoomId.length > 0 && guestRelayUrl.length > 0) ? 1 : 0;
  } catch (e: any) {
    return 0;
  }
}

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

export function setGuestRoomId(roomId: string): void {
  guestRoomId = roomId;
}

export function getGuestRoomId(): string {
  return guestRoomId;
}

export function setGuestRelayUrl(url: string): void {
  guestRelayUrl = url;
}

export function getGuestRelayUrl(): string {
  return guestRelayUrl;
}

export function isGuestConnected(): number {
  return guestConnected;
}

export function isGuestActive(): number {
  return guestActive;
}

/** Check if we have a stored connection that can be auto-reconnected. */
export function hasStoredConnection(): number {
  return loadStoredConnection();
}

/** Store current connection info for future auto-reconnect. */
export function saveConnection(): void {
  persistConnection();
}

/** Clear stored connection (unpair). */
export function clearStoredConnection(): void {
  guestRoomId = '';
  guestToken = '';
  guestRelayUrl = 'wss://sync.hone.codes/ws';
  guestHostUrl = '';
  try {
    const path = getSyncPath();
    if (existsSync(path)) {
      writeFileSync(path, '');
    }
  } catch (e: any) { /* ignore */ }
}

export function markConnected(): void {
  guestConnected = 1;
  reconnectAttempts = 0;
  _onConnected();
  flushOfflineQueue();
}

export function markDisconnected(reason: string): void {
  guestConnected = 0;
  _onDisconnected(reason);
}

// --- Auto-reconnect ---

export function setReconnectEnabled(enabled: number): void {
  reconnectEnabled = enabled;
}

export function getReconnectAttempts(): number {
  return reconnectAttempts;
}

/** Calculate the next reconnect delay (exponential backoff with jitter). */
export function getReconnectDelay(): number {
  let delay = reconnectBaseDelay;
  for (let i = 0; i < reconnectAttempts; i++) {
    delay = delay * 2;
    if (delay > 30000) { delay = 30000; break; } // cap at 30s
  }
  // Add jitter: ±25%
  const jitter = delay * 0.25;
  const offset = Math.random() * jitter * 2 - jitter;
  return Math.floor(delay + offset);
}

/** Should we attempt reconnection? */
export function shouldReconnect(): number {
  if (reconnectEnabled === 0) return 0;
  if (guestActive === 0) return 0;
  if (guestConnected === 1) return 0;
  if (reconnectAttempts >= maxReconnectAttempts) return 0;
  if (guestRoomId.length === 0) return 0;
  return 1;
}

/** Mark a reconnect attempt. */
export function markReconnectAttempt(): void {
  reconnectAttempts = reconnectAttempts + 1;
  _onReconnecting(reconnectAttempts);
}

/** Reset reconnect counter (call after successful connect). */
export function resetReconnectAttempts(): void {
  reconnectAttempts = 0;
}

// --- Offline queue ---

const QUEUE_WARNING_THRESHOLD = 90;

export function enqueueOffline(payload: string): void {
  if (offlineCount >= MAX_OFFLINE) {
    _onQueueFull(offlineCount, MAX_OFFLINE);
    return;
  }
  offlinePayloads.push(payload);
  offlineCount = offlineCount + 1;
  // Warn when approaching capacity
  if (offlineCount >= QUEUE_WARNING_THRESHOLD) {
    _onQueueWarning(offlineCount, MAX_OFFLINE);
  }
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
  reconnectEnabled = 0;
  reconnectAttempts = 0;
  offlinePayloads = [];
  offlineCount = 0;
  _sendFn = _noopData;
}

export function getGuestDeviceId(): string {
  return guestDeviceId;
}

/** Generate a unique message ID for deduplication (deviceId + counter). */
export function generateMsgId(): string {
  msgIdCounter = msgIdCounter + 1;
  let id = guestDeviceId;
  id += ':';
  id += String(Date.now());
  id += ':';
  id += String(msgIdCounter);
  return id;
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

export function setOnReconnecting(fn: (attempt: number) => void): void {
  _onReconnecting = fn;
}

export function setOnQueueWarning(fn: (count: number, max: number) => void): void {
  _onQueueWarning = fn;
}

export function setOnQueueFull(fn: (count: number, max: number) => void): void {
  _onQueueFull = fn;
}

// --- App lifecycle (background/foreground) ---

/** Call when app enters background (iOS/Android). Gracefully closes connection. */
export function onAppBackground(): void {
  appInBackground = 1;
  if (guestConnected === 1) {
    markDisconnected('app_background');
  }
}

/** Call when app returns to foreground. Triggers immediate reconnect (no backoff). */
export function onAppForeground(): void {
  appInBackground = 0;
  if (guestActive === 1 && guestConnected === 0 && guestRoomId.length > 0) {
    // Reset backoff for immediate reconnect
    reconnectAttempts = 0;
    foregroundReconnectPending = 1;
    _onReconnecting(0);
  }
}

/** Check if a foreground reconnect is pending (caller should initiate connect). */
export function consumeForegroundReconnect(): number {
  if (foregroundReconnectPending > 0) {
    foregroundReconnectPending = 0;
    return 1;
  }
  return 0;
}

/** Whether the app is currently in background. */
export function isAppInBackground(): number {
  return appInBackground;
}
