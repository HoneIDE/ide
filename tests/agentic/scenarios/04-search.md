# Scenario: Project Search
Category: search
Depends on: 01-startup

> See `tests/agentic/API.md` for the full endpoint reference.

## Goal
Verify the search panel opens, accepts a query, shows results grouped by file, and clicking a result opens the file.

## Steps

1. **Switch to Search panel**: Find the Search icon in the activity bar (2nd icon button) and click it.
   `curl -s -X POST http://127.0.0.1:7676/click/{handle}`

2. **Screenshot — search panel visible**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/04-search-panel.png`
   Read the screenshot. EVALUATE: Is a search panel visible in the sidebar with a text input field?

3. **Type search query**: Find the search text field in widgets (widget_type containing "text" or "field").
   Type "function" into it:
   `curl -s -X POST http://127.0.0.1:7676/type/{handle} -d "function"`

4. **Wait for results**: `sleep 2`

5. **Screenshot — search results**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/04-search-results.png`
   Read the screenshot. EVALUATE: Are search results shown? Results should be grouped by file with matching lines displayed.

6. **Scroll results if needed**: If the results list is long and you need to see more entries,
   scroll the sidebar area using the external CLI server:
   `curl -s -X POST http://127.0.0.1:7677/scroll -H 'Content-Type: application/json' -d '{"x":150,"y":400,"deltaY":-3}'`
   (Adjust x/y to target the sidebar area. Use port 7677 for OS-level scroll events.)

7. **Click a result**: Find a search result entry in widgets and click it.

8. **Screenshot — file opened from search**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/04-search-navigate.png`
   Read the screenshot. EVALUATE: Did clicking the result open the file in the editor?

## Evaluation Criteria

- Search panel has a text input field at the top
- Typing a query produces results (the word "function" appears in main.ts, utils.ts, server.py)
- Results are grouped by file name
- Each result shows the matching line content or a preview
- A result count or badge may be visible
- Clicking a result opens the corresponding file in the editor
- Case toggle button may be present

## Geisterhand API (Dual-Port)

**Port 7676 (baked-in)** — widget clicks, text input, screenshots:
- `GET /widgets` → list widgets
- `POST /click/{handle}` → click a widget
- `POST /type/{handle}` body=text → type into a text field
- `GET /screenshot` → PNG image

**Port 7677 (external CLI)** — scrolling:
- `POST /scroll` body=`{"x":150,"y":400,"deltaY":-3}` → scroll at coordinates

## Report Format
```
RESULT: PASS or FAIL
DETAILS:
- Search panel visible: [ok/issue]
- Text input works: [ok/issue]
- Results shown: [ok/issue]
- Results grouped by file: [ok/issue]
- Click navigates to file: [ok/issue]
- Overall: [summary]
```
