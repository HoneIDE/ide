# Hone v1 — Phased Execution Plan (Path B)

> Companion to [`SHIP-V1-GAPS.md`](./SHIP-V1-GAPS.md). Each phase references gap numbers (`#N`) from that file.
>
> **Target:** VS Code feature parity v1, macOS + iOS, 16–18 weeks calendar time for 1 primary engineer.
> Parallelism notes are included where a 2nd contributor can shorten the phase.

## Decisions log

| Decided | Choice | Implication |
|---|---|---|
| 2026-05-12 | **Tokenizer = tree-sitter** | Phase 1 ships grammars via tree-sitter; `TokenTheme.resolve()` consumes scopes; VS Code grammars reusable. |
| 2026-05-12 | **iOS subprocess features hidden for v1** | LSP, terminal, DAP, plugin-host show no UI affordances on iOS / iPad builds. No host-tunneling work in Phase 7. |
| 2026-05-12 | **Plugin signing ready by Phase 5** | Marketplace ships with real install pipeline (download → sha256 verify → signature verify → extract → register); no read-only fallback. |

---

## Phasing principles

1. **Security and signing before features.** Until the build is trustworthy and the security gaps are closed, every feature ships dirty.
2. **Foundations before what builds on them.** Tokenizer → scopes → theme keys → minimap & guides. LSP wiring → outline & code lens. Command palette → discoverability of new commands.
3. **Each phase ends with a releasable private beta.** No phase is purely internal refactor; every exit is something a tester can use.
4. **Group by area to avoid context thrash.** Don't bounce between editor and sync work; complete one surface before moving on.
5. **No phase introduces rework for a later phase.** If a decision affects multiple phases (tokenizer choice, theme key set, plugin API surface), it's made in Phase 0.
6. **Demo at every phase boundary.** Catches regressions, keeps motivation honest.

---

## Phase 0 — Foundation & safety (Weeks 0–2)

**Goal:** make the codebase trustworthy. Nothing else matters if a security finding lands in a public release.

> **Scope decision (2026-05-12):** signing + CI (#5, #7) moved out of Phase 0 and into Phase 8 (Release prep). Phase 0 is now strictly security-and-policy correctness; the actual release pipeline waits until features are in place.

**Work**

- Gaps #1 (git shell injection), #2 (E2E encryption wired), #3 (relay sender spoofing), #4 (predictable pair room ID).
- Gap #6 (single version source — `version.ts` → injected into all `Info.plist` at build).
- Gap #8 (LICENSE at root).
- Gap #9 (privacy policy + first-run telemetry opt-in; default off until disclosure shown).
- Gap #16 (tree-sitter PoC — de-risk Phase 1's critical path).

**Exit criteria**

- All P0 security items closed in code; relay-side packet capture confirms `"encrypted":true` envelopes ship ciphertext.
- Privacy page deployed at `hone.codes/privacy`.
- No `&&` / shell strings in git invocations — all argv arrays.
- Tree-sitter PoC compiles and tokenizes TS + Python through Perry FFI; perf measured.

**Parallelism:** security fixes and tree-sitter PoC are independent tracks.

---

## Phase 1 — Visual truth (Weeks 2–6)

**Goal:** every theme renders correctly across every supported language. No more hardcoded VS Code Dark in Rust; no more single-color highlighting.

**Work**

- Gap #16 — tree-sitter integration in `hone-editor/core/tokenizer/`. Ship grammars: TS, JS, TSX, JSX, Python, Rust, Go, HTML, CSS, Markdown, JSON, YAML, TOML, SQL, C, C++, Java, Swift, Shell, Ruby, PHP, XML (drop or fix the C/C++ = Rust-keywords bug).
- Gap #18 — tokens emit scope strings (`keyword.control`, `entity.name.function`, …); render path consults `TokenTheme.resolve()`.
- Gap #17 — Rust live tokenizer rewritten as per-language tables with theme palette passed via FFI on theme change.
- Gap #19 — `onThemeChange` invalidates tokens and forces redraw.
- Gap #20 — expand the 15 theme JSONs to cover the VS Code v1.85 default key set (~400 keys). Bump `REQUIRED_UI_COLORS` in `hone-themes/tests/coverage.test.ts`.
- Gap #21 — minimap renderer in `hone-editor/native/macos/src/` (Rust). Reuse the existing `view-model/minimap.ts` data.
- Gap #22 — bracket pair colorization (3-tier cycle).
- Gap #23 — indent guides (active + inactive).
- Gap #24 — sticky scroll (enclosing scope headers pinned above viewport).

**Exit criteria**

- Open the same `.tsx`, `.py`, `.rs`, `.go`, `.md` files in Hone and VS Code side-by-side. Token boundaries match, scopes match within an agreed set.
- Switch themes 5 times in a row → no stale colors anywhere; live edits are recolored.
- Minimap visible and reflects diff decorations.
- Hone Dark, Dracula, GitHub Dark, One Dark, Tokyo Night all look right on the full UI chrome (autocomplete popup, breadcrumbs, peek, settings, etc.).

**Parallelism:** tokenizer work and theme key expansion are independent. Bracket guides + minimap can start in week 5 in parallel.

---

## Phase 2 — Discoverability & intelligence (Weeks 6–9)

**Goal:** users can find commands; the LSP capabilities the IDE already advertises are actually wired.

**Work**

- Gap #15 — command palette overlay UI. Wire to the existing command registry.
- Gap #27 (references), #28 (rename + preview), #29 (code actions + lightbulb), #30 (document symbols + outline view), #31 (workspace symbols), #32 (semantic tokens overlay), #33 (inlay hints), #34 (hover markdown), #35 (format on save/on type/on paste).
- Gap #36 — replace `goToFileAction` with the existing `views/quick-open/quick-open.ts`; add `@` / `#` / `:` prefix routing.
- Gap #84 — Outline view panel (falls out of `documentSymbol`).

**Exit criteria**

- Cmd+Shift+P opens a palette listing every registered command; typing fuzzy-filters.
- Open a TS file with errors → lightbulb shows fixes from `typescript-language-server`.
- F2 inline rename with preview works.
- Cmd+P with `@User` jumps to the symbol; `:42` jumps to line 42.
- Outline panel shows the file's symbols and updates on edit.

**Parallelism:** LSP wiring is one engineer (lots of small RPC handlers); palette + quick-open is the other.

---

## Phase 3 — Workbench polish (Weeks 9–11)

**Goal:** tabs, panels, and shell behave the way users expect from VS Code.

**Work**

- Gaps #25 (wire `TabManager` + `GridNode` in `render.ts`; add `workbench.action.splitEditor*` commands).
- Gap #26 — tabs draggable, pinned column, preview tab (italic + replaced on real-edit), overflow chevron.
- Gap #37 (sidebar resize handle + persisted width).
- Gaps #38, #39 — implement `activityBarLocation` and `sidebarLocation` settings end-to-end.
- Gap #40 — notification queue + persistent drawer; fix the single-toast bug at `notifications.ts:34`.
- Gap #41 — `~/.hone/keybindings.json` loader + visual keybindings editor.
- Gap #42 — `.hone/settings.json` per workspace; layered over user file.
- Gap #43 — snapshot cursor positions, scroll, panel state, terminal state on each settings tick; restore on launch.
- Gap #88 — right-click context menus on editor area, status bar, panels.
- Gap #89 — tooltips on activity bar icons + toolbar with shortcut hints.
- Gap #92 — Cmd+Z / Cmd+Shift+Z app-wide undo/redo dispatch (sidebar reordering, deleted tabs, settings changes).
- Gap #96 — status bar indent reads real value; gap #97 — status bar items clickable.

**Exit criteria**

- Drag a tab to reorder; drag to the editor edge to split.
- Sidebar drags to resize, position persists.
- 3 notifications stack; bell icon shows count.
- Edit `~/.hone/keybindings.json`, restart, change takes effect.
- Open a workspace with `.hone/settings.json` — values override user settings.
- Quit and relaunch → tabs reopen with cursor and scroll positions intact.

**Parallelism:** tabs+splits and keybindings+settings are independent.

---

## Phase 4 — Git, terminal, tasks (Weeks 11–13)

**Goal:** Hone is a usable git client and terminal host, not just a viewer.

**Git work**

- Gap #44 — merge conflict UI (3-way diff, accept current/incoming/both).
- Gap #45 — hunk-level stage/unstage in diff view.
- Gap #46 — multiline commit + amend + sign-off.
- Gap #47 — branch picker accessible from status bar + git panel.
- Gap #48 — stash list, apply, drop.
- Gap #49 — gutter blame + per-file log view.
- Gap #50 — `.gitignore`-aware explorer.
- Gap #99 — surface all git status codes (M/A/U/?/!/R/C) in explorer.

**Terminal work**

- Gap #51 — multiple terminals, horizontal split.
- Gap #52 — shell profile registry.
- Gap #53 — link detection (file:line + URL) with click-to-open.
- Gap #54 — wire `hone_terminal_resize` on panel resize.
- Gap #55 — persist scrollback across sessions.

**Tasks work**

- Gap #105 — tasks panel + execution; problems-from-task via problemMatcher; auto-detect npm/cargo/gradle.

**Exit criteria**

- Force a merge conflict in a fixture repo → resolve fully inside Hone, no terminal.
- Stage a single hunk; verify `git diff --cached` shows only that hunk.
- Branch picker from status bar switches branches.
- Open 3 terminals, split, click a `src/foo.ts:42:10` in `tsc` output → file opens at that location.
- Define a `bun test` task → run with Cmd+Shift+B → output streams to terminal panel, failures populate problems panel.

**Parallelism:** git, terminal, tasks are three independent tracks. With 2–3 engineers, 1 week.

---

## Phase 5 — Debug & extensions (Weeks 13–14)

**Goal:** stop pretending. Either ship real debug + real extensions, or rename them. Recommendation for Path B: ship real.

**Debug work**

- Gap #11 — DAP transport (stdio + socket) wired in `hone-core/src/dap/dap-client.ts`.
- Spawn at least Node (`vscode-js-debug`) and Python (`debugpy`) adapters from launch configs.
- Breakpoints actually sent over DAP; conditional + log + function + exception breakpoints.
- Real step over/in/out, continue, pause, stop, restart.
- Variables, watch, call stack, debug console (REPL), inline values, hover-to-inspect.

**Extensions work**

- Gap #12 — real install pipeline: download tarball → sha256 verify → extract → register with plugin host.
- Gap #56 — runtime implementation of `@honeide/api` namespaces (`commands`, `workspace`, `ui`, `languages`, `debug`, `terminal`, `ai`, `sync`).
- Gap #57 — persist `extNon` enable flags in settings.
- Gap #58 — workspace trust prompt before activating any non-built-in plugin on a new folder.
- Ship a working "hello world" sample plugin that registers a command + a tree view, as a smoke test.

**Exit criteria**

- Set a breakpoint in `.ts`, F5 → Node adapter spawns, breakpoint hits, variables visible.
- Install a plugin from the marketplace; restart; the command shows up in command palette.
- Open an untrusted folder → trust prompt before the plugin runs.

**Parallelism:** debug and extensions are independent; ideal split.

---

## Phase 6 — AI quality (Weeks 14–16)

**Goal:** match Cursor / Continue on the basics, not just claim to.

**Work**

- Gap #10 — real model-backed inline completion. Wire `hone-core/src/ai/inline/{completion-provider,fim-adapter}.ts` into `views/ai-inline/inline-completion.ts`.
- Gap #59 — markdown rendering covers tables, ordered/unordered nested lists, blockquotes, link clicks, code-fence inner-language highlighting (reuse the new tree-sitter engine from Phase 1).
- Gap #60 — diff preview card before agent `file_edit` writes.
- Gap #61 — `@`-mention completion in chat input (files, symbols, folders, web).
- Gap #62 — slash command parser (`/fix`, `/explain`, `/test`) wired to `code-actions.ts`.
- Gap #63 — "Generate commit message" button in git panel.
- Gap #106 — image input.
- Gap #107 — inline "Fix with AI" / "Explain" gutter lightbulb on errors.
- Gap #108 — generate PR description.
- Gap #109 — wire Bedrock / Vertex / Azure-OpenAI SSE formats in chat panel.
- Gap #110 — session rename UI.
- Gap #13 — PR review panel: OAuth flow + real GitHub/GitLab/Bitbucket API calls + diff browser + comment submission.

**Exit criteria**

- Type in a TS file → multi-line ghost text from the configured model, Tab accepts.
- `/explain` slash command sends the selection + a system prompt; response renders with a working table.
- `@components/Button` autocomplete inserts a file chip.
- Click "Generate commit message" → diff streamed to model, message populates the commit field.
- Authenticate with GitHub → PR list loads → click a PR → review with comments works.

**Parallelism:** inline completion + chat polish on one track; PR review on another.

---

## Phase 7 — iOS, iPad, sync (Weeks 16–17)

**Goal:** ship the cross-device story honestly.

**iOS / iPad work**

- Gap #64 — keyboard handling (`keyboardWillShow` insets, dismiss on tap-outside).
- Gap #65 — bridge `onAppBackground` / `onAppForeground` from perry-ui-ios SceneDelegate.
- Gap #66 — call the orphaned reconnect orchestrator on WS close.
- Gap #67 — Mac QR rendering via CIFilter FFI.
- Gap #68 — iOS QR scanning via `AVCaptureMetadataOutput`.
- Gap #69 — iPad orientation change listener via UIScene transition.
- Gap #70 — bottom toolbar Git icon (match spec).

**Sync work**

- Gap #14 — wire `views/sync/review-panel.ts` and `views/sync/trust-settings.ts` into `sync-panel.ts`.
- Run the multi-device test matrix from MVP-CHECKLIST B23 (Mac+iPhone, Mac+iPad, two-guest broadcast, network switch, host restart).

**Exit criteria**

- Pair Mac + iPhone via QR scan (no manual typing) → green dot → propose a file edit from phone → Mac shows it in review queue → accept → diff applies.
- Background the phone for 60s → foreground → reconnect within 3s.
- Rotate iPad → layout transitions without restart.
- All sync security claims in Phase 0 still pass.

---

## Phase 8 — Polish & release prep (Weeks 17–18)

**Goal:** clear the P2 list aggressively, then cut v1.

**Editor polish**

- Gaps #71 (auto-save), #72 (trim trailing whitespace on save), #73 (EOL + encoding pickers), #74 (word wrap modes wired), #75 (whitespace render), #76 (control char render), #77 (relative line numbers), #78 (rulers), #79 (smooth scroll), #80 (multi-cursor extras), #81 (in-selection search), #82 (find/replace in files with globs + preview), #83 (snippet transforms + choices), #85 (timeline view), #86 (file-watcher reconcile), #87 (region folding).

**Workbench polish**

- Gaps #90 (empty states), #91 (confirm dirty close), #93 (spinner widget), #94 (explorer DnD), #95 (hidden files toggle), #98 (status bar widget API).

**Git polish**

- Gaps #100 (tags), #101 (submodules), #102 (LFS), #103 (commit graph), #104 (inline diff).

**Cross-platform polish**

- Gaps #112 (LSP-over-sync from iOS to host), #113 (terminal-over-sync), #114 (iPad keybinding split), #115 (Stage Manager once layout supports it).

**Distribution & ops**

- Gap #5 — Apple signing + notarization pipeline (Developer ID Skelpo GmbH `K6UW5YV9F7` ready locally; iPhone Distribution cert ready). macOS DMG: codesign → notarize → staple. iOS: distribution provisioning + App Store Connect upload.
- Gap #7 — GitHub Actions CI on `honeide/ide`: build matrix (macOS arm64 + iOS sim + Linux), `bun test` across all packages, signing job on release tags, `scripts/verify-version.ts` as a pre-commit and CI check.
- Gap #116 — verify `update-checker.ts` endpoint serves a real `version.json`.
- Gap #117 — crash reporting (minidump → Sentry or equivalent).
- Cold-start benchmark, memory baseline, binary size budget enforced in CI.
- Marketing site review, screenshot refresh, App Store listing copy.

**Exit criteria**

- `git tag v1.0.0` → CI ships signed macOS DMG + iOS App Store build + Linux tarball.
- All P0 and P1 items closed. P2 closure rate ≥ 80%.
- Cold start < 1.5s on M-series; idle memory < 200MB.
- 7-day private beta with no P0 or P1 regressions logged.

---

## Critical paths & risk

**Tokenizer (Phase 1)** is the single biggest risk. If tree-sitter integration takes longer than estimated, Phases 2 and 6 (markdown inner-highlight) slip. Mitigation: prototype a 2-language tree-sitter PoC during Phase 0 to validate Perry compatibility.

**DAP integration (Phase 5)** is the second risk. If Node/Python adapter spawn from a Perry-native binary has FFI surprises, descope to one adapter for v1 and rename "Debug → Run + Node Debug".

**iOS subprocess constraints (Phase 7)** mean LSP, terminal, and DAP can never run locally on iOS. Decide in Phase 0: are these advertised as "host-tunneled via sync" or hidden in iOS builds? Tunneling adds 1–2 weeks to Phase 7.

**Marketplace install pipeline (Phase 5)** depends on having a real signing story for plugins. If plugin signature verification isn't ready, ship marketplace read-only for v1 (browse + read details, no install) and unlock install in v1.1.

---

## Suggested cadence

- Weekly demo at phase mid-point and exit.
- Tag a `v0.X-betaN` build at every phase exit and ship to a small private list.
- Re-run the relevant section of `MVP-CHECKLIST.md` as the phase acceptance test.
- Keep `SHIP-V1-GAPS.md` updated — close items, add new ones, never leave items in `[~]` limbo.
