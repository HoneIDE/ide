/**
 * Sync Host — desktop IDE runs as the sync host.
 *
 * Accepts guest connections (LAN or via relay), handles pairing,
 * routes API messages to the SDK router, and forwards events.
 *
 * All state is module-level (Perry closures capture by value).
 */

// --- Module-level state ---

let hostActive: number = 0;
let hostDeviceId = '';
let hostDeviceName = '';
let hostRoomId = '';
let hostSecret = '';
let hostPairingCode = '';
let hostPairingExpiry: number = 0;

// Connected guest tracking (max 10 guests)
let guestIds: string[] = [];
let guestNames: string[] = [];
let guestCount: number = 0;

// Event listeners
let _onGuestConnected: (deviceId: string, deviceName: string) => void = _noopGuest;
let _onGuestDisconnected: (deviceId: string) => void = _noopGuestId;
let _onPairingCodeChanged: (code: string) => void = _noopCode;

function _noopGuest(id: string, name: string): void {}
function _noopGuestId(id: string): void {}
function _noopCode(code: string): void {}

// Pairing code characters (no I, O for readability)
const CODE_CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

// --- Public API ---

export function initSyncHost(deviceId: string, deviceName: string): void {
  hostDeviceId = deviceId;
  hostDeviceName = deviceName;
  hostRoomId = deviceId; // Use device ID as room
  hostSecret = 'secret_' + deviceId + '_' + Date.now();
  hostActive = 1;
}

export function generateHostPairingCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    const idx = Math.floor(Math.random() * CODE_CHARS.length);
    code = code + CODE_CHARS[idx];
  }
  hostPairingCode = code;
  hostPairingExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes
  _onPairingCodeChanged(code);
  return code;
}

export function getHostPairingCode(): string {
  if (hostPairingExpiry > 0 && Date.now() > hostPairingExpiry) {
    hostPairingCode = '';
    hostPairingExpiry = 0;
  }
  return hostPairingCode;
}

export function isPairingCodeValid(): number {
  if (hostPairingCode.length === 0) return 0;
  if (Date.now() > hostPairingExpiry) return 0;
  return 1;
}

export function validatePairingAttempt(code: string): number {
  if (isPairingCodeValid() === 0) return 0;
  if (code.toUpperCase() !== hostPairingCode) return 0;
  // Mark as used
  hostPairingCode = '';
  hostPairingExpiry = 0;
  return 1;
}

export function addGuest(deviceId: string, deviceName: string): void {
  if (guestCount >= 10) return;
  guestIds.push(deviceId);
  guestNames.push(deviceName);
  guestCount = guestCount + 1;
  _onGuestConnected(deviceId, deviceName);
}

export function removeGuest(deviceId: string): void {
  for (let i = 0; i < guestCount; i++) {
    if (guestIds[i] === deviceId) {
      guestIds.splice(i, 1);
      guestNames.splice(i, 1);
      guestCount = guestCount - 1;
      _onGuestDisconnected(deviceId);
      return;
    }
  }
}

export function getGuestCount(): number {
  return guestCount;
}

export function getGuestIds(): string[] {
  return guestIds.slice();
}

export function getGuestNames(): string[] {
  return guestNames.slice();
}

export function isHostActive(): number {
  return hostActive;
}

export function getHostDeviceId(): string {
  return hostDeviceId;
}

export function getHostRoomId(): string {
  return hostRoomId;
}

export function stopSyncHost(): void {
  hostActive = 0;
  guestIds = [];
  guestNames = [];
  guestCount = 0;
}

// --- Event setters ---

export function setOnGuestConnected(fn: (deviceId: string, deviceName: string) => void): void {
  _onGuestConnected = fn;
}

export function setOnGuestDisconnected(fn: (deviceId: string) => void): void {
  _onGuestDisconnected = fn;
}

export function setOnPairingCodeChanged(fn: (code: string) => void): void {
  _onPairingCodeChanged = fn;
}
