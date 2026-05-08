# Scenario: Full User Workflows
Category: workflows
Depends on: 02-explorer, 05-git

> See `tests/agentic/API.md` for the full endpoint reference.

## Goal
Test realistic multi-step user journeys that combine multiple IDE features in sequence.

## Workflow A: Open, View, and Navigate Files

1. Click the Files icon in the activity bar to ensure the explorer is showing.
2. Expand the `src/` folder if not already expanded.
3. Click `main.ts` to open it.
4. Screenshot → EVALUATE: Is `main.ts` open with TypeScript code visible?
5. Click `utils.ts` to open it.
6. Screenshot → EVALUATE: Are 2 tabs visible? Is `utils.ts` now the active tab?
7. Click the `main.ts` tab to switch back.
8. Screenshot → EVALUATE: Did the editor switch back to `main.ts` content?

## Workflow B: Search and Navigate

1. Click the Search icon in the activity bar.
2. Type "export" in the search field.
3. Wait 2 seconds for results.
4. Screenshot → EVALUATE: Are search results shown for multiple files?
5. Click the first search result.
6. Screenshot → EVALUATE: Did the corresponding file open in the editor?

## Workflow C: Git Full Cycle

1. Create a new file in the project directory:
   Run via Bash: `echo 'export const WORKFLOW_TEST = true;' > {PROJECT_DIR}/src/workflow-test.ts`
   (Use the PROJECT_DIR from the .test-state file, or /tmp/hone-agentic-* path)
2. Click the Git icon in the activity bar.
3. Wait 1 second, then take a screenshot.
4. EVALUATE: Does the new `workflow-test.ts` file appear as untracked (U)?
5. Find the stage button (+) next to `workflow-test.ts` and click it.
6. Screenshot → EVALUATE: Did it move to "Staged Changes"?
7. Type a commit message: "feat: add workflow test file"
8. Click the Commit button.
9. Screenshot → EVALUATE: Is the staged section now empty?

## Workflow D: Multi-Panel Context Switching

1. Open a file from the explorer (click Files → expand src → click types.ts).
2. Screenshot → EVALUATE: File open in editor, explorer visible in sidebar.
3. Switch to Search panel (click Search icon).
4. Screenshot → EVALUATE: Sidebar shows search, editor still shows types.ts.
5. Switch to Git panel (click Git icon).
6. Screenshot → EVALUATE: Sidebar shows git status, editor still shows types.ts.
7. Switch back to Files (click Files icon).
8. Screenshot → EVALUATE: Explorer is back, editor still shows types.ts.

Key check: The editor content should NOT change when switching sidebar panels.

## Evaluation Criteria

- **Workflow A**: File navigation and tab switching work correctly. Editor content matches the active tab.
- **Workflow B**: Search finds results across files, clicking navigates to the file.
- **Workflow C**: Full git cycle — new file detected, staged, committed successfully.
- **Workflow D**: Sidebar panel changes are independent of editor content. Switching panels doesn't affect open tabs or editor state.
- **Cross-workflow**: No crashes, no visual glitches, state is consistent throughout.

## Geisterhand Reference
- `GET /widgets` → list widgets
- `POST /click/{handle}` → click a widget
- `POST /type/{handle}` body=text → type into a text field
- `GET /screenshot` → PNG image

## Report Format
```
RESULT: PASS or FAIL
DETAILS:
- Workflow A (file navigation): [ok/issue]
- Workflow B (search → navigate): [ok/issue]
- Workflow C (git cycle): [ok/issue]
- Workflow D (panel independence): [ok/issue]
- Overall: [summary]
```
