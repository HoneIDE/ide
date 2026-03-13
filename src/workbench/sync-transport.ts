/**
 * Sync Transport — WebSocket bridge to relay server.
 *
 * Uses Perry's built-in ws module on all platforms.
 * On iOS, perry-stdlib delegates to native NSURLSessionWebSocketTask internally.
 *
 * All state is module-level (Perry closures capture by value).
 */

import WebSocket from 'ws';
import { sendToClient, closeClient, isOpen, messageCount, receive } from 'ws';

// --- Module-level state ---

let wsHandle: number = 0;
let wsConnected: number = 0;
let wsConnecting: number = 0;
let relayUrl = '';
let relayRoomId = '';
let relayDeviceId = '';
let pollTimerId: number = 0;
let joinSent: number = 0;
let nextHandleGuess: number = 1;
let seqCounter: number = 0;
let pollCount: number = 0;
let keepAliveTimerId: number = 0;
let lastPingSent: number = 0;
let relayToken = '';
let relayLastSeq: number = 0;
let maxMsgsPerPoll: number = 50; // default high for desktop; lower for Android

// Event callbacks
let _onRelayConnected: () => void = _noopVoid;
let _onRelayDisconnected: () => void = _noopVoid;
let _onRelayMessage: (data: string) => void = _noopData;
let _onDebug: (msg: string) => void = _noopData;

function _noopVoid(): void {}
function _noopData(d: string): void {}

// --- Public API ---

export function setRelayToken(token: string): void {
  relayToken = token;
}

export function setRelayLastSeq(seq: number): void {
  relayLastSeq = seq;
}

export function setMaxMessagesPerPoll(n: number): void {
  maxMsgsPerPoll = n;
}

export function connectToRelay(url: string, roomId: string, deviceId: string): void {
  if (wsConnected > 0 || wsConnecting > 0) {
    _onDebug('Already connected/connecting');
    return;
  }

  relayUrl = url;
  relayRoomId = roomId;
  relayDeviceId = deviceId;
  wsConnecting = 1;
  joinSent = 0;
  pollCount = 0;

  let dbg = 'WS connecting to ';
  dbg += url;
  _onDebug(dbg);

  // Use ws module on all platforms (perry-stdlib delegates to native on iOS)
  const wsPromise = new WebSocket(url);
  wsPromise.then((ws: any) => { storeWsHandle(ws); }, (err: any) => { onWsError(err); });
  _onDebug('WS created');

  // Start polling for connection + messages
  if (pollTimerId < 1) {
    pollTimerId = 1;
    setInterval(() => { pollRelay(); }, 200);
  }
}

export function disconnectFromRelay(): void {
  if (wsHandle > 0) {
    closeClient(wsHandle);
  }
  wsHandle = 0;
  wsConnected = 0;
  wsConnecting = 0;
  joinSent = 0;
}

export function sendToRelay(payload: string): void {
  sendToRelayTarget('broadcast', payload);
}

export function sendToRelayTarget(to: string, payload: string): void {
  _onDebug('sendToRelayTarget: wsConn=' + String(wsConnected) + ' handle=' + String(wsHandle) + ' payloadLen=' + String(payload.length));
  if (wsConnected < 1 || wsHandle < 1) return;
  seqCounter = seqCounter + 1;
  let msg = '{"from":"';
  msg += relayDeviceId;
  msg += '","to":"';
  msg += to;
  msg += '","room":"';
  msg += relayRoomId;
  msg += '","seq":';
  msg += String(seqCounter);
  msg += ',"ts":';
  msg += String(Date.now());
  msg += ',"encrypted":false,"payload":"';
  // Check if payload needs escaping (contains " \ \n \r)
  let needsEscape = 0;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    if (ch === 34 || ch === 92 || ch === 10 || ch === 13) {
      needsEscape = 1;
      break;
    }
  }
  if (needsEscape < 1) {
    // Fast path: no escaping needed, direct concat
    msg += payload;
  } else {
    // Slow path: escape character by character
    for (let i = 0; i < payload.length; i++) {
      const ch = payload.charCodeAt(i);
      if (ch === 34) {
        msg += '\\"';
      } else if (ch === 92) {
        msg += '\\\\';
      } else if (ch === 10) {
        msg += '\\n';
      } else if (ch === 13) {
        msg += '\\r';
      } else {
        msg += payload.charAt(i);
      }
    }
  }
  msg += '"}';
  _onDebug('sendToClient msgLen=' + String(msg.length) + ' handle=' + String(wsHandle));
  sendToClient(wsHandle, msg);
  _onDebug('sendToClient DONE');
}

export function isRelayConnected(): number {
  return wsConnected;
}

export function setOnRelayConnected(fn: () => void): void {
  _onRelayConnected = fn;
}

export function setOnRelayDisconnected(fn: () => void): void {
  _onRelayDisconnected = fn;
}

export function setOnRelayMessage(fn: (data: string) => void): void {
  _onRelayMessage = fn;
}

export function setOnTransportDebug(fn: (msg: string) => void): void {
  _onDebug = fn;
}

export function getRelayRoomId(): string {
  return relayRoomId;
}

export function getRelayDeviceId(): string {
  return relayDeviceId;
}

// --- Internal ---

function storeWsHandle(ws: any): void {
  wsHandle = ws as number;
  wsConnected = 1;
  wsConnecting = 0;
  let dbg = 'WS .then() handle=';
  dbg += String(wsHandle);
  _onDebug(dbg);
  onConnectedToRelay();
}

function onWsError(err: any): void {
  wsConnecting = 0;
  let dbg = 'WS ERROR: ';
  dbg += String(err);
  _onDebug(dbg);
}

function pollRelay(): void {
  if (wsConnecting < 1 && wsConnected < 1) return;

  pollCount = pollCount + 1;

  // (poll debug removed — connection works)

  // If we don't have a handle yet, probe sequential IDs
  if (wsHandle < 1 && wsConnecting > 0) {
    for (let probe = nextHandleGuess; probe < nextHandleGuess + 5; probe++) {
      const open = isOpen(probe);
      if (open > 0) {
        wsHandle = probe;
        nextHandleGuess = probe + 1;
        wsConnected = 1;
        wsConnecting = 0;
        let dbg = 'WS probe found handle=';
        dbg += String(probe);
        _onDebug(dbg);
        onConnectedToRelay();
        return;
      }
    }
    return;
  }

  // Check if the .then() gave us a handle and connection just established
  if (wsHandle > 0 && wsConnected < 1 && wsConnecting > 0) {
    const open = isOpen(wsHandle);
    if (open > 0) {
      wsConnected = 1;
      wsConnecting = 0;
      onConnectedToRelay();
      return;
    }
  }

  // Check if still connected
  if (wsConnected > 0 && wsHandle > 0) {
    const open = isOpen(wsHandle);
    if (open < 1) {
      wsConnected = 0;
      _onRelayDisconnected();
      return;
    }

    // Poll for incoming messages (capped to avoid UI thread starvation on Android)
    const count = messageCount(wsHandle);
    const limit = count < maxMsgsPerPoll ? count : maxMsgsPerPoll;
    for (let i = 0; i < limit; i++) {
      const msg = receive(wsHandle);
      if (msg.length > 0) {
        _onRelayMessage(msg);
      }
    }
  }
}

function onConnectedToRelay(): void {
  // Send join message with token + lastSeq for auth + delta catch-up
  if (joinSent < 1) {
    joinSent = 1;
    let msg = '{"join":true,"room":"';
    msg += relayRoomId;
    msg += '","device":"';
    msg += relayDeviceId;
    msg += '"';
    if (relayToken.length > 0) {
      msg += ',"token":"';
      msg += relayToken;
      msg += '"';
    }
    if (relayLastSeq > 0) {
      msg += ',"lastSeq":';
      msg += String(relayLastSeq);
    }
    msg += '}';
    let dbg = 'Sending join: ';
    dbg += msg;
    _onDebug(dbg);
    sendToClient(wsHandle, msg);
  }

  // Start keep-alive ping every 30s to prevent idle disconnect
  if (keepAliveTimerId < 1) {
    keepAliveTimerId = 1;
    setInterval(() => { sendKeepAlive(); }, 30000);
  }

  _onRelayConnected();
}

function sendKeepAlive(): void {
  if (wsConnected < 1 || wsHandle < 1) return;
  sendToClient(wsHandle, '{"type":"ping"}');
}
