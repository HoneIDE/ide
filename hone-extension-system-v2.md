# Hone Extension System — Architecture & Implementation Plan

> **Status:** Pre-production design — not shipping in Hone v1, but foundational work starts now.
> **Target directory:** `hone-extension/`
> **Core principle:** Plugins are Perry TypeScript projects compiled to native dynamic libraries, loaded at runtime via `dlopen`, with compile-time capability enforcement.
> **Ecosystem principle:** All plugins are free, open source, and community-driven. The marketplace hosts source snapshots for auditability and compiles all binaries from source.

---

## Table of Contents

1. [Overview & Philosophy](#1-overview--philosophy)
2. [Ecosystem Policy Decisions](#2-ecosystem-policy-decisions)
3. [What Is a Plugin?](#3-what-is-a-plugin)
4. [The SDK (`@honeide/sdk`)](#4-the-sdk-honesdk)
5. [Plugin Compilation & Native Integration](#5-plugin-compilation--native-integration)
6. [The Host API & Capability Enforcement](#6-the-host-api--capability-enforcement)
7. [Plugin Isolation Tiers](#7-plugin-isolation-tiers)
8. [Plugin Lifecycle](#8-plugin-lifecycle)
9. [UI Extension Points](#9-ui-extension-points)
10. [Changes Queue Integration](#10-changes-queue-integration)
11. [Plugin Package Format & Distribution](#11-plugin-package-format--distribution)
12. [Source Hosting & Auditability](#12-source-hosting--auditability)
13. [Marketplace Architecture](#13-marketplace-architecture)
14. [Marketplace Website & SEO](#14-marketplace-website--seo)
15. [Publisher Model](#15-publisher-model)
16. [Safety & Security Model](#16-safety--security-model)
17. [Approval & Review Process](#17-approval--review-process)
18. [Plugin Development Workflow](#18-plugin-development-workflow)
19. [LSP & DAP: Core, Not Plugins](#19-lsp--dap-core-not-plugins)
20. [Directory Structure](#20-directory-structure)
21. [Implementation Phases](#21-implementation-phases)
22. [Open Questions](#22-open-questions)

---

## 1. Overview & Philosophy

### What we learned from the competition

**VS Code** gave extensions unrestricted access (same permissions as the editor process). Result: 70K extensions but repeated supply chain attacks, performance degradation from rogue extensions, and no meaningful security boundary. Extensions are interpreted JS running in a Node.js host process.

**Cursor** inherited all of VS Code's extension problems and added AI-specific issues: confusing usage-based pricing, context/trust problems, and chronic fork-lag behind upstream VS Code.

**Zed** went conservative with WASM-based extensions. Result: strong isolation but a tiny ecosystem (~600 extensions), limited plugin capability, and a high barrier to entry (Rust/WASM).

### Hone's approach

Perry gives us something none of them had: **compile TypeScript plugin source to native code**, producing a dynamic library (`.dylib`/`.so`/`.dll`) that Hone loads at runtime. This means:

- **Low barrier to entry** — plugin authors write TypeScript, the most popular language for tooling
- **Native performance** — no interpreter, no WASM overhead, no Node.js subprocess
- **Compile-time security** — Perry only links APIs the plugin declared; undeclared capabilities don't exist in the binary
- **OS-level sandboxing** — high-privilege plugins run in processes with `seccomp-bpf` (Linux) / App Sandbox (macOS) / Job Objects (Windows)
- **Dogfooding** — every plugin validates Perry's compiler; a rich plugin ecosystem = thousands of real-world Perry test cases

---

## 2. Ecosystem Policy Decisions

These decisions shape everything downstream — marketplace design, trust model, community dynamics, and Hone's brand identity.

### 2.1 Commercialization: All Plugins Are Free

**Decision:** No paid plugins. No payment infrastructure in the marketplace. No "freemium" plugin tier.

**Rationale:**
- Nobody pays for editor plugins. The VS Code marketplace has ~70K extensions and virtually none are paid. JetBrains' paid plugin marketplace has a handful of successful paid plugins, almost all from companies. Zed introduced $20/month AI features and got immediate backlash.
- Every friction point between "developer finds plugin" and "developer uses plugin" costs ecosystem growth. A price tag is the highest-friction barrier there is.
- The plugin ecosystem is a growth engine for Hone adoption, not a revenue center. Hone makes money from the editor itself (Hone Services subscriptions for sync/relay/collaboration, and eventually Perry Publish for plugin authors who want to distribute their compiled plugins as standalone apps).

**Sponsorship support:** Plugin pages on the marketplace can display a "Sponsor" link pointing to the author's GitHub Sponsors, Open Collective, Ko-fi, or similar. Hone doesn't take a cut, doesn't handle money, just surfaces the link. This rewards good plugin authors without gating the plugin itself.

**Marketable position:** "Every Hone plugin is free and open source." Clean, simple, differentiating.

### 2.2 Open Source: Mandatory for All Public Plugins

**Decision:** All plugins published to the public Hone marketplace must be open source under an OSI-approved license.

**Policy details:**
- Accepted licenses: any OSI-approved license (MIT, Apache 2.0, BSD, MPL 2.0, AGPL, GPL, etc.)
- Licenses that restrict commercial use (e.g., "free for personal use only") are NOT allowed — they create confusion and fragment the ecosystem
- Source repository must be linked and accessible at publish time
- The marketplace fetches, stores, and compiles from source — what users see IS what they get
- Source snapshots for every published version are permanently hosted by the marketplace (see Section 12)

**Private/internal plugins:** Organizations that need proprietary internal plugins (CI/CD integrations, internal API tooling) can distribute them as **unlisted plugins** via direct URL or internal registry. These are not on the public marketplace. Source must still be available to anyone who installs them (visible within the organization), but does not need to be on a public repo. This accommodates enterprise use without compromising the public ecosystem's transparency.

**Why this is the right call:**
- Security becomes community-auditable. The #1 complaint about VS Code extensions is that you can't know what they're doing.
- Eliminates an entire class of supply chain attacks. No hidden code in closed-source binaries.
- Aligns with Hone's brand. Perry is open source. Hone's ecosystem should be too. "Transparent all the way down."
- The tradeoff (some companies won't publish proprietary plugins) is manageable. The plugins Hone needs for ecosystem growth — formatters, linters, themes, language support, git tools, quality-of-life utilities — are already overwhelmingly open source everywhere.

### 2.3 Approval: Layered, Not Gatekept

**Decision:** Automated checks on every publish, community signals ongoing, human review only for high-risk moments. No Apple-style gatekeeping.

See Section 17 for full details.

### 2.4 Publisher Verification: Low Friction, Trust Signals

**Decision:** Three tiers — unverified (default, easy), verified (domain/org proof), partner (invite-only). No company registration. No paid developer accounts.

See Section 15 for full details.

---

## 3. What Is a Plugin?

A Hone plugin is a **compiled native dynamic library** produced by Perry from TypeScript source.

### The artifact

```
prettier-hone-2.1.0.honepkg     (archive, platform-specific or source)
├── plugin.hone.json             (manifest: capabilities, hooks, config schema)
├── plugin.darwin-arm64.dylib    (compiled native library — macOS ARM)
├── plugin.darwin-x64.dylib      (compiled native library — macOS Intel)
├── plugin.linux-x64.so          (compiled native library — Linux)
├── plugin.win-x64.dll           (compiled native library — Windows)
├── signature.sig                (marketplace Ed25519 signature)
└── assets/                      (optional: icons, default configs, README)
```

For source-distributed plugins (dev mode, auditable installs):

```
prettier-hone-2.1.0-src.honepkg
├── plugin.hone.json
├── src/
│   ├── index.ts                 (entry point)
│   └── formatter.ts
├── signature.sig                (signature over source hash)
└── assets/
```

### The manifest (`plugin.hone.json`)

This is the complete contract between plugin and host. Every capability must be declared here — if it's not in the manifest, it doesn't exist at runtime.

```jsonc
{
  // Identity
  "name": "prettier-hone",
  "displayName": "Prettier for Hone",
  "version": "2.1.0",
  "author": "Prettier Team",
  "license": "MIT",
  "repository": "https://github.com/prettier/prettier-hone",
  "icon": "assets/icon.png",
  "description": "Code formatter using Prettier",

  // Entry point — the exported class name that implements HonePlugin
  "entry": "PrettierPlugin",

  // Capabilities — what this plugin can do
  // Determines: which Host API functions are linked, which isolation tier applies
  "capabilities": {
    // Editor access
    "editor.read": true,                    // Read buffer contents, selections, cursor
    "editor.write": true,                   // Submit edits via Changes Queue
    "editor.decorations": true,             // Add inline decorations (squiggles, highlights)

    // Filesystem access (glob patterns, relative to workspace root)
    "filesystem.read": ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.css", "**/*.json"],
    "filesystem.write": false,

    // Network
    "network": false,                       // No HTTP/socket access

    // Process spawning (allowlisted binaries only)
    "process.spawn": [],                    // Empty = none. Example: ["prettier", "node"]

    // Terminal
    "terminal": false,                      // No interactive shell access

    // UI extension points
    "ui.panel": false,                      // Side panel
    "ui.statusbar": true,                   // Status bar items
    "ui.gutter": false,                     // Gutter icons/actions
    "ui.commandPalette": true,              // Register commands
    "ui.contextMenu": true,                 // Add context menu items
    "ui.notifications": true,               // Show toast notifications
    "ui.webview": false                     // Embedded webview (Tier 3 only)
  },

  // Event hooks — which editor events this plugin subscribes to
  "hooks": [
    "onDocumentFormat",
    "onDocumentSave",
    "onDocumentOpen",
    "onSelectionChange",
    "onCommand:prettier.formatSelection"
  ],

  // User-facing configuration schema
  "configSchema": {
    "printWidth": {
      "type": "number",
      "default": 80,
      "description": "Line width before wrapping"
    },
    "semi": {
      "type": "boolean",
      "default": true,
      "description": "Add semicolons at the end of statements"
    },
    "tabWidth": {
      "type": "number",
      "default": 2,
      "description": "Number of spaces per indentation level"
    },
    "singleQuote": {
      "type": "boolean",
      "default": false,
      "description": "Use single quotes instead of double"
    }
  },

  // Minimum Hone version required
  "hone": ">=0.1.0",

  // Perry compiler version used to build (set automatically by build pipeline)
  "perryVersion": "0.12.0"
}
```

---

## 4. The SDK (`@honeide/sdk`)

The SDK is a TypeScript package that plugin authors import. It defines the types, base classes, and interfaces that Perry knows how to compile into native code with the correct ABI.

### Package structure

```
@honeide/sdk/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Re-exports everything
│   ├── plugin.ts             # Base HonePlugin class
│   ├── types/
│   │   ├── editor.ts         # Buffer, Selection, Position, Range, TextEdit
│   │   ├── filesystem.ts     # FileHandle, FileInfo, FileWatcher
│   │   ├── ui.ts             # Panel, StatusBarItem, Decoration, Command, MenuItem
│   │   ├── process.ts        # SpawnOptions, ChildProcess
│   │   ├── network.ts        # HttpRequest, HttpResponse (Tier 3 only)
│   │   ├── config.ts         # PluginConfig, WorkspaceConfig
│   │   └── events.ts         # All hook event types
│   ├── host.ts               # HoneHost interface — the injected host API
│   ├── decorators.ts         # @command, @hook, @configurable decorators
│   └── testing/
│       ├── mock-host.ts      # Mock HoneHost for unit testing plugins
│       └── test-runner.ts    # Plugin test harness
└── tsconfig.json
```

### Core types

```typescript
// === plugin.ts — The base class every plugin extends ===

import { HoneHost } from "./host";

export abstract class HonePlugin {
  protected host: HoneHost;

  // Called once when the plugin is loaded. HoneHost is injected by Hone.
  constructor(host: HoneHost) {
    this.host = host;
  }

  // Optional lifecycle methods
  async activate?(): Promise<void>;
  async deactivate?(): Promise<void>;
}
```

```typescript
// === host.ts — What Hone provides to the plugin ===
// Only the methods corresponding to declared capabilities are present at runtime.
// Perry compiles against this interface; Hone constructs a matching vtable.

export interface HoneHost {
  // --- Always available ---
  log(level: "debug" | "info" | "warn" | "error", message: string): void;
  getConfig<T>(key: string): T;
  getWorkspaceConfig(key: string): string | undefined;
  getWorkspacePath(): string;

  // --- editor.read ---
  bufferGetText(bufferId: BufferId): string;
  bufferGetLines(bufferId: BufferId, startLine: number, endLine: number): string[];
  bufferGetSelection(bufferId: BufferId): Selection;
  bufferGetSelections(bufferId: BufferId): Selection[];
  bufferGetLanguageId(bufferId: BufferId): string;
  bufferGetFilePath(bufferId: BufferId): string | undefined;
  bufferGetLineCount(bufferId: BufferId): number;
  getActiveBufferId(): BufferId | null;
  getOpenBufferIds(): BufferId[];

  // --- editor.write ---
  bufferSubmitEdits(bufferId: BufferId, edits: TextEdit[]): Promise<EditResult>;
  bufferSetSelection(bufferId: BufferId, selection: Selection): void;
  bufferSetSelections(bufferId: BufferId, selections: Selection[]): void;

  // --- editor.decorations ---
  createDecorationType(options: DecorationTypeOptions): DecorationTypeId;
  setDecorations(bufferId: BufferId, typeId: DecorationTypeId, ranges: DecorationRange[]): void;
  clearDecorations(typeId: DecorationTypeId): void;

  // --- filesystem.read ---
  fileRead(path: string): Promise<Uint8Array>;
  fileReadText(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  fileStat(path: string): Promise<FileStat>;
  directoryList(path: string, pattern?: string): Promise<FileInfo[]>;
  fileWatch(pattern: string, callback: (event: FileWatchEvent) => void): WatchHandle;

  // --- filesystem.write ---
  fileWrite(path: string, content: Uint8Array): Promise<void>;
  fileWriteText(path: string, content: string): Promise<void>;
  fileDelete(path: string): Promise<void>;
  directoryCreate(path: string, recursive?: boolean): Promise<void>;

  // --- process.spawn ---
  spawn(command: string, args: string[], options?: SpawnOptions): Promise<ChildProcess>;

  // --- network ---
  httpRequest(request: HttpRequest): Promise<HttpResponse>;

  // --- ui.statusbar ---
  statusBarCreateItem(options: StatusBarItemOptions): StatusBarItemId;
  statusBarUpdateItem(id: StatusBarItemId, options: Partial<StatusBarItemOptions>): void;
  statusBarRemoveItem(id: StatusBarItemId): void;

  // --- ui.panel ---
  panelCreate(options: PanelOptions): PanelId;
  panelUpdate(id: PanelId, content: PanelContent): void;
  panelDispose(id: PanelId): void;

  // --- ui.gutter ---
  gutterCreateProvider(options: GutterProviderOptions): GutterProviderId;
  gutterUpdate(id: GutterProviderId, items: GutterItem[]): void;

  // --- ui.commandPalette ---
  commandRegister(id: string, title: string, handler: () => void | Promise<void>): void;
  commandUnregister(id: string): void;

  // --- ui.contextMenu ---
  contextMenuRegister(options: ContextMenuOptions): ContextMenuId;
  contextMenuUnregister(id: ContextMenuId): void;

  // --- ui.notifications ---
  notify(options: NotificationOptions): void;

  // --- ui.webview (Tier 3 only) ---
  webviewCreate(options: WebviewOptions): WebviewId;
  webviewPostMessage(id: WebviewId, message: any): void;
  webviewDispose(id: WebviewId): void;
}
```

```typescript
// === types/editor.ts ===

export type BufferId = string & { __brand: "BufferId" };

export interface Position {
  line: number;    // 0-indexed
  column: number;  // 0-indexed, byte offset
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Selection {
  anchor: Position;
  head: Position;  // cursor position
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export namespace TextEdit {
  export function insert(position: Position, text: string): TextEdit {
    return { range: { start: position, end: position }, newText: text };
  }

  export function replace(range: Range, text: string): TextEdit {
    return { range, newText: text };
  }

  export function delete_(range: Range): TextEdit {
    return { range, newText: "" };
  }

  export function replaceAll(bufferId: BufferId, host: HoneHost, newText: string): TextEdit {
    const lineCount = host.bufferGetLineCount(bufferId);
    const lastLine = host.bufferGetLines(bufferId, lineCount - 1, lineCount)[0];
    return {
      range: {
        start: { line: 0, column: 0 },
        end: { line: lineCount - 1, column: lastLine.length }
      },
      newText
    };
  }
}

export interface EditResult {
  applied: boolean;
  // If trust level required review, this is false until user approves
  pendingReview: boolean;
}
```

### Example plugin — a complete formatter

```typescript
// prettier-hone/src/index.ts
import {
  HonePlugin,
  HoneHost,
  TextEdit,
  BufferId,
  type FormatDocumentEvent,
  type DocumentSaveEvent,
} from "@honeide/sdk";

export default class PrettierPlugin extends HonePlugin {
  private statusBarId: any;

  async activate(): Promise<void> {
    this.statusBarId = this.host.statusBarCreateItem({
      text: "Prettier ✓",
      tooltip: "Prettier is active",
      alignment: "right",
      priority: 100,
    });

    this.host.commandRegister(
      "prettier.formatDocument",
      "Prettier: Format Document",
      () => this.formatCurrentDocument()
    );
  }

  // Hook: called when user triggers Format Document (Cmd+Shift+F)
  async onDocumentFormat(event: FormatDocumentEvent): Promise<TextEdit[]> {
    const text = this.host.bufferGetText(event.bufferId);
    const language = this.host.bufferGetLanguageId(event.bufferId);

    if (!this.supportsLanguage(language)) {
      return []; // No edits — not our language
    }

    const options = {
      printWidth: this.host.getConfig<number>("printWidth"),
      semi: this.host.getConfig<boolean>("semi"),
      tabWidth: this.host.getConfig<number>("tabWidth"),
      singleQuote: this.host.getConfig<boolean>("singleQuote"),
      parser: this.getParser(language),
    };

    const formatted = this.format(text, options);

    if (formatted === text) {
      this.host.notify({ message: "Already formatted", level: "info" });
      return [];
    }

    // Return edits as a batch — Hone applies atomically via Changes Queue
    return [TextEdit.replaceAll(event.bufferId, this.host, formatted)];
  }

  // Hook: format on save if configured
  async onDocumentSave(event: DocumentSaveEvent): Promise<TextEdit[]> {
    const formatOnSave = this.host.getWorkspaceConfig("editor.formatOnSave");
    if (formatOnSave !== "true") return [];
    return this.onDocumentFormat({ bufferId: event.bufferId });
  }

  private async formatCurrentDocument(): Promise<void> {
    const bufferId = this.host.getActiveBufferId();
    if (!bufferId) return;

    const edits = await this.onDocumentFormat({ bufferId });
    if (edits.length > 0) {
      await this.host.bufferSubmitEdits(bufferId, edits);
    }
  }

  private supportsLanguage(lang: string): boolean {
    return ["typescript", "javascript", "css", "json", "html", "markdown"].includes(lang);
  }

  private getParser(lang: string): string {
    const map: Record<string, string> = {
      typescript: "typescript", javascript: "babel",
      css: "css", json: "json", html: "html", markdown: "markdown",
    };
    return map[lang] || "babel";
  }

  private format(source: string, options: any): string {
    // Actual prettier formatting logic would be compiled by Perry.
    return source; // placeholder
  }

  async deactivate(): Promise<void> {
    this.host.statusBarRemoveItem(this.statusBarId);
  }
}
```

### Example plugin — a linter with diagnostics

```typescript
// eslint-hone/src/index.ts
import {
  HonePlugin,
  HoneHost,
  type DocumentOpenEvent,
  type DocumentSaveEvent,
  type DecorationTypeId,
} from "@honeide/sdk";

export default class ESLintPlugin extends HonePlugin {
  private errorDecoration!: DecorationTypeId;
  private warningDecoration!: DecorationTypeId;

  async activate(): Promise<void> {
    this.errorDecoration = this.host.createDecorationType({
      underline: { color: "#ff0000", style: "squiggly" },
      gutterIcon: "error",
    });

    this.warningDecoration = this.host.createDecorationType({
      underline: { color: "#ffaa00", style: "squiggly" },
      gutterIcon: "warning",
    });

    this.host.commandRegister(
      "eslint.fixAll",
      "ESLint: Fix All Auto-fixable Problems",
      () => this.fixAll()
    );
  }

  async onDocumentOpen(event: DocumentOpenEvent): Promise<void> {
    await this.lint(event.bufferId);
  }

  async onDocumentSave(event: DocumentSaveEvent): Promise<void> {
    await this.lint(event.bufferId);
  }

  private async lint(bufferId: any): Promise<void> {
    const filePath = this.host.bufferGetFilePath(bufferId);
    if (!filePath) return;

    // Spawn eslint as a subprocess (requires process.spawn capability)
    const result = await this.host.spawn("eslint", [
      "--format", "json",
      "--stdin",
      "--stdin-filename", filePath,
    ], {
      stdin: this.host.bufferGetText(bufferId),
    });

    const diagnostics = JSON.parse(result.stdout);
    // Map diagnostics to decoration ranges and apply...
  }

  private async fixAll(): Promise<void> {
    // Run eslint --fix, diff output, submit edits via Changes Queue
  }
}
```

---

## 5. Plugin Compilation & Native Integration

### How Perry compiles a plugin

A plugin is a Perry TypeScript project. The compilation pipeline:

```
  Plugin TypeScript Source
          │
          ▼
  Perry Compiler Frontend
  (parse TS, type-check, resolve @honeide/sdk types)
          │
          ▼
  Perry IR (Intermediate Representation)
  (functions, types, capability references identified)
          │
          ▼
  Capability Linking Phase  ◄── reads plugin.hone.json
  (only links Host API functions declared in manifest)
  (strips unreachable capability code paths)
          │
          ▼
  Perry Backend (LLVM / cranelift)
  (generate native machine code for target platform)
          │
          ▼
  Native Dynamic Library
  (.dylib / .so / .dll)
  Exports: hone_plugin_init(HoneHostAPI*) -> HonePlugin*
```

### The C ABI boundary

Perry generates a C ABI entry point for every plugin. This is the only function Hone needs to `dlopen` + `dlsym`:

```c
// Generated by Perry — the bridge between Hone (Rust) and the plugin (compiled TS)

// Hone passes this struct; only populated fields correspond to declared capabilities
typedef struct HoneHostAPI {
    // Always present
    void (*log)(int level, const char* message);
    const char* (*get_config)(const char* key);
    const char* (*get_workspace_path)(void);

    // Conditionally present based on capabilities
    const char* (*buffer_get_text)(const char* buffer_id);          // editor.read
    int (*buffer_submit_edits)(const char* buffer_id, EditBatch* edits);  // editor.write
    int (*statusbar_create_item)(StatusBarItemOpts* opts);          // ui.statusbar
    // ... etc

    // Null sentinel — marks end of populated function pointers
    void* _sentinel;
} HoneHostAPI;

// The single exported symbol
extern HonePlugin* hone_plugin_init(HoneHostAPI* host);
```

### How Hone loads it (Rust side)

```rust
// Conceptual Rust pseudocode in Hone's plugin loader

use libloading::{Library, Symbol};

struct LoadedPlugin {
    _library: Library,       // Keeps dylib in memory
    instance: *mut HonePlugin,
    manifest: PluginManifest,
}

fn load_plugin(path: &Path, manifest: &PluginManifest) -> Result<LoadedPlugin> {
    // 1. Construct the host API vtable based on manifest capabilities
    let host_api = build_host_api(manifest);

    // 2. dlopen the native library
    let library = unsafe { Library::new(path)? };

    // 3. Look up the init function
    let init: Symbol<unsafe extern "C" fn(*const HoneHostAPI) -> *mut HonePlugin> =
        unsafe { library.get(b"hone_plugin_init")? };

    // 4. Initialize the plugin, passing the capability-scoped API
    let instance = unsafe { init(&host_api) };

    // 5. Register hooks declared in manifest
    for hook in &manifest.hooks {
        register_hook(hook, instance);
    }

    Ok(LoadedPlugin { _library: library, instance, manifest: manifest.clone() })
}

fn build_host_api(manifest: &PluginManifest) -> HoneHostAPI {
    let mut api = HoneHostAPI::default(); // All fields null/zero

    // Always available
    api.log = Some(host_log);
    api.get_config = Some(host_get_config);
    api.get_workspace_path = Some(host_get_workspace_path);

    // Conditionally populate based on declared capabilities
    if manifest.capabilities.editor_read {
        api.buffer_get_text = Some(host_buffer_get_text);
        api.buffer_get_lines = Some(host_buffer_get_lines);
        api.buffer_get_selection = Some(host_buffer_get_selection);
        // ...
    }

    if manifest.capabilities.editor_write {
        api.buffer_submit_edits = Some(host_buffer_submit_edits);
        // ...
    }

    if manifest.capabilities.network {
        api.http_request = Some(host_http_request);
    }
    // network: false → api.http_request stays None/null

    api
}
```

---

## 6. The Host API & Capability Enforcement

### Two-layer security model

**Layer 1: API surface restriction (compile-time + load-time)**

The `HoneHostAPI` struct only has function pointers for declared capabilities. If a plugin declared `network: false`, there's no `http_request` pointer. The plugin literally has no function to call. Perry's compiler also strips SDK code paths that reference undeclared capabilities, so the compiled binary doesn't contain dead references.

**Layer 2: OS sandbox (runtime)**

For Tier 2 and Tier 3 plugins, the host process applies OS-level sandboxing before `dlopen`:

| Platform | Mechanism | Effect |
|----------|-----------|--------|
| macOS | `sandbox-exec` profile / App Sandbox entitlements | Block syscalls: `socket()`, `open()` outside allowed paths, `exec()` outside allowlist |
| Linux | `seccomp-bpf` filter | Whitelist allowed syscalls per capability set |
| Windows | Job Objects + Restricted Tokens + AppContainer | Process-level restrictions on filesystem, network, and process creation |

This means even if someone hand-crafted a malicious native binary (bypassing Perry), the OS sandbox blocks unauthorized syscalls. The plugin process physically cannot `socket()` if `network` isn't declared.

### Why two layers?

Layer 1 (API surface) handles the 99% case: honest plugin authors using the SDK. It's convenient, fast, and requires no runtime overhead.

Layer 2 (OS sandbox) handles the adversarial case: someone ships a binary that bypasses the SDK. This is the defense-in-depth guarantee.

---

## 7. Plugin Isolation Tiers

The tier is **not chosen by the plugin author** — it's derived automatically from the declared capabilities.

### Tier 1 — In-Process (UI-only)

**Capabilities:** Subset of `ui.*` only. No editor read/write, no filesystem, no network, no process.

**Examples:** Themes, icon packs, keybinding schemes, color schemes.

**Implementation:** These aren't even dynamic libraries. They're declarative data files (JSON/TOML for themes, keymap definitions). Loaded directly into Hone's main process. Zero overhead. No security concern because they can't execute code.

**Format:**
```
dracula-theme/
├── plugin.hone.json    (capabilities: { "ui.theme": true })
├── theme.json          (color definitions)
└── assets/icon.png
```

### Tier 2 — Plugin Host Process (standard plugins)

**Capabilities:** `editor.*`, `filesystem.read`, `ui.*` (except `ui.webview`), `editor.decorations`. No `network`, no `filesystem.write`, no `process.spawn`, no `terminal`.

**Examples:** Formatters (self-contained), syntax highlighters with semantic analysis, bracket pair colorizers, minimap providers, git gutter providers (read-only git operations compiled into the plugin).

**Implementation:** All Tier 2 plugins run in a single shared **Plugin Host Process**:
- Sandboxed at OS level (no network, no filesystem write, no process spawn)
- Loads all Tier 2 plugin dylibs
- Communicates with Hone's main process via typed IPC (Unix domain socket / named pipe)
- If any plugin crashes the host, Hone restarts it and reloads all Tier 2 plugins

**IPC protocol:** Binary protocol (not JSON — too slow for high-frequency editor events). Consider FlatBuffers, Cap'n Proto, or a custom Perry-native serialization format.

**Memory budget:** Each Tier 2 plugin gets a configurable memory ceiling (default: 128MB). If exceeded, Hone kills and restarts that specific plugin, notifying the user.

### Tier 3 — Isolated Process (high-privilege)

**Capabilities:** Any of: `network`, `filesystem.write`, `process.spawn`, `terminal`, `ui.webview`.

**Examples:** ESLint (spawns `eslint` binary), language servers (if not using built-in LSP bridge), remote development, Jupyter integration, AI code assistants, package managers.

**Implementation:** Each Tier 3 plugin runs in its **own dedicated process**:
- OS sandbox tuned to its specific capabilities
- Own IPC channel to Hone
- Own crash domain — one Tier 3 plugin crashing affects nothing else
- Explicit user approval at install time, with clear capability summary

### Tier derivation logic

```
function deriveTier(capabilities: Capabilities): Tier {
  if (isUIOnly(capabilities)) return Tier.InProcess;

  if (capabilities.network ||
      capabilities.filesystemWrite ||
      capabilities.processSpawn.length > 0 ||
      capabilities.terminal ||
      capabilities.uiWebview) {
    return Tier.IsolatedProcess;
  }

  return Tier.PluginHost;
}
```

---

## 8. Plugin Lifecycle

### Installation

```
User clicks "Install Prettier" in Hone's extension panel
  │
  ├─ Hone requests prettier-hone@latest from marketplace API
  ├─ Marketplace returns .honepkg URL + signature + manifest preview
  │
  ├─ [Capability Review]
  │   Hone shows: "Prettier for Hone v2.1.0"
  │   "Can: Read and modify your open files. Show status bar info."
  │   "Cannot: Access network. Access filesystem. Run programs."
  │   │
  │   Tier 1: No prompt (auto-install)
  │   Tier 2: Brief confirmation ("Install?")
  │   Tier 3: Explicit permission dialog with each dangerous capability listed
  │
  ├─ Download .honepkg for current platform
  ├─ Verify Ed25519 signature against marketplace public key
  ├─ Extract to ~/.hone/plugins/prettier-hone/
  ├─ Store manifest + trust decision in ~/.hone/plugins/registry.json
  │
  └─ [Load]
```

### Loading (on install and on Hone startup)

```
Hone reads ~/.hone/plugins/registry.json
  │
  For each registered plugin:
  ├─ Read plugin.hone.json
  ├─ Derive tier
  ├─ Tier 1: Load theme/keymap data directly
  ├─ Tier 2: Queue for Plugin Host Process
  ├─ Tier 3: Launch dedicated sandboxed process
  │
  For Tier 2 (Plugin Host):
  ├─ Start plugin host process (if not running)
  ├─ Apply OS sandbox profile (no network, no fs-write, no spawn)
  ├─ For each Tier 2 plugin:
  │   ├─ Construct HoneHostAPI with capability-scoped function pointers
  │   ├─ dlopen(plugin.dylib)
  │   ├─ dlsym("hone_plugin_init")
  │   ├─ Call hone_plugin_init(&hostAPI)
  │   ├─ Call plugin->activate()
  │   └─ Register hooks
  │
  For Tier 3 (each in own process):
  ├─ Fork/spawn new process
  ├─ Apply capability-specific OS sandbox
  ├─ dlopen + init (same as above)
  └─ Establish IPC channel
```

### Update flow

```
Marketplace notifies: prettier-hone 2.2.0 available
  │
  ├─ Download new manifest
  ├─ [Capability Diff]
  │   Compare 2.1.0 capabilities vs 2.2.0 capabilities
  │   │
  │   No new capabilities: silent update (deactivate → replace files → reactivate)
  │   New capabilities added: re-prompt user
  │     "Prettier 2.2.0 now requests: filesystem.write (new!)"
  │     "Previously could not write files. Allow?"
  │
  ├─ If approved: hot-swap (deactivate old → dlclose → replace dylib → dlopen new → activate)
  └─ If denied: stay on current version, mark update as skipped
```

### Uninstalling

```
User uninstalls plugin
  ├─ Call plugin->deactivate()
  ├─ dlclose() the library
  ├─ Remove from hook registry
  ├─ Clean up UI elements (status bar items, decorations, panels)
  ├─ Remove ~/.hone/plugins/<name>/
  └─ Update registry.json
```

---

## 9. UI Extension Points

Plugins **never render UI directly**. They describe UI declaratively; Hone renders it natively. This ensures visual consistency and prevents plugins from breaking the editor's rendering pipeline.

### Declarative UI system

```typescript
type PanelElement =
  | { type: "text"; value: string; style?: TextStyle }
  | { type: "heading"; value: string; level: 1 | 2 | 3 }
  | { type: "list"; items: ListItem[]; ordered?: boolean }
  | { type: "tree"; roots: TreeNode[] }
  | { type: "table"; columns: Column[]; rows: Row[] }
  | { type: "input"; id: string; placeholder?: string; value?: string;
      onChange: (value: string) => void }
  | { type: "button"; label: string; onClick: () => void;
      variant?: "primary" | "secondary" | "danger" }
  | { type: "separator" }
  | { type: "progress"; value: number; max: number; label?: string }
  | { type: "codeBlock"; code: string; language?: string }
  | { type: "group"; direction: "row" | "column"; children: PanelElement[];
      gap?: number };
```

### Why declarative-only?

1. **Performance**: Native rendering is faster than any embedded webview
2. **Consistency**: Every plugin looks like it belongs in Hone
3. **Security**: No script injection, no DOM manipulation, no external resource loading
4. **Accessibility**: Hone controls the accessibility tree for all UI
5. **Theming**: Plugin UI automatically inherits the user's theme

### Perry Canvas API (Tier 2+)

For plugins needing custom rendering (minimap, diff viewer, chart), a canvas-like drawing API scoped to the plugin's panel area:

```typescript
import { CanvasContext } from "@honeide/sdk/canvas";

export class MinimapPlugin extends HonePlugin {
  async onPanelRender(ctx: CanvasContext, width: number, height: number): Promise<void> {
    ctx.setFillColor(this.host.getThemeColor("editor.background"));
    ctx.fillRect(0, 0, width, height);
    // Custom native rendering into the allocated panel area
  }
}
```

### Webview (Tier 3 escape hatch)

For rare cases requiring full HTML rendering (Jupyter output, rich documentation). Requires `ui.webview` capability (Tier 3), runs in a separate renderer process, and communicates via `postMessage`. User sees a clear indicator that this panel is a webview.

---

## 10. Changes Queue Integration

Every mutation to a buffer goes through the Changes Queue, tagged with its source and trust level. Plugins are just another change source.

### Change sources and trust

```typescript
enum ChangeSource {
  User,          // Direct keyboard input — always applied immediately
  Plugin,        // From an installed plugin
  AI,            // From AI assistant (Hone's built-in or BYOK)
  LSP,           // From a language server (code actions, refactorings)
  External,      // File changed on disk
}

interface Change {
  source: ChangeSource;
  sourceId: string;         // e.g., "plugin:prettier", "ai:claude", "lsp:rust-analyzer"
  edits: TextEdit[];
  timestamp: number;
  trustLevel: TrustLevel;   // Determined by user config per source
}

enum TrustLevel {
  AutoApply,    // Apply immediately, no review
  ShowDiff,     // Show inline diff, user accepts/rejects
  Queue,        // Add to pending queue, user reviews later
  Block,        // Don't apply, just log
}
```

### User-configurable trust per plugin

```jsonc
{
  "plugins": {
    "prettier-hone": {
      "trustLevel": "auto-apply"    // Trusted formatter, auto-format
    },
    "new-refactoring-tool": {
      "trustLevel": "show-diff"     // New plugin, show what it wants to change
    }
  },
  "defaults": {
    "pluginTrustLevel": "show-diff"  // Default for new plugins
  }
}
```

### Flow

```
Plugin calls host.bufferSubmitEdits(bufferId, edits)
  │
  ├─ Hone wraps edits in a Change { source: Plugin, sourceId: "prettier-hone" }
  ├─ Looks up trust level for "prettier-hone"
  │
  ├─ AutoApply:  Apply to buffer immediately, add to undo history
  ├─ ShowDiff:   Show inline diff markers, user presses Accept/Reject
  ├─ Queue:      Add to Changes Queue panel, user reviews batch
  └─ Block:      Log silently, don't apply
```

The **same trust infrastructure handles AI edits and plugin edits**. A formatter, an AI assistant, and a refactoring tool all go through the same queue. Users configure trust once and get a consistent experience.

---

## 11. Plugin Package Format & Distribution

### `.honepkg` format

A `.honepkg` is a **gzip-compressed tar archive** (`.tar.gz` with a different extension). Tar preserves Unix permissions and is trivially streamable.

```
Archive contents:
  plugin.hone.json                         # Manifest (always first entry for fast parsing)
  signature.sig                            # Ed25519 signature over content hash
  binaries/
    darwin-arm64/plugin.dylib              # macOS ARM64
    darwin-x64/plugin.dylib               # macOS x64
    linux-x64/plugin.so                   # Linux x64
    linux-arm64/plugin.so                 # Linux ARM64 (future)
    win-x64/plugin.dll                    # Windows x64
  assets/                                  # Optional: icons, readme, screenshots
    icon.png
    README.md
```

Users only download the platform-specific slice (marketplace serves per-platform).

### Local installation paths

```
~/.hone/
├── plugins/
│   ├── registry.json                      # Installed plugins, versions, trust settings
│   ├── prettier-hone/
│   │   ├── plugin.hone.json
│   │   ├── plugin.dylib                   # Platform-appropriate binary
│   │   └── assets/
│   ├── eslint-hone/
│   │   └── ...
│   └── dracula-theme/
│       ├── plugin.hone.json
│       └── theme.json
├── plugin-host/                           # Tier 2 shared process working directory
│   └── logs/
├── plugin-cache/                          # Downloaded .honepkg cache
└── plugin-dev/                            # Symlinks for local dev plugins
```

### `registry.json`

```jsonc
{
  "version": 1,
  "plugins": {
    "prettier-hone": {
      "version": "2.1.0",
      "installedAt": "2026-03-01T10:00:00Z",
      "updatedAt": "2026-03-01T10:00:00Z",
      "tier": 2,
      "capabilities": { /* snapshot of capabilities at install time */ },
      "trustLevel": "auto-apply",
      "enabled": true,
      "sourceType": "binary",
      "signatureVerified": true
    }
  }
}
```

---

## 12. Source Hosting & Auditability

### Design: Marketplace-Hosted Source Snapshots

**Decision:** The Hone marketplace hosts its own immutable copy of every published plugin's source code. This is not optional — it's integral to the trust model.

### Why not GitHub-only?

- **Build reproducibility.** The marketplace compiles a specific commit into the binary users install. If the source only lives on GitHub, the author can force-push, rewrite history, or delete the repo. The binary can no longer be traced back to its source. Hosting the exact source snapshot guarantees: this binary came from this code, forever.
- **Independence.** GitHub is a single point of failure. Repos get DMCA'd, accounts get suspended, organizations rename. Hone's install path must be self-sufficient.
- **Auditability.** "View Source" on a plugin page shows the exact code that produced the installed binary — not whatever the `main` branch looks like today (which may be 50 commits ahead).
- **Archive resilience.** Open source projects get abandoned constantly. The marketplace copy means plugins remain installable and auditable even after the upstream repo disappears.

### The model: marketplace stores snapshots, GitHub is upstream

```
Author pushes v2.1.0 tag to GitHub
  → runs `hone plugin publish`
  → Marketplace fetches from GitHub at tag v2.1.0
  → Stores source snapshot in marketplace's own Git storage
  → Compiles from that snapshot (not from GitHub — from local copy)
  → Signs the binary
  → Links snapshot to signed binary (immutable pair)
  → Publishes

User views plugin on marketplace website:
  → Sees source browser (rendered from marketplace's snapshot)
  → Link to upstream GitHub repo (for issues, PRs, stars)
  → "View source for installed version" always works
    even if GitHub repo is gone
```

### What the marketplace hosts (per published version)

- Full source snapshot (the exact tree that was compiled)
- SHA-256 hash of the source tree
- Compiled binaries per platform
- Ed25519 signature over source hash + binary hashes
- Manifest with capability declarations
- README (rendered for the plugin page)

### What the upstream repo provides

- The development workflow (issues, PRs, CI, community discussion)
- The "living" codebase
- Social signals (stars, contributors, activity)

### Accepted upstreams

Any Git URL is accepted — GitHub, GitLab, Codeberg, Bitbucket, self-hosted Gitea. The only requirement is that the marketplace can `git clone` at publish time and check out the specified tag.

---

## 13. Marketplace Architecture

### Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                      Hone Marketplace                              │
│                                                                    │
│  ┌────────────────┐   ┌────────────────┐   ┌──────────────────┐   │
│  │ Website        │   │ REST API       │   │ Build Pipeline    │   │
│  │ (Perry Publish │   │ (publish,      │   │                   │   │
│  │  built — SEO,  │   │  download,     │   │ 1. Fetch source   │   │
│  │  source browse,│   │  search,       │   │ 2. Validate       │   │
│  │  discovery)    │   │  update,       │   │ 3. Static analyze │   │
│  │                │   │  report)       │   │ 4. Perry compile  │   │
│  └────────────────┘   └────────────────┘   │    (all platforms)│   │
│                                            │ 5. Sign binaries  │   │
│  ┌────────────────┐   ┌────────────────┐   │ 6. Store + publish│   │
│  │ CDN            │   │ Source Storage  │   └──────────────────┘   │
│  │ (.honepkg      │   │ (Git-based,    │                          │
│  │  downloads)    │   │  per-version   │   ┌──────────────────┐   │
│  └────────────────┘   │  snapshots)    │   │ Signing Service   │   │
│                       └────────────────┘   │ (Ed25519, HSM)    │   │
│                                            └──────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### Publish flow

```
Plugin author:
  $ hone plugin publish

1. CLI reads plugin.hone.json, validates schema
2. CLI identifies upstream repo + tag
3. Uploads publish request to marketplace API with author's API key

Marketplace:
4. git clone from upstream at specified tag
5. Validates manifest (schema, version bump, license is OSI-approved)
6. Stores source snapshot in marketplace Git storage
7. Runs static analysis on TypeScript source:
   - No eval(), no Function(), no dynamic import from URLs
   - No references to APIs outside declared capabilities
   - Dependency audit (known vulnerability check)
   - Code complexity metrics (flag unusually obfuscated code)
8. Perry compiles for all target platforms (in clean containers)
9. Signs each binary + source hash with marketplace Ed25519 key
10. Publishes .honepkg to CDN
11. Updates search index + plugin page
12. If capabilities changed from previous version: flags for review
13. Notifies installed users of available update

Author receives:
  ✓ prettier-hone@2.2.0 published
    Source: stored (SHA-256: abc123...)
    darwin-arm64: ✓  darwin-x64: ✓
    linux-x64: ✓     win-x64: ✓
    Static analysis: passed
    Capability diff: none
```

### API endpoints

```
GET  /api/v1/plugins                     # Search + list
GET  /api/v1/plugins/:name               # Plugin metadata
GET  /api/v1/plugins/:name/versions      # Version history
GET  /api/v1/plugins/:name/:version      # Specific version metadata
GET  /api/v1/plugins/:name/:version/pkg  # Download .honepkg (platform-specific)
GET  /api/v1/plugins/:name/:version/src  # Source snapshot tarball
POST /api/v1/plugins                     # Publish new plugin
POST /api/v1/plugins/:name/report        # Report concern
GET  /api/v1/publishers/:id              # Publisher profile
```

---

## 14. Marketplace Website & SEO

### Why a public website matters

**Every plugin page is a landing page for Hone.** Someone googles "typescript formatter" or "rust linter for code editors" and finds a Hone marketplace page. They've now discovered Hone. The page shows what the plugin does, its source code, install instructions, and a "Get Hone" call to action. This is exactly how VS Code's marketplace drives editor adoption — people discover the editor through its ecosystem.

**Source browsing is unique content.** Google rewards pages with unique, useful content. A marketplace page showing the README, source code, capability manifest, version history, and download stats is rich content that no other page on the internet has in that form.

**Plugin author READMEs become content.** Good plugin authors write detailed READMEs with usage examples, configuration guides, and screenshots. Hosting these on the marketplace gets Hone free, high-quality content ranking for long-tail developer queries.

### Build it with Perry Publish

The marketplace website itself is a Perry app. Dogfooding all the way down. "The Hone plugin marketplace is built with the same technology that powers the plugins." Great story, great showcase.

### URL structure

```
marketplace.hone.dev/                              # Homepage: featured, trending, categories
marketplace.hone.dev/plugins/prettier-hone         # Plugin page (README, stats, install)
marketplace.hone.dev/plugins/prettier-hone/source  # Source browser for current version
marketplace.hone.dev/plugins/prettier-hone/source/v2.1.0  # Source browser for specific version
marketplace.hone.dev/plugins/prettier-hone/versions        # Version history + changelogs
marketplace.hone.dev/plugins/prettier-hone/capabilities    # Capability breakdown
marketplace.hone.dev/publishers/prettydev           # Publisher profile + all their plugins
marketplace.hone.dev/categories/formatters          # Category listing
marketplace.hone.dev/categories/themes              # Category listing
```

### Plugin page content

Each plugin page includes:
- Description and README (rendered markdown)
- Capability summary in plain language ("Can read and modify open files. Cannot access network.")
- Source browser (version-specific, from marketplace's snapshot)
- Version history with capability diffs between versions
- Download stats, install count
- Ratings and reviews
- Publisher info with verification badge (if applicable)
- Link to upstream repository (for issues, contributions)
- Sponsor link (if author provided one)
- "Install in Hone" deep link (`hone://install/prettier-hone`)
- "Get Hone" CTA for visitors who don't have the editor yet

### SEO metadata

Each plugin page gets proper meta tags:
```html
<title>Prettier for Hone — Code Formatter | Hone Marketplace</title>
<meta name="description" content="Free, open source code formatter for Hone IDE. Supports TypeScript, JavaScript, CSS, JSON, HTML, and Markdown.">
<meta property="og:title" content="Prettier for Hone">
<!-- structured data for developer tools -->
```

---

## 15. Publisher Model

### Three tiers, low friction

**Unverified Publisher** (default)
- Anyone with a GitHub, GitLab, or Codeberg account can publish
- Authentication via OAuth from their Git provider
- No special badge — just the absence of extra verification
- Plugins work fine, appear in search, fully functional
- This is the default and it should be frictionless: push code, it goes live (after automated checks)

**Verified Publisher**
- Author proves domain ownership (DNS TXT record) or has an established GitHub org
- Gets a small verified badge on their publisher page and plugin pages
- One-time verification process
- Example: the Prettier team verifies `prettier.io`, gets a badge on all their plugins

**Hone Partner**
- Invitation-only, for significant ecosystem contributors
- Ongoing relationship with the Hone team
- Plugins may be featured, recommended by default, or included in "starter packs"
- Reserved for teams behind major tools: popular formatters, language servers, essential dev utilities

### What we do NOT require

- **No company registration.** Too heavy for an open source ecosystem. A hobbyist who wrote a nice theme shouldn't need corporate documents.
- **No paid developer accounts.** We want more publishers, not fewer. Zero cost to publish.
- **No manual approval for all new publishers.** Too slow and doesn't prevent much. Automated checks + community signals catch ongoing behavior better than a one-time gate.

### Trust signals on plugin pages

Instead of heavyweight verification, surface the signals that actually matter:

```
Prettier for Hone v2.1.0
By @prettydev · ✓ Verified Publisher
3 plugins · 12K total downloads · Active since Jan 2026
Source: github.com/prettydev/prettier-hone (MIT)
Capabilities: editor read/write, status bar · No network access
```

That tells you everything you need to know. None of it required manual approval.

---

## 16. Safety & Security Model

### Threat model

| Threat | Mitigation |
|--------|-----------|
| Malicious plugin steals source code | Capability system: no `filesystem.read` beyond declared globs; OS sandbox blocks undeclared file access |
| Plugin exfiltrates data over network | `network: false` → no `http_request` in API + OS sandbox blocks `socket()` syscall |
| Plugin runs cryptominer / ransomware | `process.spawn: []` + OS sandbox blocks `exec()`; memory budget kills runaway processes |
| Supply chain via dependency | Marketplace compiles from source in clean container; dependency audit on publish |
| Hidden malicious code in binary | Binaries are NEVER uploaded by authors — marketplace always compiles from hosted source |
| Plugin impersonates another plugin | Ed25519 signatures; publisher namespace control; marketplace-compiled only |
| Plugin crashes the editor | Tier 2: shared process crash is isolated; Hone auto-restarts. Tier 3: per-process isolation |
| Plugin degrades performance | Memory budgets; CPU time monitoring; slow plugins get warnings shown to user |
| Capability escalation in update | Manifest diff on update; new capabilities require explicit re-approval |
| Plugin reads other plugins' data | No shared state between plugins; per-plugin IPC; OS process isolation for Tier 3 |
| Upstream repo tampered after publish | Marketplace hosts immutable source snapshots; binary is built from snapshot, not live repo |

### The "free + open source + marketplace-compiled" security trinity

These three ecosystem policies reinforce each other:

1. **Open source** means anyone can audit the code
2. **Marketplace-compiled** means the binary provably comes from the visible source
3. **Free** means no incentive for authors to hide monetization-related telemetry or tracking

Together they eliminate the most dangerous attack surface in VS Code's model: opaque binaries from unknown authors with unrestricted permissions.

### Signature verification

```
Marketplace holds:
  - Ed25519 signing keypair (private key in HSM)
  - Public key is bundled with Hone binary

On plugin install:
  1. Hone downloads .honepkg
  2. Computes SHA-256 hash of: manifest + binary + source snapshot reference
  3. Verifies Ed25519 signature against bundled public key
  4. If verification fails: refuse to install

On Hone startup:
  1. For each installed plugin, verify signature hasn't been tampered with
  2. If any file changed since install: disable plugin, notify user
```

### Runtime monitoring

```
Plugin Health Monitor:
  - CPU usage per plugin (sampled every 100ms)
    → Warning at sustained >25% CPU for 5 seconds
    → Kill + restart at sustained >50% CPU for 10 seconds

  - Memory usage per plugin
    → Warning at 75% of budget
    → Kill + restart at 100% of budget (default 128MB Tier 2, 256MB Tier 3)

  - IPC latency (hook response time)
    → Warning if hook response >500ms
    → Timeout and skip at >5000ms
    → Repeated timeouts → disable plugin, suggest to user

  - Crash frequency
    → Auto-restart on first crash
    → After 3 crashes in 5 minutes → disable plugin
    → Notify user: "Prettier crashed repeatedly and has been disabled"
```

---

## 17. Approval & Review Process

### Layered approach: automated baseline, community signals, human review for high-risk

Pure manual review doesn't scale (Apple's App Store still lets malware through). Pure community-driven review is reactive (someone has to notice the problem first; VS Code's community reported 100+ malicious extensions in the past year, meaning 100+ were live long enough to cause harm). We use both, plus strong automation.

### Layer 1 — Automated (every publish, instant)

Non-negotiable, catches the obvious 80%:

- **Source-only compilation:** Perry compiles from marketplace-hosted source in a clean container. No pre-built binary injection is possible.
- **Static analysis flags:** `eval()`, `Function()`, dynamic imports from URLs, obfuscated code, unusual patterns
- **Capability verification:** Declared capabilities match what the code actually references. Perry's compiler can detect this at the linking phase — if the code imports `httpRequest` but the manifest says `network: false`, compilation fails.
- **Dependency audit:** Check against known vulnerability databases (CVE, npm audit equivalent)
- **License validation:** Must be OSI-approved; must be present in source
- **Capability diff on updates:** New capabilities flagged automatically

If automated checks fail, the plugin is rejected with clear error messages. No human in the loop needed.

### Layer 2 — Community signals (ongoing, passive)

- Download counts, ratings, reviews (standard marketplace signals)
- "Report concern" button with one-click categories: "suspicious behavior", "crashes", "doesn't work as described", "abandoned"
- Reports trigger automated re-scan + escalation to Layer 3
- Community trust score: plugins from authors with established track records get a subtle indicator
- Open source means community members can and do audit source code independently

### Layer 3 — Human review (triggered, not routine)

Humans review only high-risk moments, keeping the queue small enough to be practical:

- **New publishers:** First plugin from a new account gets a human spot-check (manifest review, quick source skim). Feasible because new publishers are a trickle, not a flood.
- **Tier 3 plugins:** Anything requesting dangerous capabilities (network + filesystem.write, process.spawn) gets human review before first publish.
- **Community flags:** Anything flagged by Layer 2 gets human review.
- **Capability escalation:** Plugin update adding new dangerous capabilities gets human review.
- **Anomaly detection:** Sudden spike in downloads from unusual geographic patterns, or source code that changed drastically between versions.

### What this is NOT

- Not Apple-style multi-day review queues
- Not opaque rejection with no explanation
- Not a bottleneck for iteration speed

Tier 1 and Tier 2 plugins from existing publishers should go live within minutes of passing automated checks. Human review is reserved for moments where the risk justifies the delay.

---

## 18. Plugin Development Workflow

### Scaffolding

```bash
$ hone plugin new my-awesome-plugin

Creating plugin: my-awesome-plugin
  ✓ my-awesome-plugin/plugin.hone.json
  ✓ my-awesome-plugin/src/index.ts
  ✓ my-awesome-plugin/tsconfig.json
  ✓ my-awesome-plugin/package.json
  ✓ my-awesome-plugin/tests/index.test.ts
  ✓ my-awesome-plugin/.gitignore

Next steps:
  cd my-awesome-plugin
  hone plugin dev          # Start dev mode with hot-reload
```

### Dev mode

```bash
$ cd my-awesome-plugin
$ hone plugin dev

[Perry] Compiling my-awesome-plugin...
[Perry] ✓ Compiled in 340ms → .hone-dev/plugin.dylib
[Hone]  Loading plugin in dev mode...
[Hone]  ✓ my-awesome-plugin activated

Watching for changes...

[Perry] src/index.ts changed
[Perry] Recompiling...
[Perry] ✓ Compiled in 180ms → .hone-dev/plugin.dylib
[Hone]  Hot-reloading my-awesome-plugin...
[Hone]  ✓ deactivated → dlclose → dlopen → activated (45ms)
```

Dev mode features:
- **Hot-reload:** Perry watches source, recompiles on change, Hone does `dlclose` → `dlopen`
- **Dev console:** Plugin logs stream to a dedicated panel in Hone
- **Capability relaxation:** In dev mode, optionally relax sandbox (prominent "DEV MODE" banner)
- **Performance profiling:** Hone instruments hook calls, shows timing data

### Testing

```typescript
// tests/index.test.ts
import { MockHost, createTestBuffer } from "@honeide/sdk/testing";
import PrettierPlugin from "../src/index";

describe("PrettierPlugin", () => {
  let host: MockHost;
  let plugin: PrettierPlugin;

  beforeEach(() => {
    host = new MockHost({
      config: { printWidth: 80, semi: true },
    });
    plugin = new PrettierPlugin(host);
  });

  test("formats TypeScript file", async () => {
    const buffer = createTestBuffer({
      text: 'const x = {a:1,b:2,c:3}',
      languageId: "typescript",
    });
    host.addBuffer(buffer);

    const edits = await plugin.onDocumentFormat({ bufferId: buffer.id });

    expect(edits).toHaveLength(1);
    expect(edits[0].newText).toContain("const x = { a: 1");
  });

  test("returns no edits for unsupported language", async () => {
    const buffer = createTestBuffer({
      text: 'print("hello")',
      languageId: "python",
    });
    host.addBuffer(buffer);

    const edits = await plugin.onDocumentFormat({ bufferId: buffer.id });
    expect(edits).toHaveLength(0);
  });
});
```

```bash
$ hone plugin test
# Compiles with Perry, runs tests in sandboxed environment
```

### Publishing

```bash
$ hone plugin publish
# 1. Validates plugin.hone.json (schema, license is OSI-approved)
# 2. Authenticates with marketplace via OAuth
# 3. Marketplace fetches source from upstream Git repo at tagged version
# 4. Marketplace stores source snapshot
# 5. Marketplace compiles, signs, publishes
# 6. Plugin is live
```

---

## 19. LSP & DAP: Core, Not Plugins

Language Server Protocol and Debug Adapter Protocol support is **built into Hone's core**. This avoids the VS Code/Zed problem where basic language support requires finding and trusting the right extension.

### What's in core

- LSP client implementation (full LSP 3.17+ spec)
- DAP client implementation
- Language server process management (start, stop, restart, crash recovery)
- Language server configuration UI
- Diagnostics rendering, code actions, hover, completion, go-to-definition
- Debug console, breakpoints, variable inspector, call stack

### What plugins extend

Plugins can enhance the LSP/DAP experience without replacing it:

```typescript
export default class CustomRefactorPlugin extends HonePlugin {
  async onCodeAction(event: CodeActionEvent): Promise<CodeAction[]> {
    if (event.languageId === "typescript") {
      return [{
        title: "Extract to Perry component",
        kind: "refactor.extract",
        edits: this.computeExtraction(event),
      }];
    }
    return [];
  }
}
```

### Built-in language server registry

Hone ships with a registry of known language servers:

```jsonc
{
  "languageServers": {
    "typescript": {
      "binary": "typescript-language-server",
      "installHint": "npm install -g typescript-language-server typescript",
      "args": ["--stdio"],
      "languages": ["typescript", "javascript", "typescriptreact", "javascriptreact"]
    },
    "rust": {
      "binary": "rust-analyzer",
      "installHint": "rustup component add rust-analyzer",
      "args": [],
      "languages": ["rust"]
    },
    "python": {
      "binary": "basedpyright-langserver",
      "installHint": "pip install basedpyright",
      "args": ["--stdio"],
      "languages": ["python"]
    }
  }
}
```

If Hone detects an unsupported file type, it prompts: "Hone supports Rust via rust-analyzer. Install it? `rustup component add rust-analyzer`"

---

## 20. Directory Structure

Proposed layout for `hone-extension/` in the repository:

```
hone-extension/
├── README.md
│
├── sdk/                                # @honeide/sdk — the TypeScript SDK
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                    # Public re-exports
│   │   ├── plugin.ts                   # HonePlugin base class
│   │   ├── host.ts                     # HoneHost interface
│   │   ├── decorators.ts              # @command, @hook decorators
│   │   ├── types/
│   │   │   ├── editor.ts              # Buffer, Position, Range, TextEdit, Selection
│   │   │   ├── filesystem.ts          # FileHandle, FileStat, FileWatchEvent
│   │   │   ├── ui.ts                  # Panel, StatusBar, Decoration, Tree, etc.
│   │   │   ├── process.ts            # SpawnOptions, ChildProcess
│   │   │   ├── network.ts            # HttpRequest, HttpResponse
│   │   │   ├── config.ts             # PluginConfig, WorkspaceConfig
│   │   │   ├── events.ts             # All hook event types
│   │   │   └── changes.ts            # EditResult, TrustLevel
│   │   ├── canvas.ts                  # CanvasContext for custom rendering
│   │   └── testing/
│   │       ├── mock-host.ts           # MockHost for unit tests
│   │       ├── test-buffer.ts         # createTestBuffer helper
│   │       └── test-runner.ts         # Plugin test harness
│   └── tests/
│       ├── types.test.ts
│       └── mock-host.test.ts
│
├── host/                               # Hone-side plugin infrastructure (Rust)
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs                     # Public API
│   │   ├── manifest.rs                # plugin.hone.json parsing & validation
│   │   ├── registry.rs               # Plugin registry (registry.json management)
│   │   ├── loader.rs                  # dlopen/dlsym plugin loading
│   │   ├── host_api.rs               # HoneHostAPI struct + capability-scoped construction
│   │   ├── ipc/
│   │   │   ├── mod.rs
│   │   │   ├── protocol.rs           # Binary IPC protocol definitions
│   │   │   ├── channel.rs            # IPC channel (Unix socket / named pipe)
│   │   │   └── serialization.rs      # Fast serialization for IPC messages
│   │   ├── sandbox/
│   │   │   ├── mod.rs
│   │   │   ├── macos.rs              # sandbox-exec / App Sandbox profiles
│   │   │   ├── linux.rs              # seccomp-bpf filter generation
│   │   │   └── windows.rs            # Job Objects + AppContainer
│   │   ├── monitor.rs                # Runtime health monitoring
│   │   ├── tier.rs                   # Tier derivation from capabilities
│   │   └── hooks.rs                  # Hook registry and dispatch
│   └── tests/
│       ├── manifest_test.rs
│       ├── loader_test.rs
│       ├── sandbox_test.rs
│       └── ipc_test.rs
│
├── cli/                                # `hone plugin` CLI subcommands
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs                    # CLI entry
│   │   ├── new.rs                     # `hone plugin new`
│   │   ├── dev.rs                     # `hone plugin dev` (watch + hot-reload)
│   │   ├── build.rs                   # `hone plugin build` (Perry compile)
│   │   ├── test.rs                    # `hone plugin test`
│   │   ├── publish.rs                # `hone plugin publish`
│   │   └── pack.rs                   # `hone plugin pack` (create .honepkg)
│   └── templates/                     # Scaffolding templates
│       ├── plugin.hone.json.template
│       ├── index.ts.template
│       ├── package.json.template
│       └── tsconfig.json.template
│
├── marketplace/                        # Marketplace service
│   ├── README.md                      # Architecture notes
│   ├── api/
│   │   └── openapi.yaml              # REST API spec
│   ├── build-pipeline/
│   │   └── Dockerfile                 # Clean build environment for Perry compilation
│   ├── source-storage/
│   │   └── README.md                  # Git-based source snapshot storage design
│   ├── signing/
│   │   └── README.md                  # Ed25519 signing infrastructure
│   └── website/                       # Perry Publish marketplace website
│       └── README.md                  # SEO strategy, URL structure, page templates
│
├── examples/                          # Example plugins
│   ├── hello-world/                   # Simplest possible plugin (Tier 2)
│   │   ├── plugin.hone.json
│   │   └── src/index.ts
│   ├── word-count/                    # Status bar plugin (Tier 2)
│   │   ├── plugin.hone.json
│   │   └── src/index.ts
│   ├── formatter/                     # Formatter pattern (Tier 2)
│   │   ├── plugin.hone.json
│   │   └── src/index.ts
│   ├── linter/                        # Linter with process.spawn (Tier 3)
│   │   ├── plugin.hone.json
│   │   └── src/index.ts
│   └── theme/                         # Tier 1 theme plugin
│       ├── plugin.hone.json
│       └── theme.json
│
├── spec/                              # Formal specifications
│   ├── manifest-schema.json           # JSON Schema for plugin.hone.json
│   ├── ipc-protocol.md               # IPC binary protocol spec
│   ├── capability-model.md           # Capability system formal spec
│   ├── host-api-abi.md               # C ABI for host↔plugin boundary
│   ├── security-model.md            # Threat model and mitigations
│   └── ecosystem-policy.md           # Free, open source, approval rules
│
└── docs/                              # Plugin author documentation
    ├── getting-started.md
    ├── sdk-reference.md
    ├── capabilities-guide.md
    ├── ui-components.md
    ├── testing-guide.md
    ├── publishing-guide.md
    └── migration-from-vscode.md       # Guide for porting VS Code extensions
```

---

## 21. Implementation Phases

### Phase 0: Foundation (start now)

**Goal:** Solidify the contracts everything builds on — SDK types, manifest schema, ecosystem policies.

- [ ] Define `plugin.hone.json` JSON Schema (`spec/manifest-schema.json`)
- [ ] Write ecosystem policy document (`spec/ecosystem-policy.md`) — free, open source, approval model, publisher tiers
- [ ] Write the SDK TypeScript types (`sdk/src/types/*.ts`)
- [ ] Write the `HonePlugin` base class and `HoneHost` interface
- [ ] Write the manifest parser in Rust (`host/src/manifest.rs`)
- [ ] Write tier derivation logic (`host/src/tier.rs`)
- [ ] Create the example plugins (hello-world, word-count, theme, formatter, linter)
- [ ] Create the `MockHost` for plugin testing
- [ ] Write the capability model spec (`spec/capability-model.md`)
- [ ] Write the C ABI spec (`spec/host-api-abi.md`)

**Deliverable:** A plugin author could write a plugin against the SDK, run tests with MockHost, and validate their manifest — even though Hone can't load it yet.

### Phase 1: Local Plugin Loading

**Goal:** Hone can `dlopen` a locally-compiled plugin and call its hooks.

- [ ] Implement `HoneHostAPI` C ABI struct (`host/src/host_api.rs`)
- [ ] Implement `dlopen`/`dlsym` loader (`host/src/loader.rs`)
- [ ] Perry: compile a simple SDK plugin to a `.dylib` with correct ABI
- [ ] Implement hook dispatch (`host/src/hooks.rs`)
- [ ] Implement basic IPC protocol for Tier 2 plugin host process
- [ ] `hone plugin build` CLI command
- [ ] `hone plugin dev` with hot-reload (watch → recompile → dlclose/dlopen)
- [ ] Wire up editor.read and editor.write host API functions to Hone's buffer system

**Deliverable:** Developer writes a formatter in TypeScript, compiles with Perry, uses it in Hone via `hone plugin dev`.

### Phase 2: Sandbox & Safety

**Goal:** Capability enforcement is real and tested.

- [ ] Implement OS sandbox profiles (macOS, Linux, Windows)
- [ ] Implement capability-scoped `HoneHostAPI` construction
- [ ] Perry: strip undeclared capability references during compilation
- [ ] Implement runtime health monitoring (CPU, memory, crash recovery)
- [ ] Implement plugin registry (`registry.json` management)
- [ ] Implement Ed25519 signature verification
- [ ] Write security model spec and threat model (`spec/security-model.md`)

**Deliverable:** Plugins are sandboxed. A plugin declaring `network: false` physically cannot make network requests.

### Phase 3: UI Extension Points

**Goal:** Plugins can render panels, status bar items, decorations, and context menus.

- [ ] Implement declarative UI component system
- [ ] Wire up all `ui.*` capabilities
- [ ] Implement `editor.decorations` (squiggly underlines, inline hints, highlights)
- [ ] Implement Perry canvas API for custom rendering
- [ ] Changes Queue integration (plugin edits as change source with trust levels)

**Deliverable:** Full-featured linter plugin with diagnostics, code actions, and an issues panel.

### Phase 4: Marketplace & Distribution

**Goal:** Users can discover and install plugins from a marketplace.

- [ ] Define `.honepkg` archive format
- [ ] `hone plugin pack` and `hone plugin publish` CLI commands
- [ ] Marketplace REST API (publish, search, download, update, report)
- [ ] Source snapshot storage (Git-based, per-version)
- [ ] Build pipeline (clean-container Perry compilation for all platforms)
- [ ] Ed25519 signing service (HSM-backed)
- [ ] CDN hosting for packages
- [ ] In-Hone plugin browser UI
- [ ] Capability diffing on updates with re-approval prompts
- [ ] Automated static analysis in publish pipeline
- [ ] License validation (OSI-approved only)
- [ ] Publisher OAuth (GitHub, GitLab, Codeberg)
- [ ] Publisher verification flow (domain/org proof for verified badge)

**Deliverable:** End-to-end: author publishes TypeScript source → marketplace compiles + signs + hosts → user installs from Hone.

### Phase 5: Marketplace Website

**Goal:** Public website for plugin discovery and SEO.

- [ ] Build marketplace website with Perry Publish
- [ ] Plugin pages with README, source browser, capability summary, stats
- [ ] Publisher profile pages
- [ ] Category and search pages
- [ ] Version history with capability diffs
- [ ] Sponsor link integration
- [ ] SEO optimization (meta tags, structured data, sitemap)
- [ ] "Install in Hone" deep links
- [ ] "Get Hone" CTAs for new visitors
- [ ] Community reporting UI

**Deliverable:** `marketplace.hone.dev` — every plugin page is a Hone landing page.

### Phase 6: Ecosystem Growth

**Goal:** Make it easy to build and port plugins, grow the ecosystem.

- [ ] VS Code extension migration guide (`docs/migration-from-vscode.md`)
- [ ] Compatibility shim layer for common VS Code extension API patterns
- [ ] Comprehensive plugin author documentation
- [ ] Featured plugins curation
- [ ] Community moderation tools
- [ ] Plugin starter packs (recommended sets for web dev, Rust dev, Python dev, etc.)

---

## 22. Open Questions

These need decisions before or during implementation:

1. **Plugin host: shared process vs. per-plugin process for Tier 2?**
   Shared is more resource-efficient. Per-plugin is better for isolation. Start shared, revisit if crash isolation becomes a real problem.

2. **IPC serialization format?**
   FlatBuffers (zero-copy, fast) vs. Cap'n Proto (also zero-copy, has RPC) vs. custom Perry-native format (dogfooding, more work). Leaning FlatBuffers for Phase 1.

3. **How does Perry handle plugin dependencies?**
   If a plugin depends on an npm package (e.g., `prettier`), Perry needs to compile that too. Phase 1 plugins should be self-contained; dependency support can come later.

4. **WASM as alternative compilation target?**
   Perry could compile plugins to WASM instead of native dylibs. Pros: platform-independent, stronger sandbox. Cons: slower. Could offer as an option later. Native-first for now.

5. **Plugin-to-plugin communication?**
   Should plugins call each other? Initial answer: no. Plugins communicate through editor state, not directly. Revisit if there's demand.

6. **Backwards compatibility guarantees for SDK?**
   Once plugins exist, SDK changes are painful. Semver aggressively. Consider a plugin API version field in the manifest so Hone can load older plugins with compatibility shims.

7. **Offline mode?**
   Plugins should work fully offline once installed. Marketplace is only needed for discovery and updates. No phone-home in the runtime.

8. **Source snapshot storage scaling?**
   Git-based storage works for the first 1,000 plugins. At 10K+ plugins with multiple versions each, may need to consider object storage (S3/R2) with Git-like content addressing. Design the abstraction layer now, swap backends later.

---

## Summary

The Hone Extension System's core insight: **Perry makes something possible that no other editor has** — TypeScript plugins compiled to native code with compile-time capability enforcement.

The ecosystem policy reinforces this: **free, open source, marketplace-compiled** creates a trust model that's structurally stronger than anything in VS Code or Cursor, while keeping the barrier to entry as low as VS Code's.

| Dimension | VS Code | Cursor | Zed | Hone |
|-----------|---------|--------|-----|------|
| Plugin language | JS/TS (interpreted) | Same as VS Code | Rust/WASM | TypeScript (compiled native) |
| Security model | Honor system | Same as VS Code | WASM sandbox | Compile-time capabilities + OS sandbox |
| Performance impact | Significant | Worse | Low | Minimal (native, batched IPC) |
| Ecosystem accessibility | High | Inherits VS Code | Low | High (everyone knows TS) |
| Extension trust | Download count + vibes | Inherits VS Code | WASM limits blast radius | Open source + marketplace-compiled + signed |
| Plugin cost | Free (mostly) | Free (mostly) | Free | Free (always, by policy) |
| Source visibility | Optional | Optional | Required | Required (mandatory open source) |

Start with Phase 0 now — the types, manifest schema, examples, and ecosystem policy document. These are the contracts that everything builds on.
