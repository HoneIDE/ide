/**
 * Envelope-level tests: does a payload actually leave this device as ciphertext?
 *
 * This is the assertion AUDIT-2026-07.md H1 asked for ("relay-side packet
 * capture asserting every non-handshake envelope ships ciphertext"), done at the
 * point where the envelope is built rather than by capturing packets — same
 * property, no relay or network required, and it runs on every commit.
 *
 * The encrypt function is injected, so these tests assert the *transport's
 * decision* (encrypt or not, and whether the flag tells the truth), independently
 * of the crypto itself — which sync-crypto.test.ts covers.
 */

import { describe, it, expect } from 'bun:test';
import { buildRelayEnvelope, isPairingHandshake } from '../src/workbench/sync-envelope';

// Stand-in for real encryption: uppercase + a marker. Deliberately not a no-op —
// a no-op "encrypt" is precisely the bug that shipped.
const fakeEncrypt = (s: string) => 'ENC(' + s.toUpperCase() + ')';
const identity = (s: string) => s;

const READY = 1;
const NOT_READY = 0;

function envelope(payload: string, ready: number, enc = fakeEncrypt): string {
  return buildRelayEnvelope('devA', 'devB', 'room1', 7, 1752600000000, payload, ready, enc);
}

describe('isPairingHandshake', () => {
  it('exempts the three handshake messages', () => {
    expect(isPairingHandshake('PAIR_REQ|code|d|n|k')).toBe(1);
    expect(isPairingHandshake('PAIR_OK|d|n|k|w')).toBe(1);
    expect(isPairingHandshake('PAIR_NO|encryption required')).toBe(1);
  });

  it('does not exempt ordinary payloads', () => {
    expect(isPairingHandshake('FILE_EDIT|src/app.ts|x')).toBe(0);
    expect(isPairingHandshake('')).toBe(0);
  });

  it('is anchored — a payload merely containing the marker is not exempt', () => {
    // Otherwise an attacker-influenced payload could smuggle itself past the
    // encryption gate by embedding "PAIR_REQ|" anywhere in its body.
    expect(isPairingHandshake('FILE_EDIT|notes.md|see PAIR_REQ|for details')).toBe(0);
    expect(isPairingHandshake(' PAIR_REQ|x')).toBe(0);
  });
});

describe('buildRelayEnvelope — encryption gate', () => {
  it('ships ciphertext, not plaintext, once encryption is ready', () => {
    const msg = envelope('FILE_EDIT|src/app.ts|secret contents', READY);
    expect(msg.includes('secret contents')).toBe(false);
    expect(msg.includes('ENC(FILE_EDIT|SRC/APP.TS|SECRET CONTENTS)')).toBe(true);
  });

  it('sets encrypted:true only when it actually encrypted', () => {
    expect(envelope('FILE_EDIT|a|b', READY).includes('"encrypted":true')).toBe(true);
  });

  it('lets the pairing handshake through in cleartext — it bootstraps the key', () => {
    const msg = envelope('PAIR_REQ|123456789012|devA|Mac|pubkey', READY);
    expect(msg.includes('PAIR_REQ|123456789012|devA|Mac|pubkey')).toBe(true);
    expect(msg.includes('"encrypted":false')).toBe(true);
  });

  it('flags cleartext honestly before the key exchange completes', () => {
    // Documents the pre-key window: payloads DO ship cleartext here. The flag
    // must never claim otherwise — a false "encrypted":true would make the
    // receiver try to decrypt plaintext, and would misrepresent the wire.
    const msg = envelope('FILE_EDIT|a|b', NOT_READY);
    expect(msg.includes('"encrypted":false')).toBe(true);
    expect(msg.includes('FILE_EDIT|a|b')).toBe(true);
  });

  it('never calls the encrypt fn when not ready', () => {
    let called = 0;
    envelope('FILE_EDIT|a|b', NOT_READY, (s) => { called++; return s; });
    expect(called).toBe(0);
  });

  it('regression: an identity "encrypt" is visibly plaintext — the H1 shape', () => {
    // If ccAes256GcmEncrypt ever regresses to returning its argument, the flag
    // says true while the wire carries plaintext. Pin the distinction.
    const broken = envelope('FILE_EDIT|src/app.ts|secret', READY, identity);
    expect(broken.includes('"encrypted":true')).toBe(true);
    expect(broken.includes('secret')).toBe(true); // <- what shipped for months
    const fixed = envelope('FILE_EDIT|src/app.ts|secret', READY);
    expect(fixed.includes('secret')).toBe(false);
  });
});

describe('buildRelayEnvelope — framing', () => {
  it('carries the routing fields', () => {
    const msg = envelope('x', NOT_READY);
    expect(msg.includes('"from":"devA"')).toBe(true);
    expect(msg.includes('"to":"devB"')).toBe(true);
    expect(msg.includes('"room":"room1"')).toBe(true);
    expect(msg.includes('"seq":7')).toBe(true);
    expect(msg.includes('"ts":1752600000000')).toBe(true);
  });

  it('produces parseable JSON for both paths', () => {
    const clear: any = JSON.parse(envelope('plain payload', NOT_READY));
    expect(clear.payload).toBe('plain payload');
    expect(clear.encrypted).toBe(false);
    const enc: any = JSON.parse(envelope('plain payload', READY));
    expect(enc.encrypted).toBe(true);
    expect(enc.payload).toBe('ENC(PLAIN PAYLOAD)');
  });

  it('escapes quotes, backslashes and newlines so the envelope stays valid JSON', () => {
    const nasty = 'FILE_EDIT|a.ts|say "hi"\\ n\nnext\rline';
    const parsed: any = JSON.parse(envelope(nasty, NOT_READY));
    expect(parsed.payload).toBe(nasty);
  });

  it('a payload that looks like JSON cannot break out of the envelope', () => {
    const inject = '","encrypted":true,"x":"';
    const parsed: any = JSON.parse(envelope(inject, NOT_READY));
    expect(parsed.payload).toBe(inject);
    expect(parsed.encrypted).toBe(false); // not overridden by the injected text
  });
});
