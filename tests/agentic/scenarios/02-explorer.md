# Scenario: File Explorer Navigation
Category: explorer
Depends on: 01-startup

## Goal
Verify the file explorer shows project files, folders expand on click, and clicking a file opens it in the editor.

## Steps

1. **Get widget list**: Run `curl -s http://127.0.0.1:7676/widgets` and save the JSON output.
   Parse the widget list to understand the current UI state.

2. **Activate Files panel**: Find the first icon button in the activity bar (Files icon) and click it:
   `curl -s -X POST http://127.0.0.1:7676/click/{handle}`

3. **Screenshot — file tree visible**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/02-explorer-tree.png`
   Read the screenshot. EVALUATE: Does the sidebar show a file tree with project entries?

4. **Find and expand a folder**: Look through widgets for a button labeled "src" (folder).
   Click it: `curl -s -X POST http://127.0.0.1:7676/click/{handle}`

5. **Screenshot — folder expanded**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/02-explorer-expanded.png`
   Read the screenshot. EVALUATE: Did the "src" folder expand to show child files (main.ts, utils.ts, types.ts, server.py)?

6. **Click a file to open it**: Find a widget for "main.ts" and click it.

7. **Screenshot — file opened in editor**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/02-explorer-file-open.png`
   Read the screenshot. EVALUATE: Did a tab open with "main.ts" showing syntax-highlighted TypeScript code?

## Evaluation Criteria

- File tree shows project root contents: `src/`, `tests/`, `README.md`, `package.json`, etc.
- Folder entries have folder icons (yellow/amber colored)
- File entries have file/document icons
- Clicking a folder expands it to show children (indented below the folder)
- Clicking a file opens a new tab in the editor area
- The editor tab shows the file name
- Editor content shows syntax-highlighted code (keywords in different colors)

## Geisterhand Reference
- `GET /widgets` → `[{handle, widget_type, callback_kind, label}, ...]`
- `POST /click/{handle}` → clicks the widget
- `GET /screenshot` → PNG image

## Report Format
```
RESULT: PASS or FAIL
DETAILS:
- File tree visible: [ok/issue]
- Folder expansion: [ok/issue]
- File open in editor: [ok/issue]
- Syntax highlighting: [ok/issue]
- Overall: [summary]
```
