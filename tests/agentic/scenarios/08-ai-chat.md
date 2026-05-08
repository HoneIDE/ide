# Scenario: AI Chat Panel
Category: ai-chat
Depends on: 01-startup

> See `tests/agentic/API.md` for the full endpoint reference.

## Goal
Verify the AI chat panel opens, shows mode tabs, and has a text input that accepts messages.

## Steps

1. **Switch to AI Chat panel**: Find the AI Chat icon in the activity bar (5th or 6th icon button — look for a chat/speech bubble icon) and click it.

2. **Screenshot — AI chat panel**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/08-ai-chat-panel.png`
   Read the screenshot. EVALUATE: Is an AI chat panel visible in the sidebar or main area?

3. **Evaluate chat panel structure**:
   - Is there a chat message area (scrollable, possibly empty)?
   - Are mode tabs visible (Chat, Agent, Plan, Claude Code)?
   - Is there a text input field at the bottom for typing messages?
   - Are there any context/attachment buttons?

4. **Type a message**: Find the chat text input field in widgets and type into it:
   `curl -s -X POST http://127.0.0.1:7676/type/{handle} -d "Hello, explain this project"`

5. **Screenshot — message typed**:
   `curl -s http://127.0.0.1:7676/screenshot -o /tmp/test/08-ai-chat-typed.png`
   Read the screenshot. EVALUATE: Is the typed message visible in the input field?

## Evaluation Criteria

- AI chat panel opens without errors
- Panel has a clear layout: message area + input field
- Mode tabs or mode selector may be present (Chat, Agent, etc.)
- Text input field accepts typed text
- The panel doesn't overlap or break the main editor layout
- The chat area is empty initially (no previous messages)
- Context chip area or attachment buttons may be visible near the input

## Note
This test does NOT send the message to an AI backend — it only verifies the UI renders correctly and accepts input. No API key or AI service is needed.

## Geisterhand Reference
- `GET /widgets` → list widgets
- `POST /click/{handle}` → click a widget
- `POST /type/{handle}` body=text → type into a text field
- `GET /screenshot` → PNG image

## Report Format
```
RESULT: PASS or FAIL
DETAILS:
- AI chat panel opens: [ok/issue]
- Mode tabs visible: [ok/issue]
- Input field present: [ok/issue]
- Text input works: [ok/issue]
- Layout intact: [ok/issue]
- Overall: [summary]
```
