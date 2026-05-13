# Integrated Implementation Plan: hone-core + hone-ide

> **Last audited:** 2026-03-04
> **hone-core tests:** 499 passing (14 test files, 55 source files)
> **hone-ide source:** 26 files, 6,336 lines, 3.6MB native binary (macOS)

## Current Status Summary

### Supporting Packages — All Complete

| Package | Status | Files | Notes |
|---------|--------|-------|-------|
| `@honeide/api` | ✅ Done | 10 TS files | Zero-runtime type definitions |
| `@honeide/editor` | ✅ Done | 50 core + 11 view-model + Rust FFI | Piece-table, tokenizer, LSP/DAP client, diff, folding |
| `@honeide/terminal` | ✅ Done | 19 core + 6 view-model + Rust FFI | VT parser, PTY, screen buffer |
| `@honeide/themes` | ✅ Done | 11 theme JSON files | Hone Dark/Light, Catppuccin, Dracula, GitHub, Monokai, Nord, One Dark, Solarized |
| `@honeide/extensions` | ✅ Done | 11 built-in extensions | TS, Python, Rust, Go, C++, HTML/CSS, JSON, Markdown, Git, Docker, TOML/YAML |
| `hone-brand` | ✅ Done | Design assets | Logos, colors, typography, guidelines |
| `hone.dev` | ✅ Live | Astro site | Documentation |
| `landing` | ✅ Live | Static HTML | Landing page |

### Slice Status At-a-Glance

| Slice | Core | IDE | Overall |
|-------|------|-----|---------|
| 0 — Shell & Theme | n/a | ✅ Done | ✅ Done |
| 1 — Workspace & Explorer | ✅ Done | ✅ Done | ✅ Done |
| 2 — Settings & Keybindings | ✅ Done | ⚠️ Core logic only | ⚠️ Partial — IDE views missing |
| 3 — Editor Integration | n/a | ✅ Done | ✅ Done (breadcrumb/find-replace deferred) |
| 4 — Git & Source Control | ⚠️ Partial | ⚠️ Inline in render.ts | ⚠️ Partial — see gaps |
| 5 — Search | ⚠️ Partial | ⚠️ Inline in render.ts | ⚠️ Partial — see gaps |
| 6 — LSP | ⚠️ Types only | ❌ Not started | ⚠️ Partial — needs manager/client |
| 7 — Debug | ⚠️ Types only | ❌ Not started | ⚠️ Partial — needs manager/client/tasks |
| 8 — AI Provider | ⚠️ 2 of 8 adapters | ❌ Not started | ⚠️ Partial — 6 adapters missing |
| 9 — AI Inline | ✅ Done | ❌ Not started | ⚠️ Core done, IDE missing |
| 10 — AI Chat | ✅ Done | ❌ Not started | ⚠️ Core done, IDE missing |
| 11 — Terminal | n/a | ❌ Not started | ❌ Not started |
| 12 — AI Agent | ⚠️ Partial | ❌ Not started | ⚠️ Core partial, IDE missing |
| 13 — AI Review | ⚠️ Partial | ❌ Not started | ⚠️ Core partial, IDE missing |
| 14 — Extensions | ⚠️ Partial | ❌ Not started | ⚠️ Core partial, IDE missing |
| 15 — Polish & Packaging | — | — | ❌ Not started |

---

## Context

hone-core (headless services) and hone-ide (UI shell) cannot be built in isolation — they must grow together in **vertical feature slices**. Each slice delivers a visible, testable feature by pairing a core service with its IDE view.

**Prerequisites (all confirmed complete):**
- `@honeide/api` — ✅ 10 type definition files, zero runtime
- `@honeide/editor` — ✅ 50 core + 11 view-model files, Rust FFI for 6 platforms
- `@honeide/terminal` — ✅ 19 core + 6 view-model files, Rust FFI for 6 platforms
- `@honeide/themes` — ✅ 11 theme JSON files
- `@honeide/extensions` — ✅ 11 built-in extensions with LSP configs
- Perry compiler — ✅ working on macOS, iOS, Windows targets confirmed

**Target platforms (all, from day one):**
- Desktop: macOS, Windows, Linux
- Mobile: iOS (iPhone), iPadOS (iPad), Android (phone + tablet)
- Web: browser-hosted

**Mobile-first design principle:** Every feature must consider touch interaction, compact layouts, and platform-appropriate UX patterns from the start. Mobile is NOT a "shrink the desktop" afterthought.

---

## Platform Adaptation Strategy

Every slice below must address these platform concerns:

### Input Model

| Platform | Primary Input | Secondary Input |
|----------|--------------|-----------------|
| Desktop (macOS/Win/Linux) | Keyboard + mouse | Trackpad gestures |
| iPad / Android tablet | Touch + Apple Pencil/stylus | Hardware keyboard (when attached) |
| iPhone / Android phone | Touch | Software keyboard |
| Web | Keyboard + mouse | Touch (responsive) |

### Layout Modes

| Mode | Platforms | Description |
|------|----------|-------------|
| **Full workbench** | Desktop, iPad landscape, Android tablet landscape | Sidebar + editor + bottom panel |
| **Split** | iPad portrait, Android tablet portrait | Two-column (narrow sidebar + editor) |
| **Compact** | iPhone, Android phone | Single panel, bottom nav, swipe navigation |
| **Web responsive** | Browser | Full at ≥1024px, split at ≥768px, compact at <768px |

### Navigation Patterns

- **Desktop:** Keyboard shortcuts, menu bar, command palette (Ctrl+Shift+P)
- **Tablet:** Sidebar + tab bar, long-press for context menus, keyboard shortcuts when hw keyboard attached
- **Phone:** Bottom tab bar (4 icons: Files, Editor, AI, Terminal), swipe between panels, floating action button for commands
- **All mobile:** Pull-to-refresh in lists, swipe-to-dismiss, haptic feedback on actions

### Per-View Mobile Adaptation Rules

Each view in the plan specifies:
1. **Compact layout** — what it looks like on phone
2. **Touch targets** — minimum 44×44pt tap targets
3. **Gestures** — swipe, long-press, pinch behaviors
4. **Keyboard avoidance** — how it handles software keyboard appearance
5. **Offline behavior** — what works without network (critical for mobile)

---

## Slice 0: Workbench Shell & Theme Engine — ✅ DONE

**Core files:** (none — pure UI)

**IDE files — all exist:**
- `workbench/layout/grid.ts` — ✅ Resizable split panel engine (GridNode immutable tree)
- `workbench/layout/tab-manager.ts` — ✅ Editor tabs (split, drag, reorder, pin, preview, MRU)
- `workbench/layout/panel-registry.ts` — ✅ 10 built-in panels registered
- `workbench/layout/activity-bar.ts` — ✅ Left icon strip (desktop/tablet) / bottom tab bar (phone)
- `workbench/layout/status-bar.ts` — ✅ Bottom status bar with left/center/right segments
- `workbench/theme/theme-loader.ts` — ✅ Theme JSON loading, 40+ color definitions
- `workbench/theme/builtin-themes.ts` — ✅ Embedded Hone Dark theme
- `workbench/theme/token-theme.ts` — ✅ TextMate scope → color resolution (20+ rules)
- `workbench/theme/ui-theme.ts` — ✅ UI color provider
- `app.ts` — ✅ Perry App() entry point (81 lines)
- `window.ts` — ✅ Window management (147 lines)
- `menu.ts` — ✅ Application menu definitions (161 lines)
- `commands.ts` — ✅ 20+ built-in commands (File, Edit, View)
- `keybindings.ts` — ✅ Platform-aware keybindings with chord support

**What it delivers:** ✅ All delivered
- ✅ Workbench shell with resizable panels, tabs, activity bar, status bar
- ✅ Theme loading and color application (Hone Dark embedded, 11 themes available)
- ✅ Platform-adaptive layout (full/split/compact modes, breakpoints at 767px/1023px)
- ✅ Native menu bar (macOS) with keyboard shortcuts
- ✅ Command palette / Quick open overlay

**Mobile specifics:** ✅ Layout modes implemented in `platform.ts`
- ✅ Phone: Bottom tab bar, compact single-panel layout
- ✅ Tablet: Activity bar on left, two-column layout
- ✅ Platform detection: `__platform__` compile-time constant (0=macOS, 1=iOS, 2=Android, etc.)

**Tests:** Grid layout, tab management, theme resolution — covered by hone-core settings tests (59 tests) + hone-editor tests.

---

## Slice 1: Workspace & File Explorer — ✅ DONE

**Core files — all exist (59 tests):**
- `workspace/workspace.ts` — ✅ Multi-root workspace, folder management, ignore patterns, events
- `workspace/file-watcher.ts` — ✅ Debounced filesystem watching, event coalescing
- `workspace/file-index.ts` — ✅ Trie-based fuzzy file finder with scoring

**IDE files — all exist:**
- `workbench/views/explorer/file-tree.ts` — ✅ Hierarchical file tree with lazy-loading (393 lines)
- `workbench/views/explorer/file-tree-item.ts` — ✅ Tree node with 30+ file type icons (207 lines)
- `workbench/views/explorer/file-operations.ts` — ✅ Create/rename/delete/move/copy (284 lines)
- `workbench/views/quick-open/quick-open.ts` — ✅ Cmd+P fuzzy finder with scoring (253 lines)

**What it delivers:** ✅ All delivered
- ✅ Open folder, browse file tree, create/rename/delete files
- ✅ Fuzzy file finder (Cmd+P on desktop, full-screen on phone)
- ✅ File watching, expandable directories, DJB2 hash for expansion tracking
- ✅ Open Folder button when no workspace, ScrollView wrapper, depth limit

**Mobile specifics:**
- ✅ Phone: File explorer as full-screen "Files" tab
- ✅ Tap file → opens in editor
- ✅ Context menus via `widgetSetContextMenu`
- **Remaining:** iOS Files.app integration, Android SAF integration (platform-specific, Slice 15)

**Tests:** 59 tests passing — fuzzy search accuracy, file watcher debouncing, tree construction, file CRUD.

---

## Slice 2: Settings, Keybindings & Onboarding — ⚠️ PARTIAL

**Core files — all exist (59 tests):**
- `settings/settings-store.ts` — ✅ 4-layer resolution (language > workspace > user > defaults)
- `settings/keybindings.ts` — ✅ KeybindingResolver, chords, when-clauses
- `settings/schema.ts` — ✅ 50+ built-in settings, JSON Schema validation

**IDE files — core runtime only:**
- `workbench/settings.ts` — ✅ Runtime settings (sidebarLocation, activityBarLocation, colorTheme, editorFontSize, aiProvider, etc.)

**IDE files — NOT yet implemented:**
- `workbench/views/settings-ui/settings-view.ts` — ❌ Visual settings editor
- `workbench/views/settings-ui/settings-tree.ts` — ❌ Settings category tree
- `workbench/views/settings-ui/setting-row.ts` — ❌ Individual setting control
- `workbench/views/settings-ui/keybindings-view.ts` — ❌ Keybinding editor
- `workbench/views/welcome/welcome-tab.ts` — ❌ First-launch welcome
- `workbench/views/welcome/onboarding.ts` — ❌ AI provider setup wizard
- `workbench/views/notifications/notifications.ts` — ❌ Toast notification manager

**What's done:**
- ✅ Layered settings with schema validation (core)
- ✅ Keybinding resolution with chords and when-clauses (core)
- ✅ Runtime settings reactive updates in IDE

**Remaining work:**
- ❌ Visual settings editor (search, categories, inline editing)
- ❌ Keybinding customization UI
- ❌ Welcome screen on first launch
- ❌ AI provider setup wizard (API key entry, test connection)
- ❌ Toast notification manager
- ❌ Mobile-specific: flat list settings (phone), two-column (tablet), onboarding wizard

**Mobile specifics:**
- **Phone:** Settings as native-feeling scrollable list. Categories as sections. No tree — flat list with headers.
- **Tablet:** Two-column settings: categories on left, detail on right.
- **Onboarding:** Full-screen wizard (card-based, swipe to advance). API key entry with paste button.
- **Notifications:** iOS-style banner (top) / Android-style snackbar (bottom).

**Tests:** 59 tests passing — settings layer resolution, keybinding chord matching, when-clause evaluation.

---

## Slice 3: Editor Integration — ✅ DONE (core features)

**Core files:** (none — editor is standalone `@honeide/editor`)

**IDE files — implemented in render.ts:**
- ✅ Tab opening wires to `Editor` class from `@honeide/editor/perry`
- ✅ `embedNSView()` + `hone_editor_nsview()` FFI for native editor embedding
- ✅ Real file loading via `readFileSync()`, syntax highlighting via KeywordSyntaxEngine
- ✅ Status bar: cursor position, language detection
- ✅ Interactive editing: TypeScript event polling (setInterval 16ms) + Perry pump timer (8ms)
- ✅ Tab management: open/close/switch, VS Code-style tabs with close buttons

**Deferred (non-blocking):**
- ❌ Breadcrumb bar (nice-to-have, not blocking)
- ❌ Find/replace widget wiring (editor has search; IDE wiring pending)
- ❌ Multiple editor groups / split view

**Mobile specifics:**
- ✅ Single editor, full-screen on phone
- ✅ iOS: `ts_mode` with `becomeFirstResponder` for keyboard, UIKeyInput protocol
- **Remaining:** Software keyboard toolbar (Tab, Undo, Redo, arrows), Apple Pencil selection, Samsung DeX

**Tests:** 353 hone-editor tests pass (3 expected-fail: dirty-tracking + code-folding).

---

## Slice 4: Git & Source Control — ⚠️ PARTIAL

**Core files — partially implemented (39 tests):**
- `git/git-client.ts` — ✅ Shell-based git operations via execSync
- `git/status.ts` — ✅ `git status --porcelain=v2` parser
- `git/diff.ts` — ✅ Unified diff parser → structured DiffHunks, line analytics
- `git/log.ts` — ✅ `git log --pretty=format:...` parser, branch parsing
- `git/blame.ts` — ❌ **Not implemented**
- `git/platform/github.ts` — ❌ **Not implemented**
- `git/platform/gitlab.ts` — ❌ **Not implemented**
- `git/platform/bitbucket.ts` — ❌ **Not implemented**

**IDE files — inline in render.ts (not separate files):**
- ✅ Git panel shows branch name, staged/modified/untracked files
- ✅ Stage/unstage/discard/commit actions
- ✅ Branch name in status bar
- ✅ `execSync` from `child_process` works in Perry
- `workbench/views/git/source-control.ts` — ❌ Not separate file
- `workbench/views/git/changes-list.ts` — ❌ Not separate file
- `workbench/views/git/commit-box.ts` — ❌ Not separate file
- `workbench/views/git/branch-selector.ts` — ❌ Not separate file (basic branch display exists)
- `workbench/views/git/git-graph.ts` — ❌ **Not implemented**

**What's done:**
- ✅ Git status, diff, log parsing (core, 39 tests)
- ✅ Stage/unstage/discard/commit in IDE (inline in render.ts)
- ✅ Branch display in status bar

**Remaining work:**
- ❌ `git blame --porcelain` parser (core)
- ❌ GitHub REST API client (core)
- ❌ GitLab REST API client (core)
- ❌ Bitbucket REST API client (core)
- ❌ Visual commit graph (IDE)
- ❌ Branch switching/creation UI (IDE — basic display exists)
- ❌ Extract git views from render.ts into separate files (IDE refactor)

**Mobile specifics:**
- **Phone:** Swipeable changes list (right=stage, left=discard). Commit message as bottom sheet.
- **Tablet:** Source control in sidebar with inline action buttons.
- **Git graph:** Horizontal scrollable timeline (phone) / full graph (tablet/desktop).
- **Offline:** Local git ops work offline. Remote ops queue until online.

**Tests:** 39 tests passing — status parsing, diff parsing, log parsing.

---

## Slice 5: Search — ⚠️ PARTIAL

**Core files — partially implemented (42 tests):**
- `search/search-model.ts` — ✅ `searchFileContent` (regex/literal, case/whole-word), `computeReplace`, `isTextFile`
- `search/ripgrep.ts` — ❌ **Not implemented** (uses built-in search, not ripgrep)

**IDE files — inline in render.ts (not separate files):**
- ✅ Search panel with TextField input
- ✅ Recursive file search (500 result cap, depth 9)
- ✅ Case toggle
- ✅ Results grouped by file, click-to-open
- ✅ Replace single/all with re-search after replace
- `workbench/views/search/search-view.ts` — ❌ Not separate file
- `workbench/views/search/search-input.ts` — ❌ Not separate file
- `workbench/views/search/search-results.ts` — ❌ Not separate file

**What's done:**
- ✅ Workspace-wide text search (literal + regex) with result grouping (core + IDE)
- ✅ Replace per-match and all (IDE)

**Remaining work:**
- ❌ Ripgrep integration via child_process (core — for performance on large codebases)
- ❌ Streaming results (currently batch)
- ❌ Extract search views from render.ts into separate files (IDE refactor)

**Mobile specifics:**
- **Phone:** Pull-down gesture or search icon. Full-screen results. Tap to open.
- **Tablet:** Search in sidebar with expandable file groups.
- **Performance:** Stream results live, show updating count.

**Tests:** 42 tests passing — regex/literal search, case sensitivity, whole-word matching, replace computation.

---

## Slice 6: LSP & Language Intelligence — ⚠️ PARTIAL (types only)

**Core files — types and protocol only (41 tests):**
- `protocols/lsp/json-rpc.ts` — ✅ JSON-RPC 2.0 message types, Content-Length framing
- `protocols/lsp/lsp-types.ts` — ✅ Position, Range, Diagnostic, CompletionItem, Location, TextEdit, etc.
- `protocols/lsp/capabilities.ts` — ✅ Client/Server capability negotiation
- `protocols/lsp/lsp-manager.ts` — ❌ **Not implemented** (server lifecycle)
- `protocols/lsp/lsp-client.ts` — ❌ **Not implemented** (full JSON-RPC client)
- `protocols/formatter/formatter.ts` — ❌ **Not implemented**

> **Note:** `@honeide/editor` has its own LSP client (`core/lsp-client/`) with initialize, completion, hover, diagnostics, code actions, formatting. The core module needs a *manager* that orchestrates server lifecycle, not a duplicate client.

**IDE files — none implemented:**
- ❌ Autocomplete popup
- ❌ Hover tooltip rendering
- ❌ Go-to-definition / find-references navigation
- ❌ Diagnostics: inline underlines + Problems panel
- ❌ Code actions (lightbulb menu)
- ❌ Format on save integration

**Remaining work:**
- ❌ LSP server lifecycle manager: start/stop per language, auto-detect from file extension
- ❌ Wire `@honeide/editor`'s LSP client to server processes spawned by manager
- ❌ All IDE views (autocomplete popup, hover, go-to-def, diagnostics panel, code actions, formatting)
- ❌ Integration with `@honeide/extensions` LSP configs (11 extensions define language servers)

**Mobile specifics:**
- **Phone:** Autocomplete above keyboard, hover via long-press, problems as full-screen list.
- **Performance:** LSP may not be available on mobile. Graceful fallback to syntax-only.

**Tests:** 41 tests passing — JSON-RPC framing, capability negotiation, type serialization.

---

## Slice 7: Debug — ⚠️ PARTIAL (types only)

**Core files — types only (25 tests):**
- `protocols/dap/dap-types.ts` — ✅ DAP message types (Request, Response, Event, StackFrame, Variable, etc.)
- `protocols/dap/breakpoint-manager.ts` — ✅ BreakpointManager (add/remove/list)
- `protocols/dap/dap-manager.ts` — ❌ **Not implemented** (debug adapter lifecycle)
- `protocols/dap/dap-client.ts` — ❌ **Not implemented** (DAP protocol client)
- `tasks/task-runner.ts` — ❌ **Not implemented**
- `tasks/task-config.ts` — ❌ **Not implemented**

> **Note:** `@honeide/editor` has its own DAP client (`core/dap-client/`). Similar to LSP, core needs a *manager* that orchestrates adapter lifecycle.

**IDE files — none implemented:**
- ❌ Debug sidebar, variable inspector, call stack, breakpoint list, watch expressions, debug toolbar

**Remaining work:**
- ❌ DAP adapter lifecycle manager
- ❌ Wire `@honeide/editor`'s DAP client to debug adapter processes
- ❌ Task runner (tasks.json parsing + execution)
- ❌ All IDE debug views

**Tests:** 25 tests passing — DAP message types, breakpoint management.

---

## Slice 8: AI Provider System — ⚠️ PARTIAL (2 of 8 adapters)

**Core files — partially implemented (35 tests):**
- `ai/provider/ai-protocol.ts` — ✅ AIProviderAdapter interface, message types
- `ai/provider/provider-registry.ts` — ✅ ProviderRegistry
- `ai/provider/model-router.ts` — ✅ ModelRouter (feature→model routing)
- `ai/provider/token-counter.ts` — ✅ Token estimation helpers
- `ai/provider/adapters/anthropic.ts` — ✅ Claude (Messages API, streaming)
- `ai/provider/adapters/openai.ts` — ✅ GPT (Chat Completions)
- `ai/provider/adapters/google.ts` — ❌ **Not implemented**
- `ai/provider/adapters/ollama.ts` — ❌ **Not implemented**
- `ai/provider/adapters/openai-compat.ts` — ❌ **Not implemented**
- `ai/provider/adapters/bedrock.ts` — ❌ **Not implemented**
- `ai/provider/adapters/vertex.ts` — ❌ **Not implemented**
- `ai/provider/adapters/azure-openai.ts` — ❌ **Not implemented**

**IDE files — none implemented:**
- ❌ Model selector component
- ❌ AI provider configuration in settings UI
- ❌ Status bar AI model indicator

**Adapter details:**

| Adapter | Auth | Streaming Format | Tool Use Format | Status |
|---------|------|-----------------|-----------------|--------|
| Anthropic | `x-api-key` header | SSE `content_block_delta` | `tool_use` content blocks | ✅ Done |
| OpenAI | `Bearer` token | SSE `data: {...}` | `function_calling` | ✅ Done |
| Google | API key query param | SSE | `functionDeclarations` | ❌ Todo |
| Ollama | None | NDJSON | model-dependent | ❌ Todo |
| OpenAI-compat | `Bearer` token | SSE (same as OpenAI) | Same as OpenAI | ❌ Todo |
| Bedrock | AWS SigV4 | Bedrock streaming | Bedrock tool format | ❌ Todo |
| Vertex | OAuth2 | SSE (same as Google) | Same as Google | ❌ Todo |
| Azure OpenAI | API key or Azure AD | SSE (same as OpenAI) | Same as OpenAI | ❌ Todo |

**Remaining work:**
- ❌ 6 adapter implementations (google, ollama, openai-compat, bedrock, vertex, azure-openai)
- ❌ Model selector UI component
- ❌ AI provider settings UI
- ❌ Status bar AI model indicator

**Mobile specifics:**
- **All mobile:** AI API calls are just HTTPS — works identically on all platforms.
- **Ollama on mobile:** Connect to Ollama on remote machine (user configures IP).
- **Model selector:** Bottom sheet (phone) / popover (tablet/desktop).
- **Offline:** Show clear "offline" indicator.

**Tests:** 35 tests passing — provider registry, model routing, Anthropic/OpenAI adapters, token counting.

---

## Slice 9: AI Inline Completion — ⚠️ CORE DONE, IDE MISSING

**Core files — all implemented (41 tests):**
- `ai/inline/completion-provider.ts` — ✅ InlineCompletionProvider with state management
- `ai/inline/fim-adapter.ts` — ✅ FIM formatting per provider (Anthropic/OpenAI)
- `ai/inline/debouncer.ts` — ✅ CompletionDebouncer with configurable delay
- `ai/inline/cache.ts` — ✅ CompletionCache with LRU eviction and TTL

**IDE files — none implemented:**
- ❌ Ghost text rendering (wired to EditorViewModel.ghostText)
- ❌ Tab to accept, Ctrl+Right for word-by-word, Escape to dismiss
- ❌ Status indicator (spinner while loading completion)

**Remaining work:**
- ❌ Wire completion-provider to EditorViewModel.ghostText
- ❌ Accept/dismiss keybindings and toolbar buttons (mobile)
- ❌ Loading spinner in gutter

**Mobile specifics:**
- **Phone:** Accept button in keyboard toolbar. Swipe right for word-by-word.
- **Latency:** Increase debounce to 500ms on cellular.

**Tests:** 41 tests passing — FIM formatting, debounce timing, cache hit/miss, cancellation.

---

## Slice 10: AI Chat — ⚠️ CORE DONE, IDE MISSING

**Core files — all implemented (56 tests):**
- `ai/chat/chat-model.ts` — ✅ ChatModel with sessions, messages, code block extraction
- `ai/chat/context-collector.ts` — ✅ ContextCollector for workspace/editor context
- `ai/chat/streaming-renderer.ts` — ✅ StreamingRenderer for markdown segments
- `ai/chat/code-actions.ts` — ✅ Explain, Refactor, Fix, Test prompt templates

**IDE files — none implemented:**
- `workbench/views/ai-chat/chat-view.ts` — ❌
- `workbench/views/ai-chat/chat-message.ts` — ❌
- `workbench/views/ai-chat/context-panel.ts` — ❌
- `workbench/views/ai-chat/model-selector.ts` — ❌
- `workbench/views/ai-chat/code-blocks.ts` — ❌

**Remaining work:**
- ❌ Full chat UI (message bubbles, streaming display, code blocks with Apply/Copy)
- ❌ Context panel (what AI can see)
- ❌ Model selector
- ❌ Quick actions from editor selection (Explain, Refactor, Fix, Test)
- ❌ Multiple chat sessions

**Mobile specifics:**
- **Phone:** Full-screen messaging interface ("AI" tab). Input at bottom. Voice input button.
- **Code block "Apply":** Full-screen diff view on mobile.

**Tests:** 56 tests passing — context collection, streaming markdown, code block extraction, chat history, code actions.

---

## Slice 11: Terminal Integration — ❌ NOT STARTED

**Core files:** (none — `@honeide/terminal` is standalone and complete)

**IDE files — none implemented:**
- ❌ Terminal panel (bottom panel desktop/tablet, full-screen tab phone)
- ❌ Multiple terminal instances with tabs
- ❌ Terminal split view

> **Note:** `@honeide/terminal` package is fully implemented (VT parser, PTY, screen buffer, FFI bridge for 6 platforms). Only IDE integration remains.

**Remaining work:**
- ❌ Embed `@honeide/terminal` TerminalView via FFI (similar to editor embedding)
- ❌ Terminal panel in bottom panel area
- ❌ Multi-terminal tabs
- ❌ Mobile: SSH connection manager, special keys toolbar

**Mobile specifics:**
- **Phone:** Full-screen "Terminal" tab. Special keys toolbar (Ctrl, Alt, Tab, Esc, arrows).
- **iOS:** No local shell — SSH to remote machine or built-in limited shell.
- **Android:** Local shell (Termux-style) + SSH.
- **Web:** WebSocket-based terminal proxy.

---

## Slice 12: AI Agent Mode — ⚠️ CORE PARTIAL, IDE MISSING

**Core files — partially implemented (43 tests):**
- `ai/agent/orchestrator.ts` — ✅ AgentOrchestrator (plan+execute loop, approval management)
- `ai/agent/planner.ts` — ✅ AgentPlan (step management, lifecycle)
- `ai/agent/tools.ts` — ✅ 15 tool definitions (file_read/edit/create/delete/rename, search, web_fetch, git, etc.)
- `ai/agent/context-builder.ts` — ✅ System prompt builder, file/git context formatting
- `ai/agent/activity-log.ts` — ✅ ActivityLog for tracking operations
- `ai/agent/tool-impls/` — ❌ **Not implemented** (individual tool implementations)
- `ai/agent/approval-flow.ts` — ❌ **Not implemented**
- `ai/agent/error-recovery.ts` — ❌ **Not implemented**

**IDE files — none implemented:**
- ❌ Agent activity view, approval view, plan view, progress indicator
- ❌ Diff view (side-by-side + unified) with hunk accept/reject

**Remaining work:**
- ❌ 15 individual tool implementation files (core)
- ❌ Approval flow (core)
- ❌ Error recovery with auto-retry (core)
- ❌ All IDE agent views
- ❌ Diff viewer (reusable for agent approvals + PR review)

**Mobile specifics:**
- **Phone:** *Killer mobile feature.* Activity log with expandable entries. Swipeable approval cards. Unified diff only.
- **Background:** Continue working when app backgrounded. Push notification for approvals.

**Tests:** 43 tests passing — orchestrator loop, tool definitions, plan execution, activity log.

---

## Slice 13: AI PR Review — ⚠️ CORE PARTIAL, IDE MISSING

**Core files — partially implemented (25 tests):**
- `ai/review/review-engine.ts` — ✅ ReviewEngine (review lifecycle orchestration)
- `ai/review/diff-chunker.ts` — ✅ Token-aware diff chunking
- `ai/review/annotation-parser.ts` — ✅ Parse AI annotations from responses
- `ai/review/review-types.ts` — ✅ ReviewAnnotation, ReviewSummary, PRInfo types
- `ai/review/review-submitter.ts` — ❌ **Not implemented** (post to GitHub/GitLab/Bitbucket)

**IDE files — none implemented:**
- ❌ PR browser, PR detail, PR diff with annotations, review sidebar, submit review

**Remaining work:**
- ❌ Review submitter for GitHub/GitLab/Bitbucket APIs (core)
- ❌ Depends on platform clients from Slice 4 (github.ts, gitlab.ts, bitbucket.ts)
- ❌ All IDE PR review views

**Mobile specifics:**
- **Phone:** *Second killer mobile feature.* PR list as card inbox. Swipe through annotations.
- **Offline:** Cache PR data and annotations locally. Queue submissions.

**Tests:** 25 tests passing — diff chunking, annotation parsing, review engine.

---

## Slice 14: Extension System — ⚠️ CORE PARTIAL, IDE MISSING

**Core files — partially implemented (34 tests):**
- `extensions/manifest.ts` — ✅ Manifest parsing, contribution types
- `extensions/registry.ts` — ✅ ExtensionRegistry (register, enable, disable)
- `extensions/extension-host.ts` — ✅ ExtensionHost (lifecycle: init, activation, shutdown)
- `extensions/extension-api-impl.ts` — ❌ **Not implemented** (API bridge: @honeide/api → core services)

> **Note:** `@honeide/extensions` has 11 built-in extensions ready. They need the API bridge to actually function.

**IDE files — none implemented:**
- ❌ Extension browser, extension card, extension detail

**Remaining work:**
- ❌ Extension API implementation bridge (core — maps @honeide/api calls to core services)
- ❌ Extension browser UI (search, install, uninstall)
- ❌ Wire 11 built-in extensions to activate on startup

**Mobile specifics:**
- **Phone:** Extension browser as full-screen list (app store style).
- **Mobile:** Pre-compiled extensions downloaded as binaries.

**Tests:** 34 tests passing — manifest parsing, activation events, registry lifecycle.

---

## Slice 15: Polish, Packaging & Platform Finalization — ❌ NOT STARTED

**What it delivers:**
- Performance optimization (startup < 1s, keystroke latency < 16ms)
- Packaging for all platforms
- Accessibility: VoiceOver (macOS/iOS), TalkBack (Android), NVDA/JAWS (Windows), Orca (Linux)
- iOS Files.app + Android SAF integration
- Final documentation

**Platform packaging:**

| Platform | Package Format | Distribution |
|----------|---------------|-------------|
| macOS | `.dmg` (Universal), Homebrew | Direct download + Homebrew |
| Windows | `.msi` (x64 + ARM64), winget | Direct download + winget |
| Linux | AppImage, .deb, .rpm, Flatpak | Direct download + repos |
| iOS | .ipa | App Store |
| iPadOS | .ipa (Universal) | App Store |
| Android | .apk / .aab | Play Store |
| Web | Static files | Cloudflare Pages / Vercel |

---

## Remaining Work Summary

### Priority 1 — Complete IDE Views for Done Core Slices

These core modules are fully tested but have no IDE UI:

| Task | Core Status | IDE Status | Est. Complexity |
|------|-------------|------------|-----------------|
| AI Chat views (Slice 10) | ✅ 56 tests | ❌ 5 files needed | High |
| AI Inline ghost text wiring (Slice 9) | ✅ 41 tests | ❌ EditorViewModel wiring | Medium |
| Terminal embedding (Slice 11) | ✅ @honeide/terminal done | ❌ Panel + FFI embed | Medium |
| Settings UI views (Slice 2) | ✅ 59 tests | ❌ 7 files needed | High |

### Priority 2 — Complete Partial Core Modules

| Task | What Exists | What's Missing |
|------|-------------|----------------|
| AI adapters (Slice 8) | 2 of 8 adapters | google, ollama, openai-compat, bedrock, vertex, azure-openai |
| Git platform clients (Slice 4) | Local git ops | github.ts, gitlab.ts, bitbucket.ts, blame.ts |
| Agent tool impls (Slice 12) | Tool definitions | 15 individual tool-impl files, approval-flow, error-recovery |
| Review submitter (Slice 13) | Review engine | review-submitter.ts (depends on Slice 4 platform clients) |
| Extension API bridge (Slice 14) | Manifest + registry | extension-api-impl.ts |
| LSP manager (Slice 6) | Types + protocol | lsp-manager.ts (server lifecycle) |
| DAP manager (Slice 7) | Types + breakpoints | dap-manager.ts, task-runner.ts, task-config.ts |
| Ripgrep integration (Slice 5) | Built-in search | ripgrep.ts (for large codebase perf) |

### Priority 3 — IDE Views for Incomplete Core

| Task | Blocked By |
|------|------------|
| LSP IDE views (autocomplete, hover, etc.) | LSP manager (P2) |
| Debug IDE views | DAP manager (P2) |
| Agent IDE views | Agent tool impls (P2) |
| PR Review IDE views | Review submitter + platform clients (P2) |
| Extension browser IDE views | Extension API bridge (P2) |

### Priority 4 — IDE Refactoring

| Task | Notes |
|------|-------|
| Extract git views from render.ts | Currently inline (~200 lines in render.ts) |
| Extract search views from render.ts | Currently inline (~150 lines in render.ts) |
| Breadcrumb bar | Deferred from Slice 3 |
| Find/replace widget wiring | Editor has search; IDE wiring pending |
| Editor split view | Multiple editor groups |

---

## Build Order (Updated)

```
DONE:
  Slice 0:  Workbench Shell & Theme Engine     ✅
  Slice 1:  Workspace & File Explorer          ✅
  Slice 3:  Editor Integration                 ✅ (core features)

PARTIALLY DONE (core logic exists, IDE views missing):
  Slice 2:  Settings & Keybindings             ⚠️ Core ✅, IDE views ❌
  Slice 4:  Git & Source Control               ⚠️ Core partial, IDE inline
  Slice 5:  Search                             ⚠️ Core partial, IDE inline

NEXT UP — in recommended order:

  Phase A: Wire existing core to IDE
    Slice 9:  AI Inline ghost text wiring       (core ✅ → IDE wiring)
    Slice 10: AI Chat views                     (core ✅ → IDE views)
    Slice 11: Terminal embedding                (standalone ✅ → IDE embed)
    Slice 2:  Settings/Welcome/Notifications UI (core ✅ → IDE views)

  Phase B: Complete core gaps + IDE views
    Slice 8:  Remaining 6 AI adapters           (core only)
    Slice 4:  Git platform clients + blame      (core: github/gitlab/bitbucket)
    Slice 6:  LSP manager + IDE views           (core + IDE)
    Slice 7:  DAP manager + tasks + IDE views   (core + IDE)

  Phase C: Advanced AI + Extensions
    Slice 12: Agent tool impls + IDE views      (core + IDE)
    Slice 13: Review submitter + IDE views      (core + IDE, depends on Slice 4)
    Slice 14: Extension API bridge + IDE views  (core + IDE)

  Phase D: Polish
    Slice 15: Performance, packaging, a11y      (all platforms)
    + Slice 4/5 refactor: extract from render.ts
    + Slice 3 deferred: breadcrumb, find/replace, split view
```

**Parallelization opportunities:**
- Phase A slices are all independent — can run in parallel
- Slices 6 + 7 can run in parallel (LSP and DAP are independent)
- Slice 8 (adapters) can run in parallel with anything
- Slice 11 can start any time (no dependencies)

---

## Verification

After each slice:
1. Feature works on all 7 platforms (macOS, Windows, Linux, iOS, iPadOS, Android, Web)
2. Mobile layout adapts correctly (compact, split, full modes)
3. Touch interactions work (tap targets, gestures, keyboard avoidance)
4. Offline behavior is graceful (no crashes, clear indicators)
5. Unit + integration tests pass
6. Performance targets met on each platform

---

## Test Coverage Summary

| Module | Tests | Status |
|--------|-------|--------|
| hone-core workspace | 59 | ✅ |
| hone-core settings | 59 | ✅ |
| hone-core git | 39 | ✅ |
| hone-core search | 42 | ✅ |
| hone-core lsp | 41 | ✅ |
| hone-core dap | 25 | ✅ |
| hone-core ai-provider | 35 | ✅ |
| hone-core ai-inline | 41 | ✅ |
| hone-core ai-chat | 56 | ✅ |
| hone-core ai-agent | 43 | ✅ |
| hone-core ai-review | 25 | ✅ |
| hone-core extensions | 34 | ✅ |
| **hone-core total** | **499** | **✅** |
| hone-editor | 353 | ✅ (3 expected-fail) |
| hone-terminal | ~50+ | ✅ |
| **Grand total** | **900+** | **✅** |
