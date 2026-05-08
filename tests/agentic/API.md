# Geisterhand API Reference for Agentic Testing

Two complementary APIs run simultaneously during testing. Use the right port for each operation.

## Port 7676 — Baked-in API (Widget Callbacks)

Best for: interacting with Perry UI widgets by handle. Direct callback invocation, works without focus on all platforms.

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/health` | — | Health check → `{"status":"ok"}` |
| GET | `/widgets` | — | List all widgets `[{handle, widget_type, callback_kind, label}]` |
| GET | `/widgets?label=Save` | — | Filter widgets by label substring |
| GET | `/widgets?type=0` | — | Filter by widget type (0=button, 1=textfield, ...) |
| POST | `/click/:handle` | — | Click widget (fires onClick callback) |
| POST | `/type/:handle` | `{"text":"hello"}` | Set textfield text + fire onChange |
| POST | `/slide/:handle` | `{"value":0.75}` | Set slider position + fire onChange |
| POST | `/toggle/:handle` | — | Toggle switch + fire onChange |
| POST | `/state/:handle` | `{"value":42}` | Set State cell value directly |
| POST | `/hover/:handle` | — | Fire onHover callback |
| POST | `/doubleclick/:handle` | — | Fire onDoubleClick callback |
| GET | `/screenshot` | — | Capture app window as PNG (binary) |
| POST | `/chaos/start` | `{"interval_ms":200}` | Start random fuzzing |
| POST | `/chaos/stop` | — | Stop chaos mode |
| GET | `/chaos/status` | — | Chaos stats `{running, events_fired, uptime_secs}` |

### Widget Types

| Code | Type |
|------|------|
| 0 | Button |
| 1 | TextField |
| 2 | Slider |
| 3 | Toggle |
| 4 | Picker |
| 5 | Menu |
| 6 | Shortcut |
| 7 | Table |

## Port 7677 — External CLI Server (OS-Level)

Best for: keyboard input, scrolling, accessibility tree queries, waiting for state changes. Uses macOS APIs (CGEvent, AXUIElement).

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/health` | — | Health check |
| GET | `/status` | — | System info, permissions, frontmost app |
| GET | `/screenshot` | `?pid=&format=` | Screenshot (supports window-specific via PID) |
| POST | `/click` | `{"x":100,"y":200}` | Click at screen coordinates |
| POST | `/click/element` | `{"title":"Save","role":"Button"}` | Click by accessibility label/role |
| POST | `/type` | `{"text":"hello","delayMs":50}` | Type text via keyboard events |
| POST | `/key` | `{"key":"s","modifiers":["cmd"]}` | Press key with modifiers |
| POST | `/scroll` | `{"x":400,"y":300,"deltaY":-3}` | Scroll at coordinates |
| POST | `/wait` | `{"element":{...},"timeout":5000}` | Wait for element state change |
| GET | `/accessibility/tree` | `?maxDepth=5&format=compact` | Full UI element hierarchy |
| GET | `/accessibility/elements` | `?role=Button&title=Save` | Find elements by query |
| GET | `/accessibility/focused` | — | Currently focused element |
| POST | `/accessibility/action` | `{"path":[0,1],"action":"press"}` | Perform action on element |
| GET | `/menu` | — | App menu structure |
| POST | `/menu` | `{"path":"File > Save"}` | Trigger menu item |

### Common Key Names

`return`, `escape`, `tab`, `space`, `delete`, `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `f1`–`f12`

### Modifier Names

`cmd`, `shift`, `alt` (option), `ctrl`, `fn`

## Routing Guide

| Task | Use |
|------|-----|
| Click a button/widget | Port 7676: `POST /click/:handle` |
| Type into a text field | Port 7676: `POST /type/:handle` |
| Take a screenshot | Port 7676: `GET /screenshot` |
| List all widgets | Port 7676: `GET /widgets` |
| Press Cmd+S (save) | Port 7677: `POST /key {"key":"s","modifiers":["cmd"]}` |
| Press Cmd+B (toggle sidebar) | Port 7677: `POST /key {"key":"b","modifiers":["cmd"]}` |
| Scroll a panel | Port 7677: `POST /scroll {"x":..,"y":..,"deltaY":-3}` |
| Find element by label | Port 7677: `GET /accessibility/elements?title=Save` |
| Wait for UI to update | Port 7677: `POST /wait {"element":{...},"timeout":3000}` |
| Get UI hierarchy | Port 7677: `GET /accessibility/tree` |
| Trigger menu action | Port 7677: `POST /menu {"path":"File > Save"}` |
| Fuzz test the app | Port 7676: `POST /chaos/start` |

## Tips

- Always `GET /widgets` before clicking — handles can change after UI updates
- Wait 1-2 seconds after clicks that trigger panel switches before screenshotting
- Use `GET /accessibility/tree?format=compact` for a concise element summary
- The baked-in screenshot (`GET :7676/screenshot`) captures just the app window without focus
- The external screenshot (`GET :7677/screenshot?pid=...`) also works without focus
