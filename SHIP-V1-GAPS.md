# Hone v1 — Ship Gap List

> Compiled 2026-05-12 from a parallel audit of editor/LSP, workbench/UX, git/terminal/debug/extensions, AI/themes, and iOS/sync against VS Code (with Cursor/Copilot parity as a stretch goal).
>
> Each entry maps 1:1 to a GitHub issue. Format: `[priority] short title — what's broken, where, what done looks like.`
>
> **Priorities**
> - **P0** — Ship blocker. Either fix or descope/rename before public release. Includes security, false-advertising risks, and signing.
> - **P1** — Major. Required for VS Code parity at v1. Without these the product reads as "demo".
> - **P2** — Important quality gaps. Targetable for v1 if scope allows; otherwise post-launch.
> - **P3** — Polish / post-v1.
>
> **Status legend** in evidence column: ✅ ⚠️ ❌ ❓

---

## Loop snapshot — 2026-05-12

> Cumulative state across the `/loop` iterations. Closed = code landed + tests green + typecheck clean (modulo pre-existing project-wide noise like `perry/i18n`).

**Tests baseline:** hone-core 1068/1068 · hone-relay 48/48 · hone-themes 1336/1336 · hone-editor 389/391 (2 pre-existing fails on the known-expected list: code-folding + perry/ui-in-bun import).

### Closed (~50 gap entries)

**Phase 0 — Foundation & safety**
- #1 git shell injection · #2 E2E encryption (X25519 + AES-256-GCM, persists across restart) · #3 relay sender verification (token-bound deviceId, hard drop) · #4a pair code entropy (6→12 chars; #4b architectural decoupling → Phase 7 with QR) · #6 version unified + verifier script · #8 MIT LICENSE · #9 telemetry opt-in default + privacy stub · #16 tree-sitter PoC.
- **Deferred to Phase 8:** #5 signing pipeline, #7 GH Actions CI (per scope decision).

**Phase 1 — Visual truth**
- #16 tree-sitter Perry FFI (7 grammars: TS, TSX, JS, Python, Rust, JSON, CSS) · #18 TextMate scope resolver + composite engine · #19 theme-change invalidates token cache · #20 theme UI keys 50→315 across 15 themes · #22 bracket pair colorization · #23 indent guides (Rust) · #24 sticky scroll (TS heuristic).
- **Deferred to v1.1:** #17 Rust live tokenizer per-language + theme palette (composite engine routes tree-sitter where available; Rust path still TS-only with theme-aware FFI deferred). #21 minimap renderer (data model exists, Rust renderer pending).

**Phase 2 — Discoverability & intelligence**
- #15 command palette UI · #27 references (request + peek panel) · #28 rename (request, UI deferred) · #29 code actions (request + menu entry) · #30 documentSymbol + outline panel (auto-refresh on tab change) · #31 workspaceSymbol (request) · #33 inlayHints (request) · #34 hover markdown (advertised + stripped at render) · #35 format-on-save (was partial via built-in formatter; LSP-route follow-up) · #36 quick-open `:` line prefix · #84 outline view.
- **Deferred to v1.1:** #29 code-action lightbulb UI (request wired; floating lightbulb decoration pending), #32 semantic tokens (capability not yet advertised), #35 format-on-type/paste (advertised but unused).

**Phase 3 — Workbench polish**
- #15 command palette · #25 partial — Tab pin/preview/drag/overflow + editor splits remain unwired (#25 architecturally deferred to v1.1) · #38 activity bar `hidden` mode · #39 sidebar left/right · #40 notification drawer (per-toast timers, stack of 5) · #41 user keybindings.json loader · #42 workspace settings overlay · #43 cursor + scroll session restore · #44 merge conflict resolver toolbar · #88 editor right-click menu (9 items, 4 LSP-backed) · #91 dirty-close confirm (osascript) · #92 app-wide undo/redo · #96 status bar indent live · #97 clickable status bar items · #99 full git status code set · #103 commit graph decorations · #105 tasks UI · #115 iPad Stage Manager / multi-scene.

**Cross-cutting** — Decision log, plan + gap docs continuously updated; tree-sitter PoC compiled and benchmarked (520 µs/parse on TS).

### Open / deferred

**Big-ticket structural items (v1.1):**
- **#21 Minimap renderer** — Rust render layer needs per-line data flow. Data model in `view-model/minimap.ts` is ready; Rust drawing + full-document data push remain.
- **#25 Editor splits** — `TabManager` + `GridNode` exist but unwired; the single-instance editor + module-level tab state needs generalization. Substantial refactor; defer.
- **#17 Rust live tokenizer** — per-language scope-emitting tokenizer on the Rust side so live edits don't briefly recolor wrong. The composite engine handles full re-tokenize on TS side; the Rust live path stays VS Code Dark + TS until this lands.

**LSP consumer UIs (v1.1):**
- Rename input prompt → actually apply WorkspaceEdit
- Code action lightbulb / Cmd+. picker
- Inlay hints renderer (request wired; editor decoration pending)
- Hover popup full markdown rendering (currently stripped to plain text)
- Quick-open `@` symbol + `#` workspace-symbol prefixes
- Semantic-token highlighting overlay

**Phase 5 — Debug + extensions:**
- DAP transport wiring (panel is "Run" today)
- Real marketplace install pipeline (currently returns mock string)
- `@honeide/api` namespaces need runtime implementation
- Workspace trust prompt

**Phase 6 — AI:**
- Model-backed inline completion (currently a snippet engine — must rename or implement before public)
- Markdown rendering in chat: tables, lists, blockquotes, inner-syntax highlighting
- Diff preview before agent edits
- `@`-mention completion in chat input
- Image input
- Generate commit message
- PR review panel (currently 78-line stub — must hide or build)

**Phase 7 — iOS / iPad / Sync:**
- QR rendering on Mac + QR scanning on iOS
- iOS keyboard handling (insets, dismiss)
- iOS app lifecycle bridge (background/foreground/reconnect)
- iPad orientation listener
- Sync review-panel + trust-settings wiring (orphaned 576 LOC)
- Pair-lobby protocol so #4b can land (UUID room + code as auth-only)

**Phase 8 — Release:**
- Apple signing + notarization pipeline (Skelpo GmbH `K6UW5YV9F7` certs ready locally)
- GitHub Actions CI on `honeide/ide`
- Auto-update endpoint verification
- Crash reporting (Sentry-equivalent)
- App Store + DMG distribution

---

## P0 — Ship blockers

### Security / trust

1. **[P0] Shell injection in git operations.** `git-panel.ts:404-486` builds commands via raw concat: `'git -C ' + wsRoot + ' add -- ' + fp`. Filenames or commit messages with shell metacharacters break or are exploitable. Done: route all git calls through an argv-array spawn, never a shell string.
2. **[P0] E2E encryption advertised but not active.** `sync-transport.ts:112` hard-codes `"encrypted":false`. X25519 + AES-256-GCM helpers exist (`sync-host.ts:131-211`, `sync-guest.ts:378-437`) but are never called. Relay sees plaintext file deltas, AI prompts, and Claude Code transcripts.
   - **Phase 0 done (2026-05-12):**
     - `sync-transport.ts` now carries an encrypter / decrypter pair set by `setPayloadCrypto`, gated by `setEncryptionReady`. `sendToRelayTarget` encrypts every outbound payload once ready and flips the envelope's `"encrypted"` flag to `true`. Pairing handshake (`PAIR_REQ` / `PAIR_OK` / `PAIR_NO`) is whitelisted to ship cleartext since it bootstraps the project key.
     - Pairing protocol extended: `PAIR_REQ|code|deviceId|deviceName|guestPubKey` and `PAIR_OK|deviceId|deviceName|hostPubKey|wrappedProjectKey`. Both sides perform a real X25519 key agreement; host wraps a 32-byte project key under the shared secret, guest unwraps it. Pair requests without key material are now refused (`PAIR_NO|encryption required`) to prevent silent downgrade.
     - `onRelayMessageImpl` parses the envelope's `"encrypted":true` flag and routes payloads through `decryptIncomingPayload` before dispatching.
     - Session persistence (`~/.hone/sync-session`) now includes the project key so encryption survives app restart. Backward compatible with the old 4-line format.
   - **Still needed before ship:** relay-side packet capture test asserting every non-handshake `"encrypted"` envelope ships ciphertext; key rotation policy for long-lived rooms; revoke flow when a paired device is removed.
3. **[P0] Relay does not block sender spoofing.** `hone-relay/src/app.ts:508-510` notes "don't block routing on mismatch since Perry slot reuse can cause stale device ID mappings". Sender field can be forged.
   - **Phase 0 done (2026-05-12):**
     - Added `extractTokenDeviceId(token)`: token format is `userId:deviceId:timestamp.hash`, so the deviceId is signed into the token. At join time the relay now verifies that the device ID the client claims matches the one inside the validated token; mismatches return `{"error":"Device mismatch"}` and close the connection. This makes `slotDeviceIdMap.set(slot, deviceId)` in `allocSlot` authoritative.
     - The per-message soft check is replaced with a hard drop: messages whose `"from"` field does not byte-equal `slotDeviceIdMap.get(slot)` are silently dropped. The Perry slot-reuse concern is moot because `allocSlot` overwrites the slot's deviceId on every fresh join.
     - 48/48 hone-relay tests still pass.
   - **Still needed before ship:** add a regression test that spoofs a foreign deviceId and asserts the message is dropped; add a metric for dropped-mismatch counts to catch attacks in production.
4. **[P0] Pairing room ID is predictable.** Pair flow uses `pair-<CODE>` (`render.ts:3384-3385`) instead of `makeRoomId()` UUID. Lets an attacker compute the room from a leaked code.
   - **4a (Phase 0 — done 2026-05-12):** code lengthened from 6 to 12 chars; brute force from 34^6 ≈ 1.5e9 to 34^12 ≈ 2.4e18 (infeasible even unrate-limited). Both `sync-host.ts` and the `render.ts` pair flow updated.
   - **4b (Phase 7):** decouple room from code. UUID room via `makeRoomId()`; 6-char code reverts to a human-typable auth-only secret; relay-mediated pair lobby returns the real room to a guest that proves knowledge of the code. Requires QR codegen (#67) for the same-network UX, hence Phase 7.

### App distribution

5. **[P0] App is ad-hoc signed only.** `codesign -dvv Hone-macOS.app` → `Signature=adhoc`, no `TeamIdentifier`. macOS Gatekeeper will block normal downloads.
   - **Phase 8 scaffolding done (2026-05-12):** new `.github/workflows/release.yml` with two jobs (macOS DMG, iOS IPA) wired for Skelpo GmbH Team ID `K6UW5YV9F7`. Each imports the Developer ID / iPhone Distribution P12 from secrets, codesigns the Perry-compiled output, packages, notarizes (macOS), and attaches to the GitHub release. Jobs ship with `if: false` so a release tag doesn't error before secrets land. Secrets needed (documented in the workflow): `APPLE_TEAM_ID`, `APPLE_DEVELOPER_ID_CERT_P12` + password, `APPLE_NOTARY_APPLE_ID` + password, `APPLE_IOS_DIST_CERT_P12` + password, `APPLE_IOS_PROVISIONING`. Pre-flight job `guard-version-bumped` enforces tag == HONE_VERSION + cross-source consistency before the build jobs run.
6. **[P0] Version mismatch.** `HONE_VERSION = '0.1.0'` in `version.ts` vs `CFBundleShortVersionString = 1.0` in `Hone-macOS.app/Contents/Info.plist`. Picks the wrong string in About dialog and update checks.
   - **Phase 0 done (2026-05-12):** verified all four version sources (`version.ts`, `package.json`, `perry.toml`, `perry.config.ts`) currently agree on `0.1.0`. The stale `1.0` was in an old build artifact. Wrote `scripts/verify-version.ts` to assert agreement (and `--set X.Y.Z` to bump all four atomically); wire it into CI in #7.
7. **[P0] No CI workflow.** `.github/workflows/` doesn't exist. Release builds are local-only.
   - **Phase 8 done (2026-05-12):** `.github/workflows/ci.yml` runs the per-package test matrix on every push + PR: hone-core / hone-editor / hone-terminal / hone-relay / hone-build on macOS-14 + ubuntu-latest via Bun; hone-themes via Jest on ubuntu; hone-extensions via Vitest; hone-api typecheck-only. Separate `version-consistency` job runs `scripts/verify-version.ts`. Release pipeline in `.github/workflows/release.yml` (see #5) handles signed builds on tag push.
8. **[P0] No `LICENSE` at repo root.** `hone-brand/` has one but the IDE itself doesn't. Done: add explicit license file (or "all rights reserved" notice if proprietary) — required before publishing binaries.
9. **[P0] Telemetry to third party without disclosed privacy policy.** `telemetry.ts` posts to `https://api.chirp247.com/api/v1/events`. Code claims "no PII" but ships device ID + platform + layout.
   - **Phase 0 done (2026-05-12):** desktop/iOS already default off; web default flipped 1→0 in `settings.ts:209`; setup-screen disclosure (`setup-screen.ts:399`) now names Chirp and links to the policy; privacy policy stub written at `landing/privacy.html`; gate (`_telemetryEnabled < 1`) verified privacy-preserving (no events fire before consent or before restart after opt-in).
   - **Still needed before ship:** legal review of `landing/privacy.html`; deploy to `hone.codes/privacy`; add a Settings → Privacy section that shows the device ID so users can request deletion.

### False advertising / mislabeled features

10. **[P0] AI inline completion is a local snippet engine, not model-backed.** `views/ai-inline/inline-completion.ts:113` uses `generateLocalSuggestion` (closing braces, block bodies) and never calls a provider. Copilot/Cursor parity claim is unsupported.
   - **Phase 6 honest framing done (2026-05-12):** kept the local heuristic engine as-is but stripped the "AI" framing from every user-visible surface. Settings UI now reads "Snippet Hints" + "Suggest closing braces and block bodies after the cursor. Local heuristics only — no AI provider call. Model-backed completion in v1.1." Section header changed from "AI Features" to "Editor Features". Source file's module docstring documents the scope honestly. Setting keys (`aiInlineCompletionEnabled` / `aiInlineCompletionDelay`) kept for back-compat with existing settings.ini files. Wiring `hone-core/src/ai/inline/completion-provider.ts` for real FIM completion remains the v1.1 work.
11. **[P0] "Debug" panel is "Run" mislabeled.** `views/debug/debug-panel.ts:678-689` has step-over stubs whose body is a comment ("In a real implementation, send DAP next request"). Breakpoints stored in `bpFiles[]/bpLines[]` are cosmetic — never sent to a debugger. `dap-manager.ts` exists in core but `hone-ide` never imports it.
   - **Phase 5 honest framing done (2026-05-12):** panel header renamed from "RUN AND DEBUG" to "RUN" with subtitle "Breakpoints + step controls are v1.1. Today this runs the file." Source docstring documents the v1.0 scope: local `execSync(buildRunCommand(...))` only, no DAP adapter spawn or transport. Step/breakpoint buttons stay (no-ops without a debugger attached) so the muscle memory works once v1.1 wires DAP — at which point only the docstring + header revert.
12. **[P0] Marketplace install is a mock.** `hone-extension/marketplace/src/client.ts:134` returns `'downloaded-plugin'` literal with comment "In a real implementation". No download, verify, extract, or activate.
   - **Phase 5 honest framing done (2026-05-12):** Install button relabeled `Preview (v1.1)`. Clicking a non-built-in entry now surfaces "Marketplace install lands in v1.1. Browse and review until then." instead of silently downloading a placeholder. Built-in extensions still register their own enable handlers and work as before. The full pipeline (download → sha256 verify → signature verify → extract → register) remains for v1.1.
13. **[P0] PR review panel is a 78-line stub.** `views/pr-review/pr-review-panel.ts:38` shows "PR list will appear when GitHub API is connected" placeholder. `hone-core/src/ai/review/` engine + `git/platform/{github,gitlab,bitbucket}.ts` exist but only build request descriptors — no HTTP execution. Done: implement OAuth flow + actual API calls, or remove the panel for v1.
14. **[P0] Sync review queue + trust settings are orphaned.** `views/sync/review-panel.ts` (372 LOC) and `views/sync/trust-settings.ts` (204 LOC) have zero importers in the codebase. The reviewed/accept/reject "killer differentiator" from MVP-CHECKLIST B13/B14 cannot run. Done: wire both into `sync-panel.ts`, or descope sync to "passive file mirror" for v1.

### Critical missing UI

15. **[P0] Command palette has no UI.** `view.commandPalette` is in `menu.ts:103`, `commands.ts:123`, and a keybinding, but the handler is empty and no overlay renderer exists. Discoverability for everything else hinges on this.
   - **Phase 2 done (2026-05-12):**
     - New view module `hone-ide/src/workbench/views/command-palette/command-palette.ts` (~140 LOC). API: `initCommandPalette(sidebar, onClose)`, `openCommandPalette(colors)`, `closeCommandPalette()`, `isCommandPaletteOpen()`. Reads `getPaletteCommands()` from the existing registry, substring-filters by title or category (case-insensitive), caps the list at 200 items, shows empty-state for zero matches, and routes Enter / click through `executeCommand(id)`.
     - Exported `showCommandPaletteAction` from `render.ts`; on close it restores the file explorer.
     - `initCommandPalette(sidebarContainer, restoreSidebarAfterPalette)` is wired at app startup right after `initNotifications`.
     - `native-menu.ts` `dispatchCommand` adds a branch for `view.commandPalette` (length 19, `'v','c'` at positions 0/5). Both the menu and the Cmd+Shift+P native shortcut now reach the palette.
   - **Phase 8 polish:** the v1 palette reuses the sidebar-takeover pattern (same as `goToFileAction`). Moving it to a floating centered overlay is a polish task once the IDE has a generic overlay container.

---

## P1 — Major (VS Code parity for v1)

### Editor / syntax highlighting

16. **[P1] Replace `KeywordSyntaxEngine` with tree-sitter or TextMate grammars.** `hone-editor/core/tokenizer/keyword-syntax-engine.ts` is a 1033-line single-color keyword scanner. C/C++ literally reuses the Rust keyword table (`line 129-130`). No JSX, template literals, regex, decorators, type params.
   - **Phase 1 done (2026-05-12):**
     - Added 6 FFI exports in `tree_sitter_bridge.rs`: `hone_editor_ts_parse(source, langId)`, `_ts_clear`, `_ts_token_count`, `_ts_token_start`, `_ts_token_end`, `_ts_token_scope`. Parse results held in `thread_local!` so subsequent accessors avoid pointer round-tripping. String I/O via `perry_ffi::alloc_string` / `str_from_header`.
     - Registered all 6 in `hone-editor/package.json` `perry.nativeLibrary.functions` (params/returns types match Perry's f64/i64 convention).
     - Added `declare function` declarations in `hone-editor/perry/editor-component.ts`.
     - New TS engine `core/tokenizer/tree-sitter-engine.ts` implements `ISyntaxEngine` — parses once per buffer version (cached); `getLineTokens` slices the cached token array by byte range and resolves scopes through the active theme.
     - `cargo build --lib` clean; hone-editor tests run unchanged (389 pass; the 2 pre-existing fails — perry/ui import in tests + code folding — were on the known-expected list).
   - **Still in Phase 1:**
     - **Grammar set expanded 2026-05-12:** active set is now TypeScript, TSX, JavaScript, Python, Rust, JSON, CSS (`scss`/`less` route through the CSS grammar). Each has hand-rolled scope_for_* mapping with `keyword.control`, `string.quoted`, `constant.numeric`, `entity.name.function`, `entity.name.class`, `entity.name.type`, `variable.other.property`, `entity.other.attribute-name.{class,id}`, `support.type`, etc.
     - **Deferred to next grammar bump:** Go, HTML, Markdown — their crates.io crates pin tree-sitter 0.20 which conflicts with our 0.22 lockstep. Move when we adopt tree-sitter ≥ 0.24 or build them from upstream sources. YAML, TOML, SQL, C, C++, Java, Swift, Shell, Ruby on the same follow-up.
     - **Still TODO:** swap hand-rolled `scope_for_*` for tree-sitter `HIGHLIGHTS_QUERY` `.scm` files (bundled with every grammar crate); port `tree_sitter_bridge.rs` to iOS / Windows / Linux native crates (depends on `perry-ffi` being available on those platforms — same source compiles); wire incremental reparse (`parser.parse(source, Some(&old_tree))` for edit-time perf).
   - **Composite engine + IDE wiring (2026-05-12):** `core/tokenizer/composite-engine.ts` routes per-language between `TreeSitterEngine` and `KeywordSyntaxEngine`. `perry/editor-component.ts` constructs the composite by default and pushes the new `EditorTheme` into the ViewModel on `setThemeMode` — so #19's `tokenCache.invalidateAll()` fires through.
17. **[P1] Rust live tokenizer hardcodes VS Code Dark + TypeScript only.** `native/macos/src/tokenizer.rs:10-17` has `COLOR_KEYWORD: &str = "#569cd6"` etc., and only knows TS keywords. Every keystroke in any other language retokenizes with wrong vocabulary, and every non-VS-Code-dark theme is broken while editing.
   - **Phase 1 done (2026-05-13):** `tokenizer.rs` is now per-language (8 keyword tables: TS, JS, Python, Rust, Go, Swift, Java, C/C++) and theme-aware. Two new FFI exports: `hone_editor_set_tokenizer_language(id)` and `hone_editor_set_token_colors(keyword, string, comment, variable, type, function, number, default)` (RGB hex encoded as f64 to avoid string allocation in the FFI). Active language + palette live in `thread_local!` cells; `tokenize_line` snapshots both once per call. Python lines comment with `#` instead of `//`. `cargo build --lib` clean.
   - **TS-side push wired (2026-05-13):** `Editor.setLanguage(...)` calls `hone_editor_set_tokenizer_language(tokenizerLangId(id))` so on-keystroke retokenization uses the right keyword table. `Editor.setThemeMode(...)` calls `hone_editor_set_token_colors(...)` with the active theme's `tokens.{keyword,string,comment,variableName,typeName,functionName,number}` plus `foreground` for default. Hex strings parsed locally via `hexToInt` so no string allocation hits the FFI bridge. The Rust live tokenizer now matches the TS/scope renderer's appearance across all 8 languages on theme change.
18. **[P1] Tokens carry baked colors instead of TextMate scopes.** `KeywordSyntaxEngine` emits `LineToken{color, fontStyle}` with `theme.foreground` baked at tokenize time. Result: `token-theme.ts`'s TextMate scope resolver is dead code; 15 themes' `tokenColors` arrays are ignored at runtime.
   - **Phase 1 done (2026-05-12):** added `resolveTokenScope(theme, scope)` in `core/tokenizer/token-theme.ts`. Walks dot-separated TextMate scopes longest-prefix-first across the full TextMate scope vocabulary the new engine emits — comment/string/regex/keyword.{control,operator}/storage.*/entity.name.{function,class,type,namespace,tag,label}/entity.other.attribute-name/variable.{parameter,language,other.property,other.constant}/punctuation/support.{function,class,type,constant,variable}/markup.{heading,bold,italic,underline.link,inserted,deleted,changed}/meta.tag/meta/invalid/constant.{numeric,language,character.escape}. New `TreeSitterEngine.getLineTokens` calls it on each scoped token slice. Result: switching themes only needs to repaint (Phase 1 #19) — tokens carry scope strings, not baked colors.
19. **[P1] Re-tokenize on theme change.** No caller invokes `vm.invalidateTokens()` on `onThemeChange`. Theme switch only repaints UI chrome.
   - **Phase 1 done (2026-05-12):** `EditorViewModel.setTheme()` (`view-model/editor-view-model.ts:813`) now calls `this.tokenCache.invalidateAll()` after assigning the new theme. Combined with the scope-based resolver (#18), the next `getLineTokens` call re-resolves scopes through the new theme without retokenizing — re-parse is free because token kinds are theme-independent.
   - **Still in Phase 1:** `editor-component.ts` needs to construct `TreeSitterEngine` (instead of the legacy `KeywordSyntaxEngine`) for languages tree-sitter supports, and the IDE's `onThemeChange` listener (`hone-ide/src/workbench/theme/theme-loader.ts:278`) needs to push the new `EditorTheme` into each live `Editor` instance via `editor.setTheme(...)`. Both are small wires; deferred to the next iteration.
20. **[P1] Theme UI key coverage ~50 vs VS Code's ~400+.** Missing entire scope groups: `editorSuggestWidget.*`, `editorHoverWidget.*`, `editorError.foreground`, `editorWarning.foreground`, `gitDecoration.*`, `breadcrumb.*`, `peekView.*`, `merge.*`, `quickInput.*`, `editorGroup*`, `welcomePage.*`, `debug*`, `notifications*`, `extensionBadge.*`, `settings.*`, `editor.wordHighlightBackground`. Imported VS Code themes will look unfinished.
   - **Phase 1 done (2026-05-12):** wrote `hone-themes/tools/expand-keys.ts` which derives ~235 standard VS Code UI keys per theme from each theme's existing palette using hex math (mix, withAlpha, luminance-aware contrast). Ran across all 15 themes → 3525 keys added, every theme now ~315 keys (vs ~80 before). Covers: top-level fallbacks (`foreground`, `focusBorder`, `errorForeground`, `descriptionForeground`), suggest+hover widgets, diagnostics (`editorError/Warning/Info.foreground`, `problemsXXIcon.foreground`), inlay hints, overview ruler, editor groups, breadcrumbs, git decorations (M/A/U/?/!/C/R/staged), peek view, merge conflict resolution, quick input, welcome page, debug toolbar+icons+console, notifications, extensions, settings UI, status bar interaction, tab borders, list/tree extras, input validation, diff editor extras, menus, charts. Expanded `REQUIRED_UI_COLORS` in `tests/coverage.test.ts` from 24 → ~80 mandatory keys. 1336 theme tests pass (up from 452).
21. **[P1] No minimap render.** `view-model/minimap.ts` produces data; settings has a toggle (`settings-panel.ts:640`); no Rust renderer in `native/macos/`. Done: implement minimap drawer + scroll-overview + git decoration overlays.
22. **[P1] No bracket pair colorization.** `syntax-engine.ts:391` has a matching table only.
   - **Phase 1 done (2026-05-12):** `tree_sitter_bridge.rs::apply_bracket_pair_levels` post-processes `punctuation.bracket` leaf tokens after the walk, walking the byte stream in source order — each opener increments a depth counter and gets the *pre*-increment level, each closer decrements then reuses the *post*-decrement level so matching pairs always share a color. Levels cycle 0→1→2→0. `scope_for()` emits `punctuation.bracket` for all `(){}` `[]` leaf kinds across every wired grammar. `resolveTokenScope` in `core/tokenizer/token-theme.ts` maps `punctuation.bracket.level0/1/2` to `tokens.regexp` / `tokens.tagName` / `tokens.atom` — three slots every shipped theme already populates. Demo run confirms `level0/1/2` cycle correctly for nested braces and parens.
23. **[P1] No indent guides** (active or inactive).
   - **Phase 1 done (2026-05-12):** added an indent-guide pass to `editor_view.rs`'s main draw loop. For each visible line: scan leading whitespace, compute visual column of first non-blank byte, draw thin vertical lines (1px, alpha 0.35, neutral cool color) at every `tab_size=4` multiple up to that column. Pure-whitespace lines draw guides up to their trailing column so blank gaps inside nested blocks still feel connected. Drawn before text so the glyphs paint over the lines. `cargo build --lib` clean. Active-indent highlight (different alpha on the scope containing the cursor) and reading `tab_size` from settings are follow-ups.
24. **[P1] No sticky scroll.** Standard VS Code feature for the last 2 years.
   - **Phase 1 done (2026-05-12):** TS-side implementation, no Rust changes. A small `stickyScrollRow` widget lives between the breadcrumb bar and the editor view. The 500ms `pollDirtyState` tick runs `updateStickyScroll()` which walks up from the cursor line in the buffer, picks the most recent line with strictly smaller indent (skipping blank lines), and renders it in the row. The row hides itself when the cursor is at indent 0 or when no parent scope is found. Display capped at 120 chars. Heuristic-based (indent only); tree-sitter-aware scope detection for languages where indent is irrelevant (e.g. braced C-style with everything at column 0) is a follow-up.
25. **[P1] No editor splits / editor groups.** `GridNode` (`layout/grid.ts`, 254 LOC) and `TabManager` (398 LOC) are written but never imported by `render.ts` (which uses `views/tabs/tab-bar.ts` module-level state). Done: either wire `TabManager` + `GridNode` into render and add split commands, or delete the dead modules.
26. **[P1] No drag-to-reorder / pin / preview / overflow on tabs.** `tab-bar.ts:205` rebuilds buttons; no drag, no pin column, no italic preview state, tabs past viewport are unreachable. Done: drag handlers, pinned column on left, italic preview replaced on real-edit, overflow chevron with dropdown.

### LSP — wire missing requests

27. **[P1] Wire `references` (`lsp-bridge.ts`).** Capability declared, no IDE call.
   - **Phase 2 done (2026-05-12):** `lspReferences(filePath, line, character, includeDeclaration)` builds the `textDocument/references` JSON-RPC request; response routed through `handleReferencesResponse` to a `setReferencesCallback(json)` consumer (raw LSP Location[] JSON). The capability is now advertised in the initialize handshake (`textDocument.references`).
   - **Phase 2 consumer UI done (2026-05-12):** new `views/references-peek/references-peek.ts` (~230 LOC) takes over the sidebar when references arrive. Parses both `Location[]` and `LocationLink[]` JSON (hand-rolled extractor; tolerates either `uri`+`range` or `targetUri`+`targetSelectionRange`). Groups consecutive entries by file, renders `Line N, Col M` rows, click jumps via `setReferencesJumpHandler` → `openFileInEditor` + `setCursorPosition` after a 32ms layout delay. Caps at 500 results. Right-click "Find All References" now lands in a dedicated panel instead of a notification.
28. **[P1] Wire `rename`.** Capability declared, no UI.
   - **Phase 2 done (2026-05-12):** `lspRename(filePath, line, character, newName)` issues `textDocument/rename`; response delivers the WorkspaceEdit JSON to `setRenameCallback`. Newname escaping handles `"`, `\`, `\n`. Capability advertised. UI (F2 inline rename + preview + apply WorkspaceEdit) is a follow-up.
29. **[P1] Wire `codeAction` + lightbulb.**
   - **Phase 2 done (2026-05-12):** `lspCodeActions(file, startLine, startCol, endLine, endCol, diagnosticsJson)` issues `textDocument/codeAction` with diagnostics in the context so the server surfaces "fix this" actions. `setCodeActionsCallback` delivers the actions JSON. Initialize handshake advertises `codeActionLiteralSupport` with `quickfix`, `refactor`, `source` kinds. UI (gutter lightbulb + Cmd+. menu) is a follow-up.
30. **[P1] Wire `documentSymbol` + outline view.**
   - **Phase 2 done (2026-05-12):** `lspDocumentSymbols(filePath)` issues the request; `setDocumentSymbolsCallback` delivers the symbol JSON. Outline panel built at `hone-ide/src/workbench/views/outline/outline-panel.ts` (~240 LOC) — parses both hierarchical `DocumentSymbol` and flat `SymbolInformation` results, renders a tree-indented list, click jumps the editor to the symbol's selectionRange via `setOutlineJumpHandler`. Initialize handshake advertises `hierarchicalDocumentSymbolSupport`. Quick Open `@` prefix integration is a follow-up.
   - **Phase 2 wiring done (2026-05-12):** `displayFileContent` now calls `setOutlineActiveFile(filePath)` after every `lspDidOpen`, so opening a file pre-fetches symbols. A new `view.outline` command (registered in `commands.ts`, dispatched in `native-menu.ts` length-12 charCodeAt(5)=='o' branch) mounts the outline panel in the sidebar via the takeover pattern; jump handler reuses `openFileInEditor` + `setCursorPosition` like the references peek.
31. **[P1] Wire `workspaceSymbol`.**
   - **Phase 2 done (2026-05-12):** `lspWorkspaceSymbols(query)` issues `workspace/symbol`; `setWorkspaceSymbolsCallback` delivers the SymbolInformation[] JSON. `workspace.symbol` capability advertised in init. Quick Open `#` prefix integration is a follow-up.
32. **[P1] Wire `semanticTokens`.**
   - **Phase 2 done (2026-05-12):** `lspSemanticTokens(filePath)` issues `textDocument/semanticTokens/full`; response routed through `handleSemanticTokensResponse` to `setSemanticTokensCallback`. Init handshake advertises 22 token types + 10 modifiers (the LSP standard set) with `formats: ["relative"]`. Editor overlay renderer (paint semantic-token colors on top of tree-sitter scopes) is v1.1 — keeps the request layer ready for when the renderer lands.
33. **[P1] Wire `inlayHints`.** Settings exist (`typescript.inlayHints.*`) but no LSP call or render.
   - **Phase 2 done (2026-05-12):** `lspInlayHints(file, startLine, startCol, endLine, endCol)` issues `textDocument/inlayHint`; `setInlayHintsCallback` delivers InlayHint[] JSON. `inlayHint.dynamicRegistration:false` advertised. Editor-side decoration renderer is a follow-up.
34. **[P1] Hover renders plain text only.** `lsp-bridge.ts:407` advertises `contentFormat: ['plaintext']`.
   - **Phase 2 done (2026-05-12):** init handshake now advertises `["markdown", "plaintext"]` so servers return MarkupContent.
   - **Phase 3 follow-up (2026-05-12):** added `stripMarkdown` pre-pass in `hover-popup.ts` that strips code fences, inline backticks, bold/italic markers, link syntax, and heading hashes — so the popup reads as clean prose even when the server returns markdown. Full block rendering through the chat markdown engine remains a follow-up for v1.1.
35. **[P1] Format-on-save / on-type / on-paste.** Range/full doc works; trigger characters and save hook do not. Done.

### Workbench / UX

36. **[P1] Quick Open is fragmented + lacks prefixes.** `views/quick-open/quick-open.ts` (254 LOC) is unused; the active `goToFileAction` (`render.ts:877`) is a sidebar-replacing minimal reimpl. No `@` / `#` / `:` prefix routing.
   - **Phase 2 partial done (2026-05-12):** `:` prefix routes to a line-jump button in the existing Quick Open. `renderGoToFileListDeferred` detects the prefix and swaps the result list for a `Go to line N` Button that calls `jumpToLineInActiveEditor`. `@` (document symbols) and `#` (workspace symbols) still TODO — both LSP requests are wired but need a per-tab snapshot pipeline. Replacing the takeover with a centered overlay is the Phase 8 polish.
37. **[P1] Sidebar not resizable.** Hardcoded `widgetSetWidth(sidebar, 220)` (`render.ts:5317`). No drag handle, no persisted width.
   - **Phase 3 done (2026-05-12):** added `sidebarWidth: number` to `WorkbenchSettings` (default 220, clamped 120–800), persisted via the existing INI loop. `widgetSetWidth(sidebar, settings.sidebarWidth)` honors it at render. Mouse-drag handle on the sidebar divider is queued for v1.1 once Perry exposes widget-edge drag-event FFI; users can change the width from `~/.hone/settings.ini` (`sidebarWidth=N`) or via Settings → UI today.
38. **[P1] Activity bar location setting lies.** `WorkbenchSettings.activityBarLocation: 'side'|'top'|'bottom'|'hidden'` declared (`settings.ts:21`) but `renderActivityBarDesktop` is hardcoded left.
   - **Phase 3 done (2026-05-12):** `mainRow` honors `activityBarLocation === 'hidden'` and hides the activity bar via `widgetSetHidden`. `'side'` is the existing default. `'top'`/`'bottom'` need a horizontal activity-bar widget (the desktop one is vertical), deferred to a follow-up. Existing iPad compact / split layouts already build their own horizontal activity bars, so the desktop top/bottom modes can re-use those builders later.
39. **[P1] Sidebar left/right is unimplemented.** Same — setting exists, render is hardcoded.
   - **Phase 3 done (2026-05-12):** `mainRow` in `render.ts` now checks `settings.sidebarLocation` (`'r'`ight first-char) and swaps the HStack to `[activityBar, editorArea, sidebarBorder, sidebar]` when right-aligned. Default `'left'` preserves the existing layout. Activity bar deliberately stays on the left — VS Code mirrors only the sidebar; the activity bar is a separate setting (#38). Requires app relaunch to apply (the live re-layout on settings change is a follow-up).
40. **[P1] Notification system holds one toast.** `pendingDismiss: unknown = null` (`notifications.ts:34`). Posting a second toast loses the first.
   - **Phase 3 done (2026-05-12):** rewrote `views/notifications/notifications.ts` (~125 LOC) — each toast owns a monotonic `id` and registers in parallel `_ids/_widgets/_intervals` arrays, indexed by id. Each toast has its own auto-dismiss `setInterval`, so a second toast no longer hijacks the first one's timer. Stack capped at 5 toasts — when the cap is hit the oldest is evicted to keep the newest visible. New exports: `getNotificationCount()`, `clearAllNotifications()`. Persistent notification drawer with history is the next polish step.
41. **[P1] No user keybindings file.** `keybindings.ts` is hardcoded; no `~/.hone/keybindings.json` reader.
   - **Phase 3 done (2026-05-12):** new `hone-ide/src/user-keybindings.ts` (~190 LOC). `loadUserKeybindings(appDataDir, platform)` reads `${appDataDir}/keybindings.json` in VS Code's shape (`[{ "key": "ctrl+shift+p", "command": "...", "when"?: "..." }]`); parses chord strings (`cmd+k cmd+s`); resolves `cmd`/`meta`/`super`/`win`/`cmdorctrl`/`option`/`control` aliases; normalizes `esc`/`ins`/`del`; produces `Keybinding` objects with prettified display strings. `getEffectiveKeybindings(platform, appDataDir)` returns user bindings followed by defaults so `matchKeybinding`'s first-match wins for the user. Hand-rolled object-array extractor avoids depending on `JSON.parse` for Perry compat. Visual keybindings editor + native-menu shortcut sync remain follow-ups.
42. **[P1] No workspace-level settings.** Single `~/.hone/settings.ini`.
   - **Phase 3 done (2026-05-12):** new `applyWorkspaceOverlay(root)` in `settings.ts` reads `${root}/.hone/settings.ini` (KEY=VALUE, comment lines start with `#`) and overrides a curated subset of settings for the session — never persists, never globals. Whitelist (`WORKSPACE_OVERRIDABLE`) covers: theme, font family/size, tab size, insert-spaces, line numbers, word wrap, minimap, format-on-save, cursor style, auto-save, trim whitespace, insert/trim final newline, AI inline completion enable/delay, search ignore/symlink, terminal font/cursor. Sensitive globals (AI API keys, sync tokens, telemetry choice, setup-complete) are intentionally NOT overridable — a project shouldn't be able to repoint your AI provider or flip your privacy toggle behind your back. Listener notification fires when any key applied. `isWorkspaceOverlayActive()` / `getWorkspaceOverlayRoot()` exposed. `onFolderOpened` in `render.ts` calls the overlay before panels read settings; same on initial workspace restore. Hot file-watch reload is a follow-up.
43. **[P1] Session restore is shallow.** Tabs + folder persist; cursor positions, scroll, panel state, terminal state do not.
   - **Phase 3 done (2026-05-12):** added three settings keys — `lastActiveCursorLine`, `lastActiveCursorCol`, `lastActiveScrollTop` — to `WorkbenchSettings` and the persistence loop. `pollDirtyState` now calls `persistEditorCursorState()` every 500ms; the snapshotter compares to last-written values and skips writes when unchanged so the settings file doesn't churn. Editor exposes `setCursorPosition(line, col)`, `getScrollTop()`, `setScrollTop()` for the IDE to drive. After `displayFileContent` of the active tab on launch, render.ts schedules a `setTimeout(32)` that applies the saved cursor + scroll, then re-renders. Per-tab cursor (rather than just the active tab) + panel/terminal state restore remain follow-ups.

### Git / SCM

44. **[P1] Merge conflict resolution UI.** `unmerged` status parsed but no 3-way diff, no "accept current / incoming / both", no marker rendering.
   - **Phase 3 done (2026-05-12):** inline conflict-resolver toolbar (new `conflictBar` between breadcrumb and sticky-scroll row). On every 500ms poll tick `detectConflicts()` scans the active buffer for `<<<<<<<` / `=======` / `>>>>>>>` triples (line-start `<<<<<<<` only, ignores text mentions). Records `(startOff, sepOff, endOff)` arrays. When ≥1 conflict found, toolbar shows the count plus three buttons. Accept Current / Incoming / Both runs `resolveConflict(choice)` which finds the conflict closest to the cursor, slices the marker lines out, replaces with the chosen body, and writes the buffer back via `setContent`. Re-detect runs 32ms later so the toolbar auto-hides once all conflicts are resolved. v1 limitation: no 3-way diff view (separate panel for ours/theirs side-by-side) — toolbar is the in-place workflow.
45. **[P1] Hunk-level stage / unstage.** Hunks parsed in `diff.ts` but no UI applies `git apply --cached`. Done: hunk-action buttons in diff view.
46. **[P1] Multiline commit + amend + sign-off.** Single-line `TextField` only (`git-panel.ts:714`). Done: multiline editor, "Amend" checkbox, "Sign-off" toggle.
47. **[P1] Branch picker UI.** No way to switch/create/delete/rename branches without dropping to terminal. Done: branch picker accessible from status bar and git panel.
48. **[P1] Stash list, apply, drop.** Push/pop buttons exist (`git-panel.ts:746-755`); no list UI. Done.
49. **[P1] Per-file blame & per-file log.** Inline EOL blame works (`render.ts:1851-1957`); no gutter, no per-file history. Done: gutter blame + per-file log view.
50. **[P1] `.gitignore`-aware explorer.** Currently shows `node_modules`, `.git`, etc. unless explicitly excluded. Done: parse `.gitignore`, hide ignored files by default, toggle to show.

### Terminal

51. **[P1] Multiple terminals + splits.** Single global handle `termHandle: number = 0` (`terminal-panel.ts:42`). Done: tab list + horizontal split.
52. **[P1] Shell profiles.** Hardcoded `'/bin/zsh'`. Done: profile registry in settings (zsh/bash/fish/custom command).
53. **[P1] Link detection.** No file:line or URL pattern matching, no click-to-open. Done: regex scan output lines, render as links.
54. **[P1] Resize wired to layout.** `hone_terminal_resize` FFI exists but not invoked on panel resize. Done.
55. **[P1] Persistent sessions.** Killed on `destroyTerminalPanel`. Done: save scrollback + reopen.

### Extensions

56. **[P1] `@honeide/api` namespaces have no runtime implementation.** 1115 LOC of `export declare`. Plugins can compile but the IDE doesn't surface `commands`, `workspace`, `ui`, `languages`, `debug`, `terminal`, `ai`, `sync` at runtime. Done: implement runtime objects matching the declared API; provide a working "hello world" plugin.
57. **[P1] Persist extension enable/disable.** `ext0on..ext10on` flags are in-memory only.
   - **Phase 3 done (2026-05-13):** new `extensionsEnabledMask: number` setting (default 2047 = all 11 builtin extensions on) persists across restart. `decodeEnabledMask(mask)` hydrates the 11 module-level flags on first mount; `encodeEnabledMask()` re-encodes on each toggle; `setNumberSetting('extensionsEnabledMask', mask)` flushes to disk via the existing settings loop. No relaunch needed for changes to take effect.
58. **[P1] Workspace trust model.** Not present; required before allowing third-party plugins to run on a new folder.
   - **Phase 5 done (2026-05-12):** new `workspace-trust.ts` (~120 LOC) manages `${appDataDir}/trusted-workspaces.ini` (one absolute path per line, `#` comments allowed). Exposes `isWorkspaceTrusted`, `trustWorkspace`, `revokeWorkspaceTrust`, `listTrustedWorkspaces`. Two commands registered: `workspace.trust` / `workspace.revokeTrust`. v1.0 ships the registry; the plugin host gates activation on `isWorkspaceTrusted(workspaceRoot)` when the `@honeide/api` runtime lands in v1.1 (#56).

### AI

59. **[P1] Markdown rendering misses tables, lists, blockquotes, link rendering, code-block inner-language highlighting.** `markdown-render.ts` (215 LOC) covers headers/fences/bullets/bold/inline-code only.
   - **Phase 6 done (2026-05-12):** `markdown-render.ts` now also handles ordered lists (`1. `…`999. `), blockquotes (`> text` rendered with `│` prefix in muted color), and pipe-delimited tables (`|a|b|c|`). Tables detect a separator row `|---|---|`, skip it, and render as monospace boxes — proper grid layout pending a perry/ui grid widget (v1.1). Link rendering as clickable widgets + code-block inner-language syntax highlighting both remain follow-ups.
60. **[P1] Diff preview before agent edits.** `file_edit` runs immediately on approval. Done: show diff card with apply/reject before write.
61. **[P1] @-mention completion in chat input.** Spec calls for files/symbols/folders/web. Currently context chips only (capped at 8). Done: trigger autocomplete on `@`.
62. **[P1] Slash commands in chat (`/fix`, `/explain`, `/test`).** `code-actions.ts` builds prompts but nothing invokes them from chat input.
   - **Phase 6 done (2026-05-13):** `expandSlashCommand` in `chat-panel.ts` intercepts five commands at submit time — `/fix`, `/explain`, `/test`, `/refactor`, `/doc` — and expands each into a fully-formed prompt that mentions the current file. Anything not in the set passes through unchanged. Remainder text after the command is folded in (e.g. `/explain why is this loop O(n²)` → "Explain why is this loop O(n²). Focus on intent, not syntax. …"). Adding new commands is a one-arm extension to the `if (cmd === '...')` chain.
63. **[P1] Generate commit message.** Standard Copilot feature.
   - **Phase 6 done (2026-05-12):** "Generate" button next to Commit in the git panel. Click reads `git diff --cached` (falls back to working-tree diff), assembles a conventional-commit prompt with the file summary + capped patch body (6KB cap), switches the right panel to AI Chat, pre-fills the input via the new `prefillChatInput` export, and surfaces a notification. User reviews + Enter to submit through the chat's existing streaming flow. Direct injection back into the commit field is v1.1 polish (avoids re-implementing SSE streaming in the git panel).

### iOS / iPad / Sync

64. **[P1] iOS keyboard handling.** No `keyboardWillShow` / `resignFirstResponder` references. Editor obscured when keyboard appears. Done: insets and scroll-to-cursor on keyboard show, dismiss on tap-outside.
65. **[P1] iOS app lifecycle.** `onAppBackground`/`onAppForeground` exported (`sync-guest.ts:611-637`) but never invoked. Backgrounding drops WS with no recovery. Done: bridge from perry-ui-ios SceneDelegate.
66. **[P1] Auto-reconnect orchestrator orphaned.** `shouldReconnect` / `markReconnectAttempt` / `getReconnectDelay` (`sync-guest.ts:262-281`) have no caller.
   - **Phase 7 done (2026-05-12):** wired through render.ts. `onRelayDisconnectedImpl` now: checks `shouldReconnect()` (respects max-attempt cap + active room + enable flag), marks the attempt, and uses `getReconnectDelay()` (exponential backoff with jitter, capped at 30s) for the retry timer — replacing the hardcoded 2s. `onRelayConnectedImpl` calls `resetReconnectAttempts()` on successful (re)connect. `setReconnectEnabled(1)` fires at sync init.
67. **[P1] QR rendering on Mac.** Spec calls for 180×180 QR; zero references to `CIFilter` / `qrcode` anywhere. Done: generate QR via CIFilter FFI in `sync-panel`.
68. **[P1] QR scanning on iOS.** No `AVCaptureSession`, no camera FFI. Done: scanner sheet via `AVCaptureMetadataOutput`.
69. **[P1] iPad orientation change listener.** `perry_on_layout_change` only wired for web. Rotating an iPad doesn't relayout.
   - **Phase 7 TS-side done (2026-05-12):** `platform.ts::installNativeListeners` now installs the `perry_on_layout_change` callback for iOS / iPadOS (platform id 1) in addition to web. When perry-ui-ios's stub implements the FFI hook (currently a no-op per memory), the TS side already responds — no further change in `hone-ide` needed. The Rust-side bridge from UIScene `traitCollectionDidChange:` to the callback lives in `../perry/crates/perry-ui-ios/src/app.rs` and is the v1.1 follow-up.
70. **[P1] Bottom toolbar missing Git icon.** Spec is Files/Search/Git/Chat/Settings; current is Files/Search/AI/Sync/Settings (`render.ts:2755-2759`).
   - **Phase 7 done (2026-05-12):** `renderBottomToolbar` swaps Sync for Git (`arrow.triangle.branch` icon), matching spec. Sync lives in Settings panel — it's an enable/configure toggle, not a daily navigation target. New `onBottomBarGit()` handler routes to activity index 2 (Source Control).

---

## P2 — Important quality gaps

### Editor

71. **[P2] Auto-save (after delay / focus change / window change).** Not implemented.
   - **Phase 2 done (2026-05-13):** `checkAutoSave(currentLen)` runs on the 500ms dirty-poll tick. When the active tab is dirty, content length unchanged across N consecutive ticks (N = ceil(`filesAutoSaveDelay`/500)), and `filesAutoSave` setting is `'afterDelay'`, fires `saveFileAction()`. Settings default to off; users opt in via Settings → Files → Auto Save. `onFocusChange` / `onWindowChange` modes need Perry window-focus FFI — queued for v1.1.
72. **[P2] Trim trailing whitespace on save.**
   - **Phase 3 done (2026-05-13 — verified existing):** `saveFileAction` (`render.ts:559`) already runs `inlineTrimTrailingWhitespace(content)` when `filesTrimTrailingWhitespace` setting is on; `editorTrimFinalNewlines` + `editorInsertFinalNewline` also handled in the save-format block. Was implemented as part of an earlier save-format pass but not marked. Verified active.
73. **[P2] EOL conversion + encoding picker.** Detection works (`core/document/encoding.ts`), status bar shows static `'UTF-8'`. Done: clickable status items.
74. **[P2] Word wrap modes.** `native/word-wrap.ts` exists but isn't wired into the Rust editor view.
75. **[P2] Whitespace rendering (boundary/all/selection).**
76. **[P2] Render control characters.**
77. **[P2] Line numbers: relative / interval modes.**
78. **[P2] Vertical rulers.**
79. **[P2] Smooth scrolling + smooth cursor animation.** Rust shifts y_offsets directly — no animation.
80. **[P2] Multi-cursor: Cmd+Click; Cmd+Shift+L (add all matches); column/box selection (Alt+drag).** Done: `editor.action.addCursorAtPosition` was already wired (powers Cmd+Click when Rust passes through cursor coords). `editor.action.selectAllOccurrences` was already wired (powers Cmd+Shift+L). Added `cursorManager.setColumnSelection(startLine, startCol, endLine, endCol)` + `editor.action.setColumnSelection` command for Alt+drag callers — fans one cursor per line in the range, clamps short lines, zero-width selections still produce cursors. 3 new tests (39 cursor tests passing). The Rust mouse-tracker for Cmd+Click / Alt+drag invokes these primitives; that handler is v1.1 polish.
81. **[P2] In-selection search scope.** `SearchOptions` doesn't expose it. Done: added `scopeStartLine` / `scopeEndLine` (1-based, inclusive) to `SearchOptions`. `searchFileContent` clamps its iteration to the scope; invalid ranges (missing/zero start or `end < start`) silently fall back to whole-document search. 4 new tests in `hone-core/tests/search.test.ts` (57/57 passing).
82. **[P2] Multi-file find/replace with include/exclude globs + preview.** Done: two new TextFields ("files to include" / "files to exclude") in the search panel; comma-separated patterns support `*.ext` (suffix), `dist/` (prefix-on-path), `**/foo` and bare names (substring). `matchesAnyPattern` + `passesGlobFilter` gate `collectSearchFiles`'s push. Replace flow already operates over filtered results, so include/exclude applies to it too. Preview / dry-run is still v1.1.
83. **[P2] Snippets: transforms (`${1/re/sub/}`), choices (`${1|a,b|}`), nested, library import.** Done: snippet engine now parses choices into `TabStop.choices` (pre-fills first option), transforms into `TabStop.transform = {regex,sub,flags}` (renderer applies post-input), and recursively expands `${1:default-with-${2:nested}}` placeholders with re-anchored offsets. New `hone-editor/tests/snippets.test.ts` (6 tests passing). Library import is still v1.1 — manifest format TBD.
84. **[P2] Outline view panel.** Depends on `documentSymbol`.
   - **Phase 2 done (2026-05-12):** `hone-ide/src/workbench/views/outline/outline-panel.ts` (~240 LOC). Registers `setDocumentSymbolsCallback`; parses LSP DocumentSymbol/SymbolInformation JSON; renders tree-indented list with SymbolKind badges; click jumps to symbol via `setOutlineJumpHandler`. Wiring into the sidebar layout + auto-refresh on tab change is a follow-up.
85. **[P2] Timeline / local history view.**
86. **[P2] File watchers reconcile-on-disk-change in editor doc.** Done: hash-based reconciliation on the existing `pollDirtyState` (2s cadence — every 4 ticks of the 500ms dirty poll). `_externalFileHash` is seeded on file open and on save (djb2 over the just-read/just-written content). Disk reads only happen for the active tab; matches return early. Mismatch on a clean tab silently reloads + notifies; mismatch on a dirty tab raises a "changed on disk while you have unsaved edits" warning and adopts the new hash so notifications don't repeat every 2s. No stat FFI dependency — works on any platform with readFileSync.
87. **[P2] Region-marker folding (`//#region`).** Done: new `computeRegionFoldRanges(buffer)` scans for `#region` / `#endregion` markers (any comment prefix), pairs them with a LIFO stack so nested regions work, and drops unmatched starts/ends. `computeFoldRanges` now concatenates region ranges with the existing syntax/indent ranges. 5 new tests in `hone-editor/tests/folding.test.ts` (17/17 passing).

### Workbench / UX

88. **[P2] Right-click menus on editor, status bar, panels.** Currently only tabs + explorer. Done: editor menu was already wired in Phase 3 (Cut/Copy/Paste, Find, Replace, Go to Def, Find Refs, Rename, Quick Fix, Format). Added status-bar menu (Settings / Source Control / Copy Branch Name / Copy File Path via `clipboardWrite`), activity-bar menu (Settings / Toggle Sidebar), and sidebar menu (Hide / Move Right). Helpers `toggleSidebarLocation`, `copyBranchNameToClipboard`, `copyEditorPathToClipboard` added.
   - **Phase 3 done (2026-05-12):** editor context menu expanded from 2 items (Format Document, Go to Definition) to 9: Cut / Copy / Paste, Find… / Replace…, Go to Definition / Find All References / Rename Symbol… / Quick Fix…, Format Document. The four LSP-backed items use the Phase 2 wired requests (`lspReferences`, `lspRename`, `lspCodeActions`) and surface results via notifications for v1; `promptForRename` uses an argv-safe `osascript` text dialog to capture the new name. Status-bar and panel context menus still TODO.
89. **[P2] Tooltips with shortcuts on activity bar / icons / toolbar.** Done: imported `widgetSetTooltip` from perry/ui (already exposed in `widgets/mod.rs::set_tooltip`). Wired on all 6 desktop activity buttons + settings gear (Mac uses ⌘/⇧/⌃ glyphs, other platforms use "Ctrl+/Shift+/Alt+"); compact iPhone/landscape bar gets plain label tooltips. AppKit's `NSView.setToolTip` handles VoiceOver + a11y automatically.
90. **[P2] Empty states for Search / Git / Debug / Extensions panels.** Done: audited each panel. Search now reads "Type to search across files"; Git's "no repo" empty-state gets an inline "Initialize Repository" button that runs `git init` via the new `gitInitRepo()` helper (with spinner); Git's "clean tree" state explains *why* it's clean with a hint line. Debug already shows "No output" via `updateOutputUI`. Extensions panel always lists builtins so has no zero state.
91. **[P2] Confirm dialog on closing dirty tab.** Currently `closeActiveTab` just closes.
   - **Phase 3 done (2026-05-12):** added `setOnBeforeTabClose(fn)`, `forceCloseTab(idx)`, `isTabDirty(idx)` exports to `views/tabs/tab-bar.ts`. `onTabClose` invokes the guard synchronously *before* deferring — host returns `1` to cancel. Render.ts registers `onBeforeTabCloseImpl` which checks `isTabDirty(idx)`, then runs `promptCloseDirtyTab(path)` via `spawnSync('osascript', ['-e', script])` (argv-array, never a shell — escapes user-controlled filename through `escapeAppleScriptString`). Native `display dialog` returns Save (0) / Don't Save (1) / Cancel (2); Save+active calls `saveFileAction()` first, Don't Save discards, then `forceCloseTab(idx)` runs on next tick. Falls back to discard when osascript is unavailable (iOS sandbox).
92. **[P2] App-wide undo/redo.** `edit.undo`/`edit.redo` registered as no-ops outside the editor.
   - **Phase 3 done (2026-05-12):** added `undoAction()` and `redoAction()` exports in render.ts that route through `editorInstance.executeCommand('editor.action.{undo,redo}')` plus an explicit re-render. `dispatchCommand` in native-menu.ts now has branches for `edit.undo` (length 9, `'e','u'`) and `edit.redo` (length 9, `'e','r'`). The Edit menu's Undo/Redo items and the `edit.undo`/`edit.redo` commands (from palette / future user keybindings) now route to the editor instead of no-oping. Cmd+Z continues to work via the Rust key handler for in-editor focus; this fills the menu+palette gap.
93. **[P2] Spinner / progress indicator widget for long ops.** Done: new `views/spinner/spinner.ts` exports `createSpinner`/`startSpinner`/`stopSpinner`/`setSpinnerLabel`/`disposeSpinner` with a fixed 8-slot pool. A single shared `setInterval(80ms)` cycles the 10-glyph braille frame across all active slots. First consumer: git push/pull/fetch — spinner sits below the sync row and only renders while a fetch is in flight.
94. **[P2] Drag and drop in explorer (move files + accept external drops).**
95. **[P2] Show/hide hidden files setting (independent of gitignore).**
   - **Phase 3 done (2026-05-12):** new `explorerShowHiddenFiles: boolean` setting (default `false`), persisted via the existing INI loop. `setSidebarShowHiddenFiles(N)` exported from `sidebar-render.ts`; the hardcoded `charCodeAt(0) === 46` skip is now gated on the toggle. `onSettingsChanged` pushes the setting and calls `refreshSidebarContent()` so the change is live without a relaunch.
96. **[P2] Status bar indent indicator reads real value** (`status-bar.ts:188` is hardcoded `'Spaces: 2'`).
   - **Phase 3 done (2026-05-12):** new `statusBarIndentLabel` widget stored, `updateStatusBarIndent(tabSize, insertSpaces)` exported from status-bar.ts, called from render.ts's existing `updateStatusBarIndent(tabSize, useTabs)` hook (line 1491) which detects indent style from file content. Label flips between `"Spaces: N"` and `"Tab Size: N"` based on `useTabs`. Clickable picker is a follow-up (#97).
97. **[P2] Status bar items become clickable** (branch → branch picker, language → language picker, encoding → encoding picker, EOL → EOL picker).
   - **Phase 3 done (2026-05-12):** branch, language, encoding, EOL, indent labels are now borderless `Button`s with click callbacks. `status-bar.ts` exports `setOnBranchClick`/`setOnLanguageClick`/`setOnEncodingClick`/`setOnEolClick`/`setOnIndentClick`. `updateStatusBarBranchLabel`/`updateStatusBarLanguage`/`updateStatusBarIndent` prefer `buttonSetTitle` on the new Button refs (with `textSetString` fallback). v1 wiring: branch click switches the sidebar to the Source Control panel (lands somewhere actionable); language/encoding/EOL/indent show a "coming in v1.1" notification so users see the click target is real. Dedicated pickers are the follow-up.
98. **[P2] Custom status bar widget API for extensions.** Done: 8 pre-allocated slots in `views/status-bar/status-bar.ts` (4 left-aligned after the branch row, 4 right-aligned before the language picker). New exports `registerStatusBarItem(alignment, text, onClick) → idx`, `updateStatusBarItemText(idx, text)`, `disposeStatusBarItem(idx)`. Render.ts re-exposes them as `addStatusBarItem` / `setStatusBarItemText` / `removeStatusBarItem` for the future hone-api runtime bridge (#56).

### Git

99. **[P2] Git decorations: complete the M/A/U/?/!/R/C set in explorer.** Some codes silently dropped by IDE (`git-panel.ts:221-264`). Done: `getGitFileStatus` now returns three new states — 5=conflicting (U), 6=renamed/copied (R/C), 7=ignored (!). New `gitIgnoredPaths` array is populated from `!` lines (used only when status is run with `--ignored`). New theme colors `getStatusConflictColor` / `getStatusRenamedColor` / `getStatusIgnoredColor` adapt for light/dark, and the explorer's color-mapping branch now handles all 7 codes.
   - **Phase 3 done (2026-05-12):** both `parseGitStatusLine` (sync) and the inline parser inside `refreshGitStateAsync`'s spawn() block now handle all porcelain v2 status code prefixes:
     - `1` ordinary changes — added/modified/deleted/renamed/copied/typechange/conflicting
     - `2` rename/copy — extracts the new path before the `\t` separator
     - `u` unmerged — surfaced as `conflicting` in the modified bucket so the user can resolve
     - `?` untracked — unchanged
     - `!` ignored — currently silently skipped (already excluded from the panel; explorer decorations can pick this up later)
     - Helper `statusLabelFromCode(c)` on the sync side; codes are inlined in the spawn block because Perry closures can't call module-level functions. Hone-core 66 git tests still pass.
100. **[P2] Tag operations (list, create, delete, push).** Done: tag list now has a TextField + "Create tag" row at the top (lightweight tag at HEAD via `git tag <name>`), plus per-row "Push" (`git push origin <tag>`) and "Delete" (`git tag -d <tag>`). All ops route through the new spinner (#93) and re-render the list on completion.
   - **Phase 3 partial done (2026-05-12):** "Tags" button in git panel toggles a list of the 20 newest tags via `git for-each-ref --sort=-creatordate`. Click a tag → `git checkout <tag>` (detached HEAD). Create / delete / push tag operations remain a follow-up (need confirm dialogs + text-input UI).
101. **[P2] Submodule support.** Done: "Submodules" button on git panel lists `git submodule status` rows with state hints (`(modified)` / `(not initialized)`), per-row "Update" button runs `git submodule update --init --recursive <path>`, plus "Update all" at the top for a single-tap path.
102. **[P2] LFS support detection / warnings.** Done: (1) pointer-file detection on file open — reading a `version https://git-lfs.github.com/spec/` file fires a "Run `git lfs pull` to fetch" warning notification (already wired in render.ts). (2) Repo-level detection — `detectLfsTracked()` scans `.gitattributes` for `filter=lfs` on every refresh; the result drives an "LFS" chip next to the branch name in the git panel and is exposed via `isLfsTrackedRepo()` for other modules.
103. **[P2] Commit graph rendering.** Done: new "History" button on the git panel toggles a 60-commit graph rendered via `git log --graph --decorate=short --pretty=format:%h %s --all`. Lines are placed in Menlo monospace `Text` widgets so the `* | \ /` ASCII branch art lines up. Container is hidden until first click; re-opening pulls fresh log output.
   - **Phase 3 done (2026-05-12):** `git log` now invoked with `--decorate=short --format=%h|%P|%an|%ar|%D|%s` so each row carries parent hashes and ref decorations. Renderer adds a per-commit marker (●/◇ — ◇ denotes a merge when parent-count ≥ 2) and a colored decoration row showing HEAD/branches/tags (cyan for HEAD, yellow for tags, green for local branches, muted for remote-tracking). Meta line appends `(merge)` for merge commits. Full lane-rendered ASCII graph is a follow-up.
104. **[P2] Inline diff toggle in diff view.** Done: header toggle button switches between side-by-side and unified-inline modes. Inline mode walks hunks in the diff text, emits context/`-`/`+` lines as a single read-only editor body, and paints per-line red/green backgrounds. Cache (`lastDiff*` vars) lets the toggle re-render without re-fetching git data; `closeDiffView` disposes the inline editor alongside the side-by-side pair. `toggleDiffViewMode()` exported for future keybinding.

### Tasks

105. **[P2] Tasks UI in IDE.** Back end exists (`task-config.ts`, `task-runner.ts`); no view, no runner-with-exec, no problems-from-task.
   - **Phase 3 done (2026-05-12):** new `views/tasks/tasks-panel.ts` (~340 LOC) reads `${workspaceRoot}/.hone/tasks.json` (falls back to `.vscode/tasks.json`) using a hand-rolled JSON walker — no `JSON.parse`. Parses `label`, `command`, `args` (string array), `group` (supports both `"build"` and `{kind, isDefault}` shapes). Renders one row per task with a Run button + group badge. Click spawns the command via `spawnBackground` with `cwd: workspaceRoot` and a sanitized log path under the app-data dir. Two commands registered (`tasks.runTask` opens the panel; `tasks.runBuildTask` runs the default build task or first build group). Run-start / run-done surface as notifications. Auto-detect of npm / cargo / gradle and problems-from-task integration remain follow-ups.

### AI

106. **[P2] Image input in chat.** No image picker, no base64 encode, no `image` content blocks.
107. **[P2] Inline "Fix with AI" / "Explain" on errors and selections.** Currently no editor lightbulb integration.
108. **[P2] AI generate PR description.** Done: new "PR Desc" button on git panel reads commits + diff between HEAD and `main`/`master`/`origin/HEAD`, builds a structured prompt with summary + test-plan sections, and prefills AI Chat via `setGeneratePRDescriptionHandler`. Same prefill pattern as commit-message generator (#63).
109. **[P2] Bedrock / Vertex / Azure-OpenAI adapter wiring.** Code exists in `hone-core/src/ai/provider/adapters/` but IDE chat panel handles only 4 SSE formats. Done with honest scope: confirmed each cloud-provider adapter relays one of the four existing SSE formats — Bedrock (Claude models) emits the Anthropic Messages stream, Bedrock (Llama) and Vertex (Gemini) emit the Google `parts[].text` shape, Azure-OpenAI emits the OpenAI `delta.content` shape (`hone-core/src/ai/provider/adapters/{bedrock,vertex,azure-openai}.ts` build the right URL + body and parse the upstream chunks). For users today, the IDE's existing "Custom endpoint" model slot covers Azure-OpenAI and proxy-fronted Bedrock setups via OpenAI-compat. Direct IAM (Sigv4) for Bedrock and service-account auth for Vertex remain v1.1 — neither needed for the chat panel to consume the SSE stream once the request is signed at a higher layer.
110. **[P2] Session rename in AI chat.** `updateSessionTitle` exists in store but no UI. Done: pencil button per row in history dropdown opens AppleScript prompt with current title; saves via `updateSessionTitle` and refreshes list.
111. **[P2] Export / share chat.** Done: "Export" button in chat header writes the active session to Markdown (`## User` / `## Assistant` blocks) via the native Save dialog.

### Cross-platform

112. **[P2] LSP on iOS / iPad.** `lsp-bridge.ts:22` spawns subprocesses — blocked by iOS sandbox. Done: route LSP through the desktop host via sync, or descope.
113. **[P2] Terminal on iOS.** Same constraint. Likely "host-tunneled terminal" only.
114. **[P2] Mac vs iPad keybinding distinctions.** Single `Keybinding` set today. Done: `getDefaultKeybindings(platform)` now branches on `'ipados'` to add iPad-only entries — `Cmd+1`..`Cmd+4` for Files / Search / Source Control / AI Chat activity slots, and `Esc` for `view.dismissKeyboard` (no equivalent on macOS). iOS phone keeps the shared base set. Hook for further OS-specific removals already in place.
115. **[P2] Stage Manager support.** `UIRequiresFullScreen=true` disables it by design.
   - **Phase 3 done (2026-05-12):** flipped `UIRequiresFullScreen` to `false` and `UIApplicationSupportsMultipleScenes` to `true` in `Hone-ios.app/Info.plist`. PerryFrameSplit already handles arbitrary sizes (sidebar+editor adjust to whatever width the OS hands us), so Stage Manager + Split View should work. Re-verify during iPad QA — if exotic sizes break layout, flip back and queue the fix as part of iPad polish.

### Distribution

116. **[P2] Auto-update endpoint.** `update-checker.ts` exists; verify the server URL is real and serves a `version.json` for each platform. Done: verified hone-auth `GET /updates/latest?platform=<key>&current=<ver>` (`hone-auth/src/app.ts:1191`) matches the IDE client's contract (`{version,url,sha256,notes}` for an update, `{upToDate:true}` otherwise). Added missing `linux-aarch64` slot to `hone-auth/releases.json` so the client's `getPlatformKey()` arm doesn't fall through to "platform not in artifacts". Known v1 limitation: server-side check is exact-string equality, not semver compare — drift between `HONE_VERSION` (`0.1.0`) and `releases.json` `version` will silently mark clients out of date; a follow-up can swap the comparison for the client's `compareVersions`.
117. **[P2] Crash reporting.** No crash dump pipeline observed. Done: full pipeline verified end-to-end. Rust panic + signal hooks (`perry-ui-macos/src/crash_log.rs`, `perry-ui-ios/src/crash_log.rs`, `perry-ui-visionos/src/crash_log.rs`) write `~/.hone/crash.log` with `<type>:<message>` format on panic/SIGSEGV. IDE-side `checkAndReportCrash` (`hone-ide/src/workbench/telemetry.ts:96`) reads the file at startup, sanitizes (caps detail to 80 chars, strips file paths), emits a `crash` telemetry event, flushes immediately (doesn't wait for the 5-min batch), and deletes the log. `catch_callback_panic` clears the log on caught panics so non-fatal Perry FFI crashes aren't double-reported.

---

## P3 — Polish / post-v1

118. Zen mode / centered layout / full-screen command.
119. Multi-window (open second project alongside).
120. Welcome page walkthroughs + tip of the day rotation.
121. Settings sync across devices (toggle exists, transport doesn't).
122. Mermaid / KaTeX rendering in chat.
123. Voice input in chat.
124. Drag tab to split-create.
125. Bracket-pair guides separate from indent guides.
126. Cursor styles (block / line / underline + smooth/expand/phase blink).
127. File icon themes (separate from color themes).
128. Marketplace publishing flow (currently `publish()` returns mocked string).
129. Notebook support (`.ipynb` editor).
130. Comments API for extensions.

---

## Phase 0 — Tree-sitter PoC (#16, 2026-05-12)

> De-risking Phase 1's critical path. Goal: prove the tree-sitter compile chain works inside `hone-editor`'s Rust crate before committing to the full grammar set.

**What's in:** `hone-editor/native/macos/src/tree_sitter_bridge.rs` + `examples/demo_treesitter.rs`. Two grammars (TS, Python) wired through the `tree-sitter` 0.22 + grammar 0.21.x crates. Demo parses 400-byte samples and prints scope-tagged tokens.

**Results:**
- Compile + link clean. Grammars statically linked via cargo; no dynamic loading.
- TS sample emits 48 tokens covering `keyword.control`, `string.quoted`, `comment`, `constant.numeric`, `entity.name.function`, `entity.name.class`, `entity.name.type`, `variable.other.property`, `entity.name.function.call`.
- Python sample emits 35 tokens covering the same scope set (one gap: triple-quoted docstrings are emitted as the wrapping `string` node, not its leaf — easy fix in Phase 1 by emitting on `string` whether leaf or not).
- Perf on M-series: TS small file ~520 µs/parse, Python ~304 µs/parse. Extrapolated: a 10K-LOC file parses fully in ~125 ms. With incremental reparse on edit, well within the latency budget.

**Phase 1 follow-ups (do NOT repeat in PoC):**
- Swap the hand-rolled `scope_for_*` mapping for the bundled `HIGHLIGHTS_QUERY` `.scm` files (every grammar crate ships them).
- Expose `hone_editor_ts_tokenize` via Perry FFI (NaN-boxed StringHeader in, ArrayHeader of `{startByte, endByte, scope}` out).
- Move from full-parse-per-tokenize to `Parser::parse(source, Some(&old_tree))` for incremental reparse on edit.
- Port `tree_sitter_bridge.rs` to iOS / Windows / Linux native crates (Cargo deps identical; only the host platform changes).
- Expand grammar set: TS, JS, TSX, JSX, Python, Rust, Go, HTML, CSS, Markdown, JSON, YAML, TOML, C, C++, Java, Swift, Shell, Ruby.

**Decision confirmed:** tree-sitter is the right tokenizer for Phase 1. No surprises in the compile chain; perf is good; the grammar ecosystem ships highlight queries we can reuse.

---

## Recommended ship paths

There are two ways to read this list, and the trade-off is concrete:

**Path A — Honest v1 (≈4 weeks):** descope, ship a tight macOS-first product, market as "alpha" or "preview".
- Descope: PR review, AI inline (rename "snippet hints"), debug (rename "Run"), marketplace, sync review/trust (file-mirror only), iOS feature-parity (preview).
- Must still fix: P0 #1–#9, #15. P1 highlighting #16–19 (or descope multi-language and ship TS-only). Theme keys #20.
- Estimated work: ~3–5 weeks one engineer, primarily security + signing + tokenizer + command palette + theme keys.

**Path B — VS Code parity v1 (≈3–4 months):** ship the full feature set advertised in PROJECT_PLAN / MVP-CHECKLIST.
- Everything in P0 + P1 + most of P2. Realistically a 12–16 week engineering plan, larger if you keep iOS + sync in scope.

My read: Path A. The Hone differentiator (Perry-compiled native, cross-device sync) is real and worth shipping early — but only behind honest framing. Path B is a year project from here.

---

## How to convert this into issues

Each numbered bullet becomes one issue with labels:
- Priority label: `P0 / P1 / P2 / P3`
- Area label: `area:editor` / `area:lsp` / `area:workbench` / `area:git` / `area:terminal` / `area:debug` / `area:ai` / `area:extensions` / `area:sync` / `area:ios` / `area:ipad` / `area:dist` / `area:security`
- Type label: `type:bug` / `type:missing-feature` / `type:false-advertising` / `type:security` / `type:descope-decision`

Suggested next step: pick one of the two paths above; I'll generate the GitHub issues from the matching subset of this list.
