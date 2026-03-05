/**
 * AI Chat panel — chat interface for AI assistant.
 *
 * Uses Anthropic Messages API via Perry's native fetch (reqwest).
 * API key from ANTHROPIC_API_KEY env var or ~/.hone/settings.json.
 * All state is module-level (Perry closures capture by value).
 *
 * IMPORTANT: Perry corrupts string/number values in module-level arrays
 * when read from depth 2+ callback functions. To work around this,
 * messages are serialized to a temp file and read back for display.
 */
import {
  VStack, HStack, Text, Button, Spacer,
  TextField, ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  buttonSetBordered,
  widgetAddChild, widgetClearChildren,
  textfieldSetString, textfieldFocus,
} from 'perry/ui';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

// Perry native fetch
import fetch from 'node-fetch';

// ---------------------------------------------------------------------------
// Module-level state (must be declared BEFORE any function — Perry no-hoist)
// ---------------------------------------------------------------------------

let chatInput: unknown = null;
let chatMessagesContainer: unknown = null;
let chatInputText = '';
let panelColors: ResolvedUIColors = null as any;
let chatPanelReady: number = 0;

// Message count (number — reliable in Perry)
let msgCount: number = 0;

// Messages stored in file: /tmp/hone-chat-msgs.txt
// Format: each message is two lines: "U" or "A" (role), then content (with \n replaced by \x01)
// This avoids Perry's broken array reads at depth 2+.
let msgFilePath = '/tmp/hone-chat-msgs.txt';

// API key — loaded at render time, not in callbacks
let chatApiKey = '';
let chatApiKeyLoaded: number = 0;

// Pending send state
let sendPending: number = 0;

// ---------------------------------------------------------------------------
// Pure helper functions (only use parameters, never read module-level vars)
// ---------------------------------------------------------------------------

function trimNewline(s: string): string {
  let end = s.length;
  while (end > 0) {
    const ch = s.charCodeAt(end - 1);
    if (ch === 10 || ch === 13 || ch === 32) {
      end = end - 1;
    } else {
      break;
    }
  }
  if (end < s.length) {
    return s.slice(0, end);
  }
  return s;
}

/** Escape a string for embedding in JSON. */
function jsonEscape(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 92) {
      result += '\\';
      result += '\\';
    } else if (ch === 34) {
      result += '\\';
      result += '"';
    } else if (ch === 10) {
      result += '\\';
      result += 'n';
    } else if (ch === 13) {
      result += '\\';
      result += 'r';
    } else if (ch === 9) {
      result += '\\';
      result += 't';
    } else {
      result += s.slice(i, i + 1);
    }
  }
  return result;
}

/** Encode message content for storage: replace newlines with \x01 */
function encodeContent(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 10) {
      result += '\x01';
    } else if (ch === 13) {
      // skip CR
    } else {
      result += s.slice(i, i + 1);
    }
  }
  return result;
}

/** Decode content: restore \x01 to newlines */
function decodeContent(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 1) {
      result += '\n';
    } else {
      result += s.slice(i, i + 1);
    }
  }
  return result;
}

/** Extract a JSON string value for a given key. Pure function — uses only params. */
function extractJsonString(json: string, key: string): string {
  let pattern = '"';
  pattern += key;
  pattern += '"';

  let searchStart = 0;
  while (searchStart <= json.length - pattern.length) {
    let pos = -1;
    for (let i = searchStart; i <= json.length - pattern.length; i++) {
      let match = 1;
      for (let j = 0; j < pattern.length; j++) {
        if (json.charCodeAt(i + j) !== pattern.charCodeAt(j)) {
          match = 0;
          break;
        }
      }
      if (match > 0) {
        pos = i;
        break;
      }
    }
    if (pos < 0) return '';

    let afterKey = pos + pattern.length;
    while (afterKey < json.length) {
      const ch = json.charCodeAt(afterKey);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        afterKey = afterKey + 1;
      } else {
        break;
      }
    }
    if (afterKey >= json.length || json.charCodeAt(afterKey) !== 58) {
      searchStart = pos + 1;
      continue;
    }

    afterKey = afterKey + 1;
    while (afterKey < json.length) {
      const ch = json.charCodeAt(afterKey);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        afterKey = afterKey + 1;
      } else {
        break;
      }
    }

    if (afterKey >= json.length || json.charCodeAt(afterKey) !== 34) {
      searchStart = pos + 1;
      continue;
    }
    afterKey = afterKey + 1;

    let result = '';
    while (afterKey < json.length) {
      const ch = json.charCodeAt(afterKey);
      if (ch === 92) {
        afterKey = afterKey + 1;
        if (afterKey < json.length) {
          const next = json.charCodeAt(afterKey);
          if (next === 110) { result += '\n'; }
          else if (next === 116) { result += '\t'; }
          else if (next === 114) { result += '\r'; }
          else if (next === 34) { result += '"'; }
          else if (next === 92) { result += '\\'; }
          else if (next === 117) {
            afterKey = afterKey + 4;
            result += ' ';
          } else {
            result += json.slice(afterKey, afterKey + 1);
          }
        }
      } else if (ch === 34) {
        break;
      } else {
        result += json.slice(afterKey, afterKey + 1);
      }
      afterKey = afterKey + 1;
    }

    return result;
  }

  return '';
}

// ---------------------------------------------------------------------------
// Message file I/O — avoids Perry's broken array reads at depth 2+
// ---------------------------------------------------------------------------

/** Append a message to the file. Call at depth 1 (callback handler). */
function appendMessage(isUser: number, content: string): void {
  let existing = '';
  try { existing = readFileSync(msgFilePath); } catch (e) {}
  if (existing.length > 0) {
    existing += '\n';
  }
  if (isUser > 0) {
    existing += 'U\n';
  } else {
    existing += 'A\n';
  }
  existing += encodeContent(content);
  try { writeFileSync(msgFilePath, existing); } catch (e) {}
  msgCount = msgCount + 1;
}

/** Build API request body from message file. Pure function (reads file, not arrays). */
function buildRequestBody(fileContent: string): string {
  let body = '{"model":"claude-sonnet-4-20250514","max_tokens":4096,';
  body += '"system":"You are Hone, an AI coding assistant built into the Hone IDE. Be concise and helpful.",';
  body += '"messages":[';

  // Parse file lines: pairs of (role, content)
  let lineStart = 0;
  let lineIdx = 0;
  let currentRole = '';
  let firstMsg: number = 1;
  for (let i = 0; i <= fileContent.length; i++) {
    if (i === fileContent.length || fileContent.charCodeAt(i) === 10) {
      const line = fileContent.slice(lineStart, i);
      if (lineIdx % 2 === 0) {
        // Role line: "U" or "A"
        if (line.length > 0 && line.charCodeAt(0) === 85) {
          currentRole = 'user';
        } else {
          currentRole = 'assistant';
        }
      } else {
        // Content line
        const decoded = decodeContent(line);
        if (firstMsg < 1) body += ',';
        firstMsg = 0;
        body += '{"role":"';
        body += currentRole;
        body += '","content":"';
        body += jsonEscape(decoded);
        body += '"}';
      }
      lineIdx = lineIdx + 1;
      lineStart = i + 1;
    }
  }

  body += ']}';
  return body;
}

// ---------------------------------------------------------------------------
// API key loading — called at render time (outside callbacks)
// ---------------------------------------------------------------------------

function loadApiKey(): void {
  if (chatApiKeyLoaded > 0) return;
  chatApiKeyLoaded = 1;
  try {
    const envResult = execSync('echo $ANTHROPIC_API_KEY') as unknown as string;
    const key = trimNewline(envResult);
    if (key.length > 5) {
      chatApiKey = key;
      return;
    }
  } catch (e) {}
  try {
    const homeResult = execSync('echo $HOME') as unknown as string;
    const home = trimNewline(homeResult);
    let settingsPath = home;
    settingsPath += '/.hone/settings.json';
    const raw = readFileSync(settingsPath);
    chatApiKey = extractJsonString(raw, 'anthropicApiKey');
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// API call via Perry native fetch
// ---------------------------------------------------------------------------

async function doFetchSend(): Promise<void> {
  // Build request body from file (avoids reading module-level arrays)
  let fileContent = '';
  try { fileContent = readFileSync(msgFilePath); } catch (e) {}
  const body = buildRequestBody(fileContent);

  const apiKey = chatApiKey;
  if (apiKey.length < 5) {
    appendMessage(0, 'No API key found. Set ANTHROPIC_API_KEY or add "anthropicApiKey" to ~/.hone/settings.json');
    updateMessages();
    sendPending = 0;
    return;
  }

  // Use Perry native fetch (reqwest) — await compiles to busy-wait loop
  // Falls back to curl if fetch throws
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: body,
    });
    const response = await (resp as any).text() as unknown as string;
    handleApiResponse(response);
  } catch (e) {
    // Fallback to curl
    doFetchSendCurl(body, apiKey);
  }
  sendPending = 0;
}

function doFetchSendCurl(body: string, apiKey: string): void {
  try {
    writeFileSync('/tmp/hone-chat-body.json', body);
  } catch (e) {
    appendMessage(0, 'Error: Could not write request body');
    updateMessages();
    return;
  }

  let script = '#!/bin/sh\n';
  script += 'curl -s -m 30 -X POST https://api.anthropic.com/v1/messages';
  script += ' -H "Content-Type: application/json"';
  script += ' -H "x-api-key: ';
  script += apiKey;
  script += '"';
  script += ' -H "anthropic-version: 2023-06-01"';
  script += ' -d @/tmp/hone-chat-body.json\n';
  try {
    writeFileSync('/tmp/hone-chat-curl.sh', script);
  } catch (e) {
    appendMessage(0, 'Error: Could not write curl script');
    updateMessages();
    return;
  }

  try {
    execSync('sh /tmp/hone-chat-curl.sh > /tmp/hone-chat-response.json 2>/dev/null');
  } catch (e) {
    appendMessage(0, 'Error: API request failed. Check your internet connection.');
    updateMessages();
    return;
  }

  let response = '';
  try {
    response = readFileSync('/tmp/hone-chat-response.json');
  } catch (e) {
    appendMessage(0, 'Error: Could not read API response');
    updateMessages();
    return;
  }

  handleApiResponse(response);
}

function handleApiResponse(response: string): void {
  if (response.length < 2) {
    appendMessage(0, 'Error: Empty response from API');
    updateMessages();
    return;
  }

  // Parse response
  const text = extractJsonString(response, 'text');
  if (text.length > 0) {
    appendMessage(0, text);
  } else {
    const errMsg = extractJsonString(response, 'message');
    if (errMsg.length > 0) {
      let errText = 'API Error: ';
      errText += errMsg;
      appendMessage(0, errText);
    } else {
      appendMessage(0, 'Error: Could not parse API response');
    }
  }

  updateMessages();
}

// ---------------------------------------------------------------------------
// UI handlers — all module-level reads/writes at depth 1 (Perry constraint)
// ---------------------------------------------------------------------------

function onChatInput(text: string): void {
  chatInputText = text;
}

/**
 * Send message and call API — ALL INLINE at depth 1.
 */
function onSend(): void {
  if (chatInputText.length < 1) return;
  if (sendPending > 0) return;

  // Add user message to file
  appendMessage(1, chatInputText);
  chatInputText = '';
  if (chatInput) textfieldSetString(chatInput, '');
  updateMessages();

  sendPending = 1;
  // Defer the API call to next tick so UI updates first
  setTimeout(() => { doFetchSend(); }, 0);
}

function onClear(): void {
  msgCount = 0;
  try { writeFileSync(msgFilePath, ''); } catch (e) {}
  updateMessages();
}

/**
 * Render messages by reading from file (not arrays).
 * File I/O works at any depth — avoids Perry's stale array reads.
 */
function updateMessages(): void {
  if (chatPanelReady < 1) return;
  widgetClearChildren(chatMessagesContainer);

  let fileContent = '';
  try { fileContent = readFileSync(msgFilePath); } catch (e) {}

  if (fileContent.length < 2) {
    const hint = Text('Ask a question about your code');
    textSetFontSize(hint, 12);
    if (panelColors) setFg(hint, panelColors.sideBarForeground);
    widgetAddChild(chatMessagesContainer, hint);
    return;
  }

  // Parse file: pairs of (role line, content line)
  let lineStart = 0;
  let lineIdx = 0;
  let isUser: number = 0;
  for (let i = 0; i <= fileContent.length; i++) {
    if (i === fileContent.length || fileContent.charCodeAt(i) === 10) {
      const line = fileContent.slice(lineStart, i);
      if (lineIdx % 2 === 0) {
        // Role line
        isUser = 0;
        if (line.length > 0 && line.charCodeAt(0) === 85) {
          isUser = 1;
        }
      } else {
        // Content line — render the message
        const content = decodeContent(line);
        const roleLabel = Text(isUser > 0 ? 'You' : 'Assistant');
        textSetFontSize(roleLabel, 10);
        textSetFontWeight(roleLabel, 10, 0.7);
        if (panelColors) setFg(roleLabel, panelColors.sideBarForeground);

        const msgBlock = VStack(2, [roleLabel]);

        // Render content line by line
        let cLineStart = 0;
        let inCodeBlock: number = 0;
        for (let c = 0; c <= content.length; c++) {
          if (c === content.length || content.charCodeAt(c) === 10) {
            let cLine = content.slice(cLineStart, c);

            let isFence: number = 0;
            if (cLine.length >= 3) {
              if (cLine.charCodeAt(0) === 96 && cLine.charCodeAt(1) === 96 && cLine.charCodeAt(2) === 96) {
                isFence = 1;
              }
            }
            if (isFence > 0) {
              if (inCodeBlock > 0) {
                inCodeBlock = 0;
              } else {
                inCodeBlock = 1;
              }
              cLineStart = c + 1;
              continue;
            }

            if (cLine.length < 1) cLine = ' ';
            const lineText = Text(cLine);
            if (inCodeBlock > 0) {
              textSetFontFamily(lineText, 11, 'Menlo');
              textSetFontSize(lineText, 11);
            } else {
              textSetFontSize(lineText, 12);
            }
            if (panelColors) setFg(lineText, panelColors.sideBarForeground);
            widgetAddChild(msgBlock, lineText);
            cLineStart = c + 1;
          }
        }

        if (isUser > 0 && panelColors) {
          setBg(msgBlock, panelColors.editorBackground);
        }

        widgetAddChild(chatMessagesContainer, msgBlock);
      }
      lineIdx = lineIdx + 1;
      lineStart = i + 1;
    }
  }

  // Show loading indicator if send is pending
  if (sendPending > 0) {
    const loading = Text('Thinking...');
    textSetFontSize(loading, 12);
    if (panelColors) setFg(loading, panelColors.sideBarForeground);
    widgetAddChild(chatMessagesContainer, loading);
  }
}

// ---------------------------------------------------------------------------
// Public render function
// ---------------------------------------------------------------------------

export function renderChatPanel(container: unknown, colors: ResolvedUIColors): void {
  panelColors = colors;
  chatPanelReady = 0;

  // Load API key at render time (outside callbacks)
  loadApiKey();

  // Header row
  const title = Text('AI CHAT');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);

  const clearBtn = Button('Clear', () => { onClear(); });
  buttonSetBordered(clearBtn, 0);
  textSetFontSize(clearBtn, 11);
  setBtnFg(clearBtn, colors.sideBarForeground);

  const headerRow = HStack(4, [title, Spacer(), clearBtn]);
  widgetAddChild(container, headerRow);

  // Messages area
  chatMessagesContainer = VStack(8, []);
  widgetAddChild(container, chatMessagesContainer);

  chatPanelReady = 1;

  // Restore existing messages or show hint
  updateMessages();

  // Input — text field added directly (HStack wrapping breaks TextField callbacks in Perry)
  chatInput = TextField('Ask a question...', (text: string) => { onChatInput(text); });
  widgetAddChild(container, chatInput);

  const sendBtn = Button('Send', () => { onSend(); });
  buttonSetBordered(sendBtn, 0);
  textSetFontSize(sendBtn, 12);
  setBtnFg(sendBtn, colors.sideBarForeground);
  const sendRow = HStack(4, [sendBtn, Spacer()]);
  widgetAddChild(container, sendRow);

  textfieldFocus(chatInput);
}
