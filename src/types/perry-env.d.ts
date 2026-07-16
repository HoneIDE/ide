/**
 * Perry environment type declarations.
 *
 * Replaces bun-types / @types/node with Perry-correct signatures:
 * - readFileSync returns string (not Buffer)
 * - setTimeout/setInterval return number (not Timeout)
 * - execSync returns string (not Buffer)
 */

// ---------------------------------------------------------------------------
// Node-compatible modules (Perry provides these at compile time)
// ---------------------------------------------------------------------------

declare module 'fs' {
  /** Node-shaped stat result. Perry populates the standard predicate methods
   *  and *Ms timestamp fields (perry-runtime/src/fs/stats.rs). */
  export interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    mode: number;
  }

  /** Perry matches Node here: without an encoding this returns a Buffer, and
   *  string methods on a Buffer silently misbehave once compiled (charCodeAt
   *  → undefined). The encoding parameter is deliberately REQUIRED so tsc
   *  rejects any call site that would get a Buffer while expecting text. */
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function unlinkSync(path: string): void;
  export function statSync(path: string, options?: object): Stats;
  export function lstatSync(path: string, options?: object): Stats;
  /** Open a file and return its fd. Used to redirect background-process output. */
  export function openSync(path: string, flags: string): number;
  /** Perry extension — check if path is a directory. Prefer `../fs-compat`'s
   *  `isDirectory`, which shims this over statSync for the current toolchain. */
  export function isDirectory(path: string): boolean;
}

// node: prefixed variants (same as above)
declare module 'node:fs' {
  export * from 'fs';
}

declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function writeFile(path: string, data: string, encoding?: string): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function cp(src: string, dest: string, options?: { recursive?: boolean }): Promise<void>;
  export function stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; size: number; mtime: Date }>;
  export function readFile(path: string, encoding?: string): Promise<string>;
  export function readdir(path: string): Promise<string[]>;
}

declare module 'path' {
  export function join(...paths: string[]): string;
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function resolve(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function normalize(path: string): string;
  export const sep: string;
}

declare module 'node:path' {
  export * from 'path';
}

declare module 'child_process' {
  /** Handle returned by `spawn`. Only the members hone actually uses are
   *  declared — see `../process-compat`'s spawnBackground. */
  export interface ChildProcess {
    pid?: number;
    unref(): void;
  }

  export function execSync(command: string, options?: object): string;
  /** Argv-array spawn — no shell, args passed directly to the executable. Safe for untrusted inputs. */
  export function spawnSync(command: string, args: string[], options?: object): { stdout: string; stderr: string; status: number };
  /** Node-standard async spawn. Prefer `../process-compat`'s `spawnBackground`
   *  wrapper for fire-and-forget launches. */
  export function spawn(command: string, args: string[], options?: object): ChildProcess;
  /** Perry extension — spawn a background process. Prefer `../process-compat`'s
   *  `spawnBackground`, which reimplements this over standard `spawn`. */
  export function spawnBackground(command: string, args: string[], options?: string | object): { pid: number; handleId: number };
}

// ---------------------------------------------------------------------------
// Globals (Perry runtime returns number for timers, not objects)
// ---------------------------------------------------------------------------

declare function setTimeout(callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): number;
declare function setInterval(callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): number;
declare function clearTimeout(id: number): void;
declare function clearInterval(id: number): void;
declare function queueMicrotask(callback: () => void): void;

declare var console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

declare var process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};

declare var require: {
  (id: string): unknown;
  resolve(id: string): string;
};
declare var __dirname: string;
declare var __filename: string;

// ---------------------------------------------------------------------------
// Compile-time constants (injected by Perry compiler)
// ---------------------------------------------------------------------------

/** Compile-time platform ID: 0=macOS, 1=iOS, 2=Android, 3=Windows, 4=Linux, 5=Web */
declare const __platform__: number;

/** Compile-time plugin system toggle: 1 if --features plugins, 0 otherwise.
 *  Auto-disabled on iOS/Android (App Store policies prohibit dlopen of third-party code). */
declare const __plugins__: number;

// ---------------------------------------------------------------------------
// Perry threading (real OS threads)
// ---------------------------------------------------------------------------

declare module 'perry/thread' {
  /** Run a closure on a background OS thread. Returns a Promise that resolves
   *  when the thread completes. Captured variables are deep-copied (immutable
   *  captures only — compile-time enforced). */
  export function spawn<T>(fn: () => T): Promise<T>;

  /** Process every element of an array in parallel across all CPU cores.
   *  Returns a new array with results in the same order as the input.
   *  Small arrays skip threading automatically. */
  export function parallelMap<T, U>(data: T[], fn: (item: T) => U): U[];

  /** Filter an array in parallel across all CPU cores. Returns a new array
   *  containing only elements where the predicate returned truthy. Order preserved. */
  export function parallelFilter<T>(data: T[], predicate: (item: T) => boolean): T[];
}

// ---------------------------------------------------------------------------
// Buffer / node:crypto
//
// Perry maps node:crypto natively (perry-stdlib/src/crypto/*). Only the surface
// hone actually uses is declared. Signatures below were verified empirically
// against Perry-compiled probes, not copied from @types/node — notably,
// X25519 `export()` returns an opaque Perry surrogate string rather than real
// SPKI/PKCS8 DER (see src/workbench/sync-crypto.ts).
// ---------------------------------------------------------------------------

interface PerryBuffer {
  toString(encoding?: string): string;
  length: number;
}

declare var Buffer: {
  from(data: string, encoding?: string): PerryBuffer;
  from(data: ArrayBuffer | PerryBuffer): PerryBuffer;
  alloc(size: number): PerryBuffer;
};

declare module 'crypto' {
  interface Hmac {
    update(data: string | PerryBuffer): Hmac;
    digest(encoding: string): string;
  }
  interface Hash {
    update(data: string | PerryBuffer): Hash;
    digest(encoding: string): string;
  }
  interface Cipher {
    update(data: string, inputEncoding: string, outputEncoding: string): string;
    final(outputEncoding: string): string;
    /** GCM only — must be read after final(). */
    getAuthTag(): PerryBuffer;
  }
  interface Decipher {
    update(data: string, inputEncoding: string, outputEncoding: string): string;
    /** GCM only — THROWS if the auth tag does not verify. */
    final(outputEncoding: string): string;
    setAuthTag(tag: PerryBuffer): void;
  }
  /** Opaque key handle. Perry's export() yields a surrogate string, not DER. */
  interface KeyObject {
    export(options: { type: string; format: string }): PerryBuffer;
  }

  export function randomBytes(size: number): PerryBuffer;
  export function createHash(algorithm: string): Hash;
  export function createHmac(algorithm: string, key: string | PerryBuffer): Hmac;
  export function hkdfSync(digest: string, ikm: PerryBuffer, salt: PerryBuffer, info: PerryBuffer, keylen: number): ArrayBuffer;
  export function generateKeyPairSync(type: string): { publicKey: KeyObject; privateKey: KeyObject };
  export function diffieHellman(options: { privateKey: KeyObject; publicKey: KeyObject }): PerryBuffer;
  export function createCipheriv(algorithm: string, key: PerryBuffer, iv: PerryBuffer): Cipher;
  export function createDecipheriv(algorithm: string, key: PerryBuffer, iv: PerryBuffer): Decipher;
  export function createPublicKey(options: { key: PerryBuffer; format: string; type: string }): KeyObject;
  export function createPrivateKey(options: { key: PerryBuffer; format: string; type: string }): KeyObject;

  const _default: {
    randomBytes: typeof randomBytes;
    createHash: typeof createHash;
    createHmac: typeof createHmac;
    hkdfSync: typeof hkdfSync;
    generateKeyPairSync: typeof generateKeyPairSync;
    diffieHellman: typeof diffieHellman;
    createCipheriv: typeof createCipheriv;
    createDecipheriv: typeof createDecipheriv;
    createPublicKey: typeof createPublicKey;
    createPrivateKey: typeof createPrivateKey;
  };
  export default _default;
}

declare module 'node:crypto' {
  export * from 'crypto';
}

// ---------------------------------------------------------------------------
// Perry i18n (compile-time localization)
// ---------------------------------------------------------------------------

declare module 'perry/i18n' {
  /** Localize a string key. With no [i18n] config in perry.toml the key is
   *  returned as-is. `{param}` placeholders are filled from `params`; a `count`
   *  param selects the CLDR plural variant for the active locale. */
  export function t(key: string, params?: { [key: string]: string | number }): string;

  /** Locale-aware format wrappers. Each returns a display string for the
   *  active locale (default `en`). Date/time wrappers take epoch milliseconds. */
  export function Currency(value: number): string;
  export function Percent(value: number): string;
  export function FormatNumber(value: number): string;
  export function ShortDate(epochMs: number): string;
  export function LongDate(epochMs: number): string;
  export function FormatTime(epochMs: number): string;
  /** Bypass locale formatting — emit the value verbatim. */
  export function Raw(value: number): string;
}

// ---------------------------------------------------------------------------
// bun:test (for test files)
// ---------------------------------------------------------------------------

declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeGreaterThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toBeLessThan(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toContain(item: unknown): void;
    toHaveLength(len: number): void;
    toThrow(msg?: string | RegExp): void;
    toMatch(pattern: string | RegExp): void;
    toBeInstanceOf(cls: unknown): void;
    toHaveProperty(key: string, value?: unknown): void;
    toBeCloseTo(expected: number, precision?: number): void;
    not: {
      toBe(expected: unknown): void;
      toEqual(expected: unknown): void;
      toBeTruthy(): void;
      toBeFalsy(): void;
      toBeNull(): void;
      toBeUndefined(): void;
      toBeDefined(): void;
      toContain(item: unknown): void;
      toHaveLength(len: number): void;
      toThrow(msg?: string | RegExp): void;
      toMatch(pattern: string | RegExp): void;
      toHaveProperty(key: string, value?: unknown): void;
    };
  };
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
}
