/**
 * AI Chat/Agent panel — streaming AI assistant with tool execution.
 *
 * Three modes: Chat (0), Agent (1), Plan (2).
 * Uses Perry native SSE streaming via streamStart/streamPoll/streamStatus/streamClose.
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, VStackWithInsets, HStackWithInsets, Text, Button, Spacer,
  TextField, ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight, textSetFontFamily, textSetString, textSetWraps,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetClearChildren, widgetSetBackgroundColor, widgetSetWidth,
  widgetSetHidden, widgetSetHeight, widgetRemoveChild,
  textfieldSetString, textfieldFocus, textfieldGetString, textfieldSetOnSubmit,
} from 'perry/ui';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import { getAppDataDir, canRunShellCommands } from '../../paths';
import { getWorkbenchSettings } from '../../settings';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground } from '../../theme/theme-colors';

// Session persistence
import {
  ensureChatsDir, getSessionFilePath, createNewSession,
  loadSessionMessages, saveSessionMessages, updateSessionTitle,
  updateSessionMode, deleteSession, getSessionList, getSessionAt,
  generateTitle, getActiveSessionId, setActiveSessionId,
  getActiveSessionMode, setActiveSessionMode, getMostRecentSessionId,
  loadSessionMeta, getParsedId, getParsedMode, getParsedTitle,
} from './session-store';

// SSE streaming via Perry native fetch (from node-fetch module)
import { streamStart, streamPoll, streamStatus, streamClose } from 'node-fetch';

// Local modules
import { extractJsonString, jsonEscape, getSSEData, parseSSEEventType, parseSSETextDelta, parseSSEToolUse, parseSSEToolId, parseSSEToolDelta, isSSEDone } from './sse-parser';
import { renderMarkdownBlock } from './markdown-render';
import { setToolWorkspaceRoot, executeTool, isDestructiveTool, buildToolDefinitionsJSON, buildReadOnlyToolsJSON } from './agent-tools';
import {
  getAgentStatus, processAgentSSELine, resetAgentState,
  setAgentCallbacks, onApprovalAllow, onApprovalDeny,
  buildAgentSystemPrompt, buildPlanSystemPrompt,
  getLastToolResult, getLastToolName, getLastToolId, getPendingToolArgs,
  getAgentIterationCount,
} from './agent-state';
import {
  addFileContext, removeContext, clearContext, getContextCount,
  buildContextString, getContextTokenEstimate, renderChips, setChipsRenderCallback,
} from './context-chips';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let chatInput: unknown = null;
let chatMessagesContainer: unknown = null;
let chatFocusCountdown: number = 0;
let chatInputText = '';
let panelColors: ResolvedUIColors = null as any;
let chatPanelReady: number = 0;

let msgFilePath = '';
let chatApiKey = '';
let chatApiKeyLoaded: number = 0;

// Mode: 0=Chat, 1=Agent, 2=Plan
let panelMode: number = 0;
let modeChatBtn: unknown = null;
let modeAgentBtn: unknown = null;
let modePlanBtn: unknown = null;

// Streaming state
let streamHandle: number = 0;
let streamActive: number = 0;
let streamPollTimer: number = 0;
let streamAccumulated = '';
let streamingMsgBlock: unknown = null;


// Thinking indicator
let thinkingTimer: number = 0;
let thinkingDots: number = 0;
let thinkingLabel: unknown = null;

// Agent mode — tool display
let approvalContainer: unknown = null;
let toolDisplayContainer: unknown = null;

// Context chips container
let chipsContainer: unknown = null;

// Scroll view
let chatScrollView: unknown = null;

// Current editor file path getter (set from render.ts)
let getCurrentFilePath: (() => string) | null = null;
let getCurrentFileContent: (() => string) | null = null;

// Workspace root setter
let wsRoot = '';

// Message count for tracking
let msgCount: number = 0;

// Session list UI
let sessionListContainer: unknown = null;
let sessionListScrollView: unknown = null;
let sessionListVisible: number = 0;
let firstUserMsgSent: number = 0;

// Session click slot IDs (cached from getSessionAt)
let slotId0 = ''; let slotId1 = ''; let slotId2 = ''; let slotId3 = '';
let slotId4 = ''; let slotId5 = ''; let slotId6 = ''; let slotId7 = '';
let slotId8 = ''; let slotId9 = ''; let slotId10 = ''; let slotId11 = '';
let slotId12 = ''; let slotId13 = ''; let slotId14 = ''; let slotId15 = '';

// Agent continuation messages (tool results to feed back)
let agentConversationFile = '';

// ---------------------------------------------------------------------------
// Public setters (called from render.ts)
// ---------------------------------------------------------------------------

export function setChatWorkspaceRoot(root: string): void {
  wsRoot = root;
  setToolWorkspaceRoot(root);
}

export function setChatFilePathGetter(fn: () => string): void {
  getCurrentFilePath = fn;
}

export function setChatFileContentGetter(fn: () => string): void {
  getCurrentFileContent = fn;
}

// ---------------------------------------------------------------------------
// Helpers
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
  if (end < s.length) return s.slice(0, end);
  return s;
}

function encodeContent(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 10) { result += '\x01'; }
    else if (ch === 13) { /* skip */ }
    else { result += s.slice(i, i + 1); }
  }
  return result;
}

function decodeContent(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 1) { result += '\n'; }
    else { result += s.slice(i, i + 1); }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Message file I/O
// ---------------------------------------------------------------------------

function getCurrentMsgFilePath(): string {
  // Re-derive from active session (Perry: module vars stale in callbacks)
  const sid = getActiveSessionId();
  if (sid.length > 0) return getSessionFilePath(sid);
  return msgFilePath;
}

function appendMessage(isUser: number, content: string): void {
  const fp = getCurrentMsgFilePath();
  let existing = '';
  try { existing = readFileSync(fp); } catch (e) {}
  if (existing.length > 0) existing += '\n';
  if (isUser > 0) { existing += 'U\n'; }
  else { existing += 'A\n'; }
  existing += encodeContent(content);
  try { writeFileSync(fp, existing); } catch (e) {}
  msgCount += 1;

  // Auto-title on first user message
  if (isUser > 0 && firstUserMsgSent < 1) {
    firstUserMsgSent = 1;
    const title = generateTitle(content);
    updateSessionTitle(getActiveSessionId(), title);
    refreshSessionList();
  }
}

function appendAssistantWithTool(text: string, toolId: string, toolName: string, toolArgs: string): void {
  const fp = getCurrentMsgFilePath();
  let existing = '';
  try { existing = readFileSync(fp); } catch (e) {}
  if (existing.length > 0) existing += '\n';
  existing += 'W\n'; // 'W' = assistant message with tool_use
  // Fields separated by SOH (\x01): text | toolId | toolName | toolArgsJson
  let encoded = encodeContent(text);
  encoded += '\x01';
  encoded += toolId;
  encoded += '\x01';
  encoded += toolName;
  encoded += '\x01';
  encoded += toolArgs;
  existing += encoded;
  try { writeFileSync(fp, existing); } catch (e) {}
  msgCount += 1;
}

// ---------------------------------------------------------------------------
// API key loading
// ---------------------------------------------------------------------------

/** Returns the loaded key (Perry workaround: caller must assign to module var). */
function loadApiKeyValue(): string {
  // 1. Try workbench settings (settings.ini — persisted via Settings UI)
  try {
    const s = getWorkbenchSettings();
    if (s.aiApiKey.length > 5) { return s.aiApiKey; }
  } catch (e) {}
  // 2. Try environment variable (macOS/Linux/Windows only — not available on iOS/Android)
  if (canRunShellCommands()) {
    try {
      const envResult = execSync('echo $ANTHROPIC_API_KEY') as unknown as string;
      const key = trimNewline(envResult);
      if (key.length > 5) { return key; }
    } catch (e) {}
  }
  // 3. Try legacy settings.json file
  try {
    let settingsPath = getAppDataDir();
    settingsPath += '/settings.json';
    const raw = readFileSync(settingsPath);
    return extractJsonString(raw, 'anthropicApiKey');
  } catch (e) {}
  return '';
}

// ---------------------------------------------------------------------------
// Build request body
// ---------------------------------------------------------------------------

function buildRequestBody(fileContent: string, systemPrompt: string, includeStream: number, toolsJson: string): string {
  let body = '{"model":"claude-sonnet-4-20250514","max_tokens":4096';
  if (includeStream > 0) {
    body += ',"stream":true';
  }

  body += ',"system":"';
  body += jsonEscape(systemPrompt);
  body += '"';

  // Tools
  if (toolsJson.length > 2) {
    body += ',"tools":';
    body += toolsJson;
  }

  body += ',"messages":[';

  // Parse message file
  let lineStart = 0;
  let lineIdx = 0;
  let currentRole = '';
  let firstMsg: number = 1;
  for (let i = 0; i <= fileContent.length; i++) {
    if (i === fileContent.length || fileContent.charCodeAt(i) === 10) {
      const line = fileContent.slice(lineStart, i);
      if (lineIdx % 2 === 0) {
        if (line.length > 0 && line.charCodeAt(0) === 85) {
          currentRole = 'user';
        } else if (line.length > 0 && line.charCodeAt(0) === 84) {
          // 'T' = tool_result
          currentRole = 'tool_result';
        } else if (line.length > 0 && line.charCodeAt(0) === 87) {
          // 'W' = assistant with tool_use
          currentRole = 'assistant_tool';
        } else {
          currentRole = 'assistant';
        }
      } else {
        const decoded: string = decodeContent(line);
        if (firstMsg < 1) body += ',';
        firstMsg = 0;

        if (currentRole.length === 14) {
          // assistant_tool — assistant message with tool_use content block
          // Format: text\x01toolId\x01toolName\x01toolArgsJson (split on SOH=1)
          let soh1 = -1; let soh2 = -1; let soh3 = -1;
          for (let s = 0; s < decoded.length; s++) {
            if (decoded.charCodeAt(s) === 1) {
              if (soh1 < 0) soh1 = s;
              else if (soh2 < 0) soh2 = s;
              else if (soh3 < 0) { soh3 = s; break; }
            }
          }
          if (soh1 > -1 && soh2 > 0 && soh3 > 0) {
            const aText = decoded.slice(0, soh1);
            const aToolId = decoded.slice(soh1 + 1, soh2);
            const aToolName = decoded.slice(soh2 + 1, soh3);
            const aToolArgs = decoded.slice(soh3 + 1);
            body += '{"role":"assistant","content":[';
            if (aText.length > 0) {
              body += '{"type":"text","text":"';
              body += jsonEscape(aText);
              body += '"},';
            }
            body += '{"type":"tool_use","id":"';
            body += jsonEscape(aToolId);
            body += '","name":"';
            body += jsonEscape(aToolName);
            body += '","input":';
            // toolArgs is raw JSON, don't escape it
            if (aToolArgs.length > 1) {
              body += aToolArgs;
            } else {
              body += '{}';
            }
            body += '}]}';
          }
        } else if (currentRole.length === 11) {
          // tool_result — special format
          // Content is: toolId|toolName|result
          let pipePos1 = -1;
          let pipePos2 = -1;
          for (let p = 0; p < decoded.length; p++) {
            if (decoded.charCodeAt(p) === 124) {
              if (pipePos1 < 0) pipePos1 = p;
              else if (pipePos2 < 0) { pipePos2 = p; break; }
            }
          }
          if (pipePos1 > 0 && pipePos2 > 0) {
            const toolId = decoded.slice(0, pipePos1);
            const toolResult = decoded.slice(pipePos2 + 1);
            body += '{"role":"user","content":[{"type":"tool_result","tool_use_id":"';
            body += jsonEscape(toolId);
            body += '","content":"';
            body += jsonEscape(toolResult);
            body += '"}]}';
          }
        } else {
          body += '{"role":"';
          body += currentRole;
          body += '","content":"';
          body += jsonEscape(decoded);
          body += '"}';
        }
      }
      lineIdx += 1;
      lineStart = i + 1;
    }
  }

  body += ']}';
  return body;
}

// ---------------------------------------------------------------------------
// Streaming via Perry native SSE
// ---------------------------------------------------------------------------

function startStream(requestBody: string): void {
  // Re-load key (Perry: module var may be stale in callback context)
  if (chatApiKey.length < 5) {
    chatApiKey = loadApiKeyValue();
  }
  if (chatApiKey.length < 5) {
    appendMessage(0, 'No API key found. Open Settings to configure your API key.');
    updateMessages();
    return;
  }

  let headersJson = '{"Content-Type":"application/json","x-api-key":"';
  headersJson += chatApiKey;
  headersJson += '","anthropic-version":"2023-06-01"}';

  streamAccumulated = '';
  streamActive = 1;

  streamHandle = streamStart(
    'https://api.anthropic.com/v1/messages',
    'POST',
    requestBody,
    headersJson
  );

  // Start thinking indicator
  startThinking();

  // Start polling
  streamPollTimer = setInterval(() => { pollStreamTick(); }, 16);
}

// Module-level variable to pass SSE line data — avoids passing FFI strings
// as function parameters (Perry codegen issue with NaN-boxed FFI string params)
let currentSSELine: string = '';

function pollStreamTick(): void {
  if (streamActive < 1) return;

  // Drain all pending lines
  for (let drain = 0; drain < 50; drain++) {
    const line = streamPoll(streamHandle);
    if (line.length < 1) break;
    currentSSELine = '' + line;
    processCurrentLine();
  }

  // Re-check status after drain (avoid race with Rust tokio task)
  const statusAfter = streamStatus(streamHandle);

  // Check if done or error
  if (statusAfter >= 2) {
    // Final drain pass — get any remaining lines
    for (let drain2 = 0; drain2 < 50; drain2++) {
      const line2 = streamPoll(streamHandle);
      if (line2.length < 1) break;
      currentSSELine = '' + line2;
      processCurrentLine();
    }
    finishStream();
  }
}

// Inline SSE parsing state — all module-level to avoid passing strings as function params
let sseLineIsData: number = 0;
let sseDataPayload: string = '';
let sseExtractedText: string = '';

function inlineCheckData(): void {
  // Check if currentSSELine starts with "data: " (d=100,a=97,t=116,a=97,:=58,space=32)
  // NOTE: Perry has a bug with long && chains — use nested ifs instead
  sseLineIsData = 0;
  if (currentSSELine.length < 6) return;
  if (currentSSELine.charCodeAt(0) !== 100) return; // d
  if (currentSSELine.charCodeAt(1) !== 97) return;  // a
  if (currentSSELine.charCodeAt(2) !== 116) return; // t
  if (currentSSELine.charCodeAt(3) !== 97) return;  // a
  if (currentSSELine.charCodeAt(4) !== 58) return;  // :
  if (currentSSELine.charCodeAt(5) !== 32) return;  // space
  sseLineIsData = 1;
  sseDataPayload = currentSSELine.slice(6);
}

function inlineCheckDone(): number {
  // Check for [DONE] at start of data payload
  if (sseDataPayload.length < 6) return 0;
  if (sseDataPayload.charCodeAt(0) === 91 && sseDataPayload.charCodeAt(1) === 68 &&
      sseDataPayload.charCodeAt(2) === 79 && sseDataPayload.charCodeAt(3) === 78 &&
      sseDataPayload.charCodeAt(4) === 69) return 1;
  return 0;
}

function inlineExtractText(): void {
  // Extract "text" field value from sseDataPayload JSON
  // Pattern: "text":"<value>"
  sseExtractedText = '';
  for (let i = 0; i < sseDataPayload.length - 8; i++) {
    if (sseDataPayload.charCodeAt(i) === 34 &&      // "
        sseDataPayload.charCodeAt(i + 1) === 116 && // t
        sseDataPayload.charCodeAt(i + 2) === 101 && // e
        sseDataPayload.charCodeAt(i + 3) === 120 && // x
        sseDataPayload.charCodeAt(i + 4) === 116 && // t
        sseDataPayload.charCodeAt(i + 5) === 34) {  // "
      // Found "text", now look for :"
      let j = i + 6;
      // Skip whitespace
      while (j < sseDataPayload.length && (sseDataPayload.charCodeAt(j) === 32 || sseDataPayload.charCodeAt(j) === 9)) { j += 1; }
      if (j >= sseDataPayload.length || sseDataPayload.charCodeAt(j) !== 58) continue; // :
      j += 1;
      while (j < sseDataPayload.length && (sseDataPayload.charCodeAt(j) === 32 || sseDataPayload.charCodeAt(j) === 9)) { j += 1; }
      if (j >= sseDataPayload.length || sseDataPayload.charCodeAt(j) !== 34) continue; // opening "
      j += 1;
      // Read until closing "
      let result = '';
      while (j < sseDataPayload.length) {
        const ch = sseDataPayload.charCodeAt(j);
        if (ch === 92) { // backslash
          j += 1;
          if (j < sseDataPayload.length) {
            const next = sseDataPayload.charCodeAt(j);
            if (next === 110) { result += '\n'; }
            else if (next === 116) { result += '\t'; }
            else if (next === 34) { result += '"'; }
            else if (next === 92) { result += '\\'; }
            else if (next === 117) { j += 4; result += ' '; } // \uXXXX
            else { result += sseDataPayload.slice(j, j + 1); }
          }
        } else if (ch === 34) { // closing "
          break;
        } else {
          result += sseDataPayload.slice(j, j + 1);
        }
        j += 1;
      }
      sseExtractedText = result;
      return;
    }
  }
}

let streamDisplayLabel: unknown = null;

function isDataLine(): number {
  // Inline check: does currentSSELine start with "data: "?
  if (currentSSELine.length < 6) return 0;
  if (currentSSELine.charCodeAt(0) !== 100) return 0;
  if (currentSSELine.charCodeAt(1) !== 97) return 0;
  if (currentSSELine.charCodeAt(2) !== 116) return 0;
  if (currentSSELine.charCodeAt(3) !== 97) return 0;
  if (currentSSELine.charCodeAt(4) !== 58) return 0;
  if (currentSSELine.charCodeAt(5) !== 32) return 0;
  return 1;
}

function processCurrentLine(): void {
  const isDL = isDataLine();
  if (isDL < 1) return;
  sseDataPayload = currentSSELine.slice(6);

  if (panelMode > 0) {
    processAgentSSELine(currentSSELine);
    return;
  }

  // Chat mode — simple text extraction
  if (inlineCheckDone() > 0) return;
  inlineExtractText();
  if (sseExtractedText.length > 0) {
    streamAccumulated += sseExtractedText;
  }
}

function updateStreamingDisplay(): void {
  if (chatPanelReady < 1) return;
  if (!chatMessagesContainer) return;

  if (!streamDisplayLabel) {
    streamDisplayLabel = Text(streamAccumulated);
    textSetFontSize(streamDisplayLabel, 12);
    textSetWraps(streamDisplayLabel, 320);
    if (panelColors) setFg(streamDisplayLabel, getSideBarForeground());
    widgetAddChild(chatMessagesContainer, streamDisplayLabel);
  } else {
    textSetString(streamDisplayLabel, streamAccumulated);
  }
}

function finishStream(): void {
  streamActive = 0;
  if (streamPollTimer > 0) {
    clearInterval(streamPollTimer);
    streamPollTimer = 0;
  }
  streamClose(streamHandle);
  streamHandle = 0;
  stopThinking();

  // In agent/plan mode, check if we need to continue the loop
  if (panelMode > 0) {
    const agentSt = getAgentStatus();
    if (agentSt === 5) {
      // NEEDS_CONTINUE — tool executed, send tool result and continue
      continueAgentLoop();
      return;
    }
    if (agentSt === 3) {
      // AWAITING_APPROVAL — show approval UI, don't finalize yet
      // streamDisplayLabel stays so user sees partial text
      return;
    }
  }

  if (streamAccumulated.length > 0) {
    appendMessage(0, streamAccumulated);
  }
  streamAccumulated = '';
  streamingMsgBlock = null;
  streamDisplayLabel = null;

  updateMessages();
}

// ---------------------------------------------------------------------------
// Thinking indicator
// ---------------------------------------------------------------------------

function startThinking(): void {
  thinkingDots = 0;
  if (chatMessagesContainer) {
    thinkingLabel = Text('Thinking');
    textSetFontSize(thinkingLabel, 12);
    if (panelColors) setFg(thinkingLabel, getSideBarForeground());
    widgetAddChild(chatMessagesContainer, thinkingLabel);
  }
  thinkingTimer = setInterval(() => { updateThinkingDots(); }, 400);
}

function updateThinkingDots(): void {
  thinkingDots += 1;
  if (thinkingDots > 3) thinkingDots = 0;
  if (!thinkingLabel) return;
  let txt = 'Thinking';
  for (let d = 0; d < thinkingDots; d++) {
    txt += '.';
  }
  try { textSetString(thinkingLabel, txt); } catch (e) {}
}

function stopThinking(): void {
  if (thinkingTimer > 0) {
    clearInterval(thinkingTimer);
    thinkingTimer = 0;
  }
  if (thinkingLabel && chatMessagesContainer) {
    try { widgetRemoveChild(chatMessagesContainer, thinkingLabel); } catch (e) {}
    thinkingLabel = null;
  }
}

// ---------------------------------------------------------------------------
// Agent mode — callbacks from agent-state
// ---------------------------------------------------------------------------

function onAgentTextDelta(text: string): void {
  streamAccumulated += text;
  updateStreamingDisplay();
}

function onAgentToolStart(name: string, id: string): void {
  // Show tool execution indicator
  if (!chatMessagesContainer) return;

  let toolLabel = '\u2699 Using tool: ';
  toolLabel += name;
  const toolText = Text(toolLabel);
  textSetFontSize(toolText, 11);
  textSetFontFamily(toolText, 11, 'Menlo');
  if (panelColors) setFg(toolText, getSideBarForeground());

  toolDisplayContainer = VStackWithInsets(2, 4, 8, 4, 8);
  widgetSetBackgroundColor(toolDisplayContainer, 0.15, 0.15, 0.18, 1.0);
  widgetAddChild(toolDisplayContainer, toolText);
  widgetAddChild(chatMessagesContainer, toolDisplayContainer);
}

function onAgentToolResult(name: string, result: string): void {
  if (!toolDisplayContainer) return;

  // Show result (truncated)
  let displayResult = result;
  if (displayResult.length > 500) {
    displayResult = result.slice(0, 500) + '\n... (truncated)';
  }
  const resultText = Text(displayResult);
  textSetFontSize(resultText, 10);
  textSetFontFamily(resultText, 10, 'Menlo');
  textSetWraps(resultText, 300);
  if (panelColors) setFg(resultText, getSideBarForeground());
  widgetAddChild(toolDisplayContainer, resultText);
  toolDisplayContainer = null;
}

function onAgentApprovalNeeded(name: string, args: string): void {
  if (!chatMessagesContainer) return;

  // Stop streaming while waiting for approval
  if (streamActive > 0) {
    streamActive = 0;
    if (streamPollTimer > 0) {
      clearInterval(streamPollTimer);
      streamPollTimer = 0;
    }
  }

  approvalContainer = VStackWithInsets(4, 8, 8, 8, 8);
  widgetSetBackgroundColor(approvalContainer, 0.25, 0.18, 0.12, 1.0);

  let warnText = '\u26A0 Tool "';
  warnText += name;
  warnText += '" requires approval';
  const warnLabel = Text(warnText);
  textSetFontSize(warnLabel, 12);
  textSetFontWeight(warnLabel, 12, 0.5);
  if (panelColors) setFg(warnLabel, getSideBarForeground());
  widgetAddChild(approvalContainer, warnLabel);

  // Show args preview
  let argsPreview = args;
  if (argsPreview.length > 200) argsPreview = args.slice(0, 200) + '...';
  const argsText = Text(argsPreview);
  textSetFontSize(argsText, 10);
  textSetFontFamily(argsText, 10, 'Menlo');
  if (panelColors) setFg(argsText, getSideBarForeground());
  widgetAddChild(approvalContainer, argsText);

  const allowBtn = Button('Allow', () => { onAllowClick(); });
  buttonSetBordered(allowBtn, 0);
  textSetFontSize(allowBtn, 12);
  setBtnFg(allowBtn, getSideBarForeground());

  const denyBtn = Button('Deny', () => { onDenyClick(); });
  buttonSetBordered(denyBtn, 0);
  textSetFontSize(denyBtn, 12);
  setBtnFg(denyBtn, getSideBarForeground());

  const btnRow = HStack(8, [allowBtn, denyBtn, Spacer()]);
  widgetAddChild(approvalContainer, btnRow);
  widgetAddChild(chatMessagesContainer, approvalContainer);
}

function onAllowClick(): void {
  // Remove approval UI
  if (approvalContainer && chatMessagesContainer) {
    try { widgetRemoveChild(chatMessagesContainer, approvalContainer); } catch (e) {}
    approvalContainer = null;
  }
  onApprovalAllow();
  // Check if agent needs continuation
  const agentSt = getAgentStatus();
  if (agentSt === 5) {
    continueAgentLoop();
  }
}

function onDenyClick(): void {
  if (approvalContainer && chatMessagesContainer) {
    try { widgetRemoveChild(chatMessagesContainer, approvalContainer); } catch (e) {}
    approvalContainer = null;
  }
  onApprovalDeny();
  const agentSt = getAgentStatus();
  if (agentSt === 5) {
    continueAgentLoop();
  }
}

function onAgentStreamDone(): void {
  // Agent stream finished without tool call — finalize
  finishStream();
}

function onAgentError(msg: string): void {
  if (chatMessagesContainer) {
    const errText = Text(msg);
    textSetFontSize(errText, 12);
    if (panelColors) setFg(errText, getSideBarForeground());
    widgetAddChild(chatMessagesContainer, errText);
  }
  finishStream();
}

function onAgentIterationStart(n: number): void {
  // Could show iteration counter
}

/** Continue the agent loop after tool execution. */
function continueAgentLoop(): void {
  // Get tool result info
  const toolResult = getLastToolResult();
  const toolName = getLastToolName();
  const toolId = getLastToolId();
  const iterCount = getAgentIterationCount();

  // Append assistant message with tool_use metadata for API continuation
  appendAssistantWithTool(streamAccumulated, toolId, toolName, getPendingToolArgs());

  // Append tool result as special 'T' message type
  let toolMsg = toolId;
  toolMsg += '|';
  toolMsg += toolName;
  toolMsg += '|';
  toolMsg += toolResult;
  appendToolResultMessage(toolMsg);

  // Clear streaming state
  streamAccumulated = '';
  streamingMsgBlock = null;

  // Close old stream
  if (streamHandle > 0) {
    streamClose(streamHandle);
    streamHandle = 0;
  }

  // Reset agent status for next iteration
  resetAgentState();

  // Build and send next request
  const cPath = getCurrentMsgFilePath();
  let fileContent = '';
  try { fileContent = readFileSync(cPath); } catch (e) {}

  let systemPrompt = '';
  let toolsJson = '';
  if (panelMode === 2) {
    systemPrompt = buildPlanSystemPrompt();
    toolsJson = buildReadOnlyToolsJSON();
  } else {
    systemPrompt = buildAgentSystemPrompt();
    toolsJson = buildToolDefinitionsJSON();
  }

  const contextStr = buildContextString();
  if (contextStr.length > 0) {
    systemPrompt += contextStr;
  }

  const body = buildRequestBody(fileContent, systemPrompt, 1, toolsJson);
  startStream(body);
}

function appendToolResultMessage(content: string): void {
  const fp = getCurrentMsgFilePath();
  let existing = '';
  try { existing = readFileSync(fp); } catch (e) {}
  if (existing.length > 0) existing += '\n';
  existing += 'T\n'; // Tool result role marker
  existing += encodeContent(content);
  try { writeFileSync(fp, existing); } catch (e) {}
  msgCount += 1;
}

// ---------------------------------------------------------------------------
// Session slot helpers
// ---------------------------------------------------------------------------

function setSlotId(idx: number, id: string): void {
  if (idx === 0) slotId0 = id;
  if (idx === 1) slotId1 = id;
  if (idx === 2) slotId2 = id;
  if (idx === 3) slotId3 = id;
  if (idx === 4) slotId4 = id;
  if (idx === 5) slotId5 = id;
  if (idx === 6) slotId6 = id;
  if (idx === 7) slotId7 = id;
  if (idx === 8) slotId8 = id;
  if (idx === 9) slotId9 = id;
  if (idx === 10) slotId10 = id;
  if (idx === 11) slotId11 = id;
  if (idx === 12) slotId12 = id;
  if (idx === 13) slotId13 = id;
  if (idx === 14) slotId14 = id;
  if (idx === 15) slotId15 = id;
}

function getSlotId(idx: number): string {
  if (idx === 0) return slotId0;
  if (idx === 1) return slotId1;
  if (idx === 2) return slotId2;
  if (idx === 3) return slotId3;
  if (idx === 4) return slotId4;
  if (idx === 5) return slotId5;
  if (idx === 6) return slotId6;
  if (idx === 7) return slotId7;
  if (idx === 8) return slotId8;
  if (idx === 9) return slotId9;
  if (idx === 10) return slotId10;
  if (idx === 11) return slotId11;
  if (idx === 12) return slotId12;
  if (idx === 13) return slotId13;
  if (idx === 14) return slotId14;
  if (idx === 15) return slotId15;
  return '';
}

function switchToSession(id: string): void {
  if (streamActive > 0) return;
  if (id.length < 1) return;

  setActiveSessionId(id);
  loadSessionMeta(id);

  panelMode = getActiveSessionMode();
  msgFilePath = getSessionFilePath(id);
  firstUserMsgSent = 0;

  // Count messages in loaded file
  msgCount = 0;
  let fileContent = '';
  try { fileContent = readFileSync(msgFilePath); } catch (e) {}
  if (fileContent.length > 1) {
    let lineStart = 0;
    let lineIdx = 0;
    for (let i = 0; i <= fileContent.length; i++) {
      if (i === fileContent.length || fileContent.charCodeAt(i) === 10) {
        lineIdx += 1;
        lineStart = i + 1;
      }
    }
    // Messages are pairs of lines (role + content), so count = lineIdx / 2
    msgCount = Math.floor(lineIdx / 2);
  }

  // Check if first user message exists
  if (fileContent.length > 0 && fileContent.charCodeAt(0) === 85) {
    firstUserMsgSent = 1;
  }

  streamAccumulated = '';
  streamingMsgBlock = null;
  resetAgentState();
  updateMessages();
  updateModeTabStyles();
  refreshSessionList();
}

// Fixed session click callbacks (Perry: closures capture by value)
function onSessionClick0(): void { switchToSession(getSlotId(0)); }
function onSessionClick1(): void { switchToSession(getSlotId(1)); }
function onSessionClick2(): void { switchToSession(getSlotId(2)); }
function onSessionClick3(): void { switchToSession(getSlotId(3)); }
function onSessionClick4(): void { switchToSession(getSlotId(4)); }
function onSessionClick5(): void { switchToSession(getSlotId(5)); }
function onSessionClick6(): void { switchToSession(getSlotId(6)); }
function onSessionClick7(): void { switchToSession(getSlotId(7)); }
function onSessionClick8(): void { switchToSession(getSlotId(8)); }
function onSessionClick9(): void { switchToSession(getSlotId(9)); }
function onSessionClick10(): void { switchToSession(getSlotId(10)); }
function onSessionClick11(): void { switchToSession(getSlotId(11)); }
function onSessionClick12(): void { switchToSession(getSlotId(12)); }
function onSessionClick13(): void { switchToSession(getSlotId(13)); }
function onSessionClick14(): void { switchToSession(getSlotId(14)); }
function onSessionClick15(): void { switchToSession(getSlotId(15)); }

function getSessionClickFn(idx: number): () => void {
  if (idx === 0) return onSessionClick0;
  if (idx === 1) return onSessionClick1;
  if (idx === 2) return onSessionClick2;
  if (idx === 3) return onSessionClick3;
  if (idx === 4) return onSessionClick4;
  if (idx === 5) return onSessionClick5;
  if (idx === 6) return onSessionClick6;
  if (idx === 7) return onSessionClick7;
  if (idx === 8) return onSessionClick8;
  if (idx === 9) return onSessionClick9;
  if (idx === 10) return onSessionClick10;
  if (idx === 11) return onSessionClick11;
  if (idx === 12) return onSessionClick12;
  if (idx === 13) return onSessionClick13;
  if (idx === 14) return onSessionClick14;
  return onSessionClick15;
}

// Fixed session delete callbacks
function deleteSlot(idx: number): void {
  const id = getSlotId(idx);
  if (id.length < 1) return;
  // If deleting active session, switch to another
  const activeId = getActiveSessionId();
  let isActive: number = 0;
  if (id.length === activeId.length) {
    isActive = 1;
    for (let i = 0; i < id.length; i++) {
      if (id.charCodeAt(i) !== activeId.charCodeAt(i)) { isActive = 0; break; }
    }
  }
  deleteSession(id);
  if (isActive > 0) {
    // Switch to most recent remaining, or create new
    const recentId = getMostRecentSessionId();
    if (recentId.length > 0) {
      switchToSession(recentId);
    } else {
      onNewChat();
    }
  } else {
    refreshSessionList();
  }
}

function onDelSession0(): void { deleteSlot(0); }
function onDelSession1(): void { deleteSlot(1); }
function onDelSession2(): void { deleteSlot(2); }
function onDelSession3(): void { deleteSlot(3); }
function onDelSession4(): void { deleteSlot(4); }
function onDelSession5(): void { deleteSlot(5); }
function onDelSession6(): void { deleteSlot(6); }
function onDelSession7(): void { deleteSlot(7); }
function onDelSession8(): void { deleteSlot(8); }
function onDelSession9(): void { deleteSlot(9); }
function onDelSession10(): void { deleteSlot(10); }
function onDelSession11(): void { deleteSlot(11); }
function onDelSession12(): void { deleteSlot(12); }
function onDelSession13(): void { deleteSlot(13); }
function onDelSession14(): void { deleteSlot(14); }
function onDelSession15(): void { deleteSlot(15); }

function getDelSessionFn(idx: number): () => void {
  if (idx === 0) return onDelSession0;
  if (idx === 1) return onDelSession1;
  if (idx === 2) return onDelSession2;
  if (idx === 3) return onDelSession3;
  if (idx === 4) return onDelSession4;
  if (idx === 5) return onDelSession5;
  if (idx === 6) return onDelSession6;
  if (idx === 7) return onDelSession7;
  if (idx === 8) return onDelSession8;
  if (idx === 9) return onDelSession9;
  if (idx === 10) return onDelSession10;
  if (idx === 11) return onDelSession11;
  if (idx === 12) return onDelSession12;
  if (idx === 13) return onDelSession13;
  if (idx === 14) return onDelSession14;
  return onDelSession15;
}

// ---------------------------------------------------------------------------
// Session list rendering
// ---------------------------------------------------------------------------

function refreshSessionList(): void {
  if (!sessionListContainer) return;
  widgetClearChildren(sessionListContainer);

  const total = getSessionList();
  if (total < 1) return;

  const activeId = getActiveSessionId();

  // Show most recent first — iterate from end, max 16
  let displayed = 0;
  for (let revIdx = total - 1; revIdx >= 0; revIdx--) {
    if (displayed >= 16) break;
    getSessionAt(revIdx);
    const sid = getParsedId();
    const smode = getParsedMode();
    const stitle = getParsedTitle();

    if (sid.length < 1) continue;

    setSlotId(displayed, sid);

    // Mode badge
    let badge = 'C';
    if (smode === 1) badge = 'A';
    if (smode === 2) badge = 'P';
    const badgeLabel = Text(badge);
    textSetFontSize(badgeLabel, 9);
    textSetFontFamily(badgeLabel, 9, 'Menlo');
    if (panelColors) setFg(badgeLabel, getSideBarForeground());

    // Title
    let displayTitle = stitle;
    if (displayTitle.length < 1) displayTitle = 'New chat';
    const titleLabel = Text(displayTitle);
    textSetFontSize(titleLabel, 11);
    if (panelColors) setFg(titleLabel, getSideBarForeground());

    // Delete button
    const delFn = getDelSessionFn(displayed);
    const delBtn = Button('\u00D7', () => { delFn(); });
    buttonSetBordered(delBtn, 0);
    textSetFontSize(delBtn, 10);
    if (panelColors) setBtnFg(delBtn, getSideBarForeground());

    // Click handler for the row
    const clickFn = getSessionClickFn(displayed);
    const rowBtn = Button(displayTitle, () => { clickFn(); });
    buttonSetBordered(rowBtn, 0);
    textSetFontSize(rowBtn, 11);
    if (panelColors) setBtnFg(rowBtn, getSideBarForeground());

    const row = HStack(4, [badgeLabel, rowBtn, Spacer(), delBtn]);

    // Highlight active session
    let isActive: number = 0;
    if (sid.length === activeId.length) {
      isActive = 1;
      for (let c = 0; c < sid.length; c++) {
        if (sid.charCodeAt(c) !== activeId.charCodeAt(c)) { isActive = 0; break; }
      }
    }
    if (isActive > 0) {
      widgetSetBackgroundColor(row, 0.25, 0.25, 0.3, 1.0);
    }

    widgetAddChild(sessionListContainer, row);
    displayed += 1;
  }
}

function toggleSessionList(): void {
  if (sessionListVisible > 0) {
    sessionListVisible = 0;
  } else {
    sessionListVisible = 1;
    refreshSessionList();
  }
  if (sessionListScrollView) {
    widgetSetHidden(sessionListScrollView, sessionListVisible < 1 ? 1 : 0);
  }
}

// ---------------------------------------------------------------------------
// UI event handlers
// ---------------------------------------------------------------------------

function onChatInput(text: string): void {
  chatInputText = text;
}

/** Called when user presses Enter/Return in the text field. */
function onSubmitFromField(text: string): void {
  chatInputText = text;
  onSend();
}

function onSend(): void {
  // Read text directly from widget (Perry: module vars stale in callbacks)
  if (chatInput) {
    let raw = textfieldGetString(chatInput);
    // Strip trailing newline from Enter key
    if (raw.length > 0 && raw.charCodeAt(raw.length - 1) === 10) {
      raw = raw.slice(0, raw.length - 1);
    }
    chatInputText = raw;
  }
  if (chatInputText.length < 1) return;
  if (streamActive > 0) return;

  const sendText = chatInputText;
  appendMessage(1, sendText);
  chatInputText = '';
  if (chatInput) textfieldSetString(chatInput, '');
  updateMessages();

  // Build request — use fresh path (Perry: module vars stale in callbacks)
  const currentPath = getCurrentMsgFilePath();
  let fileContent = '';
  try { fileContent = readFileSync(currentPath); } catch (e) {}

  let systemPrompt = 'You are Hone, an AI coding assistant built into the Hone IDE. Be concise and helpful.';
  let toolsJson = '';

  if (panelMode === 1) {
    // Agent mode
    systemPrompt = buildAgentSystemPrompt();
    toolsJson = buildToolDefinitionsJSON();
  } else if (panelMode === 2) {
    // Plan mode
    systemPrompt = buildPlanSystemPrompt();
    toolsJson = buildReadOnlyToolsJSON();
  }

  // Add context
  const contextStr = buildContextString();
  if (contextStr.length > 0) {
    systemPrompt += contextStr;
  }

  const body = buildRequestBody(fileContent, systemPrompt, 1, toolsJson);
  startStream(body);
}

function onNewChat(): void {
  if (streamActive > 0) return;
  msgCount = 0;
  clearContext();
  resetAgentState();
  streamAccumulated = '';
  streamingMsgBlock = null;
  firstUserMsgSent = 0;

  const newId = createNewSession(panelMode);
  msgFilePath = getSessionFilePath(newId);

  updateMessages();
  renderChipsArea();
  refreshSessionList();
}

// ---------------------------------------------------------------------------
// Mode tabs
// ---------------------------------------------------------------------------

function onModeChat(): void {
  panelMode = 0;
  updateSessionMode(getActiveSessionId(), 0);
  updateModeTabStyles();
  updateMessages();
}

function onModeAgent(): void {
  panelMode = 1;
  updateSessionMode(getActiveSessionId(), 1);
  updateModeTabStyles();
  updateMessages();
}

function onModePlan(): void {
  panelMode = 2;
  updateSessionMode(getActiveSessionId(), 2);
  updateModeTabStyles();
  updateMessages();
}

function styleModeBtn(btn: unknown, active: number): void {
  if (!btn || !panelColors) return;
  if (active > 0) {
    // Active: bright text + visible background
    setBtnFg(btn, '#ffffff');
    widgetSetBackgroundColor(btn, 0.3, 0.35, 0.55, 1.0);
  } else {
    // Inactive: dimmed text, transparent
    setBtnFg(btn, '#808080');
    widgetSetBackgroundColor(btn, 0.0, 0.0, 0.0, 0.0);
  }
}

function updateModeTabStyles(): void {
  if (!panelColors) return;
  styleModeBtn(modeChatBtn, panelMode === 0 ? 1 : 0);
  styleModeBtn(modeAgentBtn, panelMode === 1 ? 1 : 0);
  styleModeBtn(modePlanBtn, panelMode === 2 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Context attachment
// ---------------------------------------------------------------------------

function onAttachFile(): void {
  if (!getCurrentFilePath) return;
  const filePath = getCurrentFilePath();
  if (filePath.length < 1) return;
  try {
    const content = readFileSync(filePath);
    addFileContext(filePath, content);
    renderChipsArea();
  } catch (e) {}
}

function onAttachSelection(): void {
  if (!getCurrentFileContent) return;
  if (!getCurrentFilePath) return;
  const filePath = getCurrentFilePath();
  const content = getCurrentFileContent();
  if (content.length < 1) return;
  addFileContext(filePath, content);
  renderChipsArea();
}

function renderChipsArea(): void {
  if (!chipsContainer) return;
  widgetClearChildren(chipsContainer);
  if (getContextCount() > 0) {
    renderChips(chipsContainer, panelColors);
  }
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

function updateMessages(): void {
  if (chatPanelReady < 1) return;
  widgetClearChildren(chatMessagesContainer);

  const fp = getCurrentMsgFilePath();
  let fileContent = '';
  try { fileContent = readFileSync(fp); } catch (e) {}

  if (fileContent.length < 2) {
    let hintText = 'Ask a question about your code';
    if (panelMode === 1) hintText = 'Describe a task for the AI agent';
    if (panelMode === 2) hintText = 'Describe what you want to plan';
    const hint = Text(hintText);
    textSetFontSize(hint, 12);
    if (panelColors) setFg(hint, getSideBarForeground());
    widgetAddChild(chatMessagesContainer, hint);
    return;
  }

  // Parse file: pairs of (role line, content line)
  let lineStart = 0;
  let lineIdx = 0;
  let isUser: number = 0;
  let isTool: number = 0;
  let isWithTool: number = 0;
  for (let i = 0; i <= fileContent.length; i++) {
    if (i === fileContent.length || fileContent.charCodeAt(i) === 10) {
      const line = fileContent.slice(lineStart, i);
      if (lineIdx % 2 === 0) {
        isUser = 0;
        isTool = 0;
        isWithTool = 0;
        if (line.length > 0 && line.charCodeAt(0) === 85) { isUser = 1; }
        if (line.length > 0 && line.charCodeAt(0) === 84) { isTool = 1; }
        if (line.length > 0 && line.charCodeAt(0) === 87) { isWithTool = 1; }
      } else {
        let content = decodeContent(line);
        // 'W' messages: extract text before first SOH (\x01)
        if (isWithTool > 0) {
          for (let s = 0; s < content.length; s++) {
            if (content.charCodeAt(s) === 1) {
              content = content.slice(0, s);
              break;
            }
          }
        }

        if (isTool > 0) {
          // Tool result message — show compact
          const toolBlock = VStackWithInsets(2, 4, 8, 4, 8);
          widgetSetBackgroundColor(toolBlock, 0.15, 0.15, 0.18, 1.0);
          const toolLabel = Text('\u2699 Tool result');
          textSetFontSize(toolLabel, 10);
          textSetFontFamily(toolLabel, 10, 'Menlo');
          if (panelColors) setFg(toolLabel, getSideBarForeground());
          widgetAddChild(toolBlock, toolLabel);

          // Show truncated result
          let pipeCount = 0;
          let resultStart = 0;
          for (let p = 0; p < content.length; p++) {
            if (content.charCodeAt(p) === 124) {
              pipeCount += 1;
              if (pipeCount === 2) { resultStart = p + 1; break; }
            }
          }
          let resultPreview = content.slice(resultStart);
          if (resultPreview.length > 200) resultPreview = resultPreview.slice(0, 200) + '...';
          const resultText = Text(resultPreview);
          textSetFontSize(resultText, 10);
          textSetFontFamily(resultText, 10, 'Menlo');
          if (panelColors) setFg(resultText, getSideBarForeground());
          widgetAddChild(toolBlock, resultText);
          widgetAddChild(chatMessagesContainer, toolBlock);
        } else {
          // User or assistant message
          const roleLabel = Text(isUser > 0 ? 'You' : 'Hone');
          textSetFontSize(roleLabel, 10);
          textSetFontWeight(roleLabel, 10, 0.7);
          if (panelColors) setFg(roleLabel, getSideBarForeground());

          const msgBlock = VStackWithInsets(2, 4, 8, 4, 8);
          widgetAddChild(msgBlock, roleLabel);

          // Use markdown rendering for all messages
          renderMarkdownBlock(content, msgBlock, panelColors, 320);

          if (isUser > 0 && panelColors) {
            widgetSetBackgroundColor(msgBlock, 0.18, 0.18, 0.22, 1.0);
          }

          widgetAddChild(chatMessagesContainer, msgBlock);
        }
      }
      lineIdx += 1;
      lineStart = i + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function doFocusTick(): void {
  if (chatFocusCountdown < 1) return;
  chatFocusCountdown = chatFocusCountdown - 1;
  if (chatInput) textfieldFocus(chatInput);
}

export function focusChatInput(): void {
  chatFocusCountdown = 5;
}

export function getChatInputHandle(): unknown {
  return chatInput;
}

// ---------------------------------------------------------------------------
// Public render function
// ---------------------------------------------------------------------------

export function renderChatPanel(container: unknown, colors: ResolvedUIColors): unknown {
  panelColors = colors;
  chatPanelReady = 0;

  // Load API key — assign in this function (Perry: sub-function writes to module vars are stale in caller)
  if (chatApiKeyLoaded < 1) {
    chatApiKey = loadApiKeyValue();
    chatApiKeyLoaded = 1;
  }

  // --- Session persistence init ---
  ensureChatsDir();
  let currentId = getMostRecentSessionId();
  if (currentId.length < 1) {
    currentId = createNewSession(0);
  } else {
    loadSessionMeta(currentId);
    panelMode = getActiveSessionMode();
  }
  setActiveSessionId(currentId);
  msgFilePath = getSessionFilePath(currentId);

  // Check if first user message already sent
  firstUserMsgSent = 0;
  try {
    const existingContent = readFileSync(msgFilePath);
    if (existingContent.length > 0 && existingContent.charCodeAt(0) === 85) {
      firstUserMsgSent = 1;
    }
  } catch (e) {}

  // Set up agent callbacks
  setAgentCallbacks(
    onAgentTextDelta,
    onAgentToolStart,
    onAgentToolResult,
    onAgentApprovalNeeded,
    onAgentStreamDone,
    onAgentError,
    onAgentIterationStart
  );
  setChipsRenderCallback(() => { renderChipsArea(); });

  // --- Header row: History toggle + New Chat + mode tabs + clear ---
  const historyBtn = Button('History', () => { toggleSessionList(); });
  buttonSetBordered(historyBtn, 0);
  textSetFontSize(historyBtn, 11);
  setBtnFg(historyBtn, getSideBarForeground());

  const newChatBtn = Button('+ New', () => { onNewChat(); });
  buttonSetBordered(newChatBtn, 0);
  textSetFontSize(newChatBtn, 11);
  setBtnFg(newChatBtn, getSideBarForeground());

  modeChatBtn = Button('Chat', () => { onModeChat(); });
  buttonSetBordered(modeChatBtn, 0);
  textSetFontSize(modeChatBtn, 11);

  modeAgentBtn = Button('Agent', () => { onModeAgent(); });
  buttonSetBordered(modeAgentBtn, 0);
  textSetFontSize(modeAgentBtn, 11);

  modePlanBtn = Button('Plan', () => { onModePlan(); });
  buttonSetBordered(modePlanBtn, 0);
  textSetFontSize(modePlanBtn, 11);

  const modeRow = HStack(2, [historyBtn, newChatBtn, Spacer(), modeChatBtn, modeAgentBtn, modePlanBtn]);
  widgetAddChild(container, modeRow);

  // --- Session list (collapsible) ---
  sessionListContainer = VStack(2, []);
  sessionListScrollView = ScrollView();
  scrollViewSetChild(sessionListScrollView, sessionListContainer);
  widgetSetHeight(sessionListScrollView, 180);
  widgetSetHidden(sessionListScrollView, 1);
  sessionListVisible = 0;
  widgetAddChild(container, sessionListScrollView);

  // 1px divider
  const divider = Text('');
  widgetSetHeight(divider, 1);
  widgetSetBackgroundColor(divider, 0.3, 0.3, 0.35, 1.0);
  widgetAddChild(container, divider);

  updateModeTabStyles();

  // --- Messages area (scrollable) ---
  chatMessagesContainer = VStack(6, []);
  const scrollView = ScrollView();
  scrollViewSetChild(scrollView, chatMessagesContainer);
  widgetAddChild(container, scrollView);
  chatScrollView = scrollView;

  chatPanelReady = 1;

  // Show API key setup hint if no key configured
  if (chatApiKey.length < 5) {
    const hintBlock = VStackWithInsets(4, 8, 8, 8, 8);
    widgetSetBackgroundColor(hintBlock, 0.15, 0.18, 0.25, 1.0);

    const hintTitle = Text('API Key Required');
    textSetFontSize(hintTitle, 12);
    textSetFontWeight(hintTitle, 12, 0.7);
    setFg(hintTitle, getSideBarForeground());
    widgetAddChild(hintBlock, hintTitle);

    const hint1 = Text('Open Settings to configure your API key.');
    textSetFontSize(hint1, 11);
    setFg(hint1, getSideBarForeground());
    widgetAddChild(hintBlock, hint1);

    widgetAddChild(chatMessagesContainer, hintBlock);
  } else {
    updateMessages();
  }

  // --- Context chips ---
  chipsContainer = HStack(4, []);
  widgetAddChild(container, chipsContainer);

  // --- Attach buttons ---
  const attachFileBtn = Button('+ File', () => { onAttachFile(); });
  buttonSetBordered(attachFileBtn, 0);
  textSetFontSize(attachFileBtn, 10);
  setBtnFg(attachFileBtn, getSideBarForeground());

  const attachSelBtn = Button('+ Selection', () => { onAttachSelection(); });
  buttonSetBordered(attachSelBtn, 0);
  textSetFontSize(attachSelBtn, 10);
  setBtnFg(attachSelBtn, getSideBarForeground());

  const attachRow = HStack(4, [attachFileBtn, attachSelBtn, Spacer()]);
  widgetAddChild(container, attachRow);

  // --- Input ---
  chatInput = TextField('', (text: string) => { onChatInput(text); });
  // Enter/Return key triggers onSubmit
  textfieldSetOnSubmit(chatInput, (text: string) => { onSubmitFromField(text); });
  widgetAddChild(container, chatInput);

  const sendBtn = Button('Send', () => { onSend(); });
  buttonSetBordered(sendBtn, 0);
  textSetFontSize(sendBtn, 12);
  setBtnFg(sendBtn, getSideBarForeground());
  const sendRow = HStack(4, [sendBtn, Spacer()]);
  widgetAddChild(container, sendRow);

  // Auto-focus the chat input after a delay (within same module so chatInput is fresh)
  chatFocusCountdown = 3;
  setInterval(() => { doFocusTick(); }, 100);

  return chatInput;
}
