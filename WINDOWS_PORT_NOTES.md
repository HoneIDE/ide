# Windows Port — Technical Notes

## Status (2026-03-21)

The IDE compiles and launches on Windows. The setup screen works fully.
The full workbench launches but crashes after ~10-20 seconds due to a
timer callback hitting a continuation function with incorrect type info.
This is being actively fixed in the Perry compiler.

## Perry Compiler Changes

All changes are in the `perry` repo. Zero TypeScript changes were needed.

### 1. Windows Linker Dedup (compile.rs)

**Problem:** Perry links two Rust staticlibs (`perry-stdlib` and
`perry-ui-windows`) that both bundle transitive deps (std, alloc, core,
perry-runtime). On Windows, duplicate CRT init entries cause crashes, and
`/FORCE:MULTIPLE` produces corrupt binaries.

**Fix:** Rewrote the dedup to use the **rlib** (not staticlib) for
perry-ui-windows. The rlib contains only the UI crate's own code. UI-only
dependencies are identified via set-difference against perry-stdlib's
member list. Applied to ALL native libs (editor + UI). Also filters out
allocator shim CGUs from rlib extraction.

**Scope:** Windows only (`is_windows` guard). macOS/Linux/iOS paths untouched.

### 2. Function Splitting (functions.rs)

**Problem:** Cranelift generates incorrect machine code for very large
functions (>3MB compiled code, ~240K relocations) on Windows. The
`renderWorkbench` function (5000 lines TS, 131 HIR statements) triggers this.

**Fix:** When a function has >50 top-level statements and targets Windows,
the compiler splits it into continuation functions. Each continuation takes
a pointer to a stack-allocated locals buffer, loads variables at entry,
compiles its chunk of statements, stores variables back, and returns a
status code (0=continue, 1=early-return).

**Scope:** Windows only (`compile_target == 3` guard).

### 3. Missing FFI Symbols (perry-ui-windows/lib.rs)

Added 23 missing `#[no_mangle]` FFI functions:
- Device/screen stubs (perry_get_screen_width, etc.) — iOS-only, stub on all desktop
- TextArea (create, get/set string)
- TextField focus (set_on_focus, blur_all)
- Stack alignment, overlay, edge insets
- App icon, file polling
- Splitview/VBox/FrameSplit stubs

Removed 8 duplicate stubs (backOff, js_fetch_*, js_crypto_*, js_ws_handle_to_i64)
that conflicted with perry-stdlib.

**Scope:** Windows-only crate.

### 4. RefCell Re-entrancy (perry-ui-windows/widgets/mod.rs)

**Problem:** Win32 message loop sends WM_SIZE during ShowWindow, which
calls layout code that borrows the widget registry while it's already
mutably borrowed → RefCell panic.

**Fix:** All `w.borrow()` calls in message-loop-reachable code now use
`try_borrow()` with graceful fallback (return None/0).

**Scope:** Windows-only crate.

### 5. Runtime Null Safety (perry-runtime)

**Problem:** Functions returning `*mut StringHeader` returned null on
error. Perry's try/catch can't catch null-pointer segfaults, so callers
that access `.length` on the result crash.

**Fixes:**
- `readFileSync` → returns empty string instead of null on error
- `execSync` → returns empty string instead of null on error
- `js_nanbox_string(null)` → allocates empty string instead of boxing null
- `js_nanbox_get_pointer` → now extracts JS_HANDLE_TAG (0x7FFB) values
- `inline_get_string_pointer` → null guard for zero input

**Scope:** All platforms. Strictly safer behavior.

### 6. Stack Size (compile.rs)

Reserve 64MB stack on Windows (was 1MB default). Large codebases with
100+ module init functions need more stack space.

**Scope:** Windows only (MSVC `/STACK:` flag).

### 7. Layout Guard (perry-ui-windows/layout.rs)

Replace `unwrap()` on `get_widget_info()` in layout_stack with graceful
fallback, preventing panics during re-entrant layout passes.

**Scope:** Windows-only crate.

## Known Remaining Issue

The full workbench crashes after ~10-20 seconds. The function splitting
continuation functions use `is_union: true` for ALL locals, losing the
original type information (is_string, is_pointer, etc.). When a
continuation accesses a string variable, it treats the i64 pointer as
f64, causing a type mismatch crash. Fix: preserve LocalInfo type flags
across the split boundary.

## Build Instructions

Two viable layouts depending on your perry install.

**Option A — In-tree dev (perry source checkout next to hone-ide):**

```bash
# Build all perry crates for the Windows target. The triple-specific
# release dir is where modern perry looks first for cross-compile libs.
cd ../perry
cargo build --release --target x86_64-pc-windows-msvc \
  -p perry-ui-windows -p perry-stdlib -p perry-runtime -p perry

# Compile IDE — perry resolves libs via its own ../target/<triple>/release/
# (relative to the perry exe in target/release/).
cd ../hone/hone-ide
perry compile src/app.ts --target windows --output hone-ide
# Perry auto-appends .exe on Windows targets, producing hone-ide.exe
```

**Option B — installed perry + out-of-tree libs (PERRY_RUNTIME_DIR):**

When perry is `cargo install`'d to `~/.cargo/bin/` (or installed via
winget / Homebrew bottle), it no longer has access to its source-tree
target dir. Point it at the lib dir explicitly:

```powershell
# PowerShell (Windows)
$env:PERRY_RUNTIME_DIR = "C:\path\to\perry\target\x86_64-pc-windows-msvc\release"
perry compile src/app.ts --target windows --output hone-ide
```

```bash
# bash (cross-compile from macOS/Linux)
export PERRY_RUNTIME_DIR=/path/to/perry/target/x86_64-pc-windows-msvc/release
perry compile src/app.ts --target windows --output hone-ide
```

**Note**: as of perry 0.4.40, the env-var override is present in source
but not in the released binary. If `PERRY_RUNTIME_DIR` doesn't take
effect, the install is from an older release — reinstall from source
with `cargo install --path crates/perry --force` against the current
perry tree.

## TypeScript-side Windows portability sweep (2026-05-13 / 14)

A multi-iteration `/loop` audit closed dozens of TS-side Windows portability
issues. Most of these were silently failing on Windows; some were broken on
every platform. Categorized:

### Subprocess / shell

- **`which X` → `where X`** in claude-process (Claude Code lookup) +
  lsp-bridge (tsgo/typescript-language-server discovery) + render.ts
  (Claude relay). New `findExecutableOnPath(name)` helper in lsp-bridge
  branches on `__platform__`.
- **`kill <pid>` → `taskkill /F /PID <pid>`** in 3 sites (Claude relay
  cleanup, claude session stop, claude relay startup teardown).
- **`kill -0 <pid>` liveness → `tasklist /FI "PID eq <pid>" /NH`** in
  chat-panel poll loop and render.ts relay poll loop (`INFO:` prefix or
  non-zero exit ⇒ process gone).
- **`/bin/sh -c` shell spawn → `cmd.exe /c`** in 3 background-spawn sites
  (Claude session start, Claude relay start, lsp-bridge fallback `tsc`
  diagnostic). `/dev/null` → `NUL` for the null-device handle.
- **POSIX `'\''` single-quote escaping → Windows `""` double-quote
  escaping** in `shellEscape` (claude-process) and `shellEscapeRelay`
  (render.ts). Without this, filenames-with-spaces arrived as multiple args
  on Windows.
- **`bash -c "cd <ws> && git ..."` → argv-form `spawnSync('git', ['-C',
  wsRoot, ...])`** in agent_git_status + agent_git_diff + git-blame +
  diff-view. Also closes a #1 shell-injection hole.
- **`ls -la` → `readdirSync` + isDirectory** in the agent_list_dir tool
  (zero-shell directory listing).
- **`echo $VAR` → `process.env[VAR]`** in chat-panel provider-key
  auto-detect (cross-platform + faster, no shell roundtrip).
- **Ripgrep shell-quoted query → argv `spawnSync('rg', [...])`** in
  search-panel (POSIX `'\\''` escapes don't work in cmd).
- **curl shell-string → argv `spawnSync('curl', [...])`** in
  marketplace-browser (URLs with `&` would shell-split otherwise).
- **`bin + ' auth status'` shell concat → argv `spawnSync(bin, ['auth',
  'status'])`** in `checkClaudeAuth` (bin under `%APPDATA%\Roaming\npm\` has
  spaces).
- **Debug-panel buildRunCommand**: `/tmp/hone-debug-bin` →
  `getTempDir() + '/hone-debug-bin.exe'` on Win; `cd` → `cd /d`;
  `python3` → `python`.

### Native dialogs (prompts)

- **`osascript display dialog` → `PowerShell + System.Windows.Forms.MessageBox`**
  for the dirty-tab close confirm (`promptCloseDirtyTab`).
- **`osascript text input` → `PowerShell + Microsoft.VisualBasic.InputBox`**
  for `promptForRename` (LSP rename), `promptForSessionTitle` (chat session
  rename), file create / folder create / rename prompts in explorer
  context-menu. Shared `promptInputCrossPlatform` + `confirmCrossPlatform`
  helpers in context-menu.ts.

### File ops

- **`mv $(cat tmpfile)` shell tricks → argv `spawnSync('mv'|'cmd /c move',
  [src, dst])`** in explorer-context-menu rename. Same for delete (`rm -rf`
  / `rmdir /S /Q`). No more `/tmp/hone_*.tmp` indirection.
- **`open -R <path>` → `explorer /select,<path>` on Win / `xdg-open
  <parent>` on Linux** for reveal-in-folder.
- **`pbcopy < /tmp/hone_clip.tmp` → `clipboardWrite` from perry/ui**
  (already cross-platform). Removed the `/tmp` indirection.

### Paths

- **`getTempDir()`** in paths.ts now honors `$env:TEMP` / `$env:TMP` on
  Windows (falls back to `%USERPROFILE%/AppData/Local/Temp`). Used by
  render timing logs, tasks-panel log fallback, debug-panel build output.
- **Terminal default cwd** was the previous-developer literal
  `/Users/amlug`; replaced with `process.env.HOME` (Unix) /
  `process.env.USERPROFILE` (Windows) / `process.cwd()` fallback.
- **Terminal default shell**: `__platform__` switch — `powershell.exe` on
  Win, `/bin/bash` on Linux, `/bin/zsh` else. User-overridable via new
  `terminalShell` setting.
- **`plugins.ts`** was passing the literal string `'~/.hone/plugins'` to a
  Rust FFI that doesn't shell-expand `~`. **Plugin loader was silently
  broken on every platform.** Fixed via `getAppDataDir() + '/plugins'`.

### Visuals

- **`'Menlo'` (macOS-only mono font) → `monoFont()` helper** in 15 files /
  ~40 call sites. Returns `Menlo` on Mac, `Consolas` on Win, `DejaVu Sans
  Mono` on Linux. All TS-rendered widgets (panels, popups, status bar,
  chat) now show proper monospace on Windows instead of Courier New
  fallback.
- **SF Symbols (`'chevron.right'`, `'xmark'`, etc.) → `setIconButton`
  helper** in ~80 call sites across 9 files. Uses `buttonSetImage` on Mac,
  `buttonSetTitle(unicodeForSymbol(name))` on every other platform. Closed
  via a 27-entry mapping table (chevrons `›˅˄`, `xmark`→`✕`, `folder`→`📁`,
  `gearshape`→`⚙`, etc.). File explorer chevrons, tab close `×`, find-bar
  buttons, debug toolbar, etc. now show visible glyphs on Windows instead
  of being blank.

### .gitignore

Added `stderr*.log`, `screenshot*.png`, `.perry/`, `.claude/` patterns so
dev-session detritus stays untracked.

### Caught build-saves

`perry compile --target windows` caught two broken module compiles
introduced during the audit:
1. `buildReviewPanel` (orphan `review-panel.ts` brought live by sync-panel
   wiring) tripped Perry's AOT verifier — rewrote the closure pattern to
   match git-panel's named-function style + `scrollViewSetChild` form.
   Also pre-fixed dead `buildProposalCard` / `buildGroupCard` /
   `buildConflictCard` for v1.1.
2. `buildRunCommand` ternary string assignment tripped the verifier —
   replaced ternary with `let + if/else`.

### Verifying clean compile

```bash
perry compile src/app.ts --target windows --output hone-ide-test 2>&1 | \
  grep -E "Error compiling|PANIC|failed to compile"
```

All modules compile cleanly post-sweep. The only remaining failure is the
dev-env missing `perry_runtime.lib` (build-setup, not code).
