# CLAUDE.md — Hone IDE

## What this repo is

The IDE shell for Hone — compiled from TypeScript to native UI via the Perry compiler.
No Rust here. All Rust lives in `../perry/` (Perry compiler) and its sub-crates.

## Commands

```bash
# Compile for macOS (from hone-ide/)
perry compile src/app.ts --output hone-ide

# Compile for Windows (from hone-ide/)
perry compile src/app.ts --target windows --output hone-ide
mv hone-ide hone-ide.exe  # Perry outputs without .exe extension

# Run
./hone-ide       # macOS
./hone-ide.exe   # Windows

# Type check only
bun run typecheck
```

## Critical Perry rules

**Perry captures closure variables by VALUE, not by reference.**

This means: store mutable widget handles in module-level `let` variables and access them through named functions — never from within closures.

```typescript
// ✅ CORRECT — named function reads module-level var at call time
let myButton: unknown;
function updateButton() { buttonSetTitle(myButton, 'new text'); }
const btn = Button('click', () => { updateButton(); });
myButton = btn;  // back-reference works

// ❌ WRONG — closure captures myButton's value (null) at creation time
let myButton: unknown;
const btn = Button('click', () => { buttonSetTitle(myButton, 'new text'); });
myButton = btn;  // too late, closure already captured null
```

## Perry import rules

- `perry/ui` — all UI widgets and mutation functions
- Relative imports (`./ ../`) — Perry compiles these natively ✅
- `@honeide/core` — requires `--enable-js-runtime` (adds ~15MB, avoid for UI code)
- Instead, put Perry-native runtime modules in `src/workbench/` directly

## Build Perry itself

Only needed when changing Perry's Rust code:

```bash
# Perry compiler
cd ../perry && cargo build --release -p perry

# Perry UI library — macOS (MUST disable LTO — thin LTO produces bitcode macOS linker can't read)
cd ../perry && CARGO_PROFILE_RELEASE_LTO=off cargo build --release -p perry-ui-macos

# Perry UI library — Windows
cd ../perry && cargo build --release -p perry-ui-windows

# Perry stdlib (runtime functions used by generated code)
cd ../perry && cargo build --release -p perry-stdlib
```

After rebuilding perry-ui-windows, delete the trimmed lib cache:
```bash
rm perry/target/release/_perry_ui_trimmed.lib
```

## Structure

```
src/
├── app.ts                    # Perry App() entry point
├── platform.ts               # Platform detection, LayoutMode
├── commands.ts               # registerBuiltinCommands()
├── keybindings.ts            # getDefaultKeybindings(platform)
├── menu.ts                   # App menu setup
├── window.ts                 # Multi-window management
└── workbench/
    ├── render.ts             # renderWorkbench(layoutMode) — main UI tree
    ├── settings.ts           # Runtime settings (getWorkbenchSettings, updateSettings)
    ├── layout/
    │   ├── grid.ts           # GridNode — resizable panel layout
    │   ├── tab-manager.ts    # TabManager — editor tabs
    │   ├── panel-registry.ts # Panel registration, BUILTIN_PANELS
    │   ├── activity-bar.ts   # Activity bar layout helpers
    │   ├── status-bar.ts     # Status bar layout helpers
    │   └── index.ts          # Layout barrel export
    ├── theme/
    │   ├── theme-loader.ts   # loadTheme, getActiveTheme, ResolvedUIColors
    │   ├── builtin-themes.ts # HONE_DARK, HONE_LIGHT theme data
    │   ├── token-theme.ts    # TextMate token color resolution
    │   ├── ui-theme.ts       # UI theme types
    │   ├── load-builtin-themes.ts
    │   └── index.ts          # Theme barrel export
    └── views/
        ├── explorer/         # File explorer panel
        │   ├── file-tree.ts
        │   ├── file-tree-item.ts
        │   ├── file-operations.ts
        │   └── index.ts
        └── quick-open/       # Quick open (Cmd+P / Ctrl+P)
            └── quick-open.ts
```

## Perry UI API cheatsheet

```typescript
import {
  App, VStack, HStack, VStackWithInsets, HStackWithInsets,
  Text, Button, Spacer,
  textSetColor, textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetTextColor, buttonSetTitle,
  widgetSetBackgroundColor, widgetAddChild,
  widgetSetWidth, widgetSetHugging,
} from 'perry/ui';

// Create widgets
const stack = VStack(spacing, [child1, child2]);
const btn = Button('label', () => { /* callback */ });
const txt = Text('hello');

// Mutate after creation
textSetColor(txt, r, g, b, a);       // 0.0–1.0 per channel
buttonSetTextColor(btn, r, g, b, a); // uses NSAttributedString internally
widgetSetBackgroundColor(w, r, g, b, a);
buttonSetTitle(btn, 'new label');
widgetSetWidth(w, 220);              // fixed width (Auto Layout constraint)
widgetSetHugging(w, 750);           // content hugging priority
```

## Layout architecture

- **Activity bar**: 48px wide, left edge, VStack with icon buttons
- **Sidebar**: 220px wide, configurable left or right via `settings.sidebarLocation`
- **Editor**: fills remaining space (low hugging priority)
- **Status bar**: HStack at bottom
- Window content pinned to `contentLayoutGuide` (not superview) to avoid title bar overlap (macOS)
- On Windows, layout uses Win32 child HWNDs with manual positioning in WM_SIZE

## Workbench settings

Runtime settings in `src/workbench/settings.ts`:

```typescript
import { getWorkbenchSettings, updateSettings } from './workbench/settings';

const s = getWorkbenchSettings();
// s.sidebarLocation: 'left' | 'right'
// s.activityBarLocation: 'side' | 'top' | 'bottom' | 'hidden'
// s.colorTheme, s.editorFontSize, etc.

updateSettings({ sidebarLocation: 'right' });
```

## Testing interactions

```bash
# Screenshot
geisterhand screenshot --output /tmp/shot.png

# Click (screen coordinates)
geisterhand click x y

# Get button positions (AppleScript)
osascript -e 'tell application "System Events" to tell process "hone-ide" to get position of every button of window 1'
```

## Slice plan

See `../INTEGRATED_PLAN.md` for the full roadmap (audited 2026-03-04).

**Done:**
- Slice 0: Shell + theme ✅ (`render.ts`, `theme/`, `layout/`)
- Slice 1: File explorer ✅ (`views/explorer/`, `views/quick-open/`)
- Slice 2: Settings runtime ✅ (`settings.ts`) — UI views still needed
- Slice 3: Editor integration ✅ (embedded via Perry FFI, tabs, syntax highlighting)
- Slice 4: Git panel ✅ inline in `render.ts` (stage/unstage/discard/commit/branch)
- Slice 5: Search panel ✅ inline in `render.ts` (recursive search, replace)
- Windows port ✅ (all UI features working)

**Next up (IDE views needed for done core modules):**
- Slice 9: AI Inline ghost text wiring → `EditorViewModel.ghostText`
- Slice 10: AI Chat → `views/ai-chat/`
- Slice 11: Terminal embedding → `views/terminal/`
- Slice 2: Settings/Welcome/Notifications UI → `views/settings-ui/`, `views/welcome/`
- Slice 6: LSP views → autocomplete popup, hover, diagnostics
- Slice 7: Debug views → `views/debug/`
- Slice 12: AI Agent → `views/ai-agent/`, `views/diff-view/`
- Slice 13: PR Review → `views/pr-review/`
- Slice 14: Extensions → `views/extensions/`

**Refactoring needed:**
- Extract git views from `render.ts` into `views/git/` (separate files)
- Extract search views from `render.ts` into `views/search/` (separate files)
