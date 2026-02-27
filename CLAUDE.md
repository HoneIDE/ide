# CLAUDE.md — Hone IDE

## What this repo is

The IDE shell for Hone — compiled from TypeScript to native UI via the Perry compiler.
No Rust here. All Rust lives in `../perry/` (Perry compiler) and its sub-crates.

## Commands

```bash
# Compile (from hone-ide/)
perry compile src/app.ts --output hone-ide

# Run
./hone-ide

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

# Perry UI library (MUST disable LTO — thin LTO produces bitcode macOS linker can't read)
cd ../perry && CARGO_PROFILE_RELEASE_LTO=off cargo build --release -p perry-ui-macos
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
    │   └── activity-bar.ts   # Activity bar layout helpers
    └── theme/
        ├── theme-loader.ts   # loadTheme, getActiveTheme, ResolvedUIColors
        ├── builtin-themes.ts # HONE_DARK, HONE_LIGHT theme data
        └── token-theme.ts    # TextMate token color resolution
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
- Window content pinned to `contentLayoutGuide` (not superview) to avoid title bar overlap

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

See `../INTEGRATED_PLAN.md` for the full roadmap. Each slice adds views under `src/workbench/views/`:
- Slice 0: Shell + theme ✅ (`render.ts`, `theme/`)
- Slice 2: Settings runtime ✅ (`settings.ts`)
- Slice 3: Editor integration 🔜 (`views/editor/`)
- Slice 4: Git 🔜 (`views/git/`)
- Slice 5: Search 🔜 (`views/search/`)
- Slice 10: AI Chat 🔜 (`views/ai-chat/`)
- Slice 12: AI Agent 🔜 (`views/ai-agent/`)
