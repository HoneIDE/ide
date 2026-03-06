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
  textSetFontSize, textSetFontWeight, textSetFontFamily, textSetString,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetClearChildren, widgetSetBackgroundColor, widgetSetWidth,
  widgetSetHidden, widgetSetHeight, widgetRemoveChild,
  textfieldSetString, textfieldFocus,
} from 'perry/ui';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

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
  getLastToolResult, getLastToolName, getLastToolId,
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
let chatInputText = '';
let panelColors: ResolvedUIColors = null as any;
let chatPanelReady: number = 0;

let msgFilePath = '/tmp/hone-chat-msgs.txt';
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

// Agent continuation messages (tool results to feed back)
let agentConversationFile = '/tmp/hone-agent-conv.txt';

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

function appendMessage(isUser: number, content: string): void {
  let existing = '';
  try { existing = readFileSync(msgFilePath); } catch (e) {}
  if (existing.length > 0) existing += '\n';
  if (isUser > 0) { existing += 'U\n'; }
  else { existing += 'A\n'; }
  existing += encodeContent(content);
  try { writeFileSync(msgFilePath, existing); } catch (e) {}
  msgCount += 1;
}

// ---------------------------------------------------------------------------
// API key loading
// ---------------------------------------------------------------------------

function loadApiKey(): void {
  if (chatApiKeyLoaded > 0) return;
  chatApiKeyLoaded = 1;
  try {
    const envResult = execSync('echo $ANTHROPIC_API_KEY') as unknown as string;
    const key = trimNewline(envResult);
    if (key.length > 5) { chatApiKey = key; return; }
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
        } else {
          currentRole = 'assistant';
        }
      } else {
        const decoded: string = decodeContent(line);
        if (firstMsg < 1) body += ',';
        firstMsg = 0;

        if (currentRole.length === 11) {
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
  if (chatApiKey.length < 5) {
    appendMessage(0, 'No API key found. Set ANTHROPIC_API_KEY or add "anthropicApiKey" to ~/.hone/settings.json');
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

  const status = streamStatus(streamHandle);

  // Drain all pending lines
  for (let drain = 0; drain < 50; drain++) {
    const line = streamPoll(streamHandle);
    if (line.length < 1) break;
    currentSSELine = '' + line;
    processCurrentLine();
  }

  // Check if done or error
  if (status >= 2) {
    finishStream();
  }
}

// Inline SSE parsing state — all module-level to avoid passing strings as function params
let sseLineIsData: number = 0;
let sseDataPayload: string = '';
let sseExtractedText: string = '';

function inlineCheckData(): void {
  // Check if currentSSELine starts with "data: " (d=100,a=97,t=116,a=97,:=58,space=32)
  sseLineIsData = 0;
  if (currentSSELine.length < 6) return;
  const c0 = currentSSELine.charCodeAt(0);
  const c1 = currentSSELine.charCodeAt(1);
  const c2 = currentSSELine.charCodeAt(2);
  const c3 = currentSSELine.charCodeAt(3);
  const c4 = currentSSELine.charCodeAt(4);
  const c5 = currentSSELine.charCodeAt(5);
  if (c0 === 100 && c1 === 97 && c2 === 116 && c3 === 97 && c4 === 58 && c5 === 32) {
    sseLineIsData = 1;
    sseDataPayload = currentSSELine.slice(6);
  }
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

function processCurrentLine(): void {
  inlineCheckData();
  if (sseLineIsData < 1) return;
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
    if (panelColors) setFg(streamDisplayLabel, panelColors.sideBarForeground);
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
    if (panelColors) setFg(thinkingLabel, panelColors.sideBarForeground);
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
  if (panelColors) setFg(toolText, panelColors.sideBarForeground);

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
  if (panelColors) setFg(resultText, panelColors.sideBarForeground);
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
  if (panelColors) setFg(warnLabel, panelColors.sideBarForeground);
  widgetAddChild(approvalContainer, warnLabel);

  // Show args preview
  let argsPreview = args;
  if (argsPreview.length > 200) argsPreview = args.slice(0, 200) + '...';
  const argsText = Text(argsPreview);
  textSetFontSize(argsText, 10);
  textSetFontFamily(argsText, 10, 'Menlo');
  if (panelColors) setFg(argsText, panelColors.sideBarForeground);
  widgetAddChild(approvalContainer, argsText);

  const allowBtn = Button('Allow', () => { onAllowClick(); });
  buttonSetBordered(allowBtn, 0);
  textSetFontSize(allowBtn, 12);
  setBtnFg(allowBtn, panelColors.sideBarForeground);

  const denyBtn = Button('Deny', () => { onDenyClick(); });
  buttonSetBordered(denyBtn, 0);
  textSetFontSize(denyBtn, 12);
  setBtnFg(denyBtn, panelColors.sideBarForeground);

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
    if (panelColors) setFg(errText, panelColors.sideBarForeground);
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

  // Append assistant message (with tool use) and tool result to conversation
  if (streamAccumulated.length > 0) {
    appendMessage(0, streamAccumulated);
  }

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
  let fileContent = '';
  try { fileContent = readFileSync(msgFilePath); } catch (e) {}

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
  let existing = '';
  try { existing = readFileSync(msgFilePath); } catch (e) {}
  if (existing.length > 0) existing += '\n';
  existing += 'T\n'; // Tool result role marker
  existing += encodeContent(content);
  try { writeFileSync(msgFilePath, existing); } catch (e) {}
  msgCount += 1;
}

// ---------------------------------------------------------------------------
// UI event handlers
// ---------------------------------------------------------------------------

function onChatInput(text: string): void {
  chatInputText = text;
}

function onSend(): void {
  if (chatInputText.length < 1) return;
  if (streamActive > 0) return;

  appendMessage(1, chatInputText);
  chatInputText = '';
  if (chatInput) textfieldSetString(chatInput, '');
  updateMessages();

  // Build request
  let fileContent = '';
  try { fileContent = readFileSync(msgFilePath); } catch (e) {}

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

function onClear(): void {
  msgCount = 0;
  try { writeFileSync(msgFilePath, ''); } catch (e) {}
  clearContext();
  resetAgentState();
  streamAccumulated = '';
  streamingMsgBlock = null;
  updateMessages();
  renderChipsArea();
}

// ---------------------------------------------------------------------------
// Mode tabs
// ---------------------------------------------------------------------------

function onModeChat(): void {
  panelMode = 0;
  updateModeTabStyles();
}

function onModeAgent(): void {
  panelMode = 1;
  updateModeTabStyles();
}

function onModePlan(): void {
  panelMode = 2;
  updateModeTabStyles();
}

function updateModeTabStyles(): void {
  if (!panelColors) return;
  // Active tab gets brighter text
  if (modeChatBtn) {
    if (panelMode === 0) {
      setBtnFg(modeChatBtn, panelColors.sideBarForeground);
      widgetSetBackgroundColor(modeChatBtn, 0.25, 0.25, 0.3, 1.0);
    } else {
      setBtnFg(modeChatBtn, panelColors.sideBarForeground);
      widgetSetBackgroundColor(modeChatBtn, 0.0, 0.0, 0.0, 0.0);
    }
  }
  if (modeAgentBtn) {
    if (panelMode === 1) {
      setBtnFg(modeAgentBtn, panelColors.sideBarForeground);
      widgetSetBackgroundColor(modeAgentBtn, 0.25, 0.25, 0.3, 1.0);
    } else {
      setBtnFg(modeAgentBtn, panelColors.sideBarForeground);
      widgetSetBackgroundColor(modeAgentBtn, 0.0, 0.0, 0.0, 0.0);
    }
  }
  if (modePlanBtn) {
    if (panelMode === 2) {
      setBtnFg(modePlanBtn, panelColors.sideBarForeground);
      widgetSetBackgroundColor(modePlanBtn, 0.25, 0.25, 0.3, 1.0);
    } else {
      setBtnFg(modePlanBtn, panelColors.sideBarForeground);
      widgetSetBackgroundColor(modePlanBtn, 0.0, 0.0, 0.0, 0.0);
    }
  }
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

  let fileContent = '';
  try { fileContent = readFileSync(msgFilePath); } catch (e) {}

  if (fileContent.length < 2) {
    let hintText = 'Ask a question about your code';
    if (panelMode === 1) hintText = 'Describe a task for the AI agent';
    if (panelMode === 2) hintText = 'Describe what you want to plan';
    const hint = Text(hintText);
    textSetFontSize(hint, 12);
    if (panelColors) setFg(hint, panelColors.sideBarForeground);
    widgetAddChild(chatMessagesContainer, hint);
    return;
  }

  // Parse file: pairs of (role line, content line)
  let lineStart = 0;
  let lineIdx = 0;
  let isUser: number = 0;
  let isTool: number = 0;
  for (let i = 0; i <= fileContent.length; i++) {
    if (i === fileContent.length || fileContent.charCodeAt(i) === 10) {
      const line = fileContent.slice(lineStart, i);
      if (lineIdx % 2 === 0) {
        isUser = 0;
        isTool = 0;
        if (line.length > 0 && line.charCodeAt(0) === 85) { isUser = 1; }
        if (line.length > 0 && line.charCodeAt(0) === 84) { isTool = 1; }
      } else {
        const content = decodeContent(line);

        if (isTool > 0) {
          // Tool result message — show compact
          const toolBlock = VStackWithInsets(2, 4, 8, 4, 8);
          widgetSetBackgroundColor(toolBlock, 0.15, 0.15, 0.18, 1.0);
          const toolLabel = Text('\u2699 Tool result');
          textSetFontSize(toolLabel, 10);
          textSetFontFamily(toolLabel, 10, 'Menlo');
          if (panelColors) setFg(toolLabel, panelColors.sideBarForeground);
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
          if (panelColors) setFg(resultText, panelColors.sideBarForeground);
          widgetAddChild(toolBlock, resultText);
          widgetAddChild(chatMessagesContainer, toolBlock);
        } else {
          // User or assistant message
          const roleLabel = Text(isUser > 0 ? 'You' : 'Hone');
          textSetFontSize(roleLabel, 10);
          textSetFontWeight(roleLabel, 10, 0.7);
          if (panelColors) setFg(roleLabel, panelColors.sideBarForeground);

          const msgBlock = VStackWithInsets(2, 4, 8, 4, 8);
          widgetAddChild(msgBlock, roleLabel);

          // Use markdown rendering for all messages
          renderMarkdownBlock(content, msgBlock, panelColors);

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
// Public render function
// ---------------------------------------------------------------------------

export function renderChatPanel(container: unknown, colors: ResolvedUIColors): void {
  panelColors = colors;
  chatPanelReady = 0;

  loadApiKey();

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

  // --- Mode tabs ---
  modeChatBtn = Button('Chat', () => { onModeChat(); });
  buttonSetBordered(modeChatBtn, 0);
  textSetFontSize(modeChatBtn, 11);

  modeAgentBtn = Button('Agent', () => { onModeAgent(); });
  buttonSetBordered(modeAgentBtn, 0);
  textSetFontSize(modeAgentBtn, 11);

  modePlanBtn = Button('Plan', () => { onModePlan(); });
  buttonSetBordered(modePlanBtn, 0);
  textSetFontSize(modePlanBtn, 11);

  const clearBtn = Button('Clear', () => { onClear(); });
  buttonSetBordered(clearBtn, 0);
  textSetFontSize(clearBtn, 11);
  setBtnFg(clearBtn, colors.sideBarForeground);

  const modeRow = HStack(2, [modeChatBtn, modeAgentBtn, modePlanBtn, Spacer(), clearBtn]);
  widgetAddChild(container, modeRow);

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
    setFg(hintTitle, colors.sideBarForeground);
    widgetAddChild(hintBlock, hintTitle);

    const hint1 = Text('Set the ANTHROPIC_API_KEY environment variable,');
    textSetFontSize(hint1, 11);
    setFg(hint1, colors.sideBarForeground);
    widgetAddChild(hintBlock, hint1);

    const hint2 = Text('or add "anthropicApiKey" to ~/.hone/settings.json');
    textSetFontSize(hint2, 11);
    setFg(hint2, colors.sideBarForeground);
    widgetAddChild(hintBlock, hint2);

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
  setBtnFg(attachFileBtn, colors.sideBarForeground);

  const attachSelBtn = Button('+ Selection', () => { onAttachSelection(); });
  buttonSetBordered(attachSelBtn, 0);
  textSetFontSize(attachSelBtn, 10);
  setBtnFg(attachSelBtn, colors.sideBarForeground);

  const attachRow = HStack(4, [attachFileBtn, attachSelBtn, Spacer()]);
  widgetAddChild(container, attachRow);

  // --- Input ---
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
