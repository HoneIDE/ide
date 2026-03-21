# Scenario: Editor Tabs & Content
Category: editor
Depends on: 02-explorer

## Goal
Verify multi-tab behavior: opening multiple files creates tabs, switching tabs changes content, closing a tab removes it.

## Steps

1. **Open first file**: Find "main.ts" in the file explorer widgets and click it.
   Screenshot → verify tab appears.

2. **Open second file**: Find "utils.ts" in the explorer and click it.
   Screenshot → verify 2 tabs visible.

3. **Open third file**: Find "README.md" in the explorer and click it.

4. **Screenshot — 3 tabs**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/03-editor-3tabs.png`
   Read the screenshot. EVALUATE: Are 3 tabs visible (main.ts, utils.ts, README.md)?

5. **Switch tabs**: Click the "main.ts" tab (find it in widgets).

6. **Screenshot — tab switched**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/03-editor-switched.png`
   Read the screenshot. EVALUATE: Is "main.ts" the active tab? Does the editor show TypeScript code (import statements, functions)?

7. **Close a tab**: Find the close button (xmark) associated with one of the tabs and click it.
   The close button is typically a small "x" widget near the tab label.

8. **Screenshot — tab closed**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/03-editor-closed.png`
   Read the screenshot. EVALUATE: Is the closed tab gone? Are 2 tabs remaining?

## Evaluation Criteria

- Multiple tabs are visible in a tab bar above the editor
- Active tab is visually distinct (different background color or underline)
- Switching tabs changes the editor content
- TypeScript files show syntax highlighting (keywords, strings, types in different colors)
- README.md renders differently (as Markdown with heading styles)
- Closing a tab removes it from the tab bar
- After closing, another tab becomes active

## Geisterhand Reference
- `GET /widgets` → list all widgets with handles and labels
- `POST /click/{handle}` → click a widget
- `GET /screenshot` → PNG image

## Report Format
```
RESULT: PASS or FAIL
DETAILS:
- Multiple tabs: [ok/issue]
- Tab switching: [ok/issue]
- Content changes: [ok/issue]
- Tab close: [ok/issue]
- Syntax highlighting: [ok/issue]
- Overall: [summary]
```
