# Perry toolchain migration (macOS)

Hone was originally built against a custom Perry fork. Upstream `@perryts/perry`
(0.5.112x+) removed that fork's bespoke helpers and tightened FFI/runtime
semantics, so the source needed porting. Summary of what changed and why, for
anyone touching these areas (incl. the Windows port).

## Compat shims (new files)
- `src/fs-compat.ts` — `isDirectory()` (fork-only `fs` export, removed) reimplemented
  via `statSync().isDirectory()`.
- `src/process-compat.ts` — three shims:
  - `execText` / `spawnText` — `execSync`/`spawnSync` now return a **Buffer** unless
    `{ encoding: 'utf8' }` is passed (Node semantics). The codebase treats results as
    strings everywhere, so all call sites route through these wrappers.
  - `spawnBackground` — fork-only `child_process` helper, removed. Reimplemented over
    `spawn` with `{ detached: true }`. **Platform-neutral:** the caller supplies the
    shell (`shellBin`/`shellArg`), so the shim does NOT re-wrap; a real `logFile` is
    redirected via an opened fd, `/dev/null`/`NUL`/empty discards.

All `execSync(`/`spawnSync(` call sites were renamed to `execText(`/`spawnText(`;
`isDirectory`/`spawnBackground` imports repointed to the shims. Native
`execSync`/`spawnSync` are imported only inside `process-compat.ts`.

## FFI manifest types (native libs)
Upstream Perry strictly checks `i64` params and rejects NaN-boxed strings (the old
fork extracted the pointer leniently). String params must be typed `"string"`, and
string-pointer returns (`Rust -> i64`) typed `"i64_str"`. Fixed in
`native/lsp/package.json` here, and in the `hone-editor` / `hone-terminal` repos.
Find them by scanning Rust for `*const u8` params (incl. `pub unsafe extern`).

## Other
- Cross-device sync used custom crypto intrinsics (x25519/aes-gcm/hkdf), now gone —
  **stubbed inline** in `sync-host.ts`/`sync-guest.ts`; sync is disabled (deltas pass
  through as plaintext). Restore by reimplementing over Node `crypto`.
- Unbound identifier reads now throw `ReferenceError` (old Perry read them as
  `undefined`). Run `npx tsc --noEmit | grep 'TS2304\|TS2552'` after any port to catch
  the whole class. (Fixed: dropped `t3`/`t5` timing vars + a missing find-bar import
  in render.ts.)

## Building
Requires `PERRY_ALLOW_PERRY_FEATURES=1` (native-library allowlist gate), or add
`"perry": { "allow": { "nativeLibrary": ["*"] } }` to package.json. Debug a runtime
crash with `--debug-symbols` + `lldb -o "break set -n exit" -o run -o bt` — Perry's
throw handler prints then exits without unwinding, so the crashing stack is intact.
