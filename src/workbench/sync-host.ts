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
let hostRelayUrl = 'wss://sync.hone.codes/ws';
let hostPairingUrl = '';

// Connected guest tracking (max 10 guests)
let guestIds: string[] = [];
let guestNames: string[] = [];
let guestCount: number = 0;

// Event listeners
let _onGuestConnected: (deviceId: string, deviceName: string) => void = _noopGuest;
let _onGuestDisconnected: (deviceId: string) => void = _noopGuestId;
let _onPairingCodeChanged: (code: string) => void = _noopCode;
let _onPairingUrlChanged: (url: string) => void = _noopCode;

function _noopGuest(id: string, name: string): void {}
function _noopGuestId(id: string): void {}
function _noopCode(code: string): void {}

// Pairing code characters (no I, O for readability)
const CODE_CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const HEX_CHARS = '0123456789abcdef';

// --- Public API ---

export function initSyncHost(deviceId: string, deviceName: string): void {
  hostDeviceId = deviceId;
  hostDeviceName = deviceName;
  // Random room ID — opaque, not derived from device identity
  hostRoomId = makeRoomId();
  hostSecret = 'secret_' + deviceId + '_' + Date.now();
  hostActive = 1;
}

export function setHostRelayUrl(url: string): void {
  hostRelayUrl = url;
}

export function getHostRelayUrl(): string {
  return hostRelayUrl;
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

  // Build pairing URL for QR code
  let url = 'hone://pair?relay=';
  url += encodeURIComponent(hostRelayUrl);
  url += '&room=';
  url += encodeURIComponent(hostRoomId);
  url += '&code=';
  url += code;
  hostPairingUrl = url;
  _onPairingUrlChanged(url);

  return code;
}

export function getHostPairingCode(): string {
  if (hostPairingExpiry > 0 && Date.now() > hostPairingExpiry) {
    hostPairingCode = '';
    hostPairingExpiry = 0;
    hostPairingUrl = '';
  }
  return hostPairingCode;
}

export function getHostPairingUrl(): string {
  if (hostPairingExpiry > 0 && Date.now() > hostPairingExpiry) {
    hostPairingCode = '';
    hostPairingExpiry = 0;
    hostPairingUrl = '';
  }
  return hostPairingUrl;
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
  hostPairingUrl = '';
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

export function setOnPairingUrlChanged(fn: (url: string) => void): void {
  _onPairingUrlChanged = fn;
}

// --- Claude Code relay ---

// Claude Code session state for remote guests
let claudeRelayActive: number = 0;
let claudeRelayGuestId = '';

// Event emitter — set by render.ts or whoever wires up the sync system
let _onClaudeRelayRequest: (guestId: string, prompt: string, workspaceRoot: string, resumeId: string) => void = _noopClaudeReq;
let _onClaudeRelayStop: (guestId: string, sessionId: string) => void = _noopClaudeStop;

function _noopClaudeReq(guestId: string, prompt: string, wsRoot: string, resumeId: string): void {}
function _noopClaudeStop(guestId: string, sessionId: string): void {}

export function setOnClaudeRelayRequest(fn: (guestId: string, prompt: string, workspaceRoot: string, resumeId: string) => void): void {
  _onClaudeRelayRequest = fn;
}

export function setOnClaudeRelayStop(fn: (guestId: string, sessionId: string) => void): void {
  _onClaudeRelayStop = fn;
}

/**
 * Handle an ai.claudeSend request from a guest device.
 * Forwards to the registered callback which starts the Claude Code process.
 */
export function handleClaudeSendFromGuest(guestId: string, prompt: string, workspaceRoot: string, resumeId: string): void {
  claudeRelayActive = 1;
  claudeRelayGuestId = guestId;
  _onClaudeRelayRequest(guestId, prompt, workspaceRoot, resumeId);
}

/**
 * Handle an ai.claudeStop request from a guest device.
 */
export function handleClaudeStopFromGuest(guestId: string, sessionId: string): void {
  claudeRelayActive = 0;
  claudeRelayGuestId = '';
  _onClaudeRelayStop(guestId, sessionId);
}

export function isClaudeRelayActive(): number {
  return claudeRelayActive;
}

export function getClaudeRelayGuestId(): string {
  return claudeRelayGuestId;
}

export function clearClaudeRelay(): void {
  claudeRelayActive = 0;
  claudeRelayGuestId = '';
}

// --- Helpers ---

function makeRoomId(): string {
  let id = '';
  for (let i = 0; i < 32; i++) {
    const idx = Math.floor(Math.random() * HEX_CHARS.length);
    id = id + HEX_CHARS[idx];
  }
  let out = '';
  out += id.slice(0, 8);
  out += '-';
  out += id.slice(8, 12);
  out += '-';
  out += id.slice(12, 16);
  out += '-';
  out += id.slice(16, 20);
  out += '-';
  out += id.slice(20, 32);
  return out;
}
