# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hone is a native, AI-powered code editor built in TypeScript and compiled to native binaries via the **Perry compiler** (a TypeScript-to-native AOT compiler written in Rust, located at `../perry/`). The project is a monorepo of independent packages — there is no top-level package.json or workspace manager.

## Repository Layout

| Directory | Purpose | Runtime |
|-----------|---------|---------|
| `hone-core/` | Headless IDE services (workspace, settings, git, search, LSP, DAP, AI, extensions) | Bun (tests only) |
| `hone-editor/` | Embeddable code editor (`@honeide/editor`) — piece table buffer, multi-cursor, syntax highlighting, diff | Bun (tests), Perry (native) |
| `hone-ide/` | IDE workbench shell — activity bar, sidebar, tabs, panels, theme engine | Perry (native binary) |
| `hone-terminal/` | Terminal emulator (`@honeide/terminal`) — VT parser, PTY, cross-platform Rust FFI | Bun (tests), Perry (native) |
| `hone-auth/` | Auth service (magic-link login, device pairing, subscriptions) — Fastify server | Perry (native binary, 2.8MB) |
| `hone-relay/` | WebSocket sync relay (cross-device delta sync, SQLite persistence) | Bun / Perry |
| `hone-build/` | Plugin build coordinator (submits to perry-hub for cross-platform compilation) | Perry (native binary) |
| `hone-marketplace/` | Plugin marketplace server (`marketplace.hone.codes`) | Perry (native binary) |
| `hone-api/` | Public extension API types (`@honeide/api`) — pure declarations, zero runtime | tsc only |
| `hone-extensions/` | 11 built-in IDE extensions (TypeScript, Python, Rust, Go, etc.) | Perry |
| `hone-extension/` | V2 plugin SDK (`@honeide/sdk`), Rust plugin host, marketplace client, CLI | Mixed |
| `hone-themes/` | 11 VSCode-compatible color themes (`@honeide/themes`) — pure JSON data | Jest |
| `hone-brand/` | Logos, colors, typography, brand guidelines | Static assets |
| `landing/` | Landing page (`hone.codes`) — single `index.html`, no build step | Static |
| `account.hone.codes/` | Account dashboard SPA | Static |

## Build & Test Commands

### Tests (per-package — no monorepo test runner)

```bash
cd hone-core && bun test                    # 649+ tests (workspace, settings, git, AI, etc.)
cd hone-editor && bun test                  # 353 tests (buffer, cursor, viewport, search, diff, LSP, DAP)
cd hone-terminal && bun test                # 163 tests (VT parser, buffer, input, emulator)
cd hone-relay && bun test                   # 48 tests (auth, buffer, ws-hub, config)
cd hone-build && bun test                   # 21 tests (artifact storage, platform normalization)
cd hone-themes && npm test                  # 452 tests (schema validation, WCAG contrast) — uses Jest
cd hone-extensions && npm test              # Uses Vitest
cd hone-api && npm test                     # Type-check only (tsc --noEmit)
```

**Important:** hone-core, hone-editor, hone-terminal, hone-relay, and hone-build use `bun test` (NOT vitest, NOT npx). hone-themes uses Jest. hone-extensions uses Vitest.

Run a single test file: `bun test tests/buffer.test.ts`

### Type checking

```bash
cd <package> && bun run typecheck   # or: npx tsc --noEmit
```

### Perry compiler (building native binaries)

```bash
# Build Perry itself (only when changing Rust code in ../perry/)
cd ../perry && CARGO_PROFILE_RELEASE_LTO=off cargo build --release -p perry

# Build Perry UI library (macOS) — MUST disable LTO
cd ../perry && CARGO_PROFILE_RELEASE_LTO=off cargo build --release -p perry-ui-macos

# Build Perry stdlib (needed after changing perry-runtime source)
cd ../perry && cargo clean -p perry-runtime --release && \
  CARGO_PROFILE_RELEASE_LTO=off cargo build --release -p perry-stdlib -p perry-ui-macos -p perry

# Compile IDE (macOS native binary)
cd hone-ide && perry compile src/app.ts --output hone-ide

# Compile IDE (iOS simulator)
cd hone-ide && perry compile src/app.ts --target ios-simulator --output Hone

# Compile IDE (Web)
cd hone-ide && perry compile src/app.ts --target web --output hone-ide.html

# Compile auth server
cd hone-auth && perry compile src/app.ts --output hone-auth

# Compile marketplace
cd hone-marketplace && perry compile src/app.ts --output hone-marketplace

# Compile build server
cd hone-build && perry compile src/app.ts --output hone-build
```

**Critical:** Always use `CARGO_PROFILE_RELEASE_LTO=off` for all Perry Rust builds — thin LTO produces bitcode that macOS clang linker can't read.

### UI testing (macOS)

```bash
geisterhand screenshot --output /tmp/shot.png   # Take screenshot
geisterhand click x y                            # Click at coordinates
```

For iOS Simulator, use AppleScript (`osascript`) instead of geisterhand.

## Architecture

### Compilation model

TypeScript → Perry AOT compiler → native binary (no V8, no Node.js at runtime). Perry compiles TS directly to machine code via Rust codegen. The generated binaries link against `libperry_stdlib.a` (runtime) and platform UI libraries (`perry-ui-macos`, `perry-ui-ios`, `perry-ui-windows`).

### Editor architecture

`hone-editor/` is the embeddable editor component:
- **core/** — Platform-independent: piece table buffer, multi-cursor, undo/redo, viewport, tokenizer, search, folding, diff, LSP client, DAP client
- **view-model/** — Reactive state bridge: EditorViewModel orchestrates core → rendering
- **native/** — Rust FFI crates per platform (macOS/iOS/Windows/Linux/Android/Web)

The editor uses a TS-authoritative model: TypeScript is the single source of truth for document state; Rust is a rendering cache that receives cached lines and viewport state via FFI.

### IDE architecture

`hone-ide/` is the workbench shell:
- `src/app.ts` — Perry `App()` entry point
- `src/workbench/render.ts` — Main UI tree (activity bar, sidebar, editor, status bar, panels)
- `src/workbench/views/` — Panel views (explorer, search, git, debug, extensions, AI chat, terminal, settings, etc.)
- `src/workbench/theme/` — Multi-theme engine with VS Code-compatible JSON themes

### Service architecture

- **Auth** (port 8445): Magic-link login, device pairing, JWT tokens, MySQL on `webserver.skelpo.net`
- **Relay** (port 8443/8444): WebSocket rooms for cross-device sync, SQLite delta persistence
- **Marketplace** (port 8446): Plugin search, download, publish
- **Build** (port 8447): Plugin cross-compilation via perry-hub workers

## Perry AOT Constraints

Code compiled by Perry must avoid these broken patterns:

| Pattern | Use Instead |
|---------|-------------|
| `obj[variable]` dynamic key access | `if/else if` per key |
| `?.` optional chaining | Explicit null checks |
| `??` nullish coalescing | Explicit `if (x !== undefined)` |
| `/regex/.test()` | `indexOf` or char checks |
| `{ key }` ES6 shorthand | `{ key: key }` explicit |
| `array.map(fn)` on class fields | `for` loop |
| `for...of` on arrays | `for (let i = 0; i < arr.length; i++)` |
| `c >= 'a' && c <= 'z'` char ranges | `ALPHA_STR.indexOf(c) >= 0` |
| Closures capturing `this` methods | Module-level functions reading module-level vars |
| `requestAnimationFrame` | `setInterval` (RAF never fires in Perry) |
| `setTimeout` self-recursion | `setInterval` (setTimeout inside callback only fires once) |
| String-returning functions in async | Inline string operations (returns NaN-boxed pointer) |
| `new Date()` in async | `Date.now()` |

**Closure rule:** Perry captures closure variables by value, not by reference. Store mutable state in module-level `let` variables and access them through module-level named functions.

## Perry FFI Conventions

- String params are NaN-boxed `StringHeader` pointers. Rust receives `*const u8` + `str_from_header()`.
- Perry calls `__wrapper_<function_name>` symbols (double underscore prefix).
- All FFI functions must be listed in `package.json` `perry.nativeLibrary.functions`.
- Use `f64` for numeric FFI params, `i64` for string/pointer params. `i32` causes verifier errors.

## Key Conventions

- **No Rust in hone-ide** — all Rust lives in `../perry/` and its sub-crates
- **Database schemas use camelCase** for all identifiers
- **Tests use `bun:test`** (import from `'bun:test'`) in hone-core, hone-editor, hone-terminal
- **Platform detection:** `__platform__` compile-time constant (0=macOS, 1=iOS, 2=Android)
- **Config files:** KEY=VALUE format (`auth.conf`, `relay.conf`, `build.conf`)

## Deployment

- Landing page: `scp index.html root@webserver.skelpo.net:/var/www/hone.codes/`
- Auth/relay/marketplace services run on `webserver.skelpo.net`
- MySQL database: host=webserver.skelpo.net, user=hone
