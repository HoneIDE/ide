# hone-ide — Project Plan

## 1. Overview

**What:** `hone-ide` (published as `hone`) is the full IDE application — the product users download and run. It is the composition layer that assembles all Hone components into a complete development environment. This is the "VSCode replacement" with native performance and built-in AI.

**Why:** This is the deliverable. All other packages exist to serve this. hone-ide provides the workbench shell (layout, tabs, panels, menus), all views (file explorer, search, git, debug, extensions, settings), all AI views (chat sidebar, agent activity, approval flow, PR review), the diff viewer, theme engine, and application lifecycle.

**Who uses it:**
- End users (developers) — the primary audience
- The product. This is what people install.

**Role in ecosystem:** Layer 3 — depends on everything: `@honeide/api`, `@honeide/editor`, `@honeide/terminal`, `@honeide/core`, `@honeide/themes`, `@honeide/extensions`.

---

## 2. Dependencies

### Internal
- `@honeide/api` — Extension types
- `@honeide/editor` — Code editor component (EditorViewModel, text rendering)
- `@honeide/terminal` — Terminal emulator component
- `@honeide/core` — All services (workspace, git, search, settings, LSP, DAP, AI, extensions)
- `@honeide/themes` — Built-in theme collection
- `@honeide/extensions` — Built-in extensions

### External
- `perry/ui` — Native UI widgets (VStack, HStack, Text, Button, TextField, ScrollView, Canvas, etc.)
- `perry/system` — System integration (clipboard, file dialogs, keyboard shortcuts, keychain, notifications)

### Perry Built-ins
- `State()` — Reactive UI bindings
- `App()` — Application entry point
- Window management APIs

---

## 3. Repository Structure

```
hone-ide/
├── workbench/
│   ├── layout/
│   │   ├── grid.ts                 # Resizable split panel engine
│   │   ├── tab-manager.ts          # Editor tabs (split, drag, reorder, pin)
│   │   ├── panel-registry.ts       # Registry for all panels (sidebar, bottom)
│   │   ├── activity-bar.ts         # Left icon strip (explorer, search, git, debug, extensions, AI)
│   │   └── status-bar.ts           # Bottom status bar (branch, language, encoding, line/col, AI model)
│   │
│   ├── views/
│   │   ├── explorer/
│   │   │   ├── file-tree.ts        # File explorer tree view
│   │   │   ├── file-tree-item.ts   # Tree node (file/folder with icon, context menu)
│   │   │   └── file-operations.ts  # New file, new folder, rename, delete, move
│   │   │
│   │   ├── search/
│   │   │   ├── search-view.ts      # Global search sidebar
│   │   │   ├── search-input.ts     # Search box with regex/case/word toggles
│   │   │   └── search-results.ts   # Grouped results with file/line preview
│   │   │
│   │   ├── git/
│   │   │   ├── source-control.ts   # Source control panel
│   │   │   ├── changes-list.ts     # Modified/staged/untracked file lists
│   │   │   ├── commit-box.ts       # Commit message input + buttons
│   │   │   ├── branch-selector.ts  # Branch picker/switcher
│   │   │   └── git-graph.ts        # Visual commit graph (optional)
│   │   │
│   │   ├── debug/
│   │   │   ├── debug-panel.ts      # Debug sidebar
│   │   │   ├── variables.ts        # Variable inspector tree
│   │   │   ├── call-stack.ts       # Call stack frames
│   │   │   ├── breakpoints.ts      # Breakpoint list
│   │   │   ├── watch.ts            # Watch expressions
│   │   │   └── debug-toolbar.ts    # Continue/step/pause/stop controls
│   │   │
│   │   ├── extensions/
│   │   │   ├── extensions-view.ts  # Extension browser sidebar
│   │   │   ├── extension-card.ts   # Extension listing card (name, desc, install btn)
│   │   │   └── extension-detail.ts # Extension detail page
│   │   │
│   │   ├── settings-ui/
│   │   │   ├── settings-view.ts    # Visual settings editor
│   │   │   ├── settings-tree.ts    # Settings category tree
│   │   │   ├── setting-row.ts      # Individual setting control (text, bool, enum, number)
│   │   │   └── keybindings-view.ts # Keybinding editor
│   │   │
│   │   ├── command-palette/
│   │   │   └── command-palette.ts  # Ctrl+Shift+P command palette overlay
│   │   │
│   │   ├── quick-open/
│   │   │   └── quick-open.ts       # Ctrl+P fuzzy file finder overlay
│   │   │
│   │   ├── notifications/
│   │   │   └── notifications.ts    # Toast notification manager
│   │   │
│   │   ├── welcome/
│   │   │   ├── welcome-tab.ts      # First-launch welcome screen
│   │   │   └── onboarding.ts       # API key setup, theme selection, keybinding preset
│   │   │
│   │   ├── ai-chat/
│   │   │   ├── chat-view.ts        # Chat sidebar with streaming responses
│   │   │   ├── chat-message.ts     # Individual message bubble (user/assistant)
│   │   │   ├── context-panel.ts    # Shows what the AI can see (files, errors, etc.)
│   │   │   ├── model-selector.ts   # Provider/model dropdown picker
│   │   │   └── code-blocks.ts      # Syntax-highlighted code in chat + "Apply" / "Copy" buttons
│   │   │
│   │   ├── ai-agent/
│   │   │   ├── agent-activity.ts   # Live log of agent actions (thoughts, tool calls, results)
│   │   │   ├── approval-view.ts    # Per-file diff with accept/reject controls
│   │   │   ├── plan-view.ts        # Agent's planned steps (user can edit/reorder)
│   │   │   └── progress.ts         # Progress indicator with step count
│   │   │
│   │   ├── diff-view/
│   │   │   ├── diff-editor.ts      # Side-by-side diff using two hone-editor instances
│   │   │   ├── unified-diff.ts     # Unified diff view (single editor with markers)
│   │   │   ├── inline-diff.ts      # Inline change markers within editor
│   │   │   └── hunk-controls.ts    # Accept/reject per hunk (for AI edits + PR review)
│   │   │
│   │   └── pr-review/
│   │       ├── pr-browser.ts       # List PRs from GitHub/GitLab
│   │       ├── pr-detail.ts        # PR description, commits, CI checks
│   │       ├── pr-diff.ts          # Full PR diff with AI annotations overlay
│   │       ├── review-sidebar.ts   # Annotation list, filters by severity/category
│   │       └── review-submit.ts    # Submit review back to platform (Approve/Request Changes)
│   │
│   └── theme/
│       ├── theme-loader.ts         # Load theme JSON, resolve colors
│       ├── token-theme.ts          # TextMate scope → color resolution for syntax
│       └── ui-theme.ts             # UI color provider (themed colors for all widgets)
│
├── app.ts                          # Application entry point (Perry App())
├── window.ts                       # Window management (multi-window support)
├── menu.ts                         # Application menu (File, Edit, View, Go, Run, Help)
├── commands.ts                     # Built-in command registrations
├── keybindings.ts                  # Default keybinding definitions
├── perry.config.ts                 # Perry build configuration
├── package.json
├── CHANGELOG.md
└── LICENSE                         # MIT (or commercial, TBD)
```

---

## 4. Core Interfaces & Types

### Layout System

```typescript
/** Resizable grid layout engine */
interface GridLayout {
  /** The root grid node */
  readonly root: GridNode;

  /** Add a view to the grid at a position */
  addView(viewId: string, location: GridLocation): void;

  /** Remove a view from the grid */
  removeView(viewId: string): void;

  /** Move a view to a new location */
  moveView(viewId: string, location: GridLocation): void;

  /** Resize a split at a given path */
  resizeSplit(splitPath: number[], sizes: number[]): void;

  /** Get current layout serializable state (for persistence) */
  serialize(): GridLayoutState;

  /** Restore layout from state */
  restore(state: GridLayoutState): void;
}

interface GridNode {
  type: 'split' | 'view';
  direction?: 'horizontal' | 'vertical';  // For splits
  children?: GridNode[];                   // For splits
  sizes?: number[];                        // Proportional sizes for splits
  viewId?: string;                         // For views
}

type GridLocation = {
  referenceViewId: string;
  position: 'before' | 'after' | 'above' | 'below';
};

interface GridLayoutState {
  root: GridNode;
  activeViewId: string;
}
```

### Tab Manager

```typescript
/** Tab manager for editor groups */
interface TabManager {
  /** All tab groups (split editors) */
  readonly groups: readonly TabGroup[];

  /** The active tab group */
  readonly activeGroup: TabGroup;

  /** Open a file in a tab */
  openTab(uri: string, options?: OpenTabOptions): void;

  /** Close a tab */
  closeTab(groupIndex: number, tabIndex: number): void;

  /** Close all tabs in a group */
  closeAllTabs(groupIndex: number): void;

  /** Move a tab between groups (drag and drop) */
  moveTab(fromGroup: number, fromTab: number, toGroup: number, toIndex: number): void;

  /** Split the active tab into a new group */
  splitTab(direction: 'right' | 'down'): void;

  /** Pin a tab (pinned tabs can't be auto-closed) */
  pinTab(groupIndex: number, tabIndex: number): void;

  /** Events */
  readonly onDidOpenTab: Event<TabOpenEvent>;
  readonly onDidCloseTab: Event<TabCloseEvent>;
  readonly onDidChangeActiveTab: Event<TabChangeEvent>;
}

interface TabGroup {
  readonly tabs: readonly Tab[];
  readonly activeTab: Tab | null;
  readonly index: number;
}

interface Tab {
  readonly uri: string;
  readonly title: string;
  readonly isDirty: boolean;
  readonly isPinned: boolean;
  readonly isPreview: boolean;  // Preview tabs are replaced when opening another file
  readonly icon?: string;
  readonly viewType: 'editor' | 'diff' | 'webview' | 'welcome' | 'settings' | 'pr-review';
}

interface OpenTabOptions {
  preview?: boolean;        // Open as preview tab (default: true for single-click)
  pinned?: boolean;
  groupIndex?: number;      // Which tab group to open in
  viewType?: Tab['viewType'];
  preserveFocus?: boolean;
}
```

### Activity Bar

```typescript
/** Activity bar configuration */
interface ActivityBarItem {
  id: string;
  icon: string;              // Icon identifier
  title: string;
  panel: string;             // ID of the sidebar panel to activate
  badge?: string | number;   // Badge overlay (e.g., git change count)
  order: number;
}

/** Default activity bar items */
const DEFAULT_ACTIVITY_BAR: ActivityBarItem[] = [
  { id: 'explorer',    icon: 'files',     title: 'Explorer',         panel: 'explorer',    order: 1 },
  { id: 'search',      icon: 'search',    title: 'Search',           panel: 'search',      order: 2 },
  { id: 'git',         icon: 'git-branch', title: 'Source Control',  panel: 'git',         order: 3 },
  { id: 'debug',       icon: 'debug',     title: 'Run & Debug',      panel: 'debug',       order: 4 },
  { id: 'extensions',  icon: 'extensions', title: 'Extensions',      panel: 'extensions',  order: 5 },
  { id: 'ai',          icon: 'sparkle',   title: 'AI',               panel: 'ai-chat',     order: 6 },
];
```

### Status Bar

```typescript
/** Status bar state */
interface StatusBarState {
  /** Left-aligned items */
  left: StatusBarEntry[];
  /** Right-aligned items */
  right: StatusBarEntry[];
}

interface StatusBarEntry {
  id: string;
  text: string;
  tooltip?: string;
  command?: string;
  color?: string;
  backgroundColor?: string;
  priority: number;
}

/** Default status bar items */
// Left: [branch] [sync status] [problems count]
// Right: [AI model] [line:col] [spaces/tabs] [encoding] [eol] [language] [notifications]
```

### Workbench Layout Specification

```
┌─────────────────────────────────────────────────────────────────────┐
│  Title Bar                                      [min] [max] [close] │
├──────┬──────────────────────────────────────────────────────────────┤
│      │  Tab Bar  [file1.ts ×] [file2.rs ×] [PR #42 ×] [+ ]        │
│  A   ├──────────────────────────────────────────────────────────────┤
│  C   │  Breadcrumb  src > components > Editor.tsx                   │
│  T   ├─────────────────────┬────────────────────────┬───────────────┤
│  I   │                     │                        │               │
│  V   │  Editor Group 1     │  Editor Group 2        │  Sidebar      │
│  I   │  (hone-editor)      │  (hone-editor /        │  (Chat /      │
│  T   │                     │   diff view /          │   Agent /     │
│  Y   │  ghost text         │   PR diff)             │   Explorer /  │
│      │  AI annotations     │                        │   Search /    │
│  B   ├─────────────────────┴────────────────────────┤   Git)        │
│  A   │  Bottom Panel [Terminal │ Problems │ Output │ Agent Log]     │
│  R   │  ┌───────────────────────────────────────────┐│              │
│      │  │  hone-terminal instance                    ││              │
│  S   │  │  $ npm test                                ││              │
│  I   │  │  PASS src/auth.test.ts                     ││              │
│  D   │  └───────────────────────────────────────────┘│              │
│  E   ├──────────────────────────────────────────────┴───────────────┤
│  B   │  Status Bar  [main ↑3] [0 errors 2 warnings] ... [Claude 4] │
│  A   │                                                              │
│  R   │                                                              │
└──────┴──────────────────────────────────────────────────────────────┘
```

### View Models (Workbench State)

```typescript
/** Main workbench state — drives the entire UI */
interface WorkbenchState {
  // Layout
  layout: GridLayoutState;
  tabManager: TabManager;
  activeSidebarPanel: string;       // 'explorer' | 'search' | 'git' | 'debug' | 'extensions' | 'ai-chat'
  activeBottomPanel: string | null; // 'terminal' | 'problems' | 'output' | 'agent-log' | null
  sidebarVisible: boolean;
  sidebarPosition: 'left' | 'right';
  bottomPanelVisible: boolean;

  // Editor state
  activeEditor: EditorInstanceState | null;

  // AI state
  chatSessions: ChatSessionState[];
  activeChatSession: string | null;
  agentSession: AgentSessionState | null;

  // PR Review state
  activePR: PRReviewState | null;

  // Global
  theme: ThemeState;
  notifications: NotificationState[];
  commandPaletteVisible: boolean;
  quickOpenVisible: boolean;
}

interface EditorInstanceState {
  uri: string;
  viewModel: EditorViewModel;  // From @honeide/editor
  editorRef: any;              // Reference to the native editor view
}

interface ChatSessionState {
  id: string;
  title: string;
  messages: ChatMessageDisplay[];
  isStreaming: boolean;
  provider: string;
  model: string;
}

interface ChatMessageDisplay {
  role: 'user' | 'assistant';
  content: string;
  codeBlocks: CodeBlockDisplay[];
  timestamp: Date;
}

interface CodeBlockDisplay {
  language: string;
  code: string;
  applied: boolean;  // Whether the user clicked "Apply"
}

interface AgentSessionState {
  session: AgentSession;  // From @honeide/core
  plan: AgentStep[];
  activityLog: ActivityLogEntry[];
  pendingApprovals: PendingApproval[];
}

interface PRReviewState {
  pr: PullRequestDetail;
  annotations: ReviewAnnotation[];
  currentFile: number;
  filterSeverity: ReviewSeverity | 'all';
  filterCategory: ReviewCategory | 'all';
  reviewDecision: 'approve' | 'request_changes' | 'comment' | null;
  userComments: ReviewComment[];
}
```

---

## 5. Implementation Guide

### Application Entry (`app.ts`)

**Purpose:** Perry application bootstrap.

```typescript
import { App, Window } from 'perry/ui';
import { State } from 'perry';
import { WorkbenchState } from './workbench-state';

const state = State<WorkbenchState>(initialWorkbenchState());

App({
  title: 'Hone',
  window: {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
  },
  onReady: async () => {
    // 1. Load settings
    // 2. Load theme
    // 3. Initialize core services (workspace, git, search, AI providers)
    // 4. Discover and activate extensions
    // 5. Open last workspace (if any)
    // 6. Render workbench
  },
  onClose: async () => {
    // 1. Save dirty files (prompt)
    // 2. Save layout state
    // 3. Deactivate extensions
    // 4. Shutdown services (LSP servers, terminals)
  },
  body: () => Workbench({ state }),
});
```

### Layout Engine (`workbench/layout/`)

**grid.ts** — Resizable split panel engine:
- Tree-based layout: root node can be a view or a split (horizontal/vertical)
- Splits contain children with proportional sizes (summing to 1.0)
- Drag handles between splits for resizing
- Double-click handle to reset to equal sizes
- Serializable to/from JSON for layout persistence
- Minimum panel size: 100px
- Maximum nesting depth: 4 (prevent degenerate layouts)

**tab-manager.ts** — Editor tabs:
- Each tab group is a horizontal strip of tabs
- Tabs can be: preview (italic title, replaced on next open), regular, pinned (left-aligned, icon only)
- Drag tabs to reorder within group
- Drag tabs between groups (creates new group if dragged to edge)
- Close button on hover (or middle-click)
- Dirty indicator (dot on tab)
- Tab overflow: scroll buttons when too many tabs
- "Close All", "Close Others", "Close Saved" context menu
- Double-click tab bar empty space → new untitled file
- Split: Ctrl+\ to split current tab right

**panel-registry.ts** — Panel management:
- Registry of all available panels (sidebar + bottom)
- Sidebar panels: explorer, search, git, debug, extensions, ai-chat, ai-agent, pr-review
- Bottom panels: terminal, problems, output, agent-log, debug-console
- Each panel registered with: id, title, icon, component factory, activation condition
- Panels can be contributed by extensions

**activity-bar.ts** — Icon sidebar:
- Vertical strip of icons on the far left (or right, configurable)
- Click to toggle sidebar panel
- Badge overlays for notifications (git: change count, problems: error count, AI: status)
- Drag to reorder
- Right-click context menu: hide/show items

**status-bar.ts** — Bottom status bar:
- Left section: branch name (click to switch), sync status (up/down arrows), error/warning count
- Right section: AI model indicator (click to switch), cursor position (Ln:Col), indentation (Spaces:4), encoding (UTF-8), line ending (LF), language (TypeScript), notification bell
- Extensible: extensions add items via `hone.ui.createStatusBarItem()`
- Colors: can be themed (e.g., red background during debugging)

### Views — File Explorer (`workbench/views/explorer/`)

**file-tree.ts** — Tree view:
- Renders workspace folder tree using Perry's ScrollView + custom tree nodes
- Lazy loading: only expand folder contents on open
- File icons: language-specific icons (TS, JS, JSON, MD, etc.)
- Folder icons: open/closed state
- Single-click: preview file (preview tab)
- Double-click: open file (permanent tab)
- Keyboard navigation: arrow keys, Enter to open, F2 to rename
- Drag and drop: move files/folders within explorer
- Context menu: New File, New Folder, Rename, Delete, Copy Path, Reveal in Finder/Explorer
- Filtering: type to filter visible items
- Watched: auto-updates when files change on disk

### Views — Search (`workbench/views/search/`)

**search-view.ts** — Global search:
- Text input with regex/case/word toggle buttons
- Replace input (collapsible)
- File include/exclude glob patterns
- Results grouped by file, with match preview (highlighted)
- Click result to open file at line
- Replace: per-match, per-file, or all
- Result count and file count in header
- Search history (recent searches)
- Streams results as they arrive from ripgrep

### Views — Git (`workbench/views/git/`)

**source-control.ts** — Source control panel:
- Shows: staged changes, unstaged changes, untracked files
- Each section is collapsible
- File entries show: status icon (M/A/D/R/U), filename, click to open diff

**changes-list.ts** — File change list:
- Inline actions: stage (+), unstage (-), discard (↩), open diff
- Multi-select for batch operations
- Conflict markers for merge conflicts

**commit-box.ts** — Commit interface:
- Text area for commit message
- Character count (50-char first line recommendation)
- Commit button (enabled when message + staged files exist)
- Amend checkbox
- AI commit message generation button (sends diff to AI, gets suggested message)

**branch-selector.ts** — Branch management:
- Dropdown showing current branch
- List of local and remote branches
- Create new branch
- Delete branch
- Compare branches

### Views — Debug (`workbench/views/debug/`)

**debug-panel.ts** — Debug sidebar:
- Configuration selector (dropdown of launch.json configurations)
- Start/restart buttons
- Sub-panels: Variables, Watch, Call Stack, Breakpoints

**variables.ts** — Variable tree:
- Expandable tree of scopes and variables
- Type info and values
- Editable values (double-click to modify)

**call-stack.ts** — Stack frames:
- Thread list (for multi-threaded debugging)
- Frame list per thread
- Click to navigate to frame's source location
- Grayed-out frames for external code

**breakpoints.ts** — Breakpoint list:
- All breakpoints across files
- Toggle enable/disable
- Conditional breakpoints (edit condition)
- Log points (log message instead of breaking)
- Hit count breakpoints

### Views — AI Chat (`workbench/views/ai-chat/`)

**chat-view.ts** — Chat sidebar:
- Message list (scrollable, newest at bottom)
- Input box at bottom (multiline, Shift+Enter for newline, Enter to send)
- Streaming response: characters appear in real-time
- Context indicators: "Using: file.ts, 3 errors, git diff"
- "New Chat" button, chat session tabs
- Model selector in header

**chat-message.ts** — Message rendering:
- User messages: right-aligned, plain text
- Assistant messages: left-aligned, rendered markdown
- Code blocks: syntax-highlighted with language tag
- "Apply" button on code blocks: creates a diff in the editor for the referenced file
- "Copy" button on code blocks
- Loading indicator during streaming (pulsing cursor)

**context-panel.ts** — Context visibility:
- Shows what the AI can "see" in the current context:
  - Active file (name + line count)
  - Selected text (if any)
  - Open files list
  - Current errors/warnings
  - Recent terminal output
  - Git diff summary
- Toggle items on/off to control what context is sent
- Token count estimate

**model-selector.ts** — Provider/model picker:
- Dropdown showing current provider + model
- Grouped by provider (Anthropic, OpenAI, Google, Ollama, etc.)
- Shows model capabilities (context window, tool use, vision)
- Quick switch: click to change for current chat
- "Configure" link to AI settings

**code-blocks.ts** — Code in chat:
- Syntax highlighted using hone-editor's tokenizer + theme
- Language label in header
- Copy button (copies code to clipboard)
- "Apply" button: detects which file the code belongs to, creates a diff view showing proposed changes, user accepts/rejects per hunk

### Views — AI Agent (`workbench/views/ai-agent/`)

**agent-activity.ts** — Live activity log:
- Chronological list of agent actions
- Entry types with icons: thought (brain), tool call (wrench), tool result (check/x), approval (shield), user input (chat), error (x), completion (flag)
- Expandable entries: click to see full details (file contents, command output, etc.)
- Auto-scroll to latest entry
- Elapsed time per entry

**approval-view.ts** — Change approval:
- When agent proposes file edits: shows diff view (side-by-side)
- Per-hunk accept/reject buttons
- "Accept All" / "Reject All" buttons
- For terminal commands: shows command with "Allow" / "Deny" buttons
- For file creation/deletion: shows file path with "Allow" / "Deny"
- Approved actions execute immediately
- Rejected actions: agent receives rejection and adjusts approach

**plan-view.ts** — Agent plan:
- Numbered list of planned steps
- Status indicators: pending (circle), in-progress (spinner), completed (check), failed (x)
- User can: edit step descriptions, reorder steps (drag), remove steps, add steps
- Plan is advisory — agent may deviate based on results

**progress.ts** — Progress indicator:
- Shows: "Step 3 of 8" with progress bar
- Current action description
- Cancel button
- Estimated remaining (rough)

### Views — Diff (`workbench/views/diff-view/`)

**diff-editor.ts** — Side-by-side diff:
- Two hone-editor instances side by side
- Synchronized scrolling
- Deleted lines: red background on left, empty on right
- Added lines: empty on left, green background on right
- Modified lines: yellow background, inline character diff
- Gutter: hunk indicators (colored bars)
- Full editor features work in diff (hover, go-to-def, search)

**unified-diff.ts** — Unified diff view:
- Single editor with unified diff format
- Line prefixes: -, +, space
- Colored backgrounds per line type
- Fold unchanged sections (show "...N unchanged lines...")

**inline-diff.ts** — Inline change markers:
- For small changes: show old text with strikethrough + new text highlighted inline
- Used for AI quick fixes and single-line changes

**hunk-controls.ts** — Per-hunk actions:
- Floating controls at each hunk boundary
- Buttons: Accept (check), Reject (x), Edit (pencil)
- Used in: AI edit approval, PR review, merge conflicts
- Accept: applies the hunk's changes
- Reject: keeps the original
- Edit: opens the hunk in an inline editor for manual modification

### Views — PR Review (`workbench/views/pr-review/`)

**pr-browser.ts** — PR list:
- Fetches PRs from GitHub/GitLab (via hone-core git platform clients)
- List with: PR number, title, author, labels, CI status, review status
- Filter by: state (open/closed/merged), author, label
- Sort by: updated, created, popularity
- Click to open PR detail

**pr-detail.ts** — PR overview:
- Title, description (rendered markdown)
- Author, reviewers, labels
- Commit list
- CI check status (green/red/yellow indicators)
- Changed files list with +/- counts
- "Start Review" button → runs AI review

**pr-diff.ts** — PR diff with AI annotations:
- Full diff view (side-by-side or unified)
- AI annotations overlaid inline:
  - Error (red): bug, security issue
  - Warning (yellow): performance, style
  - Info (blue): suggestion, documentation
- Click annotation to expand: message, suggested fix, confidence
- "Fix" button: AI generates fix → shown as nested diff → accept/reject
- "Dismiss" button: hide annotation
- "Explain" button: AI explains the issue in more detail (opens chat)
- Full LSP intelligence works in diff (hover, go-to-def, errors)

**review-sidebar.ts** — Annotation browser:
- List of all AI annotations for the PR
- Filter by: severity (error/warning/info), category (bug/security/perf/style/test)
- Sort by: severity, file, line number
- Click to navigate to annotation in diff view
- Counts: "3 errors, 5 warnings, 2 info"

**review-submit.ts** — Submit review:
- Decision: Approve / Request Changes / Comment
- Review body text area
- Summary of AI annotations (included as reference)
- User's manual comments (added during review)
- Submit button → posts to GitHub/GitLab via hone-core

### Theme Engine (`workbench/theme/`)

**theme-loader.ts** — Theme loading:
- Loads theme JSON from `@honeide/themes` or installed themes
- Parses `colors` section into UI color map
- Parses `tokenColors` section into token color rules
- Handles theme inheritance (dark defaults, light defaults)
- Hot-reload: switch themes without restart
- Resolves missing colors with intelligent defaults based on theme type

**token-theme.ts** — Syntax color resolution:
- Takes a TextMate scope (e.g., `entity.name.function.typescript`) and resolves to a color
- Scope matching: most specific match wins (longest prefix)
- Walks the scope chain: `entity.name.function.typescript` > `entity.name.function` > `entity.name` > `entity`
- Caches resolved colors for performance
- Integrates with hone-editor's tokenizer output

**ui-theme.ts** — UI color provider:
- Maps theme color keys to actual CSS-like values
- Provides typed access: `theme.get('editor.background')`, `theme.get('statusBar.foreground')`
- All Perry UI widgets read colors from this provider
- Supports opacity values (RGBA)
- Provides computed colors (hover = base + 10% brightness, etc.)

### Window Management (`window.ts`)

- Multi-window support (optional, start with single window)
- Window state persistence (position, size, maximized state)
- Title bar: shows current file name + workspace name
- macOS: traffic light buttons, title bar integration
- Windows/Linux: custom title bar with menu
- Full-screen mode support

### Menu System (`menu.ts`)

Default application menu structure:
```
File:     New File, New Window, Open File, Open Folder, Open Recent >, Save, Save As, Save All, Close, Exit
Edit:     Undo, Redo, Cut, Copy, Paste, Find, Replace, Find in Files
Selection: Select All, Expand Selection, Shrink Selection, Add Cursor Above/Below, Select All Occurrences
View:     Command Palette, Quick Open, Explorer, Search, Git, Debug, Extensions, AI Chat, Terminal, Problems, Toggle Sidebar, Toggle Bottom Panel, Zoom In/Out
Go:       Go to File, Go to Symbol, Go to Definition, Go to References, Go to Line, Go Back, Go Forward
Run:      Start Debugging, Run Without Debugging, Stop, Restart, Toggle Breakpoint
AI:       New Chat, Agent Mode, Review PR, Generate Commit Message, Explain Selection, Refactor Selection
Terminal: New Terminal, Split Terminal, Clear Terminal
Help:     Welcome, Documentation, Release Notes, Report Issue, About
```

### Default Keybindings (`keybindings.ts`)

```typescript
const DEFAULT_KEYBINDINGS: Keybinding[] = [
  // File
  { key: 'cmd+n',           command: 'file.newFile' },
  { key: 'cmd+o',           command: 'file.openFile' },
  { key: 'cmd+s',           command: 'file.save' },
  { key: 'cmd+shift+s',     command: 'file.saveAs' },
  { key: 'cmd+w',           command: 'tab.close' },

  // Edit
  { key: 'cmd+z',           command: 'editor.undo' },
  { key: 'cmd+shift+z',     command: 'editor.redo' },
  { key: 'cmd+x',           command: 'editor.cut' },
  { key: 'cmd+c',           command: 'editor.copy' },
  { key: 'cmd+v',           command: 'editor.paste' },
  { key: 'cmd+f',           command: 'editor.find' },
  { key: 'cmd+h',           command: 'editor.replace' },
  { key: 'cmd+shift+f',     command: 'search.findInFiles' },
  { key: 'cmd+shift+h',     command: 'search.replaceInFiles' },

  // Navigation
  { key: 'cmd+p',           command: 'quickOpen.show' },
  { key: 'cmd+shift+p',     command: 'commandPalette.show' },
  { key: 'cmd+g',           command: 'editor.goToLine' },
  { key: 'cmd+shift+o',     command: 'editor.goToSymbol' },
  { key: 'f12',             command: 'editor.goToDefinition' },
  { key: 'shift+f12',       command: 'editor.goToReferences' },
  { key: 'cmd+shift+\\',    command: 'editor.goToBracket' },
  { key: 'ctrl+-',          command: 'navigation.back' },
  { key: 'ctrl+shift+-',    command: 'navigation.forward' },

  // Selection
  { key: 'cmd+d',           command: 'editor.addNextOccurrence' },
  { key: 'cmd+shift+l',     command: 'editor.selectAllOccurrences' },
  { key: 'alt+up',          command: 'editor.addCursorAbove' },
  { key: 'alt+down',        command: 'editor.addCursorBelow' },
  { key: 'cmd+l',           command: 'editor.selectLine' },

  // Editor
  { key: 'alt+up',          command: 'editor.moveLineUp',     when: '!hasMultipleCursors' },
  { key: 'alt+down',        command: 'editor.moveLineDown',   when: '!hasMultipleCursors' },
  { key: 'cmd+/',           command: 'editor.toggleComment' },
  { key: 'cmd+shift+k',     command: 'editor.deleteLine' },
  { key: 'cmd+enter',       command: 'editor.insertLineBelow' },
  { key: 'cmd+shift+enter', command: 'editor.insertLineAbove' },
  { key: 'tab',             command: 'editor.indent',         when: 'editorTextFocus && !suggestWidgetVisible && !inlineCompletionVisible' },
  { key: 'shift+tab',       command: 'editor.outdent' },
  { key: 'cmd+]',           command: 'editor.indent' },
  { key: 'cmd+[',           command: 'editor.outdent' },

  // Folding
  { key: 'cmd+shift+[',     command: 'editor.fold' },
  { key: 'cmd+shift+]',     command: 'editor.unfold' },
  { key: 'cmd+k cmd+0',     command: 'editor.foldAll' },
  { key: 'cmd+k cmd+j',     command: 'editor.unfoldAll' },

  // View
  { key: 'cmd+b',           command: 'view.toggleSidebar' },
  { key: 'cmd+j',           command: 'view.toggleBottomPanel' },
  { key: 'cmd+\\',          command: 'view.splitEditor' },
  { key: 'cmd+1',           command: 'view.focusEditorGroup1' },
  { key: 'cmd+2',           command: 'view.focusEditorGroup2' },
  { key: 'cmd+shift+e',     command: 'view.focusExplorer' },
  { key: 'cmd+shift+g',     command: 'view.focusGit' },
  { key: 'cmd+shift+d',     command: 'view.focusDebug' },
  { key: 'cmd+shift+x',     command: 'view.focusExtensions' },

  // Terminal
  { key: 'ctrl+`',          command: 'terminal.toggle' },
  { key: 'cmd+shift+`',     command: 'terminal.new' },

  // Debug
  { key: 'f5',              command: 'debug.start' },
  { key: 'shift+f5',        command: 'debug.stop' },
  { key: 'f9',              command: 'debug.toggleBreakpoint' },
  { key: 'f10',             command: 'debug.stepOver' },
  { key: 'f11',             command: 'debug.stepInto' },
  { key: 'shift+f11',       command: 'debug.stepOut' },

  // AI
  { key: 'cmd+shift+i',     command: 'ai.toggleChat' },
  { key: 'cmd+i',           command: 'ai.inlineEdit',      when: 'editorTextFocus' },
  { key: 'ctrl+space',      command: 'ai.triggerCompletion', when: 'editorTextFocus' },
  { key: 'tab',             command: 'ai.acceptCompletion',  when: 'inlineCompletionVisible' },
  { key: 'escape',          command: 'ai.dismissCompletion', when: 'inlineCompletionVisible' },
  { key: 'cmd+shift+a',     command: 'ai.agentMode' },
  { key: 'cmd+shift+r',     command: 'ai.reviewPR' },

  // Rename
  { key: 'f2',              command: 'editor.rename' },
];
// Note: `cmd` maps to `ctrl` on Windows/Linux automatically
```

### Command Palette (`workbench/views/command-palette/`)

**command-palette.ts** — Ctrl+Shift+P overlay:
- Modal overlay at top-center of window
- Text input with ">" prefix (like VSCode)
- Fuzzy search across all registered commands
- Shows: command title, keybinding (if any), source (built-in / extension name)
- Enter to execute
- Recently used commands appear first
- Supports prefix modes: ">" for commands, no prefix for file search (redirects to quick-open), ":" for go to line, "@" for go to symbol

### Quick Open (`workbench/views/quick-open/`)

**quick-open.ts** — Ctrl+P overlay:
- Modal overlay, same position as command palette
- Fuzzy file search across workspace
- Results from FileIndex (hone-core)
- Shows: file name, path, icon
- Enter to open, Ctrl+Enter to open in split
- Recently opened files appear first
- Can switch mode: type ">" for commands, ":" for go to line, "@" for symbols

### Notifications (`workbench/views/notifications/`)

**notifications.ts** — Toast system:
- Notifications appear in bottom-right corner
- Types: info, warning, error, progress
- Auto-dismiss after 5s (configurable, progress never auto-dismisses)
- Action buttons (e.g., "Retry", "Open Settings")
- Notification bell in status bar shows history
- Source attribution (which extension/service created it)

### Welcome & Onboarding (`workbench/views/welcome/`)

**welcome-tab.ts** — First-launch experience:
- Opens as a tab on first launch
- Sections: Getting Started, Recent, Learn
- Getting Started checklist:
  - Choose color theme
  - Configure keybinding preset (Hone / VSCode / Vim / Emacs)
  - Set up AI provider (BYOK configuration)
  - Open a project
- Recent: recent files and workspaces
- Learn: links to documentation, keyboard shortcut reference

**onboarding.ts** — AI setup wizard:
- Step 1: Choose AI provider(s) — checkboxes for installed providers
- Step 2: Enter API keys (with "Test Connection" button)
- Step 3: Configure feature routing (which provider for which feature)
- Step 4: Privacy settings (what data is sent, exclude patterns)
- Saves to settings when complete

### Mobile Layout Adaptation

When running on iOS/Android via Perry:

**Phone (compact):**
- Full-screen editor, no sidebar
- Bottom toolbar: file browser, terminal, AI chat, run
- Swipe gestures: left for file browser, right for AI chat
- Long-press for context menu (replaces right-click)
- Software keyboard with shortcut bar (Tab, Esc, Ctrl, arrows)

**Tablet (split):**
- Two-column layout: sidebar + editor (or editor + sidebar)
- Bottom panel collapses to a tab bar
- Touch-friendly controls: larger targets, swipe to navigate
- Hardware keyboard fully supported
- PR review: swipe between files, tap annotations

---

## 6. Perry Integration

### Build Command
```bash
# Desktop
perry compile app.ts --target macos
perry compile app.ts --target windows
perry compile app.ts --target linux

# Mobile
perry compile app.ts --target ios
perry compile app.ts --target android

# Web
perry compile app.ts --target web
```

### Perry UI Widgets Used
- `VStack`, `HStack` — Layout containers
- `Text` — Labels, breadcrumbs, status bar text
- `Button` — Toolbar buttons, action buttons
- `TextField` — Search inputs, commit message, chat input
- `ScrollView` — File tree, search results, chat messages, activity log
- `Canvas` — Minimap rendering (if not handled by editor FFI)
- Custom native views via FFI — Editor and terminal rendering (from @honeide/editor and @honeide/terminal)

### State() Reactive Bindings
- `WorkbenchState` is the root reactive state object
- All view components read from state and auto-update when state changes
- Example: `state.activeSidebarPanel` changes → sidebar view re-renders
- Example: `state.chatSessions[i].messages` changes → chat message list re-renders

### Platform-Specific Behavior
- **macOS:** Native title bar with traffic lights, native menu bar, Spotlight-style command palette
- **Windows:** Custom title bar (or native via manifest), Win32 menu, Fluent-style controls
- **Linux:** GTK4 header bar, native file dialogs
- **iOS:** UIKit navigation, bottom tab bar, share sheet integration
- **Android:** Material Design, navigation drawer, Android-native file picker
- **Web:** Standard HTML, responsive layout, PWA manifest

### Extension Bundling
```bash
perry compile app.ts --target macos \
  --bundle-extensions ../hone-extensions/extensions/ \
  --bundle-themes ../hone-themes/themes/ \
  --bundle-ffi ../hone-editor/native/macos/ \
  --bundle-ffi ../hone-terminal/native/macos/
```

---

## 7. Test Strategy

### Unit Tests

**Layout:**
- Grid splitting, resizing, serialization/deserialization
- Tab manager: open, close, move, pin, preview mode
- Activity bar ordering and badge updates

**Views:**
- File explorer: tree construction from file system, icon resolution
- Search: query parsing, result grouping
- Git: status display, stage/unstage actions
- Command palette: fuzzy command matching, prefix modes
- Quick open: fuzzy file matching, recent files priority

**AI Views:**
- Chat message rendering (markdown parsing, code block extraction)
- Agent activity log rendering
- Approval view state management
- PR annotation filtering and sorting

**Theme:**
- Theme loading and color resolution
- Token scope matching (most-specific-wins)
- Missing color fallback logic

### Integration Tests

- Full workbench launch: open workspace, verify all panels render
- Tab workflow: open file, edit, save, close
- AI chat: send message, receive response, apply code block
- Agent: start agent, approve action, verify execution
- PR review: load PR, view annotations, submit review
- Theme switch: change theme, verify all colors update

### End-to-End Tests

- Fresh install: welcome screen, onboarding wizard, theme selection
- Edit workflow: open file, type, save, undo, redo
- Search workflow: Ctrl+Shift+F, type query, click result, open file
- Git workflow: modify file, stage, commit with AI message
- Debug workflow: set breakpoint, start debug, inspect variable

### Performance Tests

- Startup time: < 1s to interactive (measure first paint)
- Theme switch: < 100ms
- Command palette open: < 50ms
- Quick open search: < 50ms for results
- Tab switch: < 16ms
- Sidebar toggle: < 16ms

---

## 8. Phased Milestones

### Phase 1: Workbench Shell (Weeks 1-4)
- Layout grid engine with resizable splits
- Tab manager with basic operations
- Activity bar (icons, click to switch)
- Status bar (static items)
- Empty panels (placeholders for views)
- Application entry (Perry App() bootstrap)
- Window management (single window)

### Phase 2: Core Views (Weeks 5-8)
- File explorer (tree view, file operations)
- Command palette (Ctrl+Shift+P)
- Quick open (Ctrl+P fuzzy file finder)
- Theme engine (load theme, apply colors)
- Welcome tab
- Notifications

### Phase 3: Editor Integration (Weeks 9-12)
- Editor tab opening (hone-editor instances in tabs)
- Breadcrumb bar
- Diff view (side-by-side, unified)
- Find/replace UI
- Go to definition, references, symbols
- Status bar: cursor position, language, encoding

### Phase 4: Terminal & Git (Weeks 13-16)
- Terminal panel (hone-terminal instances)
- Multiple terminals, tabs, split
- Source control panel
- Changes list, commit box
- Branch selector
- Git blame gutter

### Phase 5: AI Views (Weeks 17-22)
- AI chat sidebar (streaming, code blocks, Apply button)
- Context panel
- Model selector
- Agent activity view
- Approval view (diff-based accept/reject)
- Plan view
- Status bar: AI model indicator

### Phase 6: Debug & Extensions (Weeks 23-26)
- Debug panel (variables, call stack, breakpoints, watch)
- Debug toolbar
- Settings UI (visual editor, keybindings editor)
- Extension browser
- Search view (global search with replace)

### Phase 7: PR Review (Weeks 27-30)
- PR browser (list from GitHub/GitLab)
- PR detail view
- PR diff with AI annotation overlay
- Review sidebar (annotation list, filters)
- Review submit (approve/request changes)
- Hunk controls (accept/reject)

### Phase 8: Mobile & Polish (Weeks 31-36)
- iOS workbench adaptation
- Android workbench adaptation
- Web workbench adaptation
- Menu system
- Onboarding wizard (AI setup)
- Keyboard shortcut reference
- Performance optimization (startup, rendering)
- Layout persistence (save/restore window state)

### Phase 9: Publish (Weeks 37-40)
- Multi-window support
- Auto-updater integration
- Installer packaging (macOS DMG, Windows MSI, Linux AppImage/deb/rpm)
- App Store submissions (macOS, iOS)
- v0.1.0 beta release

---

## 9. Open Questions / Risks

1. **Perry UI widget limitations**: The layout engine needs flexible resizable panels. Perry's built-in widgets may not support drag-to-resize natively. May need custom gesture handling or FFI for platform-native split views.

2. **Tab drag and drop**: Dragging tabs between groups requires complex hit-testing and visual feedback. Perry may not have built-in drag-and-drop support — may need custom implementation.

3. **Command palette overlay**: Modal overlays (command palette, quick open) need to render above all content. Perry widget z-ordering and focus management must support this.

4. **Webview for extensions**: Extensions contributing webview panels need HTML rendering within the native app. Perry may need a WebView widget (WKWebView on macOS/iOS, WebView2 on Windows, WebKitGTK on Linux).

5. **Multi-window**: Supporting multiple windows (e.g., detached terminals or editors) requires Perry to support spawning additional native windows. This may not be available initially.

6. **Mobile UX**: The desktop workbench doesn't directly translate to mobile. Significant layout adaptation needed. Risk: mobile UI feels like a shrunken desktop rather than a native mobile experience.

7. **Performance with many tabs**: Opening 50+ editor tabs means 50+ hone-editor instances. Need virtual tab groups (only active tab's editor is fully rendered, others are suspended).

8. **Accessibility**: Screen reader support, keyboard-only navigation, high-contrast themes. Perry must expose accessibility APIs on each platform (NSAccessibility, UIA, ATK).

9. **Localization**: i18n infrastructure for all UI strings. Perry must support loading locale-specific string bundles. Deferred to post-v1.0 but architecture should not preclude it.

10. **Licensing model**: MIT for open-source or commercial license with free tier? Affects distribution (App Store rules), telemetry, and feature gating. Decision needed before public release.
