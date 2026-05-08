# Scenario: Settings & Theme
Category: settings
Depends on: 01-startup

> See `tests/agentic/API.md` for the full endpoint reference.

## Goal
Verify the settings UI opens when clicking the gear icon, shows setting categories and controls, and that changing the theme updates the UI.

## Steps

1. **Open Settings**: Either use the keyboard shortcut via port 7677:
   `curl -s -X POST http://127.0.0.1:7677/key -H 'Content-Type: application/json' -d '{"key":",","modifiers":["cmd"]}'`

   Or find the gear/settings icon in the activity bar (last icon, at the bottom) and click it via port 7676:
   `curl -s -X POST http://127.0.0.1:7676/click/{handle}`

2. **Screenshot — settings panel**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/07-settings-panel.png`
   Read the screenshot. EVALUATE: Is a settings UI visible?

3. **Evaluate settings UI**:
   - Are setting categories visible (Editor, Appearance, Terminal, etc.)?
   - Are individual settings shown with labels and controls (toggles, dropdowns, text fields)?
   - Is there a search/filter input for settings?
   - Does the settings panel appear as a tab in the editor area (not in the sidebar)?

4. **Find theme toggle**: Look through widgets for a theme-related control (e.g., "Theme", "Color Theme", "Dark/Light" toggle).

5. **Screenshot — before theme change**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/07-settings-before-theme.png`
   Note the current color scheme.

6. **Change theme**: Click the theme toggle/picker.

7. **Screenshot — after theme change**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/07-settings-after-theme.png`
   Read the screenshot. EVALUATE: Did the color scheme change? (e.g., dark to light or different accent colors)

## Evaluation Criteria

- Settings opens as a tab in the editor area (like VS Code's settings tab)
- Categories are visible and organized (at least 3-4 categories)
- Individual settings have descriptive labels
- Controls are appropriate for the setting type (toggles for booleans, text fields for strings)
- Theme change is visually dramatic — background, text, sidebar, activity bar colors all update
- After theme change, all UI elements look consistent (no mixed dark/light artifacts)

## Geisterhand API (Dual-Port)

**Port 7676 (baked-in)** — widget clicks, screenshots:
- `GET /widgets` → list widgets
- `POST /click/{handle}` → click a widget
- `GET /screenshot` → PNG image

**Port 7677 (external CLI)** — keyboard shortcuts:
- `POST /key` body=`{"key":",","modifiers":["cmd"]}` → open settings (Cmd+,)

## Report Format
```
RESULT: PASS or FAIL
DETAILS:
- Settings UI opens: [ok/issue]
- Categories visible: [ok/issue]
- Controls present: [ok/issue]
- Theme toggle found: [ok/issue]
- Theme change works: [ok/issue]
- Overall: [summary]
```
