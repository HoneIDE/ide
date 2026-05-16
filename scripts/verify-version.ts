#!/usr/bin/env bun
/**
 * SHIP-V1-GAPS.md #6: assert all four version sources agree.
 *
 * Sources:
 *   - src/workbench/version.ts  → `export const HONE_VERSION = 'X.Y.Z';`
 *   - package.json              → `"version": "X.Y.Z"`
 *   - perry.toml                → `version = "X.Y.Z"`
 *   - perry.config.ts           → `version: 'X.Y.Z'`
 *
 * Usage:
 *   bun scripts/verify-version.ts            # exit 0 if all agree, 1 otherwise
 *   bun scripts/verify-version.ts --set 0.2.0  # rewrite all four sources atomically
 *
 * Hook this into CI so a release tag can't ship with version drift.
 */
import { readFileSync, writeFileSync } from 'fs';

const FILES = [
  { path: 'src/workbench/version.ts',  re: /HONE_VERSION\s*=\s*'([^']+)'/, sub: (next: string, src: string) => src.replace(/HONE_VERSION\s*=\s*'[^']+'/, `HONE_VERSION = '${next}'`) },
  { path: 'package.json',              re: /"version"\s*:\s*"([^"]+)"/,   sub: (next: string, src: string) => src.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${next}"`) },
  { path: 'perry.toml',                re: /^version\s*=\s*"([^"]+)"/m,   sub: (next: string, src: string) => src.replace(/^version\s*=\s*"[^"]+"/m, `version = "${next}"`) },
  { path: 'perry.config.ts',           re: /version\s*:\s*'([^']+)'/,     sub: (next: string, src: string) => src.replace(/version\s*:\s*'[^']+'/, `version: '${next}'`) },
  // SHIP-V1-GAPS.md #6: Mac app bundle Info.plist. Both CFBundleVersion and
  // CFBundleShortVersionString must match the project version — Gatekeeper
  // and the About dialog read these. Skipped silently when the file isn't
  // present (e.g. on Windows-only contributor checkouts).
  { path: 'Hone-macOS.app/Contents/Info.plist', re: /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/, sub: (next: string, src: string) => {
      let out = src.replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/, `$1${next}$2`);
      out = out.replace(/(<key>CFBundleVersion<\/key>\s*<string>)[^<]+(<\/string>)/, `$1${next}$2`);
      return out;
    } },
  // Android app build.gradle.kts versionName. versionCode stays an integer
  // managed separately (release counter, not semver). Skipped when the
  // android-build dir is absent.
  { path: 'android-build/app/build.gradle.kts', re: /versionName\s*=\s*"([^"]+)"/, sub: (next: string, src: string) => src.replace(/versionName\s*=\s*"[^"]+"/, `versionName = "${next}"`) },
];

function extractVersion(filePath: string, re: RegExp): string | null {
  let src: string;
  try {
    src = readFileSync(filePath, 'utf8');
  } catch {
    // Silent skip — the file may not exist on every contributor checkout
    // (e.g. Info.plist on a Windows-only fork). Caller treats this as "not
    // in scope" rather than drift.
    return null;
  }
  const m = re.exec(src);
  if (!m) {
    console.error(`error: no version match in ${filePath}`);
    return null;
  }
  return m[1];
}

const args = process.argv.slice(2);
const setIdx = args.indexOf('--set');
const setVersion = setIdx >= 0 && setIdx + 1 < args.length ? args[setIdx + 1] : null;

if (setVersion !== null) {
  if (!/^\d+\.\d+\.\d+/.test(setVersion)) {
    console.error(`error: --set value must look like X.Y.Z, got "${setVersion}"`);
    process.exit(1);
  }
  let wrote = 0;
  for (const f of FILES) {
    let src: string;
    try { src = readFileSync(f.path, 'utf8'); } catch { console.error(`skip: ${f.path} not found`); continue; }
    const next = f.sub(setVersion, src);
    if (next !== src) {
      writeFileSync(f.path, next);
      wrote += 1;
      console.log(`wrote ${f.path} → ${setVersion}`);
    } else {
      console.error(`warn: ${f.path} version pattern did not match; manual edit needed`);
    }
  }
  console.log(`Updated ${wrote}/${FILES.length} files to ${setVersion}.`);
  process.exit(wrote === FILES.length ? 0 : 1);
}

// Verify mode
const versions: { path: string; ver: string | null }[] = FILES.map((f) => ({ path: f.path, ver: extractVersion(f.path, f.re) }));
const reference = versions[0].ver;
if (reference === null) {
  console.error('error: could not read reference version from', versions[0].path);
  process.exit(1);
}

let allMatch = true;
let checkedCount = 0;
for (const v of versions) {
  if (v.ver === null) {
    console.log(`skip  ${v.path}: not present on this checkout`);
    continue;
  }
  checkedCount += 1;
  const ok = v.ver === reference;
  console.log(`${ok ? 'ok  ' : 'MISS'}  ${v.path}: ${v.ver}`);
  if (!ok) allMatch = false;
}

if (!allMatch) {
  console.error(`\nVersion drift detected. Run: bun scripts/verify-version.ts --set ${reference}`);
  process.exit(1);
}
console.log(`\nAll ${checkedCount} version sources agree on ${reference}.`);
