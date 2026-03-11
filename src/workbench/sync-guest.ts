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
import {
  x25519Keypair, x25519SharedSecret,
  aes256GcmEncrypt, aes256GcmDecrypt,
  randomNonce, hkdfSha256
} from 'crypto';

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

// E2E encryption state
let _projectKey = '';
let _dhSecretKey = '';
let _dhPublicKey = '';

// Sequence tracking
let _lastSeq = 0;

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
    out += 'lastSeq=';
    out += String(_lastSeq);
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
      if (key === 'lastSeq' && val.length > 0) _lastSeq = Number(val);
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

// --- E2E Encryption ---

export function startGuestKeyExchange(): void {
  const keypairJson = x25519Keypair();
  const pkIdx = keypairJson.indexOf('"publicKey":"');
  if (pkIdx >= 0) {
    const pkStart = pkIdx + 13;
    const pkEnd = keypairJson.indexOf('"', pkStart);
    _dhPublicKey = keypairJson.slice(pkStart, pkEnd);
  }
  const skIdx = keypairJson.indexOf('"secretKey":"');
  if (skIdx >= 0) {
    const skStart = skIdx + 13;
    const skEnd = keypairJson.indexOf('"', skStart);
    _dhSecretKey = keypairJson.slice(skStart, skEnd);
  }
}

export function getGuestDhPublicKey(): string {
  return _dhPublicKey;
}

export function receiveProjectKey(theirPublicKey: string, encryptedPayload: string): void {
  // Compute shared secret
  const shared = x25519SharedSecret(_dhSecretKey, theirPublicKey);
  // Derive same encryption key
  const encKey = hkdfSha256(shared, '', 'hone-pairing-key', 32);
  // Parse nonce:encrypted
  const colonIdx = encryptedPayload.indexOf(':');
  if (colonIdx < 0) return;
  const nonce = encryptedPayload.slice(0, colonIdx);
  const encrypted = encryptedPayload.slice(colonIdx + 1);
  _projectKey = aes256GcmDecrypt(encrypted, encKey, nonce);
}

export function getGuestProjectKey(): string {
  return _projectKey;
}

export function setGuestProjectKey(key: string): void {
  _projectKey = key;
}

export function encryptDelta(plaintext: string): string {
  if (_projectKey.length === 0) return plaintext;
  const nonce = randomNonce();
  const encrypted = aes256GcmEncrypt(plaintext, _projectKey, nonce);
  let result = nonce;
  result += ':';
  result += encrypted;
  return result;
}

export function decryptDelta(ciphertext: string): string {
  if (_projectKey.length === 0) return ciphertext;
  const colonIdx = ciphertext.indexOf(':');
  if (colonIdx < 0) return ciphertext;
  const nonce = ciphertext.slice(0, colonIdx);
  const encrypted = ciphertext.slice(colonIdx + 1);
  const decrypted = aes256GcmDecrypt(encrypted, _projectKey, nonce);
  return decrypted;
}

// --- Sequence tracking ---

export function getLastSeq(): number {
  return _lastSeq;
}

export function setLastSeq(seq: number): void {
  _lastSeq = seq;
}

// --- Claude Code relay (guest side) ---

// Callbacks for Claude Code events received from host
let _onClaudeStream: (sessionId: string, delta: string, deltaType: string, toolName: string) => void = _noopClaudeStream;
let _onClaudeResult: (sessionId: string, result: string, costUsd: number, numTurns: number) => void = _noopClaudeResult;
let _onClaudeError: (sessionId: string, error: string) => void = _noopClaudeError;

function _noopClaudeStream(sessionId: string, delta: string, deltaType: string, toolName: string): void {}
function _noopClaudeResult(sessionId: string, result: string, costUsd: number, numTurns: number): void {}
function _noopClaudeError(sessionId: string, error: string): void {}

export function setOnClaudeStream(fn: (sessionId: string, delta: string, deltaType: string, toolName: string) => void): void {
  _onClaudeStream = fn;
}

export function setOnClaudeResult(fn: (sessionId: string, result: string, costUsd: number, numTurns: number) => void): void {
  _onClaudeResult = fn;
}

export function setOnClaudeError(fn: (sessionId: string, error: string) => void): void {
  _onClaudeError = fn;
}

/**
 * Send a Claude Code prompt request to the host via relay.
 * Wraps in the standard ApiMessage envelope format.
 */
export function sendClaudeRequest(prompt: string, workspaceRoot: string, resumeSessionId: string): void {
  let payload = '{"domain":"ai","operation":"claudeSend","payload":{"prompt":"';
  payload += jsonEscapeSync(prompt);
  payload += '","workspaceRoot":"';
  payload += jsonEscapeSync(workspaceRoot);
  payload += '"';
  if (resumeSessionId.length > 0) {
    payload += ',"resumeSessionId":"';
    payload += jsonEscapeSync(resumeSessionId);
    payload += '"';
  }
  payload += '},"id":"';
  payload += generateMsgId();
  payload += '"}';
  sendOrQueue(payload);
}

/**
 * Send a Claude Code stop request to the host via relay.
 */
export function sendClaudeStop(sessionId: string): void {
  let payload = '{"domain":"ai","operation":"claudeStop","payload":{"sessionId":"';
  payload += jsonEscapeSync(sessionId);
  payload += '"},"id":"';
  payload += generateMsgId();
  payload += '"}';
  sendOrQueue(payload);
}

/**
 * Process an incoming Claude Code event from host (called by message dispatcher).
 */
export function processClaudeRelayEvent(operation: string, data: string): void {
  // Inline JSON extraction using charCodeAt (Perry-safe)
  // Operations: claudeStream, claudeResult, claudeError

  // claudeStream: charCodeAt(6) === 83 'S'
  if (operation.length === 12 && operation.charCodeAt(6) === 83) {
    const sessionId = extractSyncField(data, 'sessionId');
    const delta = extractSyncField(data, 'delta');
    const deltaType = extractSyncField(data, 'deltaType');
    const toolName = extractSyncField(data, 'toolName');
    _onClaudeStream(sessionId, delta, deltaType, toolName);
    return;
  }
  // claudeResult: charCodeAt(6) === 82 'R'
  if (operation.length === 12 && operation.charCodeAt(6) === 82) {
    const sessionId = extractSyncField(data, 'sessionId');
    const result = extractSyncField(data, 'result');
    const costStr = extractSyncField(data, 'costUsd');
    const turnsStr = extractSyncField(data, 'numTurns');
    let cost = -1;
    let turns = -1;
    if (costStr.length > 0) cost = Number(costStr);
    if (turnsStr.length > 0) turns = Number(turnsStr);
    _onClaudeResult(sessionId, result, cost, turns);
    return;
  }
  // claudeError: charCodeAt(6) === 69 'E'
  if (operation.length === 11 && operation.charCodeAt(6) === 69) {
    const sessionId = extractSyncField(data, 'sessionId');
    const error = extractSyncField(data, 'error');
    _onClaudeError(sessionId, error);
    return;
  }
}

/** Simple JSON string escape for sync payloads. */
function jsonEscapeSync(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 92) { result += '\\\\'; }
    else if (ch === 34) { result += '\\"'; }
    else if (ch === 10) { result += '\\n'; }
    else if (ch === 13) { result += '\\r'; }
    else if (ch === 9) { result += '\\t'; }
    else { result += s.slice(i, i + 1); }
  }
  return result;
}

/** Extract a JSON string field from a payload string. Perry-safe charCodeAt scanning. */
function extractSyncField(json: string, key: string): string {
  let pattern = '"';
  pattern += key;
  pattern += '"';

  let pos = -1;
  for (let i = 0; i <= json.length - pattern.length; i++) {
    let match: number = 1;
    for (let j = 0; j < pattern.length; j++) {
      if (json.charCodeAt(i + j) !== pattern.charCodeAt(j)) {
        match = 0;
        break;
      }
    }
    if (match > 0) { pos = i; break; }
  }
  if (pos < 0) return '';

  let afterKey = pos + pattern.length;
  // Skip whitespace + colon + whitespace
  while (afterKey < json.length && (json.charCodeAt(afterKey) === 32 || json.charCodeAt(afterKey) === 9)) afterKey += 1;
  if (afterKey >= json.length || json.charCodeAt(afterKey) !== 58) return '';
  afterKey += 1;
  while (afterKey < json.length && (json.charCodeAt(afterKey) === 32 || json.charCodeAt(afterKey) === 9)) afterKey += 1;
  if (afterKey >= json.length || json.charCodeAt(afterKey) !== 34) return '';
  afterKey += 1;

  let result = '';
  while (afterKey < json.length) {
    const ch = json.charCodeAt(afterKey);
    if (ch === 92) {
      afterKey += 1;
      if (afterKey < json.length) {
        const next = json.charCodeAt(afterKey);
        if (next === 110) { result += '\n'; }
        else if (next === 116) { result += '\t'; }
        else if (next === 34) { result += '"'; }
        else if (next === 92) { result += '\\'; }
        else { result += json.slice(afterKey, afterKey + 1); }
      }
    } else if (ch === 34) {
      break;
    } else {
      result += json.slice(afterKey, afterKey + 1);
    }
    afterKey += 1;
  }
  return result;
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
