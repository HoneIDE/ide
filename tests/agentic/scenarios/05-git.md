# Scenario: Git Source Control
Category: git
Depends on: 01-startup

> See `tests/agentic/API.md` for the full endpoint reference.

## Goal
Verify the git panel shows repository status with modified/staged/untracked files, allows staging files, and supports committing.

## Context
The test project was set up with this git state:
- `src/main.ts` — modified (unstaged change)
- `src/utils.ts` — staged (change already added to index)
- `src/new-feature.ts` — untracked (new file not yet added)

## Steps

1. **Switch to Git panel**: Find the Git/Source Control icon in the activity bar (3rd icon button) and click it.

2. **Screenshot — git panel**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/05-git-panel.png`
   Read the screenshot. EVALUATE: Is the Source Control panel showing?

3. **Evaluate git panel contents**:
   - Is there a commit message text input field at the top?
   - Is there a "Changes" section listing modified/untracked files?
   - Is there a "Staged Changes" section (since utils.ts was pre-staged)?
   - Do files show status indicators (M for modified, U for untracked) on the RIGHT side?
   - Are file names displayed with their relative paths?

4. **Stage a file**: Find the stage button (+) next to `src/main.ts` (in the Changes section) and click it.

5. **Screenshot — after staging**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/05-git-staged.png`
   Read the screenshot. EVALUATE: Did `main.ts` move from "Changes" to "Staged Changes"?

6. **Enter commit message**: Find the commit message text field and type a message:
   `curl -s -X POST http://127.0.0.1:7676/type/{handle} -d "test: agentic test commit"`

7. **Click Commit**: Find the Commit button and click it.

8. **Screenshot — after commit**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/05-git-committed.png`
   Read the screenshot. EVALUATE: Did the staged files disappear after committing?

## Evaluation Criteria

- Commit message text field is present at the top of the panel
- "Changes" section lists files with status on the RIGHT side:
  - `src/main.ts` with M (modified)
  - `src/new-feature.ts` with U (untracked)
- "Staged Changes" section shows `src/utils.ts` (pre-staged)
- Stage button (+) next to each file in Changes
- Discard button (x or arrow) next to each file
- Unstage button (-) next to staged files
- After staging: file moves between sections correctly
- After commit: staged section clears
- Branch name visible (main or master)
- Layout matches VS Code style (compact, status badges on right)

## Geisterhand Reference
- `GET /widgets` → list widgets
- `POST /click/{handle}` → click a widget
- `POST /type/{handle}` body=text → type into a text field
- `GET /screenshot` → PNG image

## Report Format
```
RESULT: PASS or FAIL
DETAILS:
- Git panel opens: [ok/issue]
- Changed files listed: [ok/issue]
- Status indicators correct: [ok/issue]
- Staged section present: [ok/issue]
- Staging works: [ok/issue]
- Commit works: [ok/issue]
- Overall: [summary]
```
