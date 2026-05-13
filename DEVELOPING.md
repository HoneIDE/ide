# Developing & Testing Hone

How to add new features to Hone and verify them. This is the entry point — for deeper details see [`CLAUDE.md`](CLAUDE.md), [`docs/src/contributing/setup.md`](docs/src/contributing/setup.md), and [`hone-ide/tests/agentic/API.md`](hone-ide/tests/agentic/API.md).

## TL;DR

```bash
# 1. One-time setup (Perry compiler in sibling dir)
cd ../perry && CARGO_PROFILE_RELEASE_LTO=off cargo build --release -p perry -p perry-ui-macos

# 2. Make TypeScript changes in any hone-* package

# 3. Run unit tests for the package
cd hone-core && bun test

# 4. For UI features: rebuild the IDE binary with geisterhand
cd ../perry && perry compile ../hone/hone-ide/src/app.ts --output ../hone/hone-ide/hone-ide --enable-geisterhand

# 5. Run the agentic test harness
cd ../hone/hone-ide/tests/agentic && bash setup.sh
# ... interact via http://127.0.0.1:7676 (baked-in) and http://127.0.0.1:7677 (external CLI)
bash teardown.sh
```

## Repository Layout

Hone is a **monorepo of independent packages** — there is no top-level package.json or workspace manager. Each package builds and tests independently. See [`CLAUDE.md`](CLAUDE.md) for the full table.

| Package | Purpose | Test runner |
|---------|---------|-------------|
| `hone-core/` | Headless IDE services (workspace, settings, git, search, LSP, DAP, AI, extensions) | `bun test` |
| `hone-editor/` | Embeddable code editor (`@honeide/editor`) | `bun test` |
| `hone-ide/` | IDE workbench shell (Perry-compiled native binary) | manual + agentic |
| `hone-terminal/` | Terminal emulator | `bun test` |
| `hone-relay/` | WebSocket sync relay | `bun test` |
| `hone-build/` | Plugin build coordinator | `bun test` |
| `hone-auth/` | Auth service (Perry-compiled native binary) | manual |
| `hone-marketplace/` | Plugin marketplace server | manual |
| `hone-themes/` | Color themes | `npm test` (Jest) |
| `hone-extensions/` | Built-in IDE extensions | `npm test` (Vitest) |
| `hone-api/` | Public API types | `npm test` (tsc only) |

Perry lives at `../perry/` (sibling directory). All Rust code — compiler, codegen, runtime, platform UI libs — is in Perry, **not** in any hone-* package.

## Development Workflow

### Pure-TypeScript packages (`hone-core`, `hone-editor`, `hone-terminal`, `hone-relay`, `hone-build`)

These compile and test with Bun. The cycle is fast — no native rebuild needed.

```bash
cd hone-core
# edit src/...
bun test                       # run all tests
bun test tests/git.test.ts     # run a single file
bun run typecheck              # type-check only
```

**Adding a feature here:**
1. Add the implementation in `src/`
2. Write tests in `tests/` using `import { test, expect } from 'bun:test'`
3. Run `bun test` until green
4. Run `bun run typecheck` to catch type errors

### Native binaries compiled by Perry (`hone-ide`, `hone-auth`, `hone-marketplace`, `hone-build`)

These are TypeScript that gets compiled to a **native binary** by Perry. There is no V8 or Node.js at runtime. Iteration is slower because every change requires re-compilation.

```bash
# Edit hone-ide/src/...

# Compile to native binary (~30s on first build, ~10s incremental)
cd ../perry && perry compile ../hone/hone-ide/src/app.ts \
  --output ../hone/hone-ide/hone-ide \
  --enable-geisterhand          # required for testing — see Testing section

# Run it
cd ../hone/hone-ide && ./hone-ide /path/to/test/project
```

**Critical Perry constraints** (the AOT compiler does not support all of TypeScript):

| Don't write | Write instead |
|---|---|
| `obj[variable]` dynamic key access | `if/else if` per key |
| `?.` optional chaining | Explicit null checks |
| `??` nullish coalescing | Explicit `if (x !== undefined)` |
| `/regex/.test()` | `indexOf` or char checks |
| `{ key }` ES6 shorthand | `{ key: key }` explicit |
| `array.map(fn)` on class fields | `for` loop |
| `for...of` on arrays | `for (let i = 0; i < arr.length; i++)` |
| `requestAnimationFrame` | `setInterval` (RAF never fires in Perry) |
| `setTimeout` self-recursion | `setInterval` |
| `new Date()` in async | `Date.now()` |
| Closures capturing `this` methods | Module-level functions reading module-level vars |

The full list is in `CLAUDE.md` under "Perry AOT Constraints". When Perry rejects your code, it almost always falls into one of these patterns.

### Building the Perry compiler itself

You only need to rebuild Perry when you change Rust code in `../perry/`:

```bash
cd ../perry

# Rebuild the compiler binary
CARGO_PROFILE_RELEASE_LTO=off cargo build --release -p perry

# Rebuild a platform UI library
CARGO_PROFILE_RELEASE_LTO=off cargo build --release -p perry-ui-macos

# After changing perry-runtime source, MUST rebuild perry-stdlib too:
cargo clean -p perry-runtime --release
CARGO_PROFILE_RELEASE_LTO=off cargo build --release \
  -p perry-stdlib -p perry-ui-macos -p perry
```

`CARGO_PROFILE_RELEASE_LTO=off` is mandatory on macOS — thin LTO produces bitcode that the macOS clang linker can't read.

## Testing Strategy

Hone has three layers of testing:

1. **Unit tests** — per-package, run with `bun test`/`npm test`. Cover pure logic.
2. **Agentic UI tests** — drive the running IDE via geisterhand HTTP APIs. Cover end-to-end workflows.
3. **Manual smoke tests** — cross-platform builds (iOS, iPad, Android) before release.

### 1. Unit tests

```bash
cd hone-core && bun test                 # 649+ tests
cd hone-editor && bun test               # 353 tests
cd hone-terminal && bun test             # 163 tests
cd hone-relay && bun test                # 48 tests
cd hone-build && bun test                # 21 tests
cd hone-themes && npm test               # 452 tests (Jest)
cd hone-extensions && npm test           # Vitest
cd hone-api && npm test                  # tsc --noEmit
```

**Important:** these packages use `bun test` (NOT `npx vitest`). Tests import from `'bun:test'`.

### 2. Agentic UI tests (geisterhand)

The IDE has an HTTP-driven testing harness that lets coding agents (like Claude Code) interact with the running app **without focusing the window**. Two HTTP servers run side-by-side:

| Port | Source | Best for |
|---|---|---|
| `:7676` | **Baked-in** (compiled into the binary via `--enable-geisterhand`) | Widget callbacks by handle, screenshots, chaos mode |
| `:7677` | **External CLI** (`geisterhand server`) | Keyboard shortcuts, scrolling, accessibility tree, wait-for-state |

The full endpoint reference is in [`hone-ide/tests/agentic/API.md`](hone-ide/tests/agentic/API.md).

#### Setup

```bash
# 1. Build the IDE with geisterhand baked in
cd ../perry && perry compile ../hone/hone-ide/src/app.ts \
  --output ../hone/hone-ide/hone-ide --enable-geisterhand

# 2. Launch IDE + external server with the test harness
cd ../hone/hone-ide/tests/agentic && bash setup.sh
```

`setup.sh` creates a temp project with a realistic git state (modified, staged, untracked files), launches the IDE, starts the external geisterhand server on :7677, and waits for both APIs to come up. State is recorded in `.test-state`.

#### Driving the IDE

**From the shell:**

```bash
# List all interactive widgets
curl http://127.0.0.1:7676/widgets | jq .

# Filter widgets by label or type
curl 'http://127.0.0.1:7676/widgets?label=Save'
curl 'http://127.0.0.1:7676/widgets?type=button'

# Get widget tree with visibility + frame rects
curl 'http://127.0.0.1:7676/widgets?tree=true' | jq .

# Click a widget by handle
curl -X POST http://127.0.0.1:7676/click/42

# Type into a text field
curl -X POST http://127.0.0.1:7676/type/15 \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello"}'

# Read a widget's current value
curl http://127.0.0.1:7676/value/15

# Trigger a keyboard shortcut (port 7676 — by registered menu shortcut)
curl -X POST http://127.0.0.1:7676/key -d '{"shortcut":"s"}'

# Or via the OS-level external CLI (port 7677 — works with any key)
curl -X POST http://127.0.0.1:7677/key \
  -H 'Content-Type: application/json' \
  -d '{"key":"b","modifiers":["cmd"]}'

# Scroll a scrollview
curl -X POST http://127.0.0.1:7676/scroll/8 -d '{"x":0,"y":200}'

# Wait for a widget to appear (replaces sleep)
curl -X POST http://127.0.0.1:7676/wait \
  -d '{"label":"Save","timeout":5000}'

# Capture a screenshot (works without window focus)
curl http://127.0.0.1:7676/screenshot -o /tmp/shot.png

# Get the macOS accessibility tree (port 7677)
curl 'http://127.0.0.1:7677/accessibility/tree?format=compact'

# Stress-test with chaos mode
curl -X POST http://127.0.0.1:7676/chaos/start -d '{"interval_ms":50}'
curl http://127.0.0.1:7676/chaos/status
curl -X POST http://127.0.0.1:7676/chaos/stop
```

#### Running the scenario suite

`hone-ide/tests/agentic/scenarios/` contains 10 markdown scenario files (startup, explorer, editor, search, git, terminal, settings, AI chat, sidebar, workflows). Each describes a sequence of steps and evaluation criteria.

To run them all, spawn a Claude Code agent with the prompt in [`hone-ide/tests/agentic/run-all.md`](hone-ide/tests/agentic/run-all.md). The agent executes each scenario, captures screenshots at every checkpoint, and produces a PASS/FAIL report.

To run a single scenario:

```
Read and execute hone-ide/tests/agentic/scenarios/05-git.md.
The IDE is on port 7676 (baked-in) and 7677 (external).
See tests/agentic/API.md for the endpoint reference.
Save screenshots to /tmp/test/ and Read each one as proof.
```

#### Teardown

```bash
cd hone-ide/tests/agentic && bash teardown.sh
```

Kills both the IDE and the external server, removes the temp project, preserves results in `tests/agentic/results/<timestamp>/`.

### 3. Manual cross-platform smoke tests

Before tagging a release, build and verify on each target platform. The full checklist is in [`hone-final-checklist.md`](hone-final-checklist.md).

```bash
# macOS
cd ../perry && perry compile ../hone/hone-ide/src/app.ts \
  --output ../hone/hone-ide/hone-ide

# iOS Simulator
cd ../perry && perry compile ../hone/hone-ide/src/app.ts \
  --target ios-simulator --output ../hone/hone-ide/Hone
cd ../hone/hone-ide && xcrun simctl install booted Hone.app && \
  xcrun simctl launch booted com.perry.Hone

# Web (single HTML file with WASM)
cd ../perry && perry compile ../hone/hone-ide/src/app.ts \
  --target web --output ../hone/hone-ide/hone-ide.html
```

Geisterhand also works on iOS Simulator — the baked-in API binds to `localhost:7676` which is reachable from the host.

## Adding a New Feature: Concrete Walkthrough

Suppose you're adding a "Recent Files" panel to the IDE. Here's the typical flow:

**1. Design and implement headless logic in `hone-core`**

```bash
cd hone-core
# Add src/recent-files/recent-files.ts with the data model + persistence
# Add tests/recent-files.test.ts
bun test tests/recent-files.test.ts
bun run typecheck
```

**2. Wire the UI in `hone-ide`**

```bash
cd hone-ide/src/workbench/views/
# Create recent-files/recent-files-panel.ts using @honeide/core
# Add it to render.ts and the activity bar
```

Remember the Perry constraints — no `?.`, no `for...of`, no closures over `this`, etc.

**3. Compile and run**

```bash
cd ../perry && perry compile ../hone/hone-ide/src/app.ts \
  --output ../hone/hone-ide/hone-ide --enable-geisterhand
cd ../hone/hone-ide && ./hone-ide /tmp/test-project
```

**4. Verify with geisterhand from a separate terminal**

```bash
# Did the new widgets register?
curl 'http://127.0.0.1:7676/widgets?label=Recent' | jq .

# Click the new entry
curl -X POST http://127.0.0.1:7676/click/<handle>

# Verify visually
curl http://127.0.0.1:7676/screenshot -o /tmp/recent.png && open /tmp/recent.png
```

**5. Add a scenario**

Add `hone-ide/tests/agentic/scenarios/11-recent-files.md` describing the steps and evaluation criteria. The next agentic test run will exercise it.

**6. Cross-platform**

If the feature should work on iOS too, recompile with `--target ios-simulator` and run the same geisterhand commands against the simulator.

## Common Gotchas

- **`@honeide/core` imports in `hone-ide`** require `--enable-js-runtime`, which adds 15MB. Avoid them when possible.
- **`eprintln!` in Perry GUI apps** doesn't reach the terminal when launched with `./hone-ide &`. Use file-based logging: `std::fs::OpenOptions::new().append(true).open("/tmp/hone-debug.log")`.
- **`setTimeout` self-recursion fires once** — Perry closures capture by value. Use `setInterval` for repeating loops.
- **Widget handles can change after UI updates** — always `GET /widgets` before clicking in tests.
- **Black screenshots** mean the IDE hasn't finished rendering yet — add `sleep 2` after launch.
- **Port 7676 not responding** means the binary wasn't built with `--enable-geisterhand`. Check `lsof -i :7676`.
- **Database schemas use camelCase** for all identifiers (consistent with TypeScript).

## Where to Look Next

- [`CLAUDE.md`](CLAUDE.md) — full project reference, all build commands, Perry FFI conventions
- [`hone-ide/tests/agentic/API.md`](hone-ide/tests/agentic/API.md) — complete geisterhand endpoint reference
- [`hone-ide/tests/agentic/run-all.md`](hone-ide/tests/agentic/run-all.md) — how to run the scenario suite
- [`docs/src/contributing/setup.md`](docs/src/contributing/setup.md) — first-time environment setup
- [`docs/src/perry/`](docs/src/perry/) — Perry compiler internals and platform notes
- [`hone-final-checklist.md`](hone-final-checklist.md) — pre-release manual test checklist
- `../perry/docs/src/testing/geisterhand.md` — geisterhand reference in the Perry repo
