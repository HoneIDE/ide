# Hone — Core Features vs. Plugin Ecosystem

> **Purpose:** Define the line between what ships built into Hone and what lives in the plugin ecosystem. The principle is simple: if 80%+ of developers expect it to work out of the box, it's core.

---

## 1. What's Core

Everything in this section works from the moment a user opens Hone for the first time. No marketplace, no plugin installation, no configuration required.

### 1.1 Editor Fundamentals

- Multi-cursor editing, block selection, column editing
- Code folding (language-aware via Tree-sitter)
- Minimap
- Snippets engine (user-defined + language-specific defaults)
- Bracket matching and auto-close
- Indentation detection and auto-indent
- Word wrap options
- Split panes / multi-tab layout
- Workspace management (open multiple folders, switch between projects)
- File explorer / project panel with tree view
- Breadcrumb navigation
- Go to line, go to file (fuzzy finder)
- Command palette

### 1.2 Search

- Project-wide full-text search
- Regex search with capture group replacement
- Find and replace across files
- Search in open files vs. entire workspace
- File/folder include/exclude filters
- Search result preview with context lines

### 1.3 Formatting Pipeline

This is the big one people currently install Prettier for. Hone handles it natively.

**Built-in formatter orchestrator:**
- Sensible default formatting rules per language (TS/JS, Rust, Python, Go, C/C++, HTML, CSS, JSON, YAML, Markdown, etc.)
- Reads and respects existing project config files: `.prettierrc`, `.editorconfig`, `rustfmt.toml`, `pyproject.toml`, `.clang-format`, `gofmt` conventions
- "Format Document" command (Cmd+Shift+F / Ctrl+Shift+F)
- "Format Selection" for partial formatting
- Format on Save (toggle in settings, off by default)
- Format on Paste (toggle in settings, off by default)

**External formatter support:**
- Users can point Hone at any external formatter binary per language (prettier, rustfmt, black, gofmt, clang-format, etc.)
- Hone invokes the binary, diffs the output, applies changes through the standard edit pipeline
- Config: `"typescript.formatter": "prettier"` or `"python.formatter": "black"` in settings

**Why this is core:**
Every "best VS Code extensions" list starts with Prettier. Every new user's first question is "how do I format my code?" Making formatting a plugin means the out-of-box experience feels broken. Hone should format code correctly the first time someone hits save.

### 1.4 Diagnostics & Linting Pipeline

This is what ESLint + Error Lens provide in VS Code. Hone does it natively.

**Built-in diagnostics rendering:**
- Squiggly underlines (error = red, warning = yellow, info = blue, hint = gray)
- Inline error messages (Error Lens-style) — show the error text next to the line, not just in a panel. This is a toggle (on by default).
- Error/warning gutter icons
- Problems panel with filterable list of all diagnostics
- Quick fix actions (lightbulb menu) sourced from LSP code actions
- "Go to next error" / "Go to previous error" keyboard navigation

**LSP diagnostic integration:**
- Diagnostics from any connected language server light up automatically
- No configuration needed — if a language server reports problems, Hone shows them

**External linter support:**
- Users can configure external linters per language: `"typescript.linter": "eslint"`, `"python.linter": "ruff"`, `"rust.linter": "clippy"`
- Hone runs the linter, parses its output, maps diagnostics to buffer positions
- Supports common output formats (JSON, SARIF, standard error formats)

**Why this is core:**
Linting is not optional in modern development. Every VS Code user installs ESLint. Every Rust developer expects clippy diagnostics. Making this a plugin means the editor shows no errors until you install something — that's a terrible first impression.

### 1.5 Git Integration

Not basic status indicators — full, GitLens-level git integration built in.

**Repository awareness:**
- Auto-detect git repos in opened folders
- Branch indicator in status bar
- Changed file indicators in file explorer (added, modified, deleted, untracked)
- Git gutter indicators (added lines = green, modified = blue, deleted = red marker)

**Inline blame:**
- Inline blame annotation at end of current line (author, relative time, commit message preview)
- Hover for full commit details
- "Blame" view for entire file
- Blame age coloring (recent changes are more vivid)

**Diff & merge:**
- Inline diff view (changes highlighted within the file)
- Side-by-side diff view
- Three-way merge conflict resolver with accept current / accept incoming / accept both actions
- Diff for staged vs. unstaged vs. last commit

**Operations:**
- Stage / unstage files and hunks
- Commit with message (inline in editor, not a modal)
- Push / pull / fetch
- Branch create / switch / delete
- Stash / pop / apply / drop
- Interactive rebase (stretch goal — v2)

**History:**
- Commit log with search and filtering
- Commit graph visualization
- File history (who changed this file, when, diffs per commit)
- Line history (history of changes to a specific line range)

**Why this is core:**
GitLens has 40M+ downloads — literally the most popular non-language VS Code extension. Zed's biggest complaint is weak git integration. Every developer uses git. There's no reason this should be a plugin.

### 1.6 LSP Client (Language Server Protocol)

Full LSP 3.17+ client built into Hone's core.

**Features wired to LSP:**
- Intelligent code completion (IntelliSense-equivalent)
- Hover information (type info, documentation)
- Go to definition / declaration / implementation / type definition
- Find all references
- Document symbols / outline view
- Workspace symbols
- Rename symbol (across files)
- Code actions (quick fixes, refactorings)
- Signature help
- Document highlights
- Code lens
- Inlay hints
- Folding ranges
- Semantic token highlighting

**Language server management:**
- Built-in registry of known language servers with install hints
- Auto-detect language servers already on PATH
- Auto-start/stop servers per workspace
- Crash recovery (auto-restart on crash, back off after repeated crashes)
- User configurable: point at any LSP binary per language

**Built-in language server registry (ships with Hone):**

| Language | Server | Install hint |
|----------|--------|-------------|
| TypeScript/JavaScript | typescript-language-server | `npm i -g typescript-language-server typescript` |
| Rust | rust-analyzer | `rustup component add rust-analyzer` |
| Python | basedpyright | `pip install basedpyright` |
| Go | gopls | `go install golang.org/x/tools/gopls@latest` |
| C/C++ | clangd | Ships with LLVM / Xcode |
| Java | jdtls | Eclipse JDT Language Server |
| Ruby | solargraph or ruby-lsp | `gem install solargraph` |
| PHP | intelephense | `npm i -g intelephense` |
| Elixir | elixir-ls | Via mix |
| Zig | zls | Via zigup |
| HTML/CSS/JSON | vscode-langservers | `npm i -g vscode-langservers-extracted` |
| YAML | yaml-language-server | `npm i -g yaml-language-server` |
| Markdown | marksman | Via GitHub releases |
| TOML | taplo | `cargo install taplo-cli` |
| Terraform | terraform-ls | HashiCorp releases |
| Dockerfile | dockerfile-language-server | `npm i -g dockerfile-language-server-nodejs` |

When Hone opens a file and no language server is running, it checks the registry, checks if the binary exists, and either starts it or shows: "Hone supports Python via basedpyright. Install? `pip install basedpyright`"

### 1.7 DAP Client (Debug Adapter Protocol)

Full debugging support built into core.

- Breakpoints (line, conditional, logpoints)
- Step over / step into / step out / continue
- Variable inspector (local, global, watch expressions)
- Call stack view
- Debug console (REPL)
- Multi-target debugging
- Launch and attach configurations
- Debug adapter auto-detection (similar to LSP registry)

### 1.8 Integrated Terminal

- Multiple terminal instances
- Split terminal panes
- Shell detection and configuration (bash, zsh, fish, PowerShell)
- Working directory awareness (follows active file or project root)
- Link detection (clickable URLs, file paths)
- Copy/paste with proper escape handling

### 1.9 Spell Checking

- Built-in spell check for comments, strings, markdown, and commit messages
- English dictionary shipped by default
- Support for additional language dictionaries
- Custom word list per user and per workspace
- Toggle on/off per file type
- Squiggly underline for misspelled words, right-click to correct

### 1.10 Themes & Visual

- 10+ built-in themes covering: dark (2-3 variants), light (2-3 variants), high-contrast dark, high-contrast light, plus popular styles inspired by Dracula, One Dark, Catppuccin, Solarized, Nord
- Built-in file icon set covering all common file types and frameworks
- Customizable editor font, size, line height, ligature support
- Customizable UI density (compact, normal, comfortable)
- Themes and icons are extensible via Tier 1 plugins for custom options

### 1.11 AI Integration (BYOK)

- Chat panel for conversing with AI about code
- Inline suggestions (ghost text completions)
- AI changes go through the Changes Queue with configurable trust level
- Provider abstraction: Anthropic, OpenAI, Ollama, custom endpoints
- Users bring their own API keys — no Hone account required for AI
- Context-aware: AI can see the current file, workspace structure, selected code

### 1.12 Settings & Configuration

- GUI settings editor + raw JSON settings file
- Workspace-level settings (`.hone/settings.json` in project root)
- User-level settings (global defaults)
- Keybinding editor with conflict detection
- Built-in VS Code keymap as default (most users are migrating from VS Code)
- Settings sync via Hone Services (optional)

---

## 2. Ready-to-Go Plugins

These plugins should be available on the marketplace from day one of the plugin ecosystem launch. They demonstrate the plugin system works, cover the most common developer-segment-specific needs, and fill gaps that core intentionally doesn't cover.

Organized by developer segment to illustrate the principle: these are things specific subsets of developers need, not universal expectations.

### 2.1 Web Development

| Plugin | Tier | Capabilities | What it does |
|--------|------|-------------|-------------|
| **Tailwind CSS IntelliSense** | 2 | editor.read, editor.write, editor.decorations | Class autocomplete, hover preview, lint unknown classes |
| **Live Server** | 3 | network, process.spawn, ui.statusbar | Local dev server with live reload for HTML/CSS/JS |
| **Auto Rename Tag** | 2 | editor.read, editor.write | Sync rename HTML/XML open and close tags |
| **Color Highlight** | 2 | editor.read, editor.decorations | Show color swatches inline for hex/rgb/hsl values |
| **SVG Preview** | 2 | editor.read, ui.panel | Preview SVG files in a side panel |

### 2.2 API Development

| Plugin | Tier | Capabilities | What it does |
|--------|------|-------------|-------------|
| **REST Client** | 3 | network, editor.read, ui.panel | Send HTTP requests and view responses in-editor. Define requests in `.http` files. |
| **GraphQL** | 2 | editor.read, editor.decorations, filesystem.read | GraphQL syntax, schema validation, autocomplete |
| **gRPC Client** | 3 | network, process.spawn, ui.panel | gRPC request testing |

### 2.3 Database

| Plugin | Tier | Capabilities | What it does |
|--------|------|-------------|-------------|
| **SQL Client** | 3 | network, ui.panel, ui.commandPalette | Connect to PostgreSQL/MySQL/SQLite, run queries, browse tables |
| **MongoDB Browser** | 3 | network, ui.panel | Browse MongoDB collections, run queries (Mango dogfooding opportunity) |
| **Redis Viewer** | 3 | network, ui.panel | Browse Redis keys, inspect values |

### 2.4 Container & Infrastructure

| Plugin | Tier | Capabilities | What it does |
|--------|------|-------------|-------------|
| **Docker** | 3 | process.spawn, ui.panel, filesystem.read | Manage containers, images, compose files. Build/run/stop. |
| **Kubernetes** | 3 | process.spawn, network, ui.panel | Browse clusters, view pods, read logs, apply manifests |
| **Terraform** | 3 | process.spawn, ui.panel | Plan/apply visualization, state browser (LSP already in core) |

### 2.5 Mobile & Platform

| Plugin | Tier | Capabilities | What it does |
|--------|------|-------------|-------------|
| **iOS Simulator** | 3 | process.spawn, ui.statusbar | Launch iOS Simulator, deploy builds, view logs |
| **Android Emulator** | 3 | process.spawn, ui.statusbar | Launch Android Emulator, install APKs, logcat |
| **Flutter Tools** | 3 | process.spawn, ui.panel, ui.statusbar | Hot reload, device selection, widget inspector |
| **React Native Tools** | 3 | process.spawn, ui.panel, network | Metro bundler control, device management, debug bridge |

### 2.6 Framework-Specific

| Plugin | Tier | Capabilities | What it does |
|--------|------|-------------|-------------|
| **React / JSX Helpers** | 2 | editor.read, editor.write | Component extraction, hook utilities, import optimization |
| **Vue Tools** | 2 | editor.read, editor.write, editor.decorations | SFC support enhancements, composition API helpers |
| **Svelte Tools** | 2 | editor.read, editor.write | Svelte component helpers |
| **Next.js** | 3 | process.spawn, filesystem.read | Route visualization, API route testing, build output viewer |
| **Django** | 3 | process.spawn, filesystem.read | Template rendering, URL route browser, management commands |
| **Rails** | 3 | process.spawn, filesystem.read | Model/view/controller navigation, rake tasks, routes |

### 2.7 Collaboration & Productivity

| Plugin | Tier | Capabilities | What it does |
|--------|------|-------------|-------------|
| **WakaTime** | 3 | network, editor.read, ui.statusbar | Automatic coding time tracking and metrics |
| **TODO Highlighter** | 2 | editor.read, editor.decorations, ui.panel | Highlight TODO/FIXME/HACK annotations, list them in a panel |
| **Bookmarks** | 2 | editor.read, ui.gutter, ui.panel | Mark lines, jump between bookmarks |
| **Project Notes** | 2 | editor.read, filesystem.read, ui.panel | Per-project scratchpad / notes panel |

### 2.8 Themes & Visual (Tier 1 — data only)

| Plugin | What it provides |
|--------|-----------------|
| **Dracula Theme** | The classic dark theme |
| **One Dark Pro** | Atom-inspired dark theme |
| **Catppuccin** | Warm pastel theme family (Latte, Frappe, Macchiato, Mocha) |
| **Nord** | Arctic-inspired dark theme |
| **Solarized** | Light and dark variants |
| **Tokyo Night** | Dark theme with blue/purple accents |
| **GitHub Theme** | Light and dark GitHub-style themes |
| **Material Icons** | Alternative file icon set |
| **Bearded Icons** | Another popular icon set |

### 2.9 Keymaps (Tier 1 — data only)

| Plugin | What it provides |
|--------|-----------------|
| **Vim Mode** | Vim keybindings (note: consider building this into core like Zed does — it's very popular) |
| **Emacs Keymap** | Emacs keybindings |
| **JetBrains Keymap** | IntelliJ/WebStorm keybindings |
| **Sublime Text Keymap** | Sublime keybindings |

### 2.10 Specialized Analysis

| Plugin | Tier | Capabilities | What it does |
|--------|------|-------------|-------------|
| **Import Cost** | 2 | editor.read, editor.decorations, filesystem.read | Show imported package sizes inline |
| **Dependency Audit** | 3 | network, filesystem.read, ui.panel | Check dependencies for known CVEs |
| **Code Coverage** | 2 | editor.read, editor.decorations, filesystem.read, ui.panel | Highlight covered/uncovered lines from test coverage reports |

---

## The Litmus Test

When deciding whether something is core or a plugin, ask:

1. **Would a new user expect this to work without installing anything?** If yes → core.
2. **Does every developer need this regardless of their stack?** If yes → core.
3. **Is this specific to a language, framework, platform, or tool?** If yes → plugin.
4. **Is the absence of this feature a reason someone would say "Hone isn't ready"?** If yes → core.

Formatting, linting, git, diagnostics, search, spell check, and themes all pass tests 1, 2, and 4. Docker, Tailwind, REST clients, and iOS Simulators fail test 2 — they're valuable to specific developers, not everyone.

---

## What This Means for Launch Priority

**Hone v1 (no plugin system yet):**
Ship all of Section 1. Hone works as a complete, polished editor out of the box. No plugins needed. First impression: "This just works."

**Plugin system launch (post-v1):**
Ship the plugin infrastructure plus 10-15 of the most important ready-to-go plugins from Section 2. Priority order based on developer population size: Tailwind CSS, REST Client, Docker, TODO Highlighter, WakaTime, popular themes/keymaps. These prove the plugin system works while being genuinely useful.

**Ecosystem growth:**
Community fills in the long tail — niche language snippets, obscure framework tools, creative productivity utilities. The marketplace and SEO strategy drive discovery.
