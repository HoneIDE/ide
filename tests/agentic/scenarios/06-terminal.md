# Scenario: Integrated Terminal
Category: terminal
Depends on: 01-startup

> See `tests/agentic/API.md` for the full endpoint reference.

## Goal
Verify the terminal panel can be toggled on and appears as a real terminal emulator at the bottom of the window.

## Steps

1. **Screenshot — before terminal**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/06-terminal-before.png`
   Read the screenshot. Note the current layout — editor should fill most of the vertical space.

2. **Toggle the terminal panel**: The quickest way is via keyboard shortcut on port 7677:
   `curl -s -X POST http://127.0.0.1:7677/key -H 'Content-Type: application/json' -d '{"key":"j","modifiers":["cmd"]}'`

   Alternatively, run `curl -s http://127.0.0.1:7676/widgets` and look for a toggle widget
   (a button in the status bar or a panel tab labeled "Terminal") and click it via port 7676.

3. **Screenshot — terminal visible**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/06-terminal-open.png`
   Read the screenshot. EVALUATE: Is a terminal panel visible at the bottom?

4. **Evaluate terminal appearance**:
   - Does it look like a real terminal emulator? (dark background, monospace text)
   - Is there a shell prompt visible (e.g., `$` or `%` or username)?
   - Does the terminal panel split the view (editor still visible above)?
   - Are there panel tab labels (TERMINAL, PROBLEMS, etc.)?

## Evaluation Criteria

- Terminal panel appears at the bottom portion of the window
- Editor area shrinks but remains visible above the terminal
- Terminal has a dark background (possibly darker than the editor area)
- A command prompt or shell indicator is visible
- Terminal area looks like it could accept keyboard input
- Panel tabs or header bar visible above the terminal content
- The split between editor and terminal looks reasonable (terminal ~30-40% of height)

## Geisterhand API (Dual-Port)

**Port 7676 (baked-in)** — widget clicks, screenshots:
- `GET /widgets` → list widgets
- `POST /click/{handle}` → click a widget
- `GET /screenshot` → PNG image

**Port 7677 (external CLI)** — keyboard shortcuts:
- `POST /key` body=`{"key":"j","modifiers":["cmd"]}` → toggle terminal (Cmd+J)

## Report Format
```
RESULT: PASS or FAIL
DETAILS:
- Terminal toggle found: [ok/issue - describe how]
- Terminal visible: [ok/issue]
- Terminal appearance: [ok/issue]
- Editor still visible: [ok/issue]
- Overall: [summary]
```
