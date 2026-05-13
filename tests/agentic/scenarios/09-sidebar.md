# Scenario: Sidebar Toggle & Panel Switching
Category: sidebar
Depends on: 01-startup

> See `tests/agentic/API.md` for the full endpoint reference.

## Goal
Verify the sidebar can be hidden and shown, and that clicking different activity bar icons switches the sidebar content between panels (Files, Search, Git, etc.).

## Steps

1. **Screenshot — sidebar visible (initial state)**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/09-sidebar-visible.png`
   Read the screenshot. Note the sidebar width and content.

2. **Switch to Search panel**: Click the Search icon (2nd activity bar button).
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/09-sidebar-search.png`
   Read the screenshot. EVALUATE: Did the sidebar content change to show a search panel?

3. **Switch to Git panel**: Click the Git icon (3rd activity bar button).
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/09-sidebar-git.png`
   Read the screenshot. EVALUATE: Did the sidebar content change to show git/source control?

4. **Switch back to Files**: Click the Files icon (1st activity bar button).
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/09-sidebar-files.png`
   Read the screenshot. EVALUATE: Is the file explorer back?

5. **Toggle sidebar off**: Use the keyboard shortcut via port 7677:
   `curl -s -X POST http://127.0.0.1:7677/key -H 'Content-Type: application/json' -d '{"key":"b","modifiers":["cmd"]}'`
   Alternatively, click the same Files icon again via port 7676 (clicking the active panel icon should hide the sidebar).
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/09-sidebar-hidden.png`
   Read the screenshot. EVALUATE: Is the sidebar hidden? The editor area should expand to fill the extra space. The activity bar should still be visible.

6. **Toggle sidebar back on**: Use the keyboard shortcut again:
   `curl -s -X POST http://127.0.0.1:7677/key -H 'Content-Type: application/json' -d '{"key":"b","modifiers":["cmd"]}'`
   Or click the Files icon via port 7676.
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/09-sidebar-restored.png`
   Read the screenshot. EVALUATE: Is the sidebar restored to its previous width with the file explorer?

## Evaluation Criteria

- **Panel switching**: Each activity bar icon shows different sidebar content:
  - Files: file tree / explorer
  - Search: search input + results area
  - Git: commit field + changed files
- **Sidebar hide**: Editor expands to fill the space; activity bar stays visible
- **Sidebar show**: Sidebar returns at correct width with correct panel content
- **Smooth transitions**: No visual glitches, no overlapping content
- **Active indicator**: The active activity bar icon may have a visual indicator (highlight, border)

## Geisterhand API (Dual-Port)

**Port 7676 (baked-in)** — widget clicks, screenshots:
- `GET /widgets` → list widgets
- `POST /click/{handle}` → click a widget
- `GET /screenshot` → PNG image

**Port 7677 (external CLI)** — keyboard shortcuts:
- `POST /key` body=`{"key":"b","modifiers":["cmd"]}` → toggle sidebar (Cmd+B)

## Report Format
```
RESULT: PASS or FAIL
DETAILS:
- Panel switching (Files→Search→Git→Files): [ok/issue]
- Sidebar hide: [ok/issue]
- Sidebar restore: [ok/issue]
- Activity bar always visible: [ok/issue]
- Overall: [summary]
```
