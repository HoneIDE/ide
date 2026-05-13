# Hone — Complete Project Plan v3

## Vision

**One TypeScript codebase → native AI-powered code editor on every platform.**

Replace Electron-based development tools with natively compiled alternatives using Perry. Write everything in TypeScript, compile to native binaries, render using native UI components (SwiftUI, Win32, GTK4, Android Views, + web fallback). AI-first but provider-agnostic — the user picks their AI, Hone makes it powerful.

**Hone** = to sharpen, refine, make precise. Perry takes TypeScript and hones it into sharp, native binaries.

**Tagline**: *Sharpen your code, natively.*

---

## What Makes Hone Different

| Other editors | Hone |
|---|---|
| Electron (Chromium + Node.js + 500MB RAM) | Native binary via Perry (< 50MB, < 100MB RAM) |
| One platform, maybe two | All platforms from one codebase (desktop + mobile + web) |
| AI bolted on via extensions | AI integrated at architecture level |
| Locked to one AI provider | BYOK: any provider, any model, mix and match |
| No native mobile editor exists | Native code editor on iPad and Android |
| PR review in browser | PR review with AI annotations in-editor |
| Agent mode limited by extension API | Agent mode with native editor/terminal/git access |

---

## Project Ecosystem

Hone is a family of independent, composable projects. Each has its own GitHub repo, release cycle, and can be used standalone.

### GitHub Organization: `github.com/nicehone`

### npm Scope: `@honeide`

```
Repositories:

hone                    The full IDE (the "VSCode replacement")
hone-editor             Standalone code editor component (the crown jewel)
hone-terminal           Standalone terminal emulator component
hone-core               Workspace, file ops, search, git, settings, AI, protocols
hone-api                Public extension API for plugin authors (@honeide/api)
hone-extensions         Built-in extensions (TypeScript, HTML, Git, Claude, themes, etc.)
hone-themes             Default + community theme collection (VSCode-compatible)
hone.dev                Website, docs, blog
```

### Why Separate Repos?

- **`hone-editor`**: Other devs embed it in their own apps (markdown editor, config editor, database query editor, etc.)
- **`hone-terminal`**: Any Perry app needing a terminal just depends on this
- **`hone-core`**: Powers headless/CLI tools, CI integrations, or alternative UIs
- **`hone-api`**: Stable extension contract, versioned independently, strict semver
- **`hone`**: The composition layer — depends on all above, assembles the product

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      hone (the IDE)                     │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Workbench│  │  Extensions  │  │   AI Features      │  │
│  │  Layout  │  │   Manager    │  │  (chat, agent,     │  │
│  │          │  │              │  │   review, inline)   │  │
│  └────┬─────┘  └──────┬───────┘  └─────────┬─────────┘  │
│       │               │                     │            │
├───────┼───────────────┼─────────────────────┼────────────┤
│       ▼               ▼                     ▼            │
│  ┌─────────────────────────────────────────────────┐     │
│  │                  hone-core                       │     │
│  │  workspace | git | search | settings | protocols │     │
│  │  LSP | DAP | AI providers | agent | review       │     │
│  └──────────────────────┬──────────────────────────┘     │
│                         │                                │
├─────────────────────────┼────────────────────────────────┤
│                         ▼                                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │ hone-editor  │ │hone-terminal │ │    perry-ui       │  │
│  │  (code edit) │ │  (term emu)  │ │ (standard widgets)│  │
│  └──────────────┘ └──────────────┘ └──────────────────┘  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                    Perry Compiler                        │
│            TypeScript → Native Binary                   │
├─────────────────────────────────────────────────────────┤
│  macOS (SwiftUI) │ Windows (Win32) │ Linux (GTK4)       │
│  iOS (SwiftUI)   │ Android (Views) │ Web (DOM/Browser)  │
└─────────────────────────────────────────────────────────┘
```

---

## Dependency Graph

```
@honeide/api                     (zero dependencies — pure types + interfaces)
       ▲
       │
@honeide/editor                  (depends on: @honeide/api)
       ▲                          external: @lezer/* for parsing
       │
@honeide/terminal                (depends on: @honeide/api)
       ▲
       │
@honeide/core                    (depends on: @honeide/api, editor, terminal)
       ▲                          manages protocols, workspace, AI, extensions
       │
hone                             (depends on: core, editor, terminal, perry-ui)
                                  the actual application

@honeide/extensions              (depends on: @honeide/api only)
                                  each extension is its own package

hone-themes                      (zero dependencies — pure JSON)
```

---

## Repo 1: `hone-editor` — The Code Editor Component

The standalone, reusable, high-performance code editing surface. The most valuable piece of the ecosystem.

### Repository Structure

```
hone-editor/
├── core/
│   ├── buffer/                    # Rope-based text buffer
│   │   ├── rope.ts
│   │   ├── piece-table.ts
│   │   ├── text-buffer.ts         # Public TextBuffer API
│   │   └── line-index.ts          # Line ↔ offset mapping
│   ├── document/
│   │   ├── document.ts            # EditorDocument
│   │   ├── edit-builder.ts
│   │   └── encoding.ts            # UTF-8/16, BOM
│   ├── cursor/
│   │   ├── cursor-manager.ts      # Single + multi-cursor
│   │   ├── selection.ts
│   │   └── word-boundary.ts
│   ├── commands/
│   │   ├── registry.ts
│   │   ├── editing.ts             # Insert, delete, indent, comment
│   │   ├── navigation.ts
│   │   ├── selection-cmds.ts
│   │   ├── clipboard.ts
│   │   └── multicursor.ts
│   ├── search/
│   │   ├── search-engine.ts       # Text + regex
│   │   ├── replace.ts
│   │   └── incremental.ts
│   ├── history/
│   │   ├── undo-manager.ts
│   │   └── operation.ts           # Coalesced edits
│   ├── folding/
│   │   ├── fold-provider.ts
│   │   └── fold-state.ts
│   ├── tokenizer/
│   │   ├── syntax-engine.ts       # Lezer integration
│   │   ├── token-theme.ts
│   │   ├── incremental.ts
│   │   └── grammars/              # Built-in Lezer grammars
│   │       ├── typescript.ts
│   │       ├── javascript.ts
│   │       ├── html.ts
│   │       ├── css.ts
│   │       ├── json.ts
│   │       ├── markdown.ts
│   │       ├── python.ts
│   │       ├── rust.ts
│   │       ├── go.ts
│   │       └── cpp.ts
│   ├── diff/                      # Diff engine (for AI edits + PR review)
│   │   ├── diff-model.ts          # Side-by-side + unified diff model
│   │   ├── diff-compute.ts        # Compute diff between two buffers
│   │   ├── hunk.ts                # Diff hunk with accept/reject state
│   │   └── inline-diff.ts         # Inline change preview (AI edit proposals)
│   ├── lsp-client/
│   │   ├── client.ts
│   │   ├── protocol.ts
│   │   └── capabilities.ts
│   ├── dap-client/
│   │   ├── client.ts
│   │   └── protocol.ts
│   ├── viewport/
│   │   ├── viewport-manager.ts
│   │   ├── scroll.ts
│   │   └── line-height.ts
│   └── index.ts                   # Public API barrel export
│
├── view-model/
│   ├── editor-view-model.ts       # Main ViewModel interface
│   ├── line-layout.ts
│   ├── cursor-state.ts
│   ├── gutter.ts                  # Line numbers, breakpoints, fold markers, git
│   ├── minimap.ts
│   ├── overlays.ts                # Autocomplete, hover, parameter hints
│   ├── scroll-state.ts
│   ├── decorations.ts             # Inline decorations (AI annotations, errors, etc.)
│   ├── find-widget.ts
│   ├── diff-view-model.ts         # Diff rendering state
│   ├── ghost-text.ts              # AI inline completion ghost text
│   └── theme.ts
│
├── native/                        # Platform-specific rendering
│   ├── macos/                     # Core Text + Metal/CoreAnimation
│   ├── windows/                   # DirectWrite + Direct2D
│   ├── linux/                     # Pango + Cairo/Vulkan
│   ├── ios/                       # Core Text + Metal (touch input)
│   ├── android/                   # Canvas/Skia
│   └── web/                       # DOM/Canvas fallback
│
├── tests/
├── examples/
│   ├── minimal/                   # Bare minimum editor in 50 lines
│   ├── markdown-editor/           # Specialized markdown editor
│   └── diff-viewer/               # Standalone diff viewer
│
├── perry.config.ts
├── package.json                   # Published as @honeide/editor
├── README.md
├── CHANGELOG.md
└── LICENSE                        # MIT
```

### Core Interfaces

```typescript
// === TextBuffer (Rope) ===

interface TextBuffer {
  insert(offset: number, text: string): void
  delete(offset: number, length: number): void
  getText(offset: number, length: number): string
  getLine(lineNumber: number): string
  getLineCount(): number
  getLineOffset(lineNumber: number): number
  getOffsetLine(offset: number): number
  getLength(): number

  applyEdits(edits: TextEdit[]): void
  snapshot(): BufferSnapshot
  restoreSnapshot(snapshot: BufferSnapshot): void
}


// === EditorDocument ===

interface EditorDocument {
  readonly uri: string
  readonly buffer: TextBuffer
  readonly languageId: string
  readonly version: number
  readonly isDirty: boolean
  readonly encoding: string
  readonly lineEnding: 'lf' | 'crlf'

  edit(callback: (builder: EditBuilder) => void): void
  save(): Promise<void>
  revert(): Promise<void>
}


// === CursorManager ===

interface CursorManager {
  readonly primary: CursorState
  readonly cursors: readonly CursorState[]

  move(direction: 'up' | 'down' | 'left' | 'right', select?: boolean): void
  moveToPosition(position: Position, select?: boolean): void
  moveByWord(direction: 'left' | 'right', select?: boolean): void
  moveToLineStart(select?: boolean): void
  moveToLineEnd(select?: boolean): void

  addCursorAt(position: Position): void
  addCursorAbove(): void
  addCursorBelow(): void
  selectAllOccurrences(text: string): void
}


// === ViewportManager ===

interface ViewportManager {
  update(scrollTop: number, containerHeight: number): void
  getVisibleRange(): { startLine: number; endLine: number }
  getVisibleLines(): RenderedLine[]

  scrollTo(line: number): void
  scrollBy(delta: number): void
  revealLine(line: number, position: 'top' | 'center' | 'bottom'): void
}

interface RenderedLine {
  lineNumber: number
  content: string
  tokens: SyntaxToken[]
  decorations: LineDecoration[]
  foldState: 'expanded' | 'collapsed' | 'none'
  gutterItems: GutterItem[]
}


// === Diff Engine ===

interface DiffEngine {
  computeDiff(original: TextBuffer, modified: TextBuffer): DiffResult
  computeInlineDiff(originalLine: string, modifiedLine: string): InlineDiffResult
}

interface DiffResult {
  hunks: DiffHunk[]
  identical: boolean
}

interface DiffHunk {
  originalStart: number
  originalLength: number
  modifiedStart: number
  modifiedLength: number
  changes: DiffChange[]
  state: 'pending' | 'accepted' | 'rejected'  // For AI edit approval
}


// === EditorViewModel (Core → UI Bridge) ===

interface EditorViewModel {
  readonly visibleLines: RenderedLine[]
  readonly cursors: CursorRenderState[]
  readonly selections: SelectionRenderState[]
  readonly scrollState: ScrollState
  readonly gutterWidth: number
  readonly contentWidth: number

  // Overlays
  readonly autocomplete: AutocompleteState | null
  readonly parameterHints: ParameterHintsState | null
  readonly hover: HoverState | null
  readonly diagnosticsPopup: DiagnosticsPopupState | null
  readonly findWidget: FindWidgetState | null

  // AI features
  readonly ghostText: GhostTextState | null          // Inline completion
  readonly aiAnnotations: AIAnnotation[]             // Review annotations
  readonly agentEditPreview: DiffHunk[] | null       // Agent edit approval

  readonly minimapLines: MinimapLine[] | null
  readonly theme: EditorTheme

  // Events
  onKeyDown(event: KeyEvent): void
  onKeyPress(event: KeyPressEvent): void
  onMouseDown(event: MouseEvent): void
  onMouseMove(event: MouseEvent): void
  onMouseUp(event: MouseEvent): void
  onScroll(event: ScrollEvent): void
  onResize(width: number, height: number): void
  onFocus(): void
  onBlur(): void
}
```

### Native Rendering Requirements

| Capability | macOS | Windows | Linux | iOS | Android | Web |
|---|---|---|---|---|---|---|
| Text rendering | Core Text | DirectWrite | Pango | Core Text | Canvas/Skia | DOM/Canvas |
| GPU compositing | Metal/CA | Direct2D/3D | Vulkan/Cairo | Metal | Vulkan/GL | WebGL |
| Input/IME | NSTextInputClient | TSF/IMM32 | IBus/Fcitx | UITextInput | InputMethod | DOM events |
| Scrolling | NSScrollView | ScrollBar | GtkScrolled | UIScrollView | RecyclerView | overflow |
| Popups | NSPopover | HWND popup | GtkPopover | UIPopover | PopupWindow | abs div |
| Clipboard | NSPasteboard | Win32 Clipboard | GDK Clipboard | UIPasteboard | ClipboardMgr | Clipboard API |

### Performance Targets

- Keystroke-to-pixel latency: < 16ms (60fps)
- Scroll rendering: 60fps min, 120fps on ProMotion
- File open (100K lines): < 500ms to first render
- Syntax highlighting: incremental, never blocks input
- Memory: < 2x file size for buffer + syntax tree
- Ghost text appearance: < 50ms after AI response arrives

---

## Repo 2: `hone-terminal` — Terminal Emulator Component

Standalone, reusable terminal emulator.

### Repository Structure

```
hone-terminal/
├── core/
│   ├── vt-parser/
│   │   ├── parser.ts              # State machine parser
│   │   ├── csi.ts                 # CSI sequence handlers
│   │   ├── osc.ts                 # OSC (title, colors, hyperlinks)
│   │   └── dcs.ts                 # DCS sequence handlers
│   ├── buffer/
│   │   ├── screen-buffer.ts       # Active screen (rows × cols)
│   │   ├── scrollback.ts          # Scrollback ring buffer
│   │   ├── cell.ts                # TerminalCell
│   │   └── line.ts                # TerminalLine
│   ├── pty/
│   │   ├── pty-manager.ts         # Spawn shell, resize, I/O
│   │   ├── unix-pty.ts            # forkpty() on macOS/Linux
│   │   └── win-conpty.ts          # ConPTY on Windows
│   ├── input/
│   │   ├── key-encoder.ts         # Key → VT escape bytes
│   │   └── mouse-encoder.ts       # Mouse tracking sequences
│   └── index.ts
│
├── view-model/
│   ├── cell-grid.ts
│   ├── cursor.ts
│   └── theme.ts                   # ANSI → actual colors
│
├── native/                        # Per-platform character grid rendering
│   ├── macos/
│   ├── windows/
│   ├── linux/
│   ├── ios/
│   ├── android/
│   └── web/
│
├── tests/
├── examples/
│   └── standalone-terminal/
├── perry.config.ts
├── package.json                   # Published as @honeide/terminal
├── README.md
├── CHANGELOG.md
└── LICENSE                        # MIT
```

**Compatibility target**: xterm-256color. ANSI colors, 256-color, truecolor (24-bit), mouse tracking, alternate screen buffer, bracketed paste.

---

## Repo 3: `hone-core` — Workspace, Services & AI

Shared IDE services. The brain of the operation.

### Repository Structure

```
hone-core/
├── workspace/
│   ├── workspace.ts               # Multi-root workspace management
│   ├── file-watcher.ts            # Native file system watching
│   └── file-index.ts              # Fuzzy file finder
│
├── search/
│   ├── ripgrep.ts                 # Ripgrep integration
│   └── search-model.ts
│
├── git/
│   ├── git-client.ts              # Shell-based git operations
│   ├── blame.ts
│   ├── diff.ts
│   ├── status.ts
│   └── platform/                  # Remote platform integrations
│       ├── github.ts              # GitHub API (PRs, issues, checks)
│       ├── gitlab.ts              # GitLab API (MRs, issues, pipelines)
│       └── bitbucket.ts           # Bitbucket API (PRs)
│
├── tasks/
│   ├── task-runner.ts
│   └── task-config.ts
│
├── settings/
│   ├── settings-store.ts          # Layered: default → user → workspace → language
│   ├── keybindings.ts
│   └── schema.ts
│
├── protocols/
│   ├── lsp/
│   │   ├── lsp-manager.ts         # Server lifecycle (start/stop per language)
│   │   ├── lsp-client.ts          # Full LSP 3.17 client
│   │   └── capabilities.ts
│   ├── dap/
│   │   ├── dap-manager.ts
│   │   └── dap-client.ts
│   └── formatter/
│       └── formatter.ts           # stdin→stdout external formatters
│
├── ai/                            # ============ AI SYSTEM ============
│   ├── provider/                  # Provider abstraction layer
│   │   ├── ai-protocol.ts         # AIProviderAdapter interface
│   │   ├── provider-registry.ts   # Register + manage multiple providers
│   │   ├── model-router.ts        # Route features to configured providers
│   │   └── adapters/
│   │       ├── anthropic.ts       # Claude (Messages API)
│   │       ├── openai.ts          # GPT / o-series (Chat Completions API)
│   │       ├── google.ts          # Gemini (Generative Language API)
│   │       ├── ollama.ts          # Ollama (local models)
│   │       ├── openai-compat.ts   # Any OpenAI-compatible endpoint
│   │       ├── bedrock.ts         # AWS Bedrock (enterprise)
│   │       ├── vertex.ts          # Google Cloud Vertex AI (enterprise)
│   │       └── azure-openai.ts    # Azure OpenAI (enterprise)
│   │
│   ├── inline/                    # Inline completion (ghost text)
│   │   ├── completion-provider.ts # Request + render ghost text
│   │   ├── fim-adapter.ts         # Fill-in-the-middle formatting per provider
│   │   ├── debouncer.ts           # Intelligent request debouncing
│   │   └── cache.ts               # Cache recent completions
│   │
│   ├── chat/                      # Chat sidebar
│   │   ├── chat-model.ts          # Chat history, context management
│   │   ├── context-collector.ts   # Auto-collect: open files, errors, terminal, git
│   │   ├── streaming-renderer.ts  # Render streaming markdown responses
│   │   └── code-actions.ts        # "Explain", "Refactor", "Fix", "Test" from selection
│   │
│   ├── agent/                     # Agent mode (autonomous coding)
│   │   ├── orchestrator.ts        # Plans + executes multi-step tasks
│   │   ├── planner.ts             # Decomposes user intent into steps
│   │   ├── tools.ts               # Tool definitions
│   │   ├── tool-impls/
│   │   │   ├── file-read.ts       # Read file contents
│   │   │   ├── file-edit.ts       # Edit files (via hone-editor)
│   │   │   ├── file-create.ts     # Create new files
│   │   │   ├── file-delete.ts     # Delete files
│   │   │   ├── terminal-run.ts    # Run shell commands (via hone-terminal)
│   │   │   ├── terminal-read.ts   # Read terminal output
│   │   │   ├── git-ops.ts         # Git operations (diff, stage, commit, branch)
│   │   │   ├── search.ts          # Workspace search
│   │   │   ├── lsp-query.ts       # LSP queries (definitions, references, diagnostics)
│   │   │   ├── web-fetch.ts       # Fetch docs, APIs
│   │   │   ├── user-ask.ts        # Prompt user for input
│   │   │   └── user-show-diff.ts  # Show diff for approval
│   │   ├── approval-flow.ts       # Per-hunk accept/reject UI coordination
│   │   ├── context-builder.ts     # Build rich context from editor state
│   │   ├── error-recovery.ts      # Auto-retry on build/test failures
│   │   └── activity-log.ts        # Track all agent actions for transparency
│   │
│   └── review/                    # PR / diff review with AI
│       ├── review-engine.ts       # Orchestrates AI-powered code review
│       ├── diff-chunker.ts        # Split diff into AI-digestible chunks
│       ├── annotation-parser.ts   # Parse AI response → ReviewAnnotation[]
│       ├── review-submitter.ts    # Submit review back to GitHub/GitLab
│       └── review-types.ts        # ReviewAnnotation, ReviewSeverity, etc.
│
├── extensions/
│   ├── extension-host.ts
│   ├── extension-api-impl.ts
│   ├── manifest.ts                # hone-extension.json processing
│   └── registry.ts
│
├── tests/
├── perry.config.ts
├── package.json                   # Published as @honeide/core
├── README.md
├── CHANGELOG.md
└── LICENSE                        # MIT
```

### AI Provider Architecture

```typescript
// === Provider Abstraction ===

interface AIProviderAdapter {
  readonly id: string                    // "anthropic", "openai", "ollama", etc.
  readonly name: string                  // "Claude", "GPT", "Llama", etc.
  readonly capabilities: AICapabilities

  // Core methods — all providers implement these
  complete(request: CompletionRequest): AsyncIterable<CompletionChunk>
  chat(request: ChatRequest): AsyncIterable<ChatChunk>
  chatWithTools(request: ToolChatRequest): AsyncIterable<ToolChatChunk>
}

interface AICapabilities {
  maxContextTokens: number
  supportsStreaming: boolean
  supportsToolUse: boolean
  supportsVision: boolean              // Can it see images/screenshots?
  supportsFIM: boolean                 // Fill-in-the-middle for completions
  estimatedLatencyMs: number           // For UX decisions
}


// === Provider Registry ===

interface ProviderRegistry {
  register(adapter: AIProviderAdapter): void
  get(id: string): AIProviderAdapter | null
  list(): AIProviderAdapter[]
}


// === Model Router ===
// Routes different AI features to user-configured providers

interface ModelRouter {
  getProviderForFeature(feature: AIFeature): { adapter: AIProviderAdapter; model: string }
}

type AIFeature =
  | 'inlineCompletion'    // Ghost text
  | 'chat'                // Chat sidebar
  | 'agent'               // Autonomous agent
  | 'review'              // PR review
  | 'quickFix'            // Quick error fixes
  | 'explain'             // Code explanation
  | 'commit'              // Generate commit messages
```

### AI Configuration

```json
// ~/.hone/settings.json
{
  "ai.providers": {
    "anthropic": {
      "apiKey": "${env:ANTHROPIC_API_KEY}",
      "defaultModel": "claude-sonnet-4-5"
    },
    "openai": {
      "apiKey": "${env:OPENAI_API_KEY}",
      "defaultModel": "gpt-5"
    },
    "google": {
      "apiKey": "${env:GOOGLE_AI_KEY}",
      "defaultModel": "gemini-2.5-pro"
    },
    "ollama": {
      "endpoint": "http://localhost:11434",
      "defaultModel": "qwen-2.5-coder-32b"
    },
    "bedrock": {
      "region": "us-east-1",
      "profile": "default",
      "defaultModel": "anthropic.claude-sonnet-4-5"
    },
    "custom": {
      "endpoint": "https://company-llm.corp.com/v1",
      "apiKey": "${env:CORP_AI_KEY}",
      "defaultModel": "internal-codegen-v3",
      "type": "openai-compatible"
    }
  },

  "ai.features": {
    "inlineCompletion": { "provider": "ollama",    "model": "qwen-2.5-coder-7b" },
    "chat":             { "provider": "anthropic",  "model": "claude-sonnet-4-5" },
    "agent":            { "provider": "anthropic",  "model": "claude-opus-4-6" },
    "review":           { "provider": "anthropic",  "model": "claude-opus-4-6" },
    "quickFix":         { "provider": "openai",     "model": "gpt-5-mini" },
    "explain":          { "provider": "google",     "model": "gemini-2.5-flash" },
    "commit":           { "provider": "ollama",     "model": "qwen-2.5-coder-7b" }
  },

  "ai.agent": {
    "autoApprove": {
      "fileRead": true,
      "search": true,
      "lspQuery": true,
      "terminalRead": true,
      "fileEdit": false,
      "fileCreate": false,
      "terminalRun": false,
      "gitOps": false
    },
    "maxIterations": 25,
    "stopOnTestFailure": false
  },

  "ai.review": {
    "autoReviewOnPROpen": true,
    "severityThreshold": "warning",
    "categories": ["bugs", "security", "performance", "style", "testing"]
  },

  "ai.privacy": {
    "sendFileContents": true,
    "excludePatterns": ["**/.env*", "**/secrets/**", "**/credentials/**"],
    "logRequests": false
  }
}
```

### Agent Mode Architecture

```
User: "Add JWT authentication to the API"
    │
    ▼
┌────────────────────────────────────┐
│        Agent Orchestrator           │
│                                     │
│  1. Collects context:               │
│     - Open files, project structure │
│     - LSP diagnostics               │
│     - Recent terminal output        │
│     - Git status                    │
│                                     │
│  2. Sends to configured AI:         │
│     provider + model from settings  │
│                                     │
│  3. AI plans steps via tool calls   │
│  4. Orchestrator executes tools     │
│  5. Shows diffs for approval        │
│  6. AI sees results, iterates       │
└──────────┬─────────────────────────┘
           │
           │ chatWithTools()
           ▼
┌──────────────────────────────────────┐
│     Provider Adapter Layer            │
│                                       │
│  Translates Hone's tool format to:   │
│                                       │
│  Anthropic  → tool_use content blocks │
│  OpenAI     → function_calling        │
│  Google     → function declarations   │
│  Ollama     → tool support (varies)   │
│                                       │
│  Handles:                             │
│  - Streaming differences              │
│  - Rate limiting + retries            │
│  - Context window management          │
│  - Token counting per provider        │
└──────────────────────────────────────┘
```

### Agent Tools

```typescript
// All tools the agent can use

const AGENT_TOOLS = {
  // File operations
  'file.read':     { description: 'Read file contents', requiresApproval: false },
  'file.edit':     { description: 'Edit a file', requiresApproval: true },
  'file.create':   { description: 'Create a new file', requiresApproval: true },
  'file.delete':   { description: 'Delete a file', requiresApproval: true },
  'file.rename':   { description: 'Rename/move a file', requiresApproval: true },

  // Terminal
  'terminal.run':  { description: 'Run a shell command', requiresApproval: true },
  'terminal.read': { description: 'Read recent terminal output', requiresApproval: false },

  // Git
  'git.diff':      { description: 'Get current git diff', requiresApproval: false },
  'git.status':    { description: 'Get git status', requiresApproval: false },
  'git.stage':     { description: 'Stage files', requiresApproval: true },
  'git.commit':    { description: 'Create a commit', requiresApproval: true },
  'git.branch':    { description: 'Create/switch branch', requiresApproval: true },

  // Search & intelligence
  'search.files':     { description: 'Search across workspace', requiresApproval: false },
  'search.symbols':   { description: 'Find symbol definitions', requiresApproval: false },
  'lsp.diagnostics':  { description: 'Get current errors/warnings', requiresApproval: false },
  'lsp.definition':   { description: 'Go to definition', requiresApproval: false },
  'lsp.references':   { description: 'Find all references', requiresApproval: false },

  // User interaction
  'user.ask':       { description: 'Ask the user a question', requiresApproval: false },
  'user.showDiff':  { description: 'Show proposed changes for approval', requiresApproval: false },

  // Web
  'web.fetch':      { description: 'Fetch a URL (docs, APIs)', requiresApproval: false },
}
```

### PR Review Flow

```
User opens PR in Hone (or PR notification arrives)
    │
    ▼
hone-core/git/platform/github.ts
    │  Fetches: PR metadata, diff, commits, CI status
    │
    ▼
hone-core/ai/review/review-engine.ts
    │
    ├── diff-chunker.ts splits diff into chunks
    │   (respects context window limits of configured provider)
    │
    ├── For each chunk, sends to AI:
    │   "Review this code change. Identify:
    │    - Bugs (null deref, race conditions, type mismatches)
    │    - Security issues (injection, auth bypass, secrets)
    │    - Performance problems (N+1 queries, unnecessary allocations)
    │    - Style issues (naming, dead code, missing docs)
    │    - Missing test coverage
    │    Return structured JSON annotations."
    │
    ├── annotation-parser.ts parses response:
    │   [
    │     { file: "src/auth.ts", line: 42, severity: "error",
    │       category: "security", message: "JWT secret is hardcoded",
    │       suggestedFix: "Use environment variable instead" },
    │     { file: "src/api.ts", line: 78, severity: "warning",
    │       category: "performance", message: "N+1 query in loop",
    │       suggestedFix: "Batch query outside the loop" }
    │   ]
    │
    ▼
hone-editor renders diff view with annotations
    │
    ├── Side-by-side diff with full syntax highlighting
    ├── Full LSP intelligence works IN the diff (hover, go-to-def)
    ├── AI annotations appear inline:
    │   🔴 Bug: "JWT secret is hardcoded" [Fix] [Dismiss] [Explain]
    │   🟡 Perf: "N+1 query in loop" [Fix] [Dismiss] [Explain]
    │
    ├── [Fix] → AI generates fix → shown as nested diff
    │           → user accepts/rejects per hunk
    │           → accepted fixes become new commits
    │
    ├── User can add their own comments alongside AI annotations
    │
    ▼
review-submitter.ts posts review to GitHub/GitLab
    │  Converts annotations → platform review comments
    │  Submits: "Approve" / "Request Changes" / "Comment"
```

---

## Repo 4: `hone-api` — Public Extension API

Published as `@honeide/api`. Zero dependencies. Pure types and interfaces.

### Repository Structure

```
hone-api/
├── src/
│   ├── index.ts
│   ├── commands.ts                # Command registration
│   ├── editor.ts                  # Editor manipulation API
│   ├── workspace.ts               # Workspace/file API
│   ├── ui.ts                      # UI contribution (panels, status bar, etc.)
│   ├── languages.ts               # Language feature registration
│   ├── debug.ts                   # Debug API
│   ├── terminal.ts                # Terminal API
│   ├── ai.ts                      # AI provider + agent tool registration
│   └── types.ts                   # Shared type definitions
│
├── package.json                   # Published as @honeide/api
├── README.md
├── CHANGELOG.md
└── LICENSE                        # MIT
```

### Extension API Surface

```typescript
// @honeide/api — what extension authors import

export namespace commands {
  function registerCommand(id: string, handler: (...args: any[]) => any): Disposable
  function executeCommand(id: string, ...args: any[]): Promise<any>
}

export namespace workspace {
  const workspaceFolders: readonly WorkspaceFolder[]
  function openTextDocument(uri: string): Promise<TextDocument>
  function findFiles(pattern: string): Promise<string[]>
  const onDidOpenTextDocument: Event<TextDocument>
  const onDidSaveTextDocument: Event<TextDocument>
  const onDidChangeTextDocument: Event<TextDocumentChangeEvent>
  function getConfiguration(section: string): Configuration
}

export namespace editor {
  const activeEditor: TextEditor | undefined
  const visibleEditors: readonly TextEditor[]
  const onDidChangeActiveEditor: Event<TextEditor | undefined>
  function createDecorationType(options: DecorationOptions): DecorationType
}

export namespace languages {
  function registerCompletionProvider(selector: DocumentSelector, provider: CompletionProvider): Disposable
  function registerHoverProvider(selector: DocumentSelector, provider: HoverProvider): Disposable
  function registerCodeActionProvider(selector: DocumentSelector, provider: CodeActionProvider): Disposable
  function registerCodeLensProvider(selector: DocumentSelector, provider: CodeLensProvider): Disposable
  function setDiagnostics(uri: string, diagnostics: Diagnostic[]): void
}

export namespace ui {
  function registerTreeDataProvider(viewId: string, provider: TreeDataProvider<any>): Disposable
  function registerWebviewPanel(viewType: string, title: string, options: WebviewOptions): WebviewPanel
  function createStatusBarItem(alignment: StatusBarAlignment, priority?: number): StatusBarItem
  function showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>
  function showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>
  function showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>
  function showInputBox(options: InputBoxOptions): Promise<string | undefined>
  function showQuickPick(items: QuickPickItem[], options: QuickPickOptions): Promise<QuickPickItem | undefined>
}

export namespace ai {
  // Register custom AI provider
  function registerAIProvider(provider: AIProviderAdapter): Disposable
  // Register additional agent tools
  function registerAgentTool(tool: AgentToolDefinition): Disposable
  // Access the current AI context
  function getActiveProvider(): AIProviderAdapter | null
}
```

### Extension Manifest

```json
{
  "id": "honeide.typescript",
  "name": "TypeScript Language Support",
  "version": "1.0.0",
  "engines": { "hone": "^1.0.0" },
  "activationEvents": ["onLanguage:typescript", "onLanguage:javascript"],
  "contributes": {
    "languages": [{ "id": "typescript", "extensions": [".ts", ".tsx"] }],
    "lspServers": [{ "languageIds": ["typescript", "javascript"], "command": "typescript-language-server", "args": ["--stdio"] }],
    "commands": [{ "command": "typescript.organizeImports", "title": "Organize Imports" }],
    "configuration": { "properties": { "typescript.format.semicolons": { "type": "string", "enum": ["ignore", "insert", "remove"], "default": "ignore" }}}
  }
}
```

### Extension Compilation Model

Extensions are AOT compiled by Perry:

```
Author writes TypeScript → imports @honeide/api → publishes source
User installs → Perry compiles to native → included in next launch
Runtime: in-process, native speed, no interpreter, no sandbox overhead
API boundaries enforce safety (no raw memory, no arbitrary FFI)
```

---

## Repo 5: `hone-extensions` — Built-in Extensions

```
hone-extensions/
├── extensions/
│   ├── typescript/                # TS/JS via typescript-language-server
│   ├── html-css/                  # HTML/CSS language support
│   ├── json/                      # JSON schema validation + formatting
│   ├── markdown/                  # Preview + editing
│   ├── python/                    # Python via Pyright
│   ├── rust/                      # Rust via rust-analyzer
│   ├── go/                        # Go via gopls
│   ├── cpp/                       # C/C++ via clangd
│   ├── git/                       # Enhanced git (blame, graph, etc.)
│   ├── docker/                    # Dockerfile + compose
│   └── toml-yaml/                 # TOML + YAML support
├── package.json
└── LICENSE                        # MIT
```

---

## Repo 6: `hone-themes` — Theme Collection

VSCode-compatible JSON format. Import existing themes with zero changes.

```
hone-themes/
├── themes/
│   ├── hone-dark.json             # Default dark
│   ├── hone-light.json            # Default light
│   ├── monokai.json
│   ├── solarized-dark.json
│   ├── solarized-light.json
│   ├── nord.json
│   ├── dracula.json
│   ├── one-dark.json
│   ├── github-dark.json
│   ├── github-light.json
│   └── catppuccin.json
├── CONTRIBUTING.md
└── LICENSE                        # MIT
```

---

## Repo 7: `hone` — The Full IDE

The composition layer. The app users download.

### Repository Structure

```
hone/
├── workbench/
│   ├── layout/
│   │   ├── grid.ts                # Resizable split panels
│   │   ├── tab-manager.ts         # Editor tabs (split, drag, reorder)
│   │   ├── panel-registry.ts
│   │   └── activity-bar.ts        # Left icon strip
│   │
│   ├── views/
│   │   ├── explorer/              # File explorer (tree view)
│   │   ├── search/                # Global search UI
│   │   ├── git/                   # Source control panel
│   │   ├── debug/                 # Debug panel
│   │   ├── extensions/            # Extension marketplace browser
│   │   ├── settings-ui/           # Visual settings editor
│   │   ├── command-palette/       # Ctrl+Shift+P
│   │   ├── quick-open/            # Ctrl+P
│   │   ├── notifications/         # Toast notifications
│   │   ├── welcome/               # First-launch experience
│   │   │
│   │   ├── ai-chat/              # === AI Views ===
│   │   │   ├── chat-view.ts       # Chat with streaming responses
│   │   │   ├── context-panel.ts   # Shows what AI can see (files, errors, etc.)
│   │   │   ├── model-selector.ts  # Switch provider/model mid-chat
│   │   │   └── code-blocks.ts     # Syntax-highlighted code in chat + "Apply" button
│   │   │
│   │   ├── ai-agent/             # === Agent Views ===
│   │   │   ├── agent-activity.ts  # Live log of agent actions
│   │   │   ├── approval-view.ts   # Per-file diff with accept/reject controls
│   │   │   ├── plan-view.ts       # Agent's planned steps (user can edit/reorder)
│   │   │   └── progress.ts        # Progress indicator with step count
│   │   │
│   │   ├── diff-view/            # === Diff Views ===
│   │   │   ├── diff-editor.ts     # Side-by-side diff using hone-editor instances
│   │   │   ├── unified-diff.ts    # Unified diff view
│   │   │   ├── inline-diff.ts     # Inline change markers
│   │   │   └── hunk-controls.ts   # Accept/reject per hunk
│   │   │
│   │   └── pr-review/            # === PR Review Views ===
│   │       ├── pr-browser.ts      # List PRs from GitHub/GitLab
│   │       ├── pr-detail.ts       # PR description, commits, CI checks
│   │       ├── pr-diff.ts         # Full PR diff with AI annotations
│   │       ├── review-sidebar.ts  # Annotation list, filters by severity
│   │       └── review-submit.ts   # Submit review back to platform
│   │
│   └── theme/
│       ├── theme-loader.ts
│       ├── token-theme.ts
│       └── ui-theme.ts
│
├── app.ts                         # Application entry point
├── perry.config.ts
├── package.json
├── README.md
├── CHANGELOG.md
└── LICENSE                        # MIT (or commercial, TBD)
```

### Workbench Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Title Bar                                  [min] [max] [close] │
├────┬────────────────────────────────────────────────────────────┤
│    │  Tab Bar  [file1.ts ×] [file2.rs ×] [PR #42 ×]            │
│ A  ├────────────────────────────────────────────────────────────┤
│ C  │  Breadcrumb  src > components > Editor.tsx                 │
│ T  ├────────────────────┬───────────────────────┬───────────────┤
│ I  │                    │                       │               │
│ V  │  hone-editor       │  hone-editor          │  AI Chat      │
│ I  │  instance          │  (diff view /         │  ─────────    │
│ T  │                    │   split view)         │  🤖 Agent is  │
│ Y  │  👻 ghost text     │                       │  editing 3    │
│    │  🔴 AI annotation  │  🟢 AI fix applied    │  files...     │
│ B  ├────────────────────┴───────────────────────┴───────────────┤
│ A  │  Bottom Panel [Terminal | Problems | Agent Log | Output]   │
│ R  │  ┌─────────────────────────────────────────────────────┐   │
│    │  │  hone-terminal instance                             │   │
│ S  │  │  $ npm test                                         │   │
│ I  │  │  PASS src/auth.test.ts (4 tests)                    │   │
│ D  │  │  FAIL src/api.test.ts (1 failure)                   │   │
│ E  │  └─────────────────────────────────────────────────────┘   │
│ B  ├────────────────────────────────────────────────────────────┤
│ A  │  Status Bar  [main] [TS] [UTF-8] [Ln 42] [Claude Opus 4] │
│ R  │                                                            │
└────┴────────────────────────────────────────────────────────────┘
```

---

## Mobile Strategy

### Why Mobile is a Killer Feature

- No good native code editor exists on iPad or Android tablets
- Developers have been begging for this for years
- PR review on mobile is terrible (GitHub mobile is read-only for reviews)
- AI makes mobile coding viable (less typing, more approving)

### Mobile AI Interactions

| Interaction | How it works on mobile |
|---|---|
| Review PRs | Swipe through diffs, tap to expand AI annotations, one-tap approve/reject |
| Quick fixes | AI suggests fix, user taps "Apply" — done |
| Agent mode | Describe task verbally or type, watch agent work, approve diffs with taps |
| Chat | Ask questions about code, get explanations with syntax highlighting |
| Triage issues | AI reads issue, shows relevant code, suggests approach |
| Commit messages | AI generates commit message, user taps approve |
| Voice-to-code | Speak intent → AI generates code → review on screen |

### Mobile Layout Adaptation

```
Phone (compact):
┌──────────────────┐
│ [☰] file.ts  [AI]│
├──────────────────┤
│                  │
│  hone-editor     │
│  (full screen)   │
│                  │
│  👻 ghost text   │
│                  │
├──────────────────┤
│ [⌨] [▶] [🤖] [≡]│
└──────────────────┘

Tablet (split):
┌──────────────┬────────────┐
│ Explorer     │            │
│ ─────────    │ hone-editor│
│ 📁 src/      │            │
│   📄 auth.ts │ ghost text │
│   📄 api.ts  │            │
│              │            │
├──────────────┤            │
│ AI Chat      │            │
│ ─────────    ├────────────┤
│ 🤖 Ready     │ Terminal   │
│              │ $ _        │
└──────────────┴────────────┘
```

### BYOK Works Perfectly on Mobile

- API calls are just HTTPS requests — no heavy infrastructure needed
- User configures API key once in settings
- Same provider configuration syncs across devices
- Local models possible on powerful tablets (M-series iPads)

---

## Plugin System Summary

Most "plugins" don't need to be plugins at all:

```
Built-in protocols (just configure, no code needed):
  ├── LSP          → Language intelligence
  ├── DAP          → Debugging
  ├── AI Provider  → BYOK: any provider, any model
  └── Formatter    → stdin→stdout code formatting

Extension points (via @honeide/api):
  ├── commands     → Register commands for palette
  ├── sidebar      → Contribute panels (tree/list/form widgets)
  ├── editor       → Add decorations, code lenses, hovers
  ├── gutter       → Add icons (breakpoints, git, etc.)
  ├── statusBar    → Add items
  ├── fileViewer   → Register custom viewer for file types
  ├── ai.provider  → Register custom AI provider
  ├── ai.tool      → Register custom agent tools
  └── events       → onSave, onOpen, onBuild, etc.

Pure configuration (JSON, no code needed):
  ├── Themes       → tokenColors + UI colors (VSCode-compatible)
  ├── Keybindings  → key → command mapping
  ├── Snippets     → Language-specific snippets
  ├── Tasks        → Build/run task definitions
  └── AI providers → API keys + model routing
```

---

## Development Phases & Roadmap

### Phase 0 — Foundation (Weeks 1–4)

**Goal**: hone-editor core, basic rendering on macOS.

| Task | Repo | Deliverable |
|---|---|---|
| Create GitHub org + repos + CI | all | Build pipelines |
| Rope-based text buffer | hone-editor | TextBuffer |
| Document model | hone-editor | EditorDocument |
| Cursor & selection | hone-editor | CursorManager |
| Viewport manager | hone-editor | ViewportManager |
| View model contract | hone-editor | EditorViewModel interface |
| macOS native view | hone-editor | Core Text rendering |
| Basic keyboard input | hone-editor | Type, move cursor |
| Undo/redo | hone-editor | UndoManager |

**Milestone**: Open file → syntax-colored text → type → move cursor → undo. macOS.

---

### Phase 1 — Editor Core Complete (Weeks 5–10)

**Goal**: Feature-complete hone-editor, cross-platform, Lezer, diff engine.

| Task | Repo | Deliverable |
|---|---|---|
| Lezer integration | hone-editor | Incremental syntax highlighting |
| Code folding | hone-editor | Fold/unfold |
| Find & replace | hone-editor | Text + regex search |
| Multi-cursor | hone-editor | All occurrences, above/below |
| Autocomplete overlay | hone-editor | Popup rendering |
| Minimap | hone-editor | Minimap data |
| Diff engine | hone-editor | Side-by-side + unified diff |
| Ghost text rendering | hone-editor | AI inline completion display |
| Windows native view | hone-editor | DirectWrite + Direct2D |
| Linux native view | hone-editor | Pango + Cairo |
| IME support | hone-editor | CJK input, dead keys |
| Clipboard | hone-editor | Copy/cut/paste all platforms |
| **Release** | hone-editor | **v0.1.0 on npm as @honeide/editor** |

**Milestone**: Full editor on macOS/Windows/Linux. Published standalone.

---

### Phase 2 — Terminal, Workspace & AI Foundation (Weeks 11–18)

**Goal**: hone-terminal, hone-core workspace, AI provider layer.

| Task | Repo | Deliverable |
|---|---|---|
| VT parser | hone-terminal | xterm-256color parser |
| Terminal buffer + scrollback | hone-terminal | Screen buffer |
| PTY management | hone-terminal | Shell spawning |
| Terminal native rendering | hone-terminal | All desktop platforms |
| Workspace management | hone-core | Multi-root, file watching |
| File indexer | hone-core | Fuzzy finder |
| Settings store | hone-core | Layered JSON settings |
| Keybinding system | hone-core | Configurable bindings |
| Global search (ripgrep) | hone-core | Workspace search |
| Git client | hone-core | Status, blame, diff |
| **AI provider abstraction** | hone-core | AIProviderAdapter interface |
| **Anthropic adapter** | hone-core | Claude API integration |
| **OpenAI adapter** | hone-core | GPT API integration |
| **Ollama adapter** | hone-core | Local model support |
| **OpenAI-compatible adapter** | hone-core | Generic endpoint support |
| **Inline completion** | hone-core | Ghost text via AI providers |
| **AI chat (basic)** | hone-core | Chat with context collection |
| **Release** | hone-terminal | **v0.1.0 on npm** |

**Milestone**: All components published. AI inline completion + chat working.

---

### Phase 3 — Workbench Shell (Weeks 19–24)

**Goal**: VSCode-like application shell with AI views.

| Task | Repo | Deliverable |
|---|---|---|
| Layout grid engine | hone | Resizable split panels |
| Tab manager | hone | Tabs with split/drag/reorder |
| Activity bar | hone | Icon sidebar |
| File explorer | hone | Tree view |
| Search view | hone | Global search results |
| Git view | hone | Source control panel |
| Command palette | hone | Ctrl+Shift+P |
| Quick open | hone | Ctrl+P |
| Settings UI | hone | Visual editor |
| Theme engine | hone | VSCode theme loading |
| Status bar | hone | With AI provider indicator |
| Notifications | hone | Toasts |
| **AI chat sidebar** | hone | Chat view with model selector |
| **AI context panel** | hone | Shows what AI sees |
| Welcome tab | hone | First-launch + API key setup |

**Milestone**: Looks and feels like VSCode with AI chat built-in.

---

### Phase 4 — Intelligence & Agent Mode (Weeks 25–32)

**Goal**: LSP, DAP, full AI agent, PR review.

| Task | Repo | Deliverable |
|---|---|---|
| LSP client (full 3.17) | hone-core | Language intelligence |
| LSP lifecycle manager | hone-core | Auto-start per language |
| Completions via LSP | hone | Autocomplete |
| Go-to-definition | hone | Ctrl+click |
| Find references | hone | References panel |
| Hover info | hone | Type info |
| Diagnostics | hone | Inline errors, problems panel |
| Rename symbol | hone | Cross-file rename |
| Code formatting | hone-core | Format on save |
| DAP client | hone-core | Debug adapter |
| Debug UI | hone | Breakpoints, variables, call stack |
| **Agent orchestrator** | hone-core | Multi-step autonomous coding |
| **Agent tools** | hone-core | File, terminal, git, search, LSP tools |
| **Approval flow** | hone | Per-hunk accept/reject UI |
| **Agent activity view** | hone | Live action log |
| **GitHub/GitLab integration** | hone-core | PR fetching + review submission |
| **AI PR review engine** | hone-core | Diff analysis + annotations |
| **PR review view** | hone | Browse + review PRs in-editor |
| **Diff view** | hone | Side-by-side diff with AI annotations |
| **Google adapter** | hone-core | Gemini support |
| **Bedrock adapter** | hone-core | AWS enterprise support |
| Code actions (explain/refactor/fix) | hone | Right-click AI actions |

**Milestone**: Full language intelligence + AI agent + PR review. The killer release.

---

### Phase 5 — Extension System (Weeks 33–38)

**Goal**: Public API, built-in extensions, marketplace.

| Task | Repo | Deliverable |
|---|---|---|
| **Extension API v1.0** | hone-api | Stable public API |
| Extension host | hone-core | Lifecycle management |
| Extension activation | hone-core | Lazy activation |
| TypeScript extension | hone-extensions | TS/JS via LSP |
| Python extension | hone-extensions | Python via Pyright |
| Rust extension | hone-extensions | Rust via rust-analyzer |
| Go extension | hone-extensions | Go via gopls |
| HTML/CSS extension | hone-extensions | HTML/CSS support |
| JSON extension | hone-extensions | Schema validation |
| Markdown extension | hone-extensions | Preview + editing |
| Git extension | hone-extensions | Enhanced git features |
| Default themes | hone-themes | 10+ themes |
| VSCode theme import tool | hone-themes | Convert existing themes |
| Extension marketplace | infra | Discovery + install |

**Milestone**: Third-party developers can build extensions. Ecosystem opens.

---

### Phase 6 — Mobile & Web (Weeks 39–46)

**Goal**: Hone on iOS, Android, and web.

| Task | Repo | Deliverable |
|---|---|---|
| iOS editor rendering | hone-editor | Core Text + Metal, touch |
| iOS terminal | hone-terminal | Character grid for iOS |
| iOS workbench | hone | Touch-friendly layout |
| iOS keyboard | hone-editor | Software keyboard + shortcut bar |
| iOS PR review | hone | Swipe-through diff + AI annotations |
| Android editor | hone-editor | Canvas rendering, touch |
| Android terminal | hone-terminal | Character grid for Android |
| Android workbench | hone | Material-style adaptation |
| Web editor | hone-editor | DOM/Canvas rendering |
| Web terminal | hone-terminal | Browser-based |
| Web workbench | hone | Browser-hosted IDE |
| Mobile AI voice-to-code | hone | Speak intent → AI generates |
| Remote development | hone-core | SSH remote, containers |
| Settings sync | hone-core | Sync across devices |

**Milestone**: Hone on every platform. PR review on iPad is real.

---

### Phase 7 — Polish & Launch (Weeks 47–52)

**Goal**: Performance, accessibility, v1.0.

| Task | Repo | Deliverable |
|---|---|---|
| Performance profiling | all | Identify bottlenecks |
| Memory optimization | editor, terminal | < 100MB idle target |
| Startup time | hone | < 1s to interactive |
| Accessibility | all | Screen reader, high contrast |
| Localization | hone | i18n infrastructure |
| Auto-updater | hone | Per-platform updates |
| Documentation | hone.dev | User guide, extension guide, API docs |
| Landing page | hone.dev | Website with branding |
| **Launch** | all | **HN, ProductHunt, blog, social** |

**Milestone**: v1.0. Hone is self-hosting (used to develop itself).

---

## Performance Targets vs VSCode

| Metric | VSCode (Electron) | Hone Target | Improvement |
|---|---|---|---|
| Cold start | ~3–5s | < 1s | 3–5x |
| RAM idle | ~300–500MB | < 100MB | 3–5x |
| RAM heavy use | ~1–2GB | < 300MB | 3–5x |
| Binary size | ~300MB | < 50MB | 6x |
| Keystroke latency | ~30–50ms | < 10ms | 3–5x |
| File open (100K lines) | ~2s | < 500ms | 4x |
| AI ghost text render | ~50–100ms | < 30ms | 2–3x |
| Diff view render | ~500ms | < 100ms | 5x |

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Text buffer | Rope (piece table) | O(log n), handles huge files |
| Syntax highlighting | Lezer | Proven, TypeScript-native, grammar ecosystem |
| Search backend | Ripgrep | Fastest available, VSCode uses it too |
| Theme format | VSCode-compatible JSON | Import thousands of existing themes |
| Extension format | TypeScript, AOT compiled | Native performance, type safety |
| Settings format | JSON with schema | VSCode-compatible |
| AI integration | BYOK, provider-agnostic | No single point of failure, future-proof |
| AI provider protocol | Adapter pattern | Each provider normalizes to same interface |
| VCS integration | Shell git + platform APIs | Simple, always current |
| LSP transport | stdio | Standard, all servers support it |
| Build system | Perry | Dog-food Perry's own tooling |

---

## AI Strategy: Why BYOK Wins

| Risk | BYOK mitigation |
|---|---|
| Anthropic cuts off access (like Windsurf) | User has their own key, Hone is not a reseller |
| Provider raises prices | User switches provider in one config change |
| New hot model drops | Works immediately if OpenAI-compatible |
| Enterprise needs private deployment | Point at Bedrock/Vertex/Azure/on-prem |
| User wants local/offline AI | Ollama/llama.cpp, no internet needed |
| Provider changes API format | Only the adapter needs updating, not the whole app |
| User wants to mix providers | Route features to different providers independently |

**Hone's AI value is in the UX layer**: context awareness, diff rendering, agent approval flow, PR review annotations, mobile interactions. Not in reselling API access. The UX is the moat.

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Native rendering complexity | High | High | macOS-first, extract patterns early |
| IME input handling | Medium | High | Test CJK input from day one |
| Perry compiler maturity | High | Medium | Build incrementally, report issues |
| Extension API lock-in | High | Medium | Minimal API, mark unstable until v1 |
| AI provider API changes | Medium | Medium | Adapter pattern isolates changes |
| LSP edge cases | Medium | Medium | Test with top 5 language servers |
| Mobile platform limitations | Medium | Medium | Accept reduced feature set |
| Competition (Cursor, Zed) | Medium | Low | Multi-platform + BYOK is unique |
| AI providers blocking Hone | Low | Low | BYOK means user's key, not Hone's |

---

## Success Criteria

**v0.1 (Internal Alpha)**
- [ ] hone-editor: Edit files with syntax highlighting on macOS
- [ ] hone-terminal: Basic terminal working
- [ ] AI inline completion with one provider

**v0.5 (Public Beta)**
- [ ] All desktop platforms
- [ ] LSP for 5+ languages
- [ ] AI chat + agent mode
- [ ] PR review with AI annotations
- [ ] Extension system
- [ ] 3+ AI providers supported (Anthropic, OpenAI, Ollama)
- [ ] VSCode themes importable
- [ ] hone-editor + hone-terminal published as standalone packages

**v1.0 (Public Launch)**
- [ ] Feature parity with core VSCode for daily use
- [ ] Mobile (iOS + Android)
- [ ] Web version
- [ ] 50+ extensions in marketplace
- [ ] 5+ AI providers (Anthropic, OpenAI, Google, Ollama, OpenAI-compat)
- [ ] Performance targets met
- [ ] Hone is self-hosting (used to develop itself)

---

*Hone — sharpen your code, natively.*
