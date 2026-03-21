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

```bash
# Build all Perry crates together (shared perry-runtime compilation)
cd ../perry
cargo build --release -p perry-ui-windows -p perry-stdlib -p perry

# Copy libs to hone-ide
cp target/release/perry_ui_windows.lib ../hone/hone-ide/target/release/
cp target/release/libperry_ui_windows.rlib ../hone/hone-ide/target/release/
cp target/release/perry_stdlib.lib ../hone/hone-ide/target/release/
cp target/release/perry_runtime.lib ../hone/hone-ide/target/release/

# Compile IDE
cd ../hone/hone-ide
perry compile src/app.ts --target windows --output hone-ide
mv hone-ide hone-ide.exe
```
