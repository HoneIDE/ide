/**
 * Relay envelope construction — the single point where sync decides whether a
 * payload goes out encrypted.
 *
 * Split out of sync-transport.ts so this decision is testable. sync-transport
 * imports Perry's `ws` module (sendToClient/isOpen/receive — Perry extensions
 * that npm's `ws` doesn't export), so it cannot be imported under `bun test` at
 * all. That meant the one security property that actually matters — "payloads
 * leave this device as ciphertext" — had no test, which is exactly how sync
 * shipped as a plaintext pass-through while claiming E2E encryption
 * (AUDIT-2026-07.md H1).
 *
 * Keep this file free of `ws`/FFI imports so it stays testable.
 */

/**
 * Pairing handshake messages bootstrap the project key, so they are the one
 * category that legitimately ships cleartext. Everything else must be encrypted
 * once the key exchange has completed.
 *
 * Anchored with indexOf(...) === 0 rather than a substring search: a payload
 * that merely *contains* "PAIR_REQ|" further in must not win the exemption.
 */
export function isPairingHandshake(payload: string): number {
  if (payload.length < 7) return 0;
  if (payload.indexOf('PAIR_REQ|') === 0) return 1;
  if (payload.indexOf('PAIR_OK|') === 0) return 1;
  if (payload.indexOf('PAIR_NO|') === 0) return 1;
  return 0;
}

/** JSON-escape the payload for embedding in the envelope string. */
function escapePayload(txPayload: string): string {
  let needsEscape = 0;
  for (let i = 0; i < txPayload.length; i++) {
    const ch = txPayload.charCodeAt(i);
    if (ch === 34 || ch === 92 || ch === 10 || ch === 13) {
      needsEscape = 1;
      break;
    }
  }
  if (needsEscape < 1) return txPayload;

  let out = '';
  for (let i = 0; i < txPayload.length; i++) {
    const ch = txPayload.charCodeAt(i);
    if (ch === 34) {
      out += '\\"';
    } else if (ch === 92) {
      out += '\\\\';
    } else if (ch === 10) {
      out += '\\n';
    } else if (ch === 13) {
      out += '\\r';
    } else {
      out += txPayload.charAt(i);
    }
  }
  return out;
}

/**
 * Build the wire envelope for one outbound message.
 *
 * `encryptReady` is the gate: while it is 0 (before the key exchange completes)
 * payloads ship cleartext with "encrypted":false. The flag always describes what
 * actually happened to the payload — it is never set optimistically.
 */
export function buildRelayEnvelope(
  from: string,
  to: string,
  room: string,
  seq: number,
  ts: number,
  payload: string,
  encryptReady: number,
  encrypt: (s: string) => string
): string {
  let txPayload = payload;
  let encryptedFlag = 'false';
  if (encryptReady > 0 && isPairingHandshake(payload) < 1) {
    txPayload = encrypt(payload);
    encryptedFlag = 'true';
  }

  let msg = '{"from":"';
  msg += from;
  msg += '","to":"';
  msg += to;
  msg += '","room":"';
  msg += room;
  msg += '","seq":';
  msg += String(seq);
  msg += ',"ts":';
  msg += String(ts);
  msg += ',"encrypted":';
  msg += encryptedFlag;
  msg += ',"payload":"';
  msg += escapePayload(txPayload);
  msg += '"}';
  return msg;
}
