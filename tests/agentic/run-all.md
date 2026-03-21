# Agentic Test Runner — Orchestrator Instructions

This file contains instructions for running all agentic test scenarios against the Hone IDE.

## Prerequisites

1. The IDE binary `hone-ide` must be built: `cd hone-ide && perry compile src/app.ts --output hone-ide`
2. `geisterhand` must be installed and in PATH
3. `curl` must be available

## Setup

Run the setup script to create a temp project with git state and launch the IDE:

```bash
cd hone-ide/tests/agentic && bash setup.sh
```

Or, if the IDE is already running with geisterhand on port 7676, skip setup and go straight to running scenarios.

Create the screenshot output directory:
```bash
mkdir -p /tmp/test
```

## Running All Scenarios

**IMPORTANT: Use a SINGLE agent to run all scenarios sequentially.** Multiple agents interacting with the same IDE instance will conflict (clicking widgets, switching panels). One agent carries state forward naturally (files opened in scenario 02 are still there for 03).

Spawn one agent with this prompt:

```
You are testing the Hone IDE via the geisterhand automation API.
The IDE is running and geisterhand is listening on http://127.0.0.1:7676.

Run ALL scenarios sequentially, in order, from:
  /path/to/hone-ide/tests/agentic/scenarios/

For each scenario (01 through 10):
1. Read the scenario .md file
2. Execute every step described in it
3. At EVERY evaluation checkpoint, take a screenshot and Read it:
   - curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/{scenario}-{step}.png
   - Read /tmp/test/{scenario}-{step}.png  (this is your PROOF — you must view it)
4. Record PASS or FAIL with per-criterion details

Geisterhand API:
- GET  http://127.0.0.1:7676/health → {"status":"ok"}
- GET  http://127.0.0.1:7676/widgets → [{handle, widget_type, callback_kind, label}, ...]
- POST http://127.0.0.1:7676/click/{handle} → click a widget
- POST http://127.0.0.1:7676/type/{handle} body=text → type into a text field
- GET  http://127.0.0.1:7676/screenshot → PNG of the app window

CRITICAL RULES:
- You MUST Read every screenshot you capture. The screenshot IS the proof.
  Do not just save it — view it with the Read tool and describe what you see.
- Always get a fresh widget list (GET /widgets) before interacting.
  Widget handles can change after clicks.
- Wait 1-2 seconds after clicks that trigger panel switches or file loads
  before taking the next screenshot.
- If a scenario step fails, note the failure, take a proof screenshot,
  and continue to the next scenario (don't abort the whole run).

After all 10 scenarios, produce a final report in this format:

# Agentic Test Report — {date}

| # | Scenario | Result | Key Screenshot |
|---|----------|--------|----------------|
| 01 | Startup & Layout | PASS/FAIL | /tmp/test/01-startup.png |
| 02 | File Explorer | PASS/FAIL | /tmp/test/02-explorer-file-open.png |
| ... | ... | ... | ... |

**Total: X/10 passed**

## Detailed Results

### 01 — Startup & Layout
RESULT: PASS/FAIL
Screenshots: /tmp/test/01-startup.png
DETAILS:
- Activity bar: [ok/issue]
- Sidebar: [ok/issue]
...

### 02 — File Explorer
...
(repeat for each scenario)

## All Screenshots Captured
- /tmp/test/01-startup.png — [one-line description of what it shows]
- /tmp/test/02-explorer-tree.png — ...
...
```

### Run a Single Scenario

```
Read and execute the scenario at: hone-ide/tests/agentic/scenarios/05-git.md
The IDE is running on port 7676. Save screenshots to /tmp/test/.
You MUST Read every screenshot you take — it is your proof for evaluation.
```

## Teardown

After collecting results, clean up:

```bash
cd hone-ide/tests/agentic && bash teardown.sh
```

This kills the IDE process and removes the temp project directory. Results are preserved.

## Troubleshooting

- **geisterhand not responding**: Check that the IDE binary exists and that port 7676 is free (`lsof -i :7676`)
- **Screenshots are black**: The IDE may not have finished rendering. Add `sleep 2` after startup.
- **Widget clicks don't work**: Get fresh widget list (`/widgets`) before each click — handles can change after UI updates.
- **Search returns no results**: Ensure the search text field handle is correct. Some text fields may need a delay after typing.
- **Git panel empty**: Verify the project dir has a `.git` directory and that files were modified as expected.
