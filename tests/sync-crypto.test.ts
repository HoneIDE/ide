/**
 * Regression tests for the sync E2E crypto primitives.
 *
 * These exist because sync shipped as a PLAINTEXT PASS-THROUGH while the product
 * advertised end-to-end encryption: every primitive in sync-host.ts /
 * sync-guest.ts was stubbed, and ccAes256GcmEncrypt literally returned its
 * plaintext argument (AUDIT-2026-07.md H1). The single most important assertion
 * in this file is therefore the dullest one: that ciphertext is not plaintext.
 *
 * SCOPE — these run under `bun test`, i.e. against Node/Bun's crypto, not
 * Perry's. That is a real limitation to understand rather than paper over:
 *
 *  - The symmetric primitives (nonce/HKDF/AES-256-GCM) are standard node:crypto
 *    on both runtimes, and Perry's output was verified byte-identical to node's,
 *    so testing them here is meaningful.
 *  - The X25519 helpers are NOT portable and are deliberately not tested here.
 *    Perry's KeyObject.export() returns an opaque surrogate string
 *    ("PERRY-X25519-PUBLIC:<base64url>") rather than real SPKI/PKCS8 DER, and
 *    ignores the requested encoding. Under Bun the same call returns real DER,
 *    so ccX25519Keypair's String(export(...)) round-trip only works on Perry.
 *    That path is covered by a Perry-compiled probe instead (see the commit that
 *    introduced sync-crypto.ts). If X25519 pairing ever needs to interop with a
 *    non-Perry client, the wire format has to change first.
 */

import { describe, it, expect } from 'bun:test';
import {
  ccRandomNonce,
  ccHkdfSha256,
  ccAes256GcmEncrypt,
  ccAes256GcmDecrypt,
  ccRandomKeyHex,
} from '../src/workbench/sync-crypto';

const KEY = 'a'.repeat(64); // 32 bytes hex
const HEX = /^[0-9a-f]+$/;

describe('ccRandomNonce', () => {
  it('is a 12-byte hex nonce', () => {
    const n = ccRandomNonce();
    expect(n.length).toBe(24);
    expect(HEX.test(n)).toBe(true);
  });

  it('never repeats across many draws (GCM nonce reuse is catastrophic)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(ccRandomNonce());
    expect(seen.size).toBe(1000);
  });
});

describe('ccRandomKeyHex', () => {
  it('is 32 bytes of hex', () => {
    const k = ccRandomKeyHex();
    expect(k.length).toBe(64);
    expect(HEX.test(k)).toBe(true);
  });

  it('is not the all-zero / constant key', () => {
    const a = ccRandomKeyHex();
    const b = ccRandomKeyHex();
    expect(a).not.toBe(b);
    expect(a).not.toBe('0'.repeat(64));
  });
});

describe('ccHkdfSha256', () => {
  it('derives the requested number of bytes', () => {
    expect(ccHkdfSha256('aabb', '', 'info', 32).length).toBe(64);
    expect(ccHkdfSha256('aabb', '', 'info', 16).length).toBe(32);
  });

  it('is deterministic for the same inputs', () => {
    expect(ccHkdfSha256('aabb', '', 'x', 32)).toBe(ccHkdfSha256('aabb', '', 'x', 32));
  });

  it('separates domains by info label', () => {
    const a = ccHkdfSha256('aabb', '', 'hone-pairing-key', 32);
    const b = ccHkdfSha256('aabb', '', 'hone-project-key', 32);
    expect(a).not.toBe(b);
  });

  it('honours the salt', () => {
    const a = ccHkdfSha256('aabb', '', 'x', 32);
    const b = ccHkdfSha256('aabb', 'ccdd', 'x', 32);
    expect(a).not.toBe(b);
  });
});

describe('ccAes256GcmEncrypt / ccAes256GcmDecrypt', () => {
  it('does not return the plaintext — the actual H1 bug', () => {
    const pt = 'FILE_EDIT|src/app.ts|secret contents';
    const ct = ccAes256GcmEncrypt(pt, KEY, ccRandomNonce());
    expect(ct).not.toBe(pt);
    expect(ct.includes('FILE_EDIT')).toBe(false);
    expect(ct.includes('secret contents')).toBe(false);
  });

  it('round-trips', () => {
    const pt = 'FILE_EDIT|src/app.ts|hello world';
    const n = ccRandomNonce();
    expect(ccAes256GcmDecrypt(ccAes256GcmEncrypt(pt, KEY, n), KEY, n)).toBe(pt);
  });

  it('round-trips unicode and empty payloads', () => {
    const n = ccRandomNonce();
    expect(ccAes256GcmDecrypt(ccAes256GcmEncrypt('日本語 🔐 ok', KEY, n), KEY, n)).toBe('日本語 🔐 ok');
    const n2 = ccRandomNonce();
    expect(ccAes256GcmDecrypt(ccAes256GcmEncrypt('', KEY, n2), KEY, n2)).toBe('');
  });

  it('appends a 16-byte auth tag (32 hex chars)', () => {
    const n = ccRandomNonce();
    const empty = ccAes256GcmEncrypt('', KEY, n);
    expect(empty.length).toBe(32); // no ciphertext, tag only
  });

  it('produces different ciphertext per nonce for identical plaintext', () => {
    const pt = 'same message';
    expect(ccAes256GcmEncrypt(pt, KEY, ccRandomNonce()))
      .not.toBe(ccAes256GcmEncrypt(pt, KEY, ccRandomNonce()));
  });

  it('rejects a tampered ciphertext', () => {
    const n = ccRandomNonce();
    const ct = ccAes256GcmEncrypt('hello world', KEY, n);
    const tampered = ct.slice(0, ct.length - 4) + 'dead';
    expect(() => ccAes256GcmDecrypt(tampered, KEY, n)).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const n = ccRandomNonce();
    const ct = ccAes256GcmEncrypt('hello world', KEY, n);
    const flipped = ct.slice(0, 2) === 'ff' ? '00' + ct.slice(2) : 'ff' + ct.slice(2);
    expect(() => ccAes256GcmDecrypt(flipped, KEY, n)).toThrow();
  });

  it('rejects the wrong key', () => {
    const n = ccRandomNonce();
    const ct = ccAes256GcmEncrypt('hello world', KEY, n);
    expect(() => ccAes256GcmDecrypt(ct, ccRandomKeyHex(), n)).toThrow();
  });

  it('rejects the wrong nonce', () => {
    const ct = ccAes256GcmEncrypt('hello world', KEY, ccRandomNonce());
    expect(() => ccAes256GcmDecrypt(ct, KEY, ccRandomNonce())).toThrow();
  });

  it('rejects a payload too short to carry a tag', () => {
    expect(() => ccAes256GcmDecrypt('abcd', KEY, ccRandomNonce())).toThrow();
  });
});
