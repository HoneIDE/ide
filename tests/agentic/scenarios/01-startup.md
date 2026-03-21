# Scenario: App Startup & Layout
Category: startup

## Goal
Verify the IDE launches correctly with proper layout — activity bar, sidebar, editor area, and status bar.

## Steps

1. **Health check**: Run `curl -s http://127.0.0.1:7676/health` — should return `{"status":"ok"}`.
   If it fails, the IDE or geisterhand is not running. Report FAIL immediately.

2. **Wait for render**: `sleep 2` to allow full initial render.

3. **Take screenshot**: Run `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/01-startup.png`
   Then use the Read tool to view `/tmp/test/01-startup.png`.

4. **Evaluate the screenshot** visually. Check each criterion below.

## Evaluation Criteria

- **Activity bar**: Visible on the far left as a narrow vertical strip with icon buttons (Files, Search, Git, Debug, Extensions, AI Chat). Should be around 48px wide.
- **Sidebar**: Next to the activity bar, showing either the file explorer (with project files) or a welcome view. Should be around 220px wide.
- **Editor area**: Center/right portion of the window showing file content or a welcome tab. This is the largest area.
- **Status bar**: A thin bar at the very bottom showing branch name or other info.
- **Theme**: Dark theme applied consistently. Text should be readable (light text on dark background).
- **No errors**: No blank white areas, no error dialogs, no loading spinners, no crash artifacts.
- **General impression**: Does this look like a real code editor (similar to VS Code)?

## Report Format

Return your result as:
```
RESULT: PASS or FAIL
DETAILS:
- Activity bar: [ok/issue]
- Sidebar: [ok/issue]
- Editor area: [ok/issue]
- Status bar: [ok/issue]
- Theme: [ok/issue]
- Overall: [summary sentence]
```
