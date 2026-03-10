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
  export function readFileSync(path: string, encoding?: string): string;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function unlinkSync(path: string): void;
  /** Perry extension — check if path is a directory. */
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
  export function execSync(command: string, options?: object): string;
  /** Perry extension — spawn a background process. */
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
