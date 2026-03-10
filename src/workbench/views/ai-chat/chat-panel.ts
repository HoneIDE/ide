/**
 * AI Chat/Agent panel — streaming AI assistant with tool execution.
 *
 * Three modes: Chat (0), Agent (1), Plan (2).
 * Uses Perry native SSE streaming via streamStart/streamPoll/streamStatus/streamClose.
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, VStackWithInsets, HStackWithInsets, Text, Button, Spacer,
  TextField, ScrollView, scrollViewSetChild, scrollViewScrollTo,
  textSetFontSize, textSetFontWeight, textSetFontFamily, textSetString, textSetWraps,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetClearChildren, widgetSetBackgroundColor, widgetSetWidth,
  widgetSetHidden, widgetSetHeight, widgetRemoveChild, stackSetDetachesHidden,
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
  updateSessionMode, updateSessionModel, deleteSession,
  getSessionList, getSessionAt,
  generateTitle, getActiveSessionId, setActiveSessionId,
  getActiveSessionMode, setActiveSessionMode,
  getActiveSessionModel, setActiveSessionModel,
  getMostRecentSessionId,
  loadSessionMeta, getParsedId, getParsedMode, getParsedTitle, getParsedModel,
  saveClaudeSessionUUID, loadClaudeSessionUUID,
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

// Claude Code integration
import {
  findClaudeBinary, checkClaudeAuth, startClaudeSession,
} from './claude-process';
import { parseNDJSONCost, parseNDJSONTurns } from './claude-events';

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

// Mode: 0=Chat, 1=Agent, 2=Plan, 3=Claude Code
let panelMode: number = 0;
let modeChatBtn: unknown = null;
let modeAgentBtn: unknown = null;
let modePlanBtn: unknown = null;
let modeClaudeBtn: unknown = null;
// Wrapper containers for mode tab backgrounds (NSButton ignores widgetSetBackgroundColor)
let modeChatWrap: unknown = null;
let modeAgentWrap: unknown = null;
let modePlanWrap: unknown = null;
let modeClaudeWrap: unknown = null;

// Claude Code mode state
let claudeModeActive: number = 0;
let claudeToolContainer: unknown = null;
let claudeCostLabel: unknown = null;
let claudePollTimer: number = 0;
let claudeLineBuffer = '';
let claudeLogFilePath = '';
let claudeLogOffset: number = 0;
let claudeProcessDone: number = 0;
let claudeNoDataCount: number = 0;
let claudeSessionUUID = '';
let claudeResumeSessionId = '';
let claudeSpawnedPid: number = 0;

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

// Auto-scroll: last widget added to chat (used as scroll target)
let lastAddedWidget: unknown = null;
// Max messages to render (older ones hidden to prevent endless scroll)
let maxVisibleMessages: number = 30;

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

// Live markdown streaming
let streamContainer: unknown = null;
let streamLastRenderLen: number = 0;
let streamLastRenderTime: number = 0;

// Model selector (0=Sonnet, 1=Opus, 2=Haiku)
let selectedModel: number = 0;
let modelSonnetBtn: unknown = null;
let modelOpusBtn: unknown = null;
let modelHaikuBtn: unknown = null;
let modelSonnetWrap: unknown = null;
let modelOpusWrap: unknown = null;
let modelHaikuWrap: unknown = null;
let modelRow: unknown = null;
let modelRowParent: unknown = null;
let modelRowAttached: number = 0;

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
// Auto-scroll helper
// ---------------------------------------------------------------------------

function scrollToBottom(): void {
  if (!chatScrollView) return;
  if (!lastAddedWidget) return;
  scrollViewScrollTo(chatScrollView, lastAddedWidget);
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
  let modelStr = getSelectedModelString();
  let body = '{"model":"';
  body += modelStr;
  body += '","max_tokens":4096';
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

  if (!streamContainer) {
    streamContainer = VStack(2, []);
    widgetAddChild(chatMessagesContainer, streamContainer);
    lastAddedWidget = streamContainer;
    streamLastRenderLen = 0;
    streamLastRenderTime = 0;
  }

  // Rate-limit markdown rebuilds to every ~300ms with at least 20 chars new
  const now = Date.now();
  const lenDiff = streamAccumulated.length - streamLastRenderLen;
  const timeDiff = now - streamLastRenderTime;
  let shouldRebuild: number = 0;
  if (streamLastRenderLen < 1) shouldRebuild = 1;
  if (timeDiff > 300 && lenDiff > 20) shouldRebuild = 1;

  if (shouldRebuild > 0) {
    widgetClearChildren(streamContainer);
    renderMarkdownBlock(streamAccumulated, streamContainer, panelColors, 320);
    streamLastRenderLen = streamAccumulated.length;
    streamLastRenderTime = now;
  }

  lastAddedWidget = streamContainer;
  scrollToBottom();
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
  streamContainer = null;

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
    lastAddedWidget = thinkingLabel;
    scrollToBottom();
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
  lastAddedWidget = toolDisplayContainer;
  scrollToBottom();
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
  lastAddedWidget = approvalContainer;
  scrollToBottom();
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

// ---------------------------------------------------------------------------
// Claude Code mode — callbacks from claude-state
// ---------------------------------------------------------------------------

function onClaudeToolActivity(name: string, status: string, inputDetail: string): void {
  if (!chatMessagesContainer) return;

  // status is "running" or "done"
  // "running" charCodeAt(0)===114 'r'
  if (status.length > 0 && status.charCodeAt(0) === 114) {
    let toolLabel = '\u2699 ';
    toolLabel += name;
    if (inputDetail.length > 0) {
      toolLabel += ': ';
      if (inputDetail.length > 80) {
        toolLabel += inputDetail.slice(0, 80);
        toolLabel += '...';
      } else {
        toolLabel += inputDetail;
      }
    }
    const toolText = Text(toolLabel);
    textSetFontSize(toolText, 11);
    textSetFontFamily(toolText, 11, 'Menlo');
    textSetWraps(toolText, 300);
    if (panelColors) setFg(toolText, getSideBarForeground());

    claudeToolContainer = VStackWithInsets(2, 4, 8, 4, 8);
    widgetSetBackgroundColor(claudeToolContainer, 0.15, 0.15, 0.18, 1.0);
    widgetAddChild(claudeToolContainer, toolText);
    widgetAddChild(chatMessagesContainer, claudeToolContainer);
    lastAddedWidget = claudeToolContainer;
    scrollToBottom();
  } else {
    // Tool done — mark container
    if (claudeToolContainer) {
      const doneText = Text('\u2713 done');
      textSetFontSize(doneText, 10);
      textSetFontFamily(doneText, 10, 'Menlo');
      if (panelColors) setFg(doneText, getSideBarForeground());
      widgetAddChild(claudeToolContainer, doneText);
      claudeToolContainer = null;
    }
  }
}

function onClaudeToolResult(output: string): void {
  if (!claudeToolContainer) return;
  if (output.length < 1) return;

  let displayOutput = output;
  if (displayOutput.length > 300) {
    displayOutput = output.slice(0, 300);
    displayOutput += '\n... (truncated)';
  }
  const resultText = Text(displayOutput);
  textSetFontSize(resultText, 10);
  textSetFontFamily(resultText, 10, 'Menlo');
  textSetWraps(resultText, 300);
  if (panelColors) setFg(resultText, getSideBarForeground());
  widgetAddChild(claudeToolContainer, resultText);
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
  if (claudeModeActive > 0) return;
  if (id.length < 1) return;

  setActiveSessionId(id);
  loadSessionMeta(id);

  panelMode = getActiveSessionMode();
  selectedModel = getActiveSessionModel();
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
  updateModelStyles();
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
    if (smode === 3) badge = 'CC';
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

    // Check active session
    let isActive: number = 0;
    if (sid.length === activeId.length) {
      isActive = 1;
      for (let c = 0; c < sid.length; c++) {
        if (sid.charCodeAt(c) !== activeId.charCodeAt(c)) { isActive = 0; break; }
      }
    }

    let row: unknown = null;
    if (isActive > 0) {
      const accentBar = Text('');
      widgetSetWidth(accentBar, 3);
      widgetSetHeight(accentBar, 18);
      widgetSetBackgroundColor(accentBar, 0.35, 0.45, 0.85, 1.0);
      row = HStack(4, [accentBar, badgeLabel, rowBtn, Spacer(), delBtn]);
      widgetSetBackgroundColor(row, 0.22, 0.22, 0.28, 1.0);
    } else {
      row = HStack(4, [badgeLabel, rowBtn, Spacer(), delBtn]);
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

/**
 * Inline JSON string value extractor — searches for "key":"value" and returns value.
 * Uses a specific pattern: finds "KEY": then reads the string value.
 * This avoids cross-module extractJsonString which may not work correctly in Perry.
 */
function inlineExtractValue(json: string, keyWithQuotes: string): string {
  // keyWithQuotes is like: "result":  (including quotes and colon)
  // Find the pattern in json
  let pos = -1;
  for (let i = 0; i <= json.length - keyWithQuotes.length; i++) {
    let match: number = 1;
    for (let j = 0; j < keyWithQuotes.length; j++) {
      if (json.charCodeAt(i + j) !== keyWithQuotes.charCodeAt(j)) {
        match = 0;
        break;
      }
    }
    if (match > 0) {
      pos = i + keyWithQuotes.length;
      break;
    }
  }
  if (pos < 0) return '';

  // Skip whitespace after colon
  while (pos < json.length) {
    const ch = json.charCodeAt(pos);
    if (ch === 32 || ch === 9) {
      pos += 1;
    } else {
      break;
    }
  }
  if (pos >= json.length) return '';

  // Expect opening quote
  if (json.charCodeAt(pos) !== 34) return '';
  pos += 1;

  // Read string value until closing quote
  let result = '';
  while (pos < json.length) {
    const ch = json.charCodeAt(pos);
    if (ch === 92) {
      // Backslash escape
      pos += 1;
      if (pos < json.length) {
        const next = json.charCodeAt(pos);
        if (next === 110) { result += '\n'; }
        else if (next === 116) { result += '\t'; }
        else if (next === 114) { result += '\r'; }
        else if (next === 34) { result += '"'; }
        else if (next === 92) { result += '\\'; }
        else if (next === 117) { pos += 4; result += ' '; }
        else { result += json.slice(pos, pos + 1); }
      }
    } else if (ch === 34) {
      // Closing quote
      break;
    } else {
      result += json.slice(pos, pos + 1);
    }
    pos += 1;
  }
  return result;
}

/**
 * Check if line contains a substring (inline, no cross-module call).
 */
function lineContains(line: string, sub: string): number {
  if (sub.length > line.length) return 0;
  for (let i = 0; i <= line.length - sub.length; i++) {
    let m: number = 1;
    for (let j = 0; j < sub.length; j++) {
      if (line.charCodeAt(i + j) !== sub.charCodeAt(j)) {
        m = 0;
        break;
      }
    }
    if (m > 0) return 1;
  }
  return 0;
}

/**
 * Detect event type from NDJSON line.
 * Returns: 1=system, 2=assistant, 3=result, 4=user, 0=unknown
 */
function detectClaudeEventType(line: string): number {
  // Look for "type":"system" / "type":"assistant" / "type":"result" / "type":"user"
  // "type":"system" → check for "system" at the right spot
  if (lineContains(line, '"type":"system"') > 0) return 1;
  if (lineContains(line, '"type":"assistant"') > 0) return 2;
  if (lineContains(line, '"type":"result"') > 0) return 3;
  if (lineContains(line, '"type":"user"') > 0) return 4;
  return 0;
}

/**
 * Process a single NDJSON line from Claude Code output.
 * All processing is inline in this module — no cross-module dependencies.
 * Uses exact pattern matching ("key":) to avoid ambiguous key/value collisions.
 */
function handleClaudeLine(line: string): void {
  if (line.length < 10) return;

  const evtType = detectClaudeEventType(line);
  if (evtType < 1) return;

  // System event (1) — session init
  if (evtType === 1) {
    // Extract session_id using exact pattern "session_id":"
    let sid = inlineExtractValue(line, '"session_id":');
    if (sid.length > 0) {
      claudeSessionUUID = sid;
      saveClaudeSessionUUID(getActiveSessionId(), sid);
    }
    stopThinking();
    return;
  }

  // Assistant event (2) — text or tool_use
  if (evtType === 2) {
    // Check for tool_use blocks
    if (lineContains(line, 'tool_use') > 0) {
      let toolName = inlineExtractValue(line, '"name":');
      if (toolName.length > 0) {
        // Extract tool input details
        let toolInput = inlineExtractValue(line, '"command":');
        if (toolInput.length < 1) toolInput = inlineExtractValue(line, '"file_path":');
        if (toolInput.length < 1) toolInput = inlineExtractValue(line, '"pattern":');
        onClaudeToolActivity(toolName, 'running', toolInput);
      }
    }
    // Extract text content — look for "text":" pattern after "type":"text"
    // The assistant message has content blocks like: {"type":"text","text":"actual content"}
    // We need the value of the second "text" key (the content), not "type":"text"
    if (lineContains(line, '"type":"text"') > 0) {
      // Find "type":"text" then extract the next "text":"..." value after it
      let searchPattern = '"type":"text"';
      let foundPos = -1;
      for (let i = 0; i <= line.length - searchPattern.length; i++) {
        let m: number = 1;
        for (let j = 0; j < searchPattern.length; j++) {
          if (line.charCodeAt(i + j) !== searchPattern.charCodeAt(j)) {
            m = 0;
            break;
          }
        }
        if (m > 0) {
          foundPos = i + searchPattern.length;
          break;
        }
      }
      if (foundPos > 0) {
        // Now extract "text":"value" from the remainder after "type":"text"
        let remainder = line.slice(foundPos);
        let textVal = inlineExtractValue(remainder, '"text":');
        if (textVal.length > 0) {
          streamAccumulated += textVal;
          updateStreamingDisplay();
        }
      }
    }
    return;
  }

  // Result event (3) — final output
  if (evtType === 3) {
    // Check for error: "is_error":true
    let isError: number = 0;
    if (lineContains(line, '"is_error":true') > 0) {
      isError = 1;
    }

    // Extract result text using EXACT pattern: ,"result":" (with leading comma to disambiguate from "type":"result")
    let resultText = inlineExtractValue(line, ',"result":');
    let costVal = parseNDJSONCost(line);
    let turnsVal = parseNDJSONTurns(line);
    let sid = inlineExtractValue(line, '"session_id":');
    if (sid.length > 0) {
      claudeSessionUUID = sid;
      saveClaudeSessionUUID(getActiveSessionId(), sid);
      claudeResumeSessionId = sid;
    }

    // On error, clear stale resume ID so next attempt starts fresh
    if (isError > 0) {
      claudeResumeSessionId = '';
      saveClaudeSessionUUID(getActiveSessionId(), '');
    }

    // Stop polling
    claudeProcessDone = 1;
    if (claudePollTimer > 0) {
      clearInterval(claudePollTimer);
      claudePollTimer = 0;
    }
    // Finalize UI
    stopThinking();
    claudeModeActive = 0;

    if (isError > 0) {
      // Show error message
      let errMsg = resultText;
      if (errMsg.length < 1) errMsg = 'Claude Code returned an error.';
      if (chatMessagesContainer) {
        const errBlock = VStackWithInsets(4, 8, 8, 8, 8);
        widgetSetBackgroundColor(errBlock, 0.3, 0.12, 0.12, 1.0);
        const errLabel = Text(errMsg);
        textSetFontSize(errLabel, 12);
        textSetWraps(errLabel, 300);
        if (panelColors) setFg(errLabel, getSideBarForeground());
        widgetAddChild(errBlock, errLabel);
        widgetAddChild(chatMessagesContainer, errBlock);
        lastAddedWidget = errBlock;
        scrollToBottom();
      }
      streamAccumulated = '';
      streamDisplayLabel = null;
      streamContainer = null;
      return;
    }

    if (streamAccumulated.length > 0) {
      appendMessage(0, streamAccumulated);
    } else if (resultText.length > 0) {
      appendMessage(0, resultText);
    }
    streamAccumulated = '';
    streamDisplayLabel = null;
    streamContainer = null;
    // Show cost
    if (chatMessagesContainer && costVal >= 0) {
      let costStr = 'Cost: $';
      let costInt = Math.floor(costVal * 10000);
      let costMain = Math.floor(costInt / 10000);
      let costFrac = costInt % 10000;
      costStr += String(costMain);
      costStr += '.';
      if (costFrac < 1000) costStr += '0';
      if (costFrac < 100) costStr += '0';
      if (costFrac < 10) costStr += '0';
      costStr += String(costFrac);
      if (turnsVal >= 0) {
        costStr += ' | Turns: ';
        costStr += String(turnsVal);
      }
      claudeCostLabel = Text(costStr);
      textSetFontSize(claudeCostLabel, 10);
      textSetFontFamily(claudeCostLabel, 10, 'Menlo');
      if (panelColors) setFg(claudeCostLabel, getSideBarForeground());
      widgetAddChild(chatMessagesContainer, claudeCostLabel);
      lastAddedWidget = claudeCostLabel;
    }
    updateMessages();
    return;
  }

  // User event (4) — tool results (internal to Claude Code)
  if (evtType === 4) {
    // Extract tool output before marking done
    let toolOutput = inlineExtractValue(line, '"stdout":');
    if (toolOutput.length < 1) toolOutput = inlineExtractValue(line, '"content":');
    onClaudeToolResult(toolOutput);
    onClaudeToolActivity('', 'done', '');
  }
}

/**
 * Claude Code poll tick — called from setInterval in chat-panel (same module).
 * Reads log file directly, splits lines, processes each inline.
 * No cross-module state dependencies.
 */
function claudePollTick(): void {
  if (claudeModeActive < 1) return;
  if (claudeLogFilePath.length < 1) return;
  if (claudeProcessDone > 0) return;

  // Read the log file directly from this module
  let content = '';
  try {
    content = readFileSync(claudeLogFilePath);
  } catch (e) {
    return;
  }

  if (content.length <= claudeLogOffset) {
    // No new data — count consecutive empty polls
    claudeNoDataCount += 1;
    // After 60 empty polls (~3 seconds), check if process exited via kill -0
    if (claudeNoDataCount > 60) {
      claudeNoDataCount = 0;
      let processGone: number = 0;
      try {
        let checkCmd = 'kill -0 ';
        checkCmd += String(claudeSpawnedPid);
        execSync(checkCmd);
      } catch (e) {
        processGone = 1;
      }
      if (processGone > 0) {
        claudeProcessDone = 1;
        if (claudePollTimer > 0) {
          clearInterval(claudePollTimer);
          claudePollTimer = 0;
        }
        // Finalize with whatever we have
        if (claudeModeActive > 0) {
          claudeModeActive = 0;
          stopThinking();
          if (streamAccumulated.length > 0) {
            appendMessage(0, streamAccumulated);
          }
          streamAccumulated = '';
          streamDisplayLabel = null;
          streamContainer = null;
          updateMessages();
        }
      }
    }
    return;
  }

  // Got new data — reset no-data counter
  claudeNoDataCount = 0;

  // Extract new data since last read
  const newData = content.slice(claudeLogOffset);
  claudeLogOffset = content.length;

  // Prepend any incomplete line from previous tick
  let buffer = claudeLineBuffer;
  buffer += newData;
  claudeLineBuffer = '';

  // Split into lines and process each
  let lineStart = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer.charCodeAt(i) === 10) {
      const line = buffer.slice(lineStart, i);
      if (line.length > 0) {
        handleClaudeLine(line);
      }
      lineStart = i + 1;
    }
  }

  // Save any remaining incomplete line
  if (lineStart < buffer.length) {
    claudeLineBuffer = buffer.slice(lineStart);
  }
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
  if (claudeModeActive > 0) return;

  const sendText = chatInputText;
  appendMessage(1, sendText);
  chatInputText = '';
  if (chatInput) textfieldSetString(chatInput, '');
  updateMessages();
  scrollToBottom();

  // Build request — use fresh path (Perry: module vars stale in callbacks)
  const currentPath = getCurrentMsgFilePath();
  let fileContent = '';
  try { fileContent = readFileSync(currentPath); } catch (e) {}

  let systemPrompt = 'You are Hone, an AI coding assistant built into the Hone IDE. Be concise and helpful.';
  let toolsJson = '';

  if (panelMode === 3) {
    // Claude Code mode — spawn subprocess instead of API call
    claudeModeActive = 1;
    streamAccumulated = '';
    streamDisplayLabel = null;
    streamContainer = null;
    claudeLineBuffer = '';
    claudeLogOffset = 0;
    claudeProcessDone = 0;
    claudeNoDataCount = 0;
    startThinking();

    // Build log file path in THIS module (avoids cross-module string returns)
    let logPath = getAppDataDir();
    logPath += '/claude-session-';
    logPath += String(Date.now());
    logPath += '.log';
    claudeLogFilePath = logPath;

    // Load resume ID from stored session
    const storedUUID = loadClaudeSessionUUID(getActiveSessionId());

    // Pass log path to startClaudeSession so it redirects output there
    claudeSpawnedPid = startClaudeSession(sendText, wsRoot, storedUUID, logPath);

    // Start polling from THIS module (same-module setInterval pattern works in Perry)
    claudePollTimer = setInterval(() => { claudePollTick(); }, 50);
    return;
  }

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
  if (claudeModeActive > 0) return;
  msgCount = 0;
  clearContext();
  resetAgentState();
  claudeSessionUUID = '';
  claudeResumeSessionId = '';
  claudeProcessDone = 0;
  streamAccumulated = '';
  streamingMsgBlock = null;
  streamContainer = null;
  firstUserMsgSent = 0;

  // New sessions always default to Chat mode (0)
  panelMode = 0;
  setActiveSessionMode(0);
  const newId = createNewSession(0);
  msgFilePath = getSessionFilePath(newId);

  // Persist model choice for new session
  updateSessionModel(newId, selectedModel);

  updateMessages();
  updateModeTabStyles();
  renderChipsArea();
  refreshSessionList();
}

// ---------------------------------------------------------------------------
// Mode tabs
// ---------------------------------------------------------------------------

function onModeChat(): void {
  // Mode locked if current session is Claude Code (mode 3)
  if (getActiveSessionMode() === 3) return;
  panelMode = 0;
  updateSessionMode(getActiveSessionId(), 0);
  setActiveSessionMode(0);
  updateModeTabStyles();
  updateMessages();
}

function onModeAgent(): void {
  if (getActiveSessionMode() === 3) return;
  panelMode = 1;
  updateSessionMode(getActiveSessionId(), 1);
  setActiveSessionMode(1);
  updateModeTabStyles();
  updateMessages();
}

function onModePlan(): void {
  if (getActiveSessionMode() === 3) return;
  panelMode = 2;
  updateSessionMode(getActiveSessionId(), 2);
  setActiveSessionMode(2);
  updateModeTabStyles();
  updateMessages();
}

function onModeClaude(): void {
  // If current session has API messages (modes 0-2), create new session
  const curMode = getActiveSessionMode();
  if (curMode < 3) {
    const fp = getCurrentMsgFilePath();
    let hasMessages: number = 0;
    try {
      const fc = readFileSync(fp);
      if (fc.length > 1) hasMessages = 1;
    } catch (e) {}
    if (hasMessages > 0) {
      panelMode = 3;
      onNewChat();
      setActiveSessionMode(3);
      updateModeTabStyles();
      return;
    }
  }
  panelMode = 3;
  updateSessionMode(getActiveSessionId(), 3);
  setActiveSessionMode(3);
  updateModeTabStyles();
  updateMessages();
}

function styleModeTab(btn: unknown, wrap: unknown, active: number): void {
  if (!btn) return;
  if (active > 0) {
    setBtnFg(btn, '#ffffff');
    if (wrap) widgetSetBackgroundColor(wrap, 0.25, 0.30, 0.58, 1.0);
  } else {
    setBtnFg(btn, '#707070');
    if (wrap) widgetSetBackgroundColor(wrap, 0.0, 0.0, 0.0, 0.0);
  }
}

function styleDisabledTab(btn: unknown, wrap: unknown): void {
  if (!btn) return;
  setBtnFg(btn, '#404040');
  if (wrap) widgetSetBackgroundColor(wrap, 0.0, 0.0, 0.0, 0.0);
}

function updateModeTabStyles(): void {
  const isClaudeSession = panelMode === 3 ? 1 : 0;
  if (isClaudeSession > 0) {
    // Claude Code session — lock API tabs
    styleDisabledTab(modeChatBtn, modeChatWrap);
    styleDisabledTab(modeAgentBtn, modeAgentWrap);
    styleDisabledTab(modePlanBtn, modePlanWrap);
    styleModeTab(modeClaudeBtn, modeClaudeWrap, 1);
  } else {
    styleModeTab(modeChatBtn, modeChatWrap, panelMode === 0 ? 1 : 0);
    styleModeTab(modeAgentBtn, modeAgentWrap, panelMode === 1 ? 1 : 0);
    styleModeTab(modePlanBtn, modePlanWrap, panelMode === 2 ? 1 : 0);
    styleModeTab(modeClaudeBtn, modeClaudeWrap, panelMode === 3 ? 1 : 0);
  }
  updateModelRowVisibility();
}

// ---------------------------------------------------------------------------
// Model selector
// ---------------------------------------------------------------------------

function getSelectedModelString(): string {
  if (selectedModel === 1) return 'claude-opus-4-20250514';
  if (selectedModel === 2) return 'claude-haiku-4-5-20251001';
  return 'claude-sonnet-4-20250514';
}

function onModelSonnet(): void {
  selectedModel = 0;
  updateModelStyles();
  updateSessionModel(getActiveSessionId(), 0);
  setActiveSessionModel(0);
}

function onModelOpus(): void {
  selectedModel = 1;
  updateModelStyles();
  updateSessionModel(getActiveSessionId(), 1);
  setActiveSessionModel(1);
}

function onModelHaiku(): void {
  selectedModel = 2;
  updateModelStyles();
  updateSessionModel(getActiveSessionId(), 2);
  setActiveSessionModel(2);
}

function styleModelBtn(btn: unknown, wrap: unknown, active: number): void {
  if (!btn) return;
  if (active > 0) {
    setBtnFg(btn, '#ffffff');
    if (wrap) widgetSetBackgroundColor(wrap, 0.22, 0.28, 0.50, 1.0);
  } else {
    setBtnFg(btn, '#707070');
    if (wrap) widgetSetBackgroundColor(wrap, 0.0, 0.0, 0.0, 0.0);
  }
}

function updateModelStyles(): void {
  styleModelBtn(modelSonnetBtn, modelSonnetWrap, selectedModel === 0 ? 1 : 0);
  styleModelBtn(modelOpusBtn, modelOpusWrap, selectedModel === 1 ? 1 : 0);
  styleModelBtn(modelHaikuBtn, modelHaikuWrap, selectedModel === 2 ? 1 : 0);
}

function updateModelRowVisibility(): void {
  if (!modelRowParent) return;
  if (panelMode === 3) {
    // Remove model row from wrapper — empty VStack collapses to 0 height
    if (modelRowAttached > 0 && modelRow) {
      widgetClearChildren(modelRowParent);
      modelRowAttached = 0;
    }
  } else {
    // Re-add model row to wrapper
    if (modelRowAttached < 1 && modelRow) {
      widgetAddChild(modelRowParent, modelRow);
      modelRowAttached = 1;
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
  lastAddedWidget = null;

  const fp = getCurrentMsgFilePath();
  let fileContent = '';
  try { fileContent = readFileSync(fp); } catch (e) {}

  if (fileContent.length < 2) {
    let hintText = 'Ask a question about your code';
    if (panelMode === 1) hintText = 'Describe a task for the AI agent';
    if (panelMode === 2) hintText = 'Describe what you want to plan';
    if (panelMode === 3) hintText = 'Ask Claude Code (uses your Claude.ai subscription)';
    const hint = Text(hintText);
    textSetFontSize(hint, 12);
    if (panelColors) setFg(hint, getSideBarForeground());
    widgetAddChild(chatMessagesContainer, hint);
    return;
  }

  // Count total messages first (pairs of lines)
  let totalMessages: number = 0;
  for (let c = 0; c < fileContent.length; c++) {
    if (fileContent.charCodeAt(c) === 10) totalMessages += 1;
  }
  totalMessages = Math.floor((totalMessages + 1) / 2);

  // Calculate skip count — only show last maxVisibleMessages
  let skipCount: number = 0;
  if (totalMessages > maxVisibleMessages) {
    skipCount = totalMessages - maxVisibleMessages;
  }

  // Show "N older messages hidden" indicator
  if (skipCount > 0 && chatMessagesContainer) {
    let hiddenText = '... ';
    hiddenText += String(skipCount);
    hiddenText += ' older messages hidden';
    const hiddenLabel = Text(hiddenText);
    textSetFontSize(hiddenLabel, 10);
    if (panelColors) setFg(hiddenLabel, getSideBarForeground());
    widgetAddChild(chatMessagesContainer, hiddenLabel);
  }

  // Parse file: pairs of (role line, content line)
  let lineStart = 0;
  let lineIdx = 0;
  let msgIdx: number = 0;
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
        msgIdx += 1;
        // Skip older messages beyond the visible limit
        if (msgIdx <= skipCount) {
          lineIdx += 1;
          lineStart = i + 1;
          continue;
        }

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
          lastAddedWidget = toolBlock;
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
          lastAddedWidget = msgBlock;
        }
      }
      lineIdx += 1;
      lineStart = i + 1;
    }
  }
  // Auto-scroll to bottom after rendering messages
  scrollToBottom();
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
  stackSetDetachesHidden(container, 1);

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
  // Claude Code: no cross-module callbacks — polling + line processing all inline
  setChipsRenderCallback(() => { renderChipsArea(); });

  // --- Header row: New Chat ---
  const newChatBtn = Button('+ New', () => { onNewChat(); });
  buttonSetBordered(newChatBtn, 0);
  textSetFontSize(newChatBtn, 11);
  setBtnFg(newChatBtn, getSideBarForeground());

  const headerRow = HStack(4, [newChatBtn, Spacer()]);
  widgetAddChild(container, headerRow);

  modeChatBtn = Button('Chat', () => { onModeChat(); });
  buttonSetBordered(modeChatBtn, 0);
  textSetFontSize(modeChatBtn, 11);
  modeChatWrap = HStackWithInsets(0, 6, 3, 6, 3);
  widgetAddChild(modeChatWrap, modeChatBtn);

  modeAgentBtn = Button('Agent', () => { onModeAgent(); });
  buttonSetBordered(modeAgentBtn, 0);
  textSetFontSize(modeAgentBtn, 11);
  modeAgentWrap = HStackWithInsets(0, 6, 3, 6, 3);
  widgetAddChild(modeAgentWrap, modeAgentBtn);

  modePlanBtn = Button('Plan', () => { onModePlan(); });
  buttonSetBordered(modePlanBtn, 0);
  textSetFontSize(modePlanBtn, 11);
  modePlanWrap = HStackWithInsets(0, 6, 3, 6, 3);
  widgetAddChild(modePlanWrap, modePlanBtn);

  modeClaudeBtn = Button('Claude Code', () => { onModeClaude(); });
  buttonSetBordered(modeClaudeBtn, 0);
  textSetFontSize(modeClaudeBtn, 11);
  modeClaudeWrap = HStackWithInsets(0, 6, 3, 6, 3);
  widgetAddChild(modeClaudeWrap, modeClaudeBtn);

  const modeRow = HStack(2, [modeChatWrap, modeAgentWrap, modePlanWrap, modeClaudeWrap, Spacer()]);
  widgetAddChild(container, modeRow);

  // --- Model selector row (hidden for Claude Code mode) ---
  modelSonnetBtn = Button('Sonnet', () => { onModelSonnet(); });
  buttonSetBordered(modelSonnetBtn, 0);
  textSetFontSize(modelSonnetBtn, 10);
  modelSonnetWrap = HStackWithInsets(0, 5, 2, 5, 2);
  widgetAddChild(modelSonnetWrap, modelSonnetBtn);

  modelOpusBtn = Button('Opus', () => { onModelOpus(); });
  buttonSetBordered(modelOpusBtn, 0);
  textSetFontSize(modelOpusBtn, 10);
  modelOpusWrap = HStackWithInsets(0, 5, 2, 5, 2);
  widgetAddChild(modelOpusWrap, modelOpusBtn);

  modelHaikuBtn = Button('Haiku', () => { onModelHaiku(); });
  buttonSetBordered(modelHaikuBtn, 0);
  textSetFontSize(modelHaikuBtn, 10);
  modelHaikuWrap = HStackWithInsets(0, 5, 2, 5, 2);
  widgetAddChild(modelHaikuWrap, modelHaikuBtn);

  modelRow = HStack(2, [modelSonnetWrap, modelOpusWrap, modelHaikuWrap, Spacer()]);
  // Wrap in VStack so clearing children collapses it (widgetSetHidden doesn't work on HStack)
  modelRowParent = VStack(0, []);
  widgetAddChild(modelRowParent, modelRow);
  modelRowAttached = 1;
  widgetAddChild(container, modelRowParent);

  // Load model from session
  selectedModel = getActiveSessionModel();
  updateModelStyles();
  updateModelRowVisibility();

  // --- Session list (always visible) ---
  const sessionLabel = Text('History');
  textSetFontSize(sessionLabel, 11);
  textSetFontWeight(sessionLabel, 11, 0.5);
  if (panelColors) setFg(sessionLabel, getSideBarForeground());
  widgetAddChild(container, sessionLabel);

  sessionListContainer = VStack(2, []);
  sessionListScrollView = ScrollView();
  scrollViewSetChild(sessionListScrollView, sessionListContainer);
  widgetSetHeight(sessionListScrollView, 120);
  sessionListVisible = 1;
  widgetAddChild(container, sessionListScrollView);
  refreshSessionList();

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

  // Show setup hints based on mode
  if (panelMode === 3) {
    // Claude Code mode — check binary and auth
    const claudeBin = findClaudeBinary();
    if (claudeBin.length < 3) {
      const hintBlock = VStackWithInsets(4, 8, 8, 8, 8);
      widgetSetBackgroundColor(hintBlock, 0.15, 0.18, 0.25, 1.0);

      const hintTitle = Text('Claude Code Required');
      textSetFontSize(hintTitle, 12);
      textSetFontWeight(hintTitle, 12, 0.7);
      setFg(hintTitle, getSideBarForeground());
      widgetAddChild(hintBlock, hintTitle);

      const hint1 = Text('Install Claude Code: npm install -g @anthropic-ai/claude-code');
      textSetFontSize(hint1, 11);
      setFg(hint1, getSideBarForeground());
      widgetAddChild(hintBlock, hint1);

      widgetAddChild(chatMessagesContainer, hintBlock);
    } else {
      const authOk = checkClaudeAuth();
      if (authOk < 1) {
        const hintBlock = VStackWithInsets(4, 8, 8, 8, 8);
        widgetSetBackgroundColor(hintBlock, 0.15, 0.18, 0.25, 1.0);

        const hintTitle = Text('Sign In Required');
        textSetFontSize(hintTitle, 12);
        textSetFontWeight(hintTitle, 12, 0.7);
        setFg(hintTitle, getSideBarForeground());
        widgetAddChild(hintBlock, hintTitle);

        const hint1 = Text('Run "claude auth login" in your terminal to sign in.');
        textSetFontSize(hint1, 11);
        setFg(hint1, getSideBarForeground());
        widgetAddChild(hintBlock, hint1);

        widgetAddChild(chatMessagesContainer, hintBlock);
      } else {
        updateMessages();
      }
    }
  } else if (chatApiKey.length < 5) {
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
