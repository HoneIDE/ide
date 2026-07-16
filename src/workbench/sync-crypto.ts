/**
 * Sync crypto primitives — X25519 pairing + AES-256-GCM payload encryption.
 *
 * These six functions back the cross-device sync E2E encryption protocol used by
 * sync-host.ts (desktop) and sync-guest.ts (mobile). They were previously stubbed
 * to no-ops in BOTH files — ccAes256GcmEncrypt returned its plaintext unchanged —
 * because they had been written against custom Perry crypto intrinsics
 * (ccX25519Keypair et al) that the toolchain stopped providing. The result was
 * that sync shipped as a plaintext pass-through while the product claimed E2E
 * encryption (AUDIT-2026-07.md H1).
 *
 * Perry now maps node:crypto natively, so these are implemented against the
 * standard API. Verified under a Perry-compiled probe: DH agreement, HKDF,
 * GCM round-trip, and key export→wire→import all behave.
 *
 * KEY ENCODING — IMPORTANT:
 * Perry does not emit real SPKI/PKCS8 DER for X25519. `export()` returns an
 * opaque surrogate string ("PERRY-X25519-PUBLIC:<base64url>"), and
 * createPublicKey/createPrivateKey accept that same surrogate back. So the
 * public keys on the wire are Perry-specific, NOT interoperable with a
 * non-Perry client. That is fine today (every Hone client is Perry-compiled)
 * but it means a third-party client cannot pair without matching this format.
 * The `*Hex` parameter names below are historical — key material is passed
 * through opaquely; only nonces and derived symmetric keys are really hex.
 */

import crypto from 'crypto';

/** 12-byte random nonce as hex (24 chars) — the GCM IV. Never reuse one under a key. */
export function ccRandomNonce(): string {
  return crypto.randomBytes(12).toString('hex');
}

/** HKDF-SHA256. ikm/salt are hex; info is a plain domain-separation label.
 *  Returns `length` bytes as hex. */
export function ccHkdfSha256(ikmHex: string, saltHex: string, info: string, length: number): string {
  const ikm = Buffer.from(ikmHex, 'hex');
  let salt = Buffer.alloc(0);
  if (saltHex.length > 0) salt = Buffer.from(saltHex, 'hex');
  const okm = crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info), length);
  return Buffer.from(okm).toString('hex');
}

/** Fresh ephemeral X25519 keypair as {"publicKey":"...","secretKey":"..."}.
 *  Both values are opaque Perry surrogates (see KEY ENCODING above). */
export function ccX25519Keypair(): string {
  const kp: any = crypto.generateKeyPairSync('x25519');
  const pub = String(kp.publicKey.export({ type: 'spki', format: 'der' }));
  const sec = String(kp.privateKey.export({ type: 'pkcs8', format: 'der' }));
  let out = '{"publicKey":"';
  out += pub;
  out += '","secretKey":"';
  out += sec;
  out += '"}';
  return out;
}

/** X25519 ECDH. Returns the 32-byte shared secret as hex.
 *  Raw ECDH output — always run it through ccHkdfSha256 before use as a key. */
export function ccX25519SharedSecret(secretKey: string, publicKey: string): string {
  const priv: any = crypto.createPrivateKey({ key: Buffer.from(secretKey), format: 'der', type: 'pkcs8' });
  const pub: any = crypto.createPublicKey({ key: Buffer.from(publicKey), format: 'der', type: 'spki' });
  const shared: any = crypto.diffieHellman({ privateKey: priv, publicKey: pub });
  return Buffer.from(shared).toString('hex');
}

/** AES-256-GCM. Returns hex(ciphertext) || hex(16-byte auth tag).
 *  The tag is appended rather than returned separately so the wire format stays
 *  a single string — decrypt splits the last 32 hex chars back off. */
export function ccAes256GcmEncrypt(plaintext: string, keyHex: string, nonceHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(nonceHex, 'hex');
  const c: any = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ct = c.update(plaintext, 'utf8', 'hex');
  ct += c.final('hex');
  const tag: any = c.getAuthTag();
  let out = ct;
  out += Buffer.from(tag).toString('hex');
  return out;
}

/** AES-256-GCM open. THROWS if the auth tag does not verify.
 *
 * Fail-closed is the whole point of GCM: a tampered or truncated payload must
 * not be handed back to the caller as if it were plaintext. Callers decrypting
 * untrusted relay traffic must catch and DROP the message — never fall back to
 * treating the ciphertext as cleartext. */
export function ccAes256GcmDecrypt(encrypted: string, keyHex: string, nonceHex: string): string {
  if (encrypted.length < 32) throw new Error('ciphertext shorter than auth tag');
  const tagHex = encrypted.slice(encrypted.length - 32);
  const ctHex = encrypted.slice(0, encrypted.length - 32);
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(nonceHex, 'hex');
  const d: any = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(Buffer.from(tagHex, 'hex'));
  let pt = d.update(ctHex, 'hex', 'utf8');
  pt += d.final('utf8');
  return pt;
}

/** 32 bytes of CSPRNG output as hex — for project keys and host secrets. */
export function ccRandomKeyHex(): string {
  return crypto.randomBytes(32).toString('hex');
}
