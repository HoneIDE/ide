# Hone IDE — MVP Checklist

> **Goal**: Every visible UI element works. No dead buttons. No placeholder panels.

## How to use this checklist

**This file is the master template. Do not fill in checkboxes here.**

To run a test pass:

```bash
# Create a timestamped test run
cp MVP-CHECKLIST.md "test-runs/run-$(date +%Y%m%d-%H%M).md"
```

Agents and humans fill in checkboxes in the run copy:
- `[x]` — passes
- `[!]` — **fails** (add a one-line note: `[!] Cmd+B — sidebar doesn't reappear after hide`)
- `[~]` — skipped (blocked by another failing item)

After fixing `[!]` items, start a fresh run from this template. The final shipping gate is a clean run where every item is `[x]`.

**Section A** (🤖) — agent-testable via `geisterhand run` HTTP API. Multiple agents can work different sections in parallel.
**Section B** (👤) — requires human judgment (visual quality, feel, multi-device).

---

## How to test (geisterhand run — macOS)

### Setup — start the server (once, keeps running)

```bash
# Build
cd hone-ide && perry compile src/app.ts --output hone-ide

# Launch hone-ide with a dedicated geisterhand server (port 7677)
# This must run as a long-lived process — use run_in_background or a dedicated terminal.
# Do NOT background with & inside a shell that will exit.
geisterhand run /full/path/to/hone-ide/hone-ide --port 7677
```

The server binds to `http://127.0.0.1:7677`. All agents share this one server.

### API reference

```bash
# Health check — verify app is running
curl -s http://127.0.0.1:7677/status

# Screenshot — save to file or inspect visually
curl -s http://127.0.0.1:7677/screenshot --output /tmp/shot.png

# Screenshot — base64 to stdout (for inline inspection)
curl -s 'http://127.0.0.1:7677/screenshot?base64=true'

# Accessibility tree — see all UI elements with roles, titles, labels, frames
curl -s 'http://127.0.0.1:7677/accessibility/tree?format=compact'

# Find elements by role/title/label
curl -s 'http://127.0.0.1:7677/accessibility/elements?role=AXButton'
curl -s 'http://127.0.0.1:7677/accessibility/elements?role=AXStaticText&label=EXPLORER'

# Get focused element
curl -s http://127.0.0.1:7677/accessibility/focused

# Get menu structure
curl -s http://127.0.0.1:7677/menu

# --- Actions ---

# Click at coordinates (from accessibility tree frames)
curl -s -X POST http://127.0.0.1:7677/click \
  -H 'Content-Type: application/json' \
  -d '{"x": 100, "y": 200}'

# Click element by title/role/label (preferred over coordinates)
curl -s -X POST http://127.0.0.1:7677/click/element \
  -H 'Content-Type: application/json' \
  -d '{"title": "Chat"}'

curl -s -X POST http://127.0.0.1:7677/click/element \
  -H 'Content-Type: application/json' \
  -d '{"role": "AXButton", "title": "Send"}'

# Press key with modifiers
curl -s -X POST http://127.0.0.1:7677/key \
  -H 'Content-Type: application/json' \
  -d '{"key": "s", "modifiers": ["command"]}'

curl -s -X POST http://127.0.0.1:7677/key \
  -H 'Content-Type: application/json' \
  -d '{"key": "s", "modifiers": ["command", "shift"]}'

# Type text into focused field
curl -s -X POST http://127.0.0.1:7677/type \
  -H 'Content-Type: application/json' \
  -d '{"text": "hello world"}'

# Scroll at position
curl -s -X POST http://127.0.0.1:7677/scroll \
  -H 'Content-Type: application/json' \
  -d '{"x": 500, "y": 400, "deltaY": -3}'

# Wait for element to appear
curl -s -X POST http://127.0.0.1:7677/wait \
  -H 'Content-Type: application/json' \
  -d '{"role": "AXStaticText", "label": "EXPLORER", "timeout": 5}'
```

### Testing pattern for agents

```bash
# 1. Verify server is up
curl -s http://127.0.0.1:7677/status | jq .status

# 2. Take a "before" screenshot
curl -s http://127.0.0.1:7677/screenshot --output /tmp/before.png

# 3. Perform action (click, key, type)
curl -s -X POST http://127.0.0.1:7677/key \
  -H 'Content-Type: application/json' \
  -d '{"key": "j", "modifiers": ["command"]}'

# 4. Wait a moment for UI to update
sleep 0.5

# 5. Check result via accessibility tree or screenshot
curl -s 'http://127.0.0.1:7677/accessibility/elements?role=AXStaticText&label=TERMINAL'
curl -s http://127.0.0.1:7677/screenshot --output /tmp/after.png

# 6. Compare / verify
```

### Important notes for agents

- **Do NOT launch geisterhand run with `&` in a shell that will exit.** Use `run_in_background: true` or a dedicated long-lived terminal. If the parent shell dies, geisterhand dies, and hone-ide dies with it.
- **Add `sleep 0.3` to `sleep 1` between actions.** Perry defers UI mutations via setTimeout — rapid-fire clicks can hit before the UI updates.
- **Use `/accessibility/elements` to find coordinates.** The `frame` field gives `{x, y, width, height}`. Click at `x + width/2, y + height/2` to hit center.
- **Use `/click/element` when possible** — it's more reliable than coordinate clicking.
- **Screenshot after each action** to verify visually.
- **Coordinates are screen-absolute** (not window-relative). They include the display offset.

---

## A. AGENT-TESTABLE (🤖 geisterhand HTTP API)

### A1. Activity Bar — 4 icons + gear

- [ ] **Files icon** (1st) is visible — find via `accessibility/elements?role=AXButton` (path [0,0])
- [ ] Clicking Files icon shows file explorer — verify `accessibility/elements?label=EXPLORER` returns a result
- [ ] **Search icon** (2nd) is visible — click it, verify `accessibility/elements?label=SEARCH` appears
- [ ] **Git icon** (3rd) is visible — click it, verify `accessibility/elements?label=SOURCE+CONTROL` appears
- [ ] **AI Chat icon** (4th) is visible — click it, verify right panel opens (Chat/Agent/Plan buttons appear)
- [ ] **Settings gear** (bottom of activity bar) — click it, verify `accessibility/elements?label=SETTINGS` appears
- [ ] **No 5th icon** — screenshot the activity bar area, only 4 icons above the gear
- [ ] **Active indicator** — screenshot shows white bar next to active icon

### A2. File Explorer

- [ ] **"EXPLORER" label** — `accessibility/elements?label=EXPLORER` returns a result
- [ ] **"FOLDERS" label** — `accessibility/elements?label=FOLDERS` returns a result
- [ ] **File tree populated** — buttons with file/folder names visible in accessibility tree
- [ ] **Directory expand/collapse** — click a folder chevron button, children appear/disappear
- [ ] **File click** — click a file button (e.g., one with title ending in `.ts`), verify a tab appears
- [ ] **"New File" icon button** — find and click it, verify "Untitled" tab appears
- [ ] **"Collapse All" icon button** — click it, verify tree collapses (fewer elements in sidebar)
- [ ] **Nested expansion** — expand folder A, expand folder B inside A, screenshot shows both expanded

### A3. Editor & Tabs

- [ ] **Tab appears** — after opening a file, `accessibility/elements?role=AXButton&title=app.ts` exists
- [ ] **Tab click** — open 2 files, click first tab, verify breadcrumb updates to first file
- [ ] **Tab close** — find and click the close (X) button on a tab, verify tab disappears from tree
- [ ] **Multiple tabs** — open 3 files, verify 3 tab buttons exist in accessibility tree
- [ ] **Breadcrumb** — `accessibility/elements?role=AXStaticText` includes filename text below tabs

### A4. Status Bar

- [ ] **Branch name** — `accessibility/elements?role=AXStaticText&label=main` (or current branch) exists
- [ ] **Cursor position** — a label matching `Ln *` pattern exists in status bar area
- [ ] **Language label** — `accessibility/elements?role=AXStaticText&label=TypeScript` exists (after opening .ts)
- [ ] **Encoding** — label "UTF-8" exists
- [ ] **Line endings** — label "LF" exists

### A5. Search Panel

- [ ] Click Search activity icon → `accessibility/elements?label=SEARCH` appears
- [ ] **Search field** — a text field exists in the sidebar area
- [ ] **Type a query** — focus the search field, type "import", verify results appear (new buttons/text)
- [ ] **Result count** — a label with "results" text appears
- [ ] **Click a result** — click a result button, verify a new tab opens
- [ ] **Case toggle** — find "Aa" button, click it
- [ ] **Replace toggle** — find "Replace" button, click it, verify replace field appears
- [ ] **Replace All** — type replacement text, click "Replace All", verify results update

### A6. Git Panel

- [ ] Click Git activity icon → `accessibility/elements?label=SOURCE+CONTROL` appears
- [ ] **Branch name** visible in sidebar
- [ ] **Commit message field** — a text field exists
- [ ] **Commit button** — `accessibility/elements?role=AXButton&title=Commit` exists
- [ ] **Refresh button** — `accessibility/elements?role=AXButton&title=Refresh` exists
- [ ] **Stage/unstage/discard buttons** — if changes exist, `+`, `-`, `x` buttons appear
- [ ] **File click** — clicking a changed file name opens it in editor or diff view

### A7. Terminal Panel

- [ ] **Cmd+J** — `POST /key {"key":"j","modifiers":["command"]}` → terminal panel appears
- [ ] **PROBLEMS tab** — `accessibility/elements?role=AXButton&title=PROBLEMS` exists
- [ ] **TERMINAL tab** — `accessibility/elements?role=AXButton&title=TERMINAL` exists
- [ ] **Only 2 tabs** — no "OUTPUT" or "DEBUG CONSOLE" buttons in the header area
- [ ] **Close button** — click xmark button in terminal header, verify panel hides
- [ ] **Cmd+J again** — panel reappears
- [ ] **Click PROBLEMS tab** — verify tab switches (take screenshot, compare)
- [ ] **Click TERMINAL tab** — verify terminal view returns

### A8. Menu Bar — File

- [ ] **Cmd+N** → `POST /key {"key":"n","modifiers":["command"]}` → "Untitled" tab appears
- [ ] **Cmd+S** → make an edit first, then `POST /key {"key":"s","modifiers":["command"]}` → file saved
- [ ] **Cmd+Shift+S** → `POST /key {"key":"s","modifiers":["command","shift"]}` → save dialog appears
- [ ] **Cmd+,** → `POST /key {"key":",","modifiers":["command"]}` → settings panel appears

### A9. Menu Bar — Edit

- [ ] **Cmd+F** → `POST /key {"key":"f","modifiers":["command"]}` → search panel opens in sidebar
- [ ] **Cmd+H** → `POST /key {"key":"h","modifiers":["command"]}` → search panel opens (same as Cmd+F)

### A10. Menu Bar — View

- [ ] **Cmd+B** → `POST /key {"key":"b","modifiers":["command"]}` → sidebar hides; again → sidebar shows
- [ ] **Cmd+J** → `POST /key {"key":"j","modifiers":["command"]}` → terminal toggles
- [ ] **Zoom In** — check settings `editorFontSize` before, trigger zoom in, verify it increased
- [ ] **Zoom Out** — verify `editorFontSize` decreased
- [ ] **Reset Zoom** — verify `editorFontSize` is 13

### A11. Menu Bar — Go

- [ ] **Cmd+P** → `POST /key {"key":"p","modifiers":["command"]}` → "GO TO FILE" label appears
- [ ] **File finder** — type a filename, verify filtered list appears (buttons with matching names)
- [ ] **Click a file result** — verify file opens in editor, sidebar returns to explorer
- [ ] **Cmd+G** → `POST /key {"key":"g","modifiers":["command"]}` → "GO TO LINE" label appears
- [ ] **Enter line number** — type "10", click "Go" button, verify cursor moved (status bar shows "Ln 10")

### A12. Menu Bar — Help

- [ ] **Help > About Hone** — trigger via menu, verify notification toast appears (label "Hone IDE v0.1.0")
- [ ] **Help > Welcome** — trigger via menu, verify "Hone IDE" title appears in editor area
- [ ] **Help > Documentation** — trigger via menu, verify browser opens (check via `ps aux | grep -i browser`)

### A13. Settings Panel

- [ ] Click Settings gear → "SETTINGS" label appears
- [ ] **Theme toggle** — find button with title "Hone Dark" or "Hone Light", click it, screenshot shows color change
- [ ] **Sidebar Location** — find "Left"/"Right" button, click it, screenshot shows sidebar moved
- [ ] **Font Size +/-** — find "+" button near font size, click it, verify value label increases
- [ ] **Tab Size +/-** — find "+" button near tab size, click it, verify value label increases
- [ ] **Line Numbers** — find "On"/"Off"/"Relative" button, click it, verify it cycles

### A14. Notifications

- [ ] Trigger Help > About → notification toast appears in accessibility tree
- [ ] **Auto-dismiss** — wait 4 seconds, verify notification is gone from accessibility tree

### A15. Welcome Tab

- [ ] Trigger Help > Welcome → "Hone IDE" label appears in editor area
- [ ] **"Open Folder" button** exists — `accessibility/elements?role=AXButton&title=Open+Folder`
- [ ] **"Open File" button** exists
- [ ] **"New File" button** exists
- [ ] **Tips text** — labels for "Cmd+P", "Cmd+B" exist

### A16. Keyboard Shortcuts (integration)

- [ ] **Cmd+N** → new tab appears
- [ ] **Cmd+S** → no crash (save current file)
- [ ] **Cmd+Shift+S** → save dialog appears (dismiss with Escape key)
- [ ] **Cmd+B** → sidebar hides, Cmd+B again → sidebar shows
- [ ] **Cmd+J** → terminal shows, Cmd+J again → terminal hides
- [ ] **Cmd+F** → search panel opens
- [ ] **Cmd+H** → search panel opens
- [ ] **Cmd+P** → file finder opens
- [ ] **Cmd+G** → go to line panel opens
- [ ] **Cmd+,** → settings panel opens

### A17. AI Chat Session History

- [ ] Click AI Chat icon → verify "History" and "+ New" buttons exist via `accessibility/elements?role=AXButton&title=History`
- [ ] Click "+ New" → verify `accessibility/elements?role=AXButton&title=+ New` creates a new session
- [ ] Click "History" → session list appears (new buttons visible in accessibility tree)
- [ ] Click "History" again → session list hides
- [ ] Send a message → verify `~/.hone/chats/index.txt` has a session entry with auto-generated title
- [ ] Send a message → verify `~/.hone/chats/<id>.txt` message file exists
- [ ] Click "+ New" twice → verify 2 new sessions in list (check accessibility tree for multiple session buttons)
- [ ] Click a non-active session button → messages update (different content in chat area)
- [ ] Mode tabs (Chat/Agent/Plan) still visible alongside History/+ New

### A18. Core Tests

- [ ] `cd hone-core && bun test` — all 819+ tests pass, 0 failures

### A19. Relay Server

- [ ] **Health check** — `curl https://sync.hone.codes/health` returns `{"status":"ok",...}`
- [ ] **WebSocket connects** — `wss://sync.hone.codes/ws` accepts connections
- [ ] **Join protocol** — first message `{"type":"join","room":"...","device":"..."}` accepted
- [ ] **Rate limiting** — >100 msgs/sec from one IP gets throttled

### A20. Relay Tests

- [ ] `cd hone-relay && bun test` — all 48 tests pass, 0 failures

---

## B. HUMAN-ONLY TESTING (👤)

These require visual judgment, subjective quality assessment, or interactions that geisterhand can't reliably verify.

### B1. Visual Quality

- [ ] **Overall layout** looks correct — activity bar | sidebar | editor | (right panel) — no overlapping, no gaps
- [ ] **Colors are consistent** — dark theme looks cohesive, no random white/bright elements
- [ ] **Light theme** — switch to light theme, verify all panels recolor properly, text is readable
- [ ] **Font rendering** — editor text is crisp, monospace, no garbled characters
- [ ] **Icon rendering** — SF Symbols render at correct size, not pixelated or clipped
- [ ] **Scroll behavior** — file explorer scrolls smoothly with many files
- [ ] **Window resize** — resizing the window keeps layout intact, editor fills available space

### B2. Editor Experience

- [ ] **Typing feels responsive** — no visible lag when typing fast
- [ ] **Syntax highlighting** — keywords, strings, comments are colored differently for .ts files
- [ ] **Cursor movement** — arrow keys, Home/End, Cmd+Left/Right work as expected
- [ ] **Selection** — Shift+arrow keys selects text, Cmd+A selects all
- [ ] **Scrolling** — mouse wheel / trackpad scrolls the editor content smoothly
- [ ] **Large files** — open a 500+ line file, scrolling and editing remain smooth
- [ ] **Line numbers** — visible by default, aligned with editor content

### B3. AI Chat Experience

- [ ] **API key hint** — when no ANTHROPIC_API_KEY is set, chat panel shows setup instructions on open
- [ ] **With API key** — set ANTHROPIC_API_KEY, send a message, verify streaming response appears
- [ ] **Multi-turn** — send 2-3 messages, context is maintained
- [ ] **Chat mode** — simple Q&A works
- [ ] **Agent mode** — agent uses tools (file_read, search, etc.), approval dialog appears for destructive tools
- [ ] **Plan mode** — generates a plan response (read-only tools)
- [ ] **+ New button** — creates a new chat session, clears messages
- [ ] **+ File button** — attaches current file as context chip
- [ ] **Streaming indicator** — "Thinking..." animation shows during API calls
- [ ] **Markdown rendering** — code blocks, headers, bullets render distinctly
- [ ] **History button** — toggles session list panel (collapsible, max 180px)
- [ ] **Session list** — shows past sessions with mode badge (C/A/P), title, and delete button
- [ ] **Session switching** — click a session in the list, messages load correctly
- [ ] **Session switching blocked during streaming** — can't switch while AI is responding
- [ ] **Auto-titling** — first user message auto-generates session title (first 40 chars)
- [ ] **Active session highlight** — current session has darker background in list
- [ ] **Session delete** — click X on a session, it's removed from list and disk
- [ ] **Delete active session** — deleting active session switches to most recent remaining
- [ ] **Session persistence** — quit and relaunch, sessions persist in `~/.hone/chats/`
- [ ] **Mode persistence** — switch to Agent mode, quit, relaunch, session restores in Agent mode
- [ ] **Empty first launch** — no `~/.hone/chats/` dir, app creates it and starts a fresh session

### B4. Terminal Experience

- [ ] **Shell is interactive** — can run `ls`, `git status`, `echo hello`
- [ ] **Command output** — output appears correctly, multi-line output wraps
- [ ] **Terminal colors** — colored output (e.g., `ls --color`) renders with colors
- [ ] **Ctrl+C** — interrupts a running command
- [ ] **Tab completion** — pressing Tab completes file/command names

### B5. Git Workflow (end-to-end)

- [ ] Open a git repo with uncommitted changes
- [ ] Verify modified files appear in Changes section
- [ ] Stage a file, verify it moves to Staged section
- [ ] Enter a commit message and commit
- [ ] Verify the commit succeeded (file disappears from staged, `git log` shows it)
- [ ] View diff for a modified file — changes are correctly highlighted

### B6. Search & Replace Workflow (end-to-end)

- [ ] Search for a string that exists in multiple files
- [ ] Click a result — correct file opens at the right location
- [ ] Enable replace, replace one occurrence — file updates correctly
- [ ] Replace all — all occurrences across files are replaced

### B7. File Operations Workflow

- [ ] **New File** → type content → **Save As** to a new path → close → reopen → content persists
- [ ] **Open Folder** → tree populates → open a file → edit → **Save** → reopen → edits persisted
- [ ] **Open deep nested file** — breadcrumb shows folder > filename correctly
- [ ] **Close all tabs** — editor area is empty (or shows welcome)

### B8. Settings Persistence

- [ ] Change theme to Light → quit app → relaunch → theme is still Light
- [ ] Change font size to 16 → quit → relaunch → font size is still 16
- [ ] Move sidebar to right → quit → relaunch → sidebar is on the right
- [ ] Open a folder → quit → relaunch → last opened folder is restored

### B9. Edge Cases

- [ ] **No workspace** — launch without a folder open. Explorer shows "Open Folder" button, not a crash
- [ ] **Binary file** — open a .png or compiled file. App doesn't crash (may show garbled text, that's OK)
- [ ] **Very long filename** — tab doesn't overflow or break layout
- [ ] **Empty file** — open an empty file. Editor shows empty content, no crash
- [ ] **Permission denied** — try to save to a read-only location. Should fail gracefully (no crash)
- [ ] **Rapid switching** — click activity bar icons rapidly (Files→Search→Git→Files). No crash or visual glitch

### B10. Known Placeholders (verify they don't crash)

- [ ] **Go > Go to Symbol** — should be a no-op, no crash
- [ ] **Explorer > "⋯" button** — no-op, no crash
- [ ] **Explorer > "New Folder" icon** — no-op, no crash
- [ ] **Explorer > OUTLINE section** — collapsed placeholder, no crash on click
- [ ] **Explorer > TIMELINE section** — collapsed placeholder, no crash on click
- [ ] **Terminal > Maximize button** — no-op, no crash
- [ ] **Status bar > Branch icon** — clickable but no-op, no crash

### B11. Sync: QR Pairing Flow (Two Devices)

#### QR Code Display (Mac)
- [ ] Open Hone on Mac, go to Sync panel in sidebar
- [ ] Click "Pair Device" → QR code appears (180×180, crisp pixels)
- [ ] 6-char text code visible below QR as fallback
- [ ] Status shows "Waiting for connection..."
- [ ] QR encodes correct `hone://pair?relay=...&room=...&code=...` URL
- [ ] Generating a new code updates both QR and text code
- [ ] Code expires after 5 minutes (QR disappears, status resets)

#### Pairing
- [ ] Mac shows QR code
- [ ] iPhone/iPad scans QR → auto-fills relay URL, room ID, pairing code
- [ ] Phone sends pairing request through relay
- [ ] Mac validates code, issues device token
- [ ] Phone receives token, stores in `~/.hone/sync-connection.ini`
- [ ] Both devices show "connected" status
- [ ] QR code hides after successful pairing
- [ ] Device appears in Connected Devices list with green dot

#### Fallback: Manual Code Entry
- [ ] Phone can manually type the 6-char code (when camera unavailable)
- [ ] Case-insensitive (lowercase input works)
- [ ] Wrong code shows error
- [ ] Expired code shows error

#### Auto-Reconnect
- [ ] Kill phone app, reopen → reconnects automatically (no re-pairing)
- [ ] Connection info persisted in `~/.hone/sync-connection.ini`
- [ ] Exponential backoff on failed reconnects (1s → 2s → 4s → ... → 30s cap)
- [ ] Max 10 reconnect attempts before stopping
- [ ] `clearStoredConnection()` wipes stored credentials (unpair)

### B12. Sync: Message Routing

- [ ] Guest → Host: envelope with `"to":"host"` reaches desktop
- [ ] Host → Guest: envelope with `"to":"<device-id>"` reaches phone
- [ ] Broadcast: `"to":"broadcast"` reaches all other devices in room
- [ ] Sender mismatch rejected (can't spoof `from` field)
- [ ] Room mismatch rejected
- [ ] Offline buffering: messages held for 60s when target disconnects
- [ ] Buffered messages delivered on reconnect

### B13. Sync: Changes Queue (Review Flow)

- [ ] AI on phone proposes file change → appears in Mac's review queue
- [ ] Accept → file modified in working tree
- [ ] Reject → proposal discarded
- [ ] Accept All / Reject All batch operations
- [ ] Group review: related proposals shown together, accept/reject as group
- [ ] Undo accepted proposal → reverse diff applied
- [ ] Undo conflict: shows "Keep Current" / "Force Revert" / "Skip" options

### B14. Sync: Trust Settings

- [ ] Per-device trust level: Review / Auto (clean) / Auto (all) / Block
- [ ] Default trust level configurable
- [ ] Cycling through levels works
- [ ] "Block" silently rejects all proposals from that source
- [ ] "Auto (clean)" auto-accepts if diff applies without conflicts

### B15. Sync: Offline Mode (Guest)

- [ ] Compose changes while host is offline → queued locally
- [ ] On reconnect → queued changes flushed to host
- [ ] Queue cap: 100 messages max
- [ ] `sendOrQueue()` routes correctly based on connection state

### B16. Sync: Security

- [ ] Room IDs are random UUIDs (not derived from device identity)
- [ ] Pairing codes single-use (can't be reused after pairing)
- [ ] Device tokens signed (tampered tokens rejected)
- [ ] Relay sees only encrypted blobs (once E2E is wired)
- [ ] No user accounts, no PII stored on relay

### B17. Cross-Platform

- [ ] macOS: QR code renders via CIFilter, pairing works
- [ ] iOS: QR code scanning (camera), pairing flow, auto-reconnect
- [ ] iOS: connection persisted in Documents dir (not /tmp)

---

## C. FINAL SIGN-OFF

> Only fill this in on the **final clean run** — the one intended to ship.

- [ ] All Section A items are `[x]` (agent-verified)
- [ ] All Section B items are `[x]` (human-verified)
- [ ] Zero `[!]` items remain
- [ ] Binary size is reasonable (< 10MB)
- [ ] App launches without errors in Console.app
- [ ] No crash after 5 minutes of normal use
- [ ] Run file committed as `test-runs/final-YYYYMMDD.md`
