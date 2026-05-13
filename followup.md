# Ship v1 — Follow-up for the Next Agent

You're picking up a multi-iteration loop that's working through `SHIP-V1-GAPS.md`
(the 117-entry audit comparing Hone against VS Code). The work is split across
four package repos and one untracked planning dir.

This document is the hand-off. Read it end-to-end before you start.

---

## 1 · Where things live

```
/Users/amlug/projects/hone/                       # parent dir — NOT a git repo
├── SHIP-V1-GAPS.md                              # the 117-entry punch list
├── SHIP-V1-PLAN.md                              # 8-phase plan + decisions log
├── hone-ide/      → github.com/HoneIDE/ide      (you are here)
├── hone-editor/   → github.com/HoneIDE/editor
├── hone-core/     → github.com/HoneIDE/core
├── hone-auth/     → github.com/HoneIDE/auth
└── ../perry/perry → Perry compiler (Rust)       (do NOT edit unless gap requires it)
```

> **Windows note.** The previous agent worked from macOS. Many of the Apple-
> specific paths above will differ on your box (`C:\Users\…\projects\hone\…`).
> Anywhere this doc names a path, substitute your local equivalent.

Both `SHIP-V1-GAPS.md` and `SHIP-V1-PLAN.md` live in the parent dir, which has
no `.git`. They're the source of truth for what's done and what's open. If you
want them version-controlled, either `git init` the parent or copy them into a
repo — don't lose them.

---

## 2 · Current state

- **~100 of 117 gap entries closed** across multiple loop iterations.
- Last commit per repo:
  - `hone-ide`     `e0c6fec` feat: ship v1 P0–P2 polish pass
  - `hone-editor`  `680a185` feat: ship v1 editor surface polish
  - `hone-core`    `045810c` feat: core slices 4–14 + ship v1 search scope
  - `hone-auth`    `e4a61de` feat: add releases.json with all 5 platform artifact slots
- All four are pushed to `main` on `github.com/HoneIDE/*`.
- Tests pass locally: hone-core 649+, hone-editor 17/17 folding · 39/39 cursor
  · 6/6 snippets, hone-relay 48/48.

Verify before doing anything else:

```sh
cd /path/to/hone/hone-core    && bun test
cd /path/to/hone/hone-editor  && bun test
cd /path/to/hone/hone-ide     && bun run typecheck
```

If any of those fail before you've touched anything, **stop and surface that
back to the user** — don't paper over a broken baseline.

---

## 3 · The loop pattern

Every iteration follows the same shape:

1. **Pick** one open entry from `SHIP-V1-GAPS.md`. Prefer items that are
   genuinely contained — single-file or two-file diffs. Open structural items
   (the bucket list below) need a separate plan; flag them, don't half-do them.
2. **Confirm scope** — read the affected files end-to-end before editing.
   Many entries already have partial work; check for `Done:` markers.
3. **Implement** the smallest honest fix. Examples already closed:
   - small command + one button: `#101` submodule list, `#100` tag create/push/delete
   - small UI affordance: `#88` right-click menus, `#89` tooltips with shortcuts
   - small data model expansion: `#81` `scopeStartLine/scopeEndLine`,
     `#83` snippet choices/transforms
4. **Type-check.** Each package has its own:
   - `hone-ide`: `bun run typecheck` (TS) — `perry/i18n` resolution errors are
     pre-existing noise; ignore them. Anything else from your changes is yours.
   - `hone-editor`, `hone-core`: `bun test` runs the suite.
5. **Update `SHIP-V1-GAPS.md`** — append a `Done: …` sentence to the entry
   describing what shipped, why, and any v1.1 follow-up.
6. **Commit each package separately** at the end of the session (not after
   every entry — see §5).

---

## 4 · What's left

### 4a. The five "big buckets" — not loop-friendly

These cross many files and don't yield to per-iteration polish. They need their
own design pass before code.

| # | Item | Where |
|---|------|-------|
| **#10** | Model-backed inline completion (replace local snippet engine) | `hone-ide/src/workbench/views/ai-inline/inline-completion.ts:113`, wires through `hone-core/src/ai/inline/` |
| **#21** | Minimap render in Rust (`view-model/minimap.ts` produces data, no native renderer) | `hone-editor/native/macos/`, `windows/`, `linux/`, `ios/` |
| **#25** | Editor splits / editor groups (`GridNode` + `TabManager` are written but unused) | `hone-ide/src/workbench/layout/grid.ts`, `tab-manager.ts`, plus `render.ts` integration |
| **#56** | `hone-api` runtime impl (1100 LOC of `export declare` with no backing objects) | `hone-api/src/*.ts` declarations, runtime in `hone-core/src/extensions/extension-api-impl.ts` |
| **#64/#65/#67/#68/#69** | iOS keyboard / lifecycle / QR scan / orientation listener — needs Perry FFI in `perry-ui-ios` | `../perry/perry/crates/perry-ui-ios/src/` — **the only place** in the loop where Rust changes outside `hone-editor/native/*` are appropriate |

Don't attempt these as part of a /loop iteration. Surface them to the user and
get explicit scope before starting.

### 4b. Remaining P1 work (likely tractable)

Run this query for the current list:

```sh
awk '
  /^[0-9]+\. \*\*\[P[01]\]/ {
    if (in_item && !has_done) print pending;
    in_item=1; has_done=0; pending=$0; next
  }
  in_item && /(Done:|done \(|done:)/ { has_done=1 }
  END { if (in_item && !has_done) print pending }
' /path/to/hone/SHIP-V1-GAPS.md
```

The awk pattern's coarse — `Done:` appears in some entries as the *prescription*
("Done: implement X") not the *resolution*. Always open the entry and look for
a follow-up indented bullet like `- **Phase N done (YYYY-MM-DD):**` before
believing it's closed.

Items confirmed open as of the last loop iteration:

- `#10` inline completion (above, structural)
- `#11` debug → "Run" panel — partial honest descope already shipped; full DAP
  wiring is v1.1
- `#12` marketplace install (mock today)
- `#15` command palette — UI shipped; check if anything's missing now
- `#16` tree-sitter PoC — already shipped, look for follow-up wiring of TSX, etc.
- `#22` bracket pair colorization (matching table only)
- `#23` indent guides
- `#26` tab drag/pin/preview/overflow (partial)
- `#62` slash commands in chat (`/fix`, `/explain`, `/test`)
- `#66` auto-reconnect orchestrator — already wired; verify
- `#94` explorer drag and drop (needs Perry drag-event FFI)

### 4c. Remaining P2 work (mostly tractable)

Smaller wins that haven't been touched:

- `#74` word-wrap modes (`native/word-wrap.ts` exists but isn't wired to Rust)
- `#75` whitespace rendering (boundary/all/selection)
- `#76` render control characters
- `#77` line numbers relative/interval modes — needs Rust edit in
  `hone-editor/native/macos/src/editor_view.rs` gutter draw
- `#78` vertical rulers
- `#79` smooth scrolling — needs Rust animation in editor_view
- `#85` timeline / local history view
- `#94` explorer drag and drop (also blocks structural work)
- `#106` image input in chat
- `#107` inline "Fix with AI" / "Explain" lightbulb

---

## 5 · Windows-specific gotchas

The previous agent shipped a lot of macOS-specific code paths. **Do not break
them** — the macOS build still has to work — but watch for these when you add
new platform-touching code:

1. **AppleScript prompts.** Several places use `spawnSync('osascript', ['-e', script])`
   for native dialogs: `render.ts::promptForRename`, `promptCloseDirtyTab`,
   `chat-panel.ts::promptForSessionTitle`. These are Mac-only. If you add a
   prompt that needs to work cross-platform, gate it on `__platform__`:

   ```ts
   declare const __platform__: number; // 0=macOS, 1=iOS, 3=Windows, 4=Linux
   if (__platform__ === 3) {
     // Windows: use PowerShell or a Perry-native prompt widget
   } else if (__platform__ === 0) {
     spawnSync('osascript', ['-e', script]);
   }
   ```

   Perry exposes `Alert(title, message, buttons)` via `perry/ui` — prefer that
   over shelling out, even on Mac, for new code.

2. **Clipboard.** Use `clipboardWrite(text)` and `clipboardRead()` from
   `perry/ui` — they handle pbpaste/clip.exe/xclip per platform. Never call
   `pbcopy` directly. The status-bar context menu has the correct pattern.

3. **`git` is always argv'd.** Every `spawnSync('git', ['-C', wsRoot, …])`
   call in this codebase is argv-form, never a shell string. SHIP-V1-GAPS #1
   closed this for a reason — don't reintroduce string concat.

4. **Path separators.** `path.join` from `'path'` handles `/` vs `\` for you.
   Anywhere you see `'/'` hard-coded as a separator (e.g. `crashPath += '/crash.log'`
   in telemetry), that's macOS-biased — fine for `~/.hone/` paths Perry
   normalizes, but be cautious in new code.

5. **Perry build profile.** Windows builds via
   `cd ../perry/perry && cargo build --release -p perry-ui-windows`. Skip the
   `CARGO_PROFILE_RELEASE_LTO=off` flag — that's a macOS-clang requirement
   only. The hone-ide CLAUDE.md has the full command list.

---

## 6 · Build + verify

```sh
# Type-check IDE
cd /path/to/hone-ide && bun run typecheck

# Compile for Windows
cd /path/to/hone-ide
perry compile src/app.ts --target windows --output hone-ide
mv hone-ide hone-ide.exe   # Perry doesn't add .exe

# Run
./hone-ide.exe
```

When you change `hone-editor` source, the IDE picks it up via the
`@honeide/editor` workspace dependency — no separate build step. When you
change `hone-core`, same.

When you change Rust in `hone-editor/native/macos/` or any
`../perry/perry/crates/perry-ui-*`, rebuild that crate before recompiling:

```sh
cd /path/to/perry/perry
cargo build --release -p perry-ui-windows
```

---

## 7 · Commit + push protocol

Wait for the user to explicitly request commits. **Don't auto-commit per
iteration** — let the work pile up and ship one descriptive commit per
package at the end of the session.

When the user says "commit and push":

1. `cd` into each package, run `git status --short`.
2. Stage **only the source files you changed** — never `git add .`. The
   previous round left a lot of stray Perry build artifacts (`HoneIDE`,
   `__perry_js_bundle.js`, `paths`, `render`, `settings`, etc.) sitting in
   the working tree; don't pull them into commits.
3. Use a HEREDOC for the commit message so multi-line formatting survives:

   ```sh
   git commit -m "$(cat <<'EOF'
   feat: <one-line summary>

   <bullet list of SHIP-V1-GAPS.md entries closed>
   EOF
   )"
   ```

4. `git push origin main`.

The four repos are independent — no submodules, no monorepo tooling. Push
each one separately.

---

## 8 · Things to NEVER do

- **Don't edit Perry's Rust code** unless the gap explicitly requires it
  (#64/#65/#67/#68/#69 in `perry-ui-ios`). Everything else lives in
  `hone-editor/native/*` or the package TypeScript.
- **Don't add `--no-verify`** to commits to skip hooks. If a hook fails,
  read the output and fix the underlying issue.
- **Don't `git add .`** — see §7. The working tree has untracked artifacts
  that should stay untracked.
- **Don't commit `.env`, secrets, or `~/.hone/` content.** The crash-log
  pipeline (#117) reads from `~/.hone/crash.log`; that file is per-user
  state, never source.
- **Don't claim a gap is "done" without the `Done:` sentence.** If you
  closed it in this iteration, append the sentence to the entry. If you
  verified-existing-implementation, say so explicitly so the next agent
  doesn't redo the work.

---

## 9 · Where to ask if you're stuck

The user is the final authority on scope. When in doubt:

- Decision-class question (which approach? include this in v1?) → ask first.
- Implementation-class question (how does this file work?) → read the file,
  then act. Don't ask the user to summarize their own code.
- Build failure → diagnose root cause, don't just "make it pass" by
  commenting out the failing assertion.

Good luck. The loop pattern works — pick small entries, write the `Done:`
sentence, and the punch list shrinks one iteration at a time.
