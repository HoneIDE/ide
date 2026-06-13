/**
 * AI Chat/Agent panel — streaming AI assistant with tool execution.
 *
 * Three modes: Chat (0), Agent (1), Plan (2).
 * Uses Perry native SSE streaming via streamStart/streamPoll/streamStatus/streamClose.
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, VStackWithInsets, HStackWithInsets, Text, Button, Spacer,
  TextField, ScrollView,
  scrollViewSetChild, scrollViewScrollTo,
  textSetFontSize, textSetFontWeight, textSetFontFamily, textSetString, textSetWraps,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetAddOverlay, widgetSetOverlayFrame,
  widgetClearChildren, widgetSetBackgroundColor, widgetSetWidth,
  widgetSetHidden, widgetSetHeight, widgetRemoveChild, stackSetDetachesHidden,
  textfieldSetString, textfieldFocus, textfieldGetString, textfieldSetOnSubmit,
  textfieldSetOnFocus, textfieldBlurAll,
  saveFileDialog,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { execText, spawnText } from '../../../process-compat';
import { isDirectory } from '../../../fs-compat';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { setFg, setBtnFg, setBg, monoFont } from '../../ui-helpers';
import { telemetryTrackAiChat, telemetryTrackAiAgent } from '../../telemetry';
import { getAppDataDir, canRunShellCommands } from '../../paths';
import { getWorkbenchSettings } from '../../settings';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getSideBarBackground, getSecondaryTextColor, getActivityBarForeground, isCurrentThemeDark, getInputBackground, getPanelBackground, getEditorBackground } from '../../theme/theme-colors';

// Platform constant — 0=macOS, 1=iOS, 3=Windows, 4=Linux, 5=web.
declare const __platform__: number;

// Session persistence
import {
  ensureChatsDir, getSessionFilePath, createNewSession,
  loadSessionMessages, saveSessionMessages, updateSessionTitle,
  updateSessionMode, updateSessionModel, updateSessionTimestamp,
  deleteSession,
  getSessionList, getSessionAt,
  generateTitle, getActiveSessionId, setActiveSessionId,
  getActiveSessionMode, setActiveSessionMode,
  getActiveSessionModel, setActiveSessionModel,
  getMostRecentSessionId,
  loadSessionMeta, getParsedId, getParsedMode, getParsedTitle, getParsedModel,
  getParsedTimestamp,
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
  findClaudeBinary, checkClaudeAuth, startClaudeSession, stopClaudeSession,
} from './claude-process';
import { parseNDJSONCost, parseNDJSONTurns } from './claude-events';

// Multi-provider support
import {
  getModelApiId, getProviderIndex, getProviderFormat,
  getProviderApiUrl, getModelCount, getPickerLabel,
} from './provider-config';
import { buildProviderBody } from './request-builders';

// ---------------------------------------------------------------------------
// Theme-aware background helpers (replaces hardcoded dark RGBA values)
// ---------------------------------------------------------------------------

/** Container background (messages, tool blocks, session list items). */
function setChatBg(w: unknown): void {
  if (isCurrentThemeDark() > 0) {
    widgetSetBackgroundColor(w, 0.18, 0.18, 0.22, 1.0);
  } else {
    widgetSetBackgroundColor(w, 0.94, 0.94, 0.96, 1.0);
  }
}

/** Slightly darker container (thinking blocks, header areas). */
function setChatBgDeep(w: unknown): void {
  if (isCurrentThemeDark() > 0) {
    widgetSetBackgroundColor(w, 0.12, 0.12, 0.15, 1.0);
  } else {
    widgetSetBackgroundColor(w, 0.90, 0.90, 0.92, 1.0);
  }
}

/** Tool/code block background. */
function setChatBgCode(w: unknown): void {
  if (isCurrentThemeDark() > 0) {
    widgetSetBackgroundColor(w, 0.15, 0.15, 0.18, 1.0);
  } else {
    widgetSetBackgroundColor(w, 0.92, 0.92, 0.94, 1.0);
  }
}

/** Context chip background. */
function setChatBgChip(w: unknown): void {
  if (isCurrentThemeDark() > 0) {
    widgetSetBackgroundColor(w, 0.2, 0.2, 0.25, 1.0);
  } else {
    widgetSetBackgroundColor(w, 0.88, 0.88, 0.92, 1.0);
  }
}

/** Divider line. */
function setChatDivider(w: unknown): void {
  if (isCurrentThemeDark() > 0) {
    widgetSetBackgroundColor(w, 0.3, 0.3, 0.35, 1.0);
  } else {
    widgetSetBackgroundColor(w, 0.78, 0.78, 0.82, 1.0);
  }
}

/** Active/selected session cell. */
function setChatBgActive(w: unknown): void {
  if (isCurrentThemeDark() > 0) {
    widgetSetBackgroundColor(w, 0.22, 0.22, 0.28, 1.0);
  } else {
    widgetSetBackgroundColor(w, 0.85, 0.88, 0.95, 1.0);
  }
}

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
// Claude Code subprocess inactivity watchdog. The poll loop only finalizes
// when the process EXITS (liveness check). A hung claude (alive but silent
// forever) otherwise spins the poll timer indefinitely, pins the chat on
// "thinking", AND leaks the subprocess — and the user can't even switch
// sessions (blocked while claudeModeActive) or cancel (no cancel wired to
// stopClaudeSession). 180s is very generous: the local claude CLI can pause
// long during tool execution, so this only trips on a genuine hang.
let _claudeLastDataMs: number = 0;
const CLAUDE_IDLE_TIMEOUT_MS = 180000;
let claudeSessionUUID = '';
let claudeResumeSessionId = '';
let claudeSpawnedPid: number = 0;

// Streaming state
let streamHandle: number = 0;
let streamActive: number = 0;
let streamPollTimer: number = 0;
let streamAccumulated = '';
// Stream inactivity watchdog (see pollStreamTick). 90s with zero bytes
// while the stream is still "connecting/streaming" means the connection is
// effectively dead — AI providers send incremental events well within this,
// even during long tool/thinking pauses, so 90s only trips on a real stall.
let _streamLastDataMs: number = 0;
const STREAM_IDLE_TIMEOUT_MS = 90000;
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
// SHIP-V1-GAPS.md #61: @-mention popup state.
let mentionsContainer: unknown = null;
let mentionsVisible: number = 0;
let mentionsLastQuery: string = '';
// Cached workspace file list — built lazily on first @-typing so chat startup
// stays cheap on large repos.
let _chatFileIndex: string[] = [];
let _chatFileIndexBuilt: number = 0;
let _chatFileIndexRoot: string = '';

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

// Model selector — flat ID (0–15), provider format for SSE parsing
let selectedModelId: number = 0;
let activeProviderFormat: number = 0; // 0=anthropic, 1=openai, 2=google, 3=ollama
let modelBtn: unknown = null;
let modelListContainer: unknown = null;
let modelListVisible: number = 0;

// History search
let historySearchField: unknown = null;
let historySearchText = '';
let historyDropdown: unknown = null;
let historyDropdownVisible: number = 0;

// Remote guest mode — Claude relay (set from render.ts)
let isRemoteGuest: number = 0;
let _relaySendFn: (payload: string) => void = _noopRelay;
let _relayForwardFn: (line: string) => void = _noopRelay;
let isRelayHostMode: number = 0;

function _noopRelay(p: string): void {}

// ---------------------------------------------------------------------------
// Unicode decode helpers (inline — cross-module function calls from getters are unreliable in Perry)
// ---------------------------------------------------------------------------

function hexValCP(ch: number): number {
  if (ch >= 48 && ch <= 57) return ch - 48;
  if (ch >= 65 && ch <= 70) return ch - 55;
  if (ch >= 97 && ch <= 102) return ch - 87;
  return -1;
}

function decodeUHexCP(s: string, pos: number): string {
  if (pos + 5 >= s.length) return ' ';
  const a = hexValCP(s.charCodeAt(pos + 2));
  const b = hexValCP(s.charCodeAt(pos + 3));
  const c = hexValCP(s.charCodeAt(pos + 4));
  const d = hexValCP(s.charCodeAt(pos + 5));
  if (a < 0 || b < 0 || c < 0 || d < 0) return ' ';
  const code = (a << 12) | (b << 8) | (c << 4) | d;
  return String.fromCharCode(code);
}

// Title stream guard
let titleStreamActive: number = 0;

// Claude Code metadata (from system event)
let claudeModelDisplay = '';
let claudeVersionDisplay = '';
let claudePermModeDisplay = '';
let claudeInfoRow: unknown = null;

// Rate limit state
let claudeRateLimited: number = 0;
let claudeRateLimitResetEpoch: number = 0;
let claudeRateLimitTimer: number = 0;
let claudeRateLimitLabel: unknown = null;

// Tool use tracking (for linking tool calls to results)
let claudeLastToolUseId = '';
let claudeLastToolUseName = '';

// Thinking block state
let thinkingBlockWidget: unknown = null;
let thinkingBlockContent: unknown = null;
let thinkingBlockExpanded: number = 0;

// Per-session stats
let claudeTotalDurationMs: number = 0;
let claudeTotalInputTokens: number = 0;
let claudeTotalOutputTokens: number = 0;

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

/** Mark this chat panel as running on a remote guest device. */
export function setChatRemoteGuest(isGuest: number): void {
  isRemoteGuest = isGuest;
}

/** Set the relay send function for forwarding Claude requests to host. */
export function setChatRelaySendFn(fn: (payload: string) => void): void {
  _relaySendFn = fn;
}

/** Set the relay forward function — host calls this to forward NDJSON lines to guest. */
export function setChatRelayForwardFn(fn: (line: string) => void): void {
  _relayForwardFn = fn;
}

/**
 * Host: start Claude subprocess on behalf of remote guest.
 * Called from render.ts when host receives CLAUDE_REQ from guest.
 */
export function startClaudeForRelay(prompt: string): void {
  isRelayHostMode = 1;
  claudeModeActive = 1;
  claudeProcessDone = 0;
  claudeNoDataCount = 0;
  claudeLineBuffer = '';
  claudeLogOffset = 0;
  streamAccumulated = '';

  let logPath = getAppDataDir();
  logPath += '/claude-relay-';
  logPath += String(Date.now());
  logPath += '.log';
  claudeLogFilePath = logPath;

  const storedUUID = loadClaudeSessionUUID(getActiveSessionId());
  _claudeLastDataMs = Date.now();
  claudeSpawnedPid = startClaudeSession(prompt, wsRoot, storedUUID, logPath, '', '', 0);
  claudePollTimer = setInterval(() => { claudePollTick(); }, 50);
}

/**
 * Guest: process a raw NDJSON line forwarded from host via relay.
 * This is the same as the host's handleClaudeLine but exposed publicly.
 */
export function handleClaudeRelayLine(line: string): void {
  handleClaudeLine(line);
}

/**
 * Handle a Claude relay event from the host (called by render.ts message dispatcher).
 * operation: 'claudeStream', 'claudeResult', 'claudeError'
 * data: the JSON payload string from the relay message
 */
export function handleClaudeRelayEvent(operation: string, data: string): void {
  // claudeStream: charCodeAt(6) === 83 'S' (length 12)
  if (operation.length === 12 && operation.charCodeAt(6) === 83) {
    // Extract delta text
    let delta = inlineExtractRelayField(data, '"delta":');
    let deltaType = inlineExtractRelayField(data, '"deltaType":');
    let toolName = inlineExtractRelayField(data, '"toolName":');

    // 'text' deltaType: charCodeAt(0) === 116 't'
    if (deltaType.length >= 4 && deltaType.charCodeAt(0) === 116) {
      streamAccumulated += delta;
      updateStreamingDisplay();
    }
    // 'tool' deltaType: charCodeAt(0) === 116 't', charCodeAt(1) === 111 'o'
    if (deltaType.length >= 4 && deltaType.charCodeAt(0) === 116 && deltaType.charCodeAt(1) === 111) {
      if (toolName.length > 0) {
        onClaudeToolActivity(toolName, 'running', '');
      }
    }
    // 'toolDone' deltaType: charCodeAt(4) === 68 'D'
    if (deltaType.length >= 8 && deltaType.charCodeAt(4) === 68) {
      onClaudeToolActivity('', 'done', '');
    }
    return;
  }

  // claudeResult: charCodeAt(6) === 82 'R' (length 12)
  if (operation.length === 12 && operation.charCodeAt(6) === 82) {
    let resultText = inlineExtractRelayField(data, '"result":');
    let costStr = inlineExtractRelayField(data, '"costUsd":');
    let turnsStr = inlineExtractRelayField(data, '"numTurns":');
    let costVal: number = -1;
    let turnsVal: number = -1;
    if (costStr.length > 0) costVal = Number(costStr);
    if (turnsStr.length > 0) turnsVal = Number(turnsStr);

    // Finalize
    stopThinking();
    claudeModeActive = 0;

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
      let costLabel = t('Cost') + ': $';
      let costInt = Math.floor(costVal * 10000);
      let costMain = Math.floor(costInt / 10000);
      let costFrac = costInt % 10000;
      costLabel += String(costMain);
      costLabel += '.';
      if (costFrac < 1000) costLabel += '0';
      if (costFrac < 100) costLabel += '0';
      if (costFrac < 10) costLabel += '0';
      costLabel += String(costFrac);
      if (turnsVal >= 0) {
        costLabel += ' | ' + t('Turns') + ': ';
        costLabel += String(turnsVal);
      }
      claudeCostLabel = Text(costLabel);
      textSetFontSize(claudeCostLabel, 10);
      textSetFontFamily(claudeCostLabel, 10, monoFont());
      setFg(claudeCostLabel, getSideBarForeground());
      widgetAddChild(chatMessagesContainer, claudeCostLabel);
      lastAddedWidget = claudeCostLabel;
    }
    updateMessages();
    return;
  }

  // claudeError: charCodeAt(6) === 69 'E' (length 11)
  if (operation.length === 11 && operation.charCodeAt(6) === 69) {
    let errMsg = inlineExtractRelayField(data, '"error":');
    if (errMsg.length < 1) errMsg = t('Claude Code error from host.');

    stopThinking();
    claudeModeActive = 0;
    streamAccumulated = '';
    streamDisplayLabel = null;
    streamContainer = null;

    if (chatMessagesContainer) {
      const errBlock = VStackWithInsets(4, 8, 8, 8, 8);
      if (isCurrentThemeDark() > 0) { widgetSetBackgroundColor(errBlock, 0.3, 0.12, 0.12, 1.0); } else { widgetSetBackgroundColor(errBlock, 1.0, 0.9, 0.9, 1.0); };
      const errLabel = Text(errMsg);
      textSetFontSize(errLabel, 12);
      textSetWraps(errLabel, 300);
      setFg(errLabel, getSideBarForeground());
      widgetAddChild(errBlock, errLabel);
      widgetAddChild(chatMessagesContainer, errBlock);
      lastAddedWidget = errBlock;
      scrollToBottom();
    }
    return;
  }
}

/**
 * Extract a JSON string field value from relay data.
 * Pattern: "key":"value" — keyWithColon includes the colon, e.g. '"delta":'
 * Inline to avoid cross-module string-return issues in Perry.
 */
function inlineExtractRelayField(json: string, keyWithColon: string): string {
  let pos = -1;
  for (let i = 0; i <= json.length - keyWithColon.length; i++) {
    let match: number = 1;
    for (let j = 0; j < keyWithColon.length; j++) {
      if (json.charCodeAt(i + j) !== keyWithColon.charCodeAt(j)) {
        match = 0;
        break;
      }
    }
    if (match > 0) {
      pos = i + keyWithColon.length;
      break;
    }
  }
  if (pos < 0) return '';

  // Skip whitespace
  while (pos < json.length) {
    const ch = json.charCodeAt(pos);
    if (ch === 32 || ch === 9) { pos += 1; } else { break; }
  }
  if (pos >= json.length) return '';

  // Check for opening quote — if not a string, read until , or }
  if (json.charCodeAt(pos) !== 34) {
    // Numeric or boolean value — read until comma or closing brace
    let numStart = pos;
    while (pos < json.length) {
      const ch = json.charCodeAt(pos);
      if (ch === 44 || ch === 125) break;  // , or }
      pos += 1;
    }
    return json.slice(numStart, pos);
  }

  // String value
  pos += 1; // skip opening quote
  let result = '';
  while (pos < json.length) {
    const ch = json.charCodeAt(pos);
    if (ch === 92) {
      pos += 1;
      if (pos < json.length) {
        const next = json.charCodeAt(pos);
        if (next === 110) { result += '\n'; }
        else if (next === 116) { result += '\t'; }
        else if (next === 114) { result += '\r'; }
        else if (next === 34) { result += '"'; }
        else if (next === 92) { result += '\\'; }
        else if (next === 117) { result += decodeUHexCP(json, pos - 1); pos += 4; }
        else { result += json.slice(pos, pos + 1); }
      }
    } else if (ch === 34) {
      break;
    } else {
      result += json.slice(pos, pos + 1);
    }
    pos += 1;
  }
  return result;
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

  // Update last-used timestamp
  updateSessionTimestamp(getActiveSessionId());

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

/** Load API key for a given provider index (0–6). */
function loadProviderApiKey(providerIdx: number): string {
  try {
    const s = getWorkbenchSettings();
    if (providerIdx === 0) {
      // Anthropic — check dedicated key, then legacy key
      if (s.aiKeyAnthropic.length > 5) return s.aiKeyAnthropic;
      if (s.aiApiKey.length > 5) return s.aiApiKey;
    }
    if (providerIdx === 1) {
      if (s.aiKeyOpenai.length > 5) return s.aiKeyOpenai;
    }
    if (providerIdx === 2) {
      if (s.aiKeyGoogle.length > 5) return s.aiKeyGoogle;
    }
    if (providerIdx === 3) {
      if (s.aiKeyDeepseek.length > 5) return s.aiKeyDeepseek;
    }
    if (providerIdx === 4) {
      if (s.aiKeyXai.length > 5) return s.aiKeyXai;
    }
    if (providerIdx === 5) return ''; // Ollama — no key needed
    if (providerIdx === 6) {
      if (s.aiCustomKey.length > 5) return s.aiCustomKey;
    }
  } catch (e) {}

  // Fallback: try environment variables for common providers
  // SHIP-V1-GAPS.md followup §5: was `execText('echo $VAR')` which is POSIX-
  // only. `process.env` works identically on every platform Perry targets,
  // and skips an entire shell roundtrip. canRunShellCommands gate kept so
  // we don't try this on iOS / web where env access may be restricted.
  if (canRunShellCommands()) {
    try {
      let envVar = '';
      if (providerIdx === 0) envVar = 'ANTHROPIC_API_KEY';
      if (providerIdx === 1) envVar = 'OPENAI_API_KEY';
      if (providerIdx === 2) envVar = 'GOOGLE_AI_API_KEY';
      if (envVar.length > 0) {
        const env = (process as any).env;
        const value = env && env[envVar] ? env[envVar] : '';
        if (value && value.length > 5) return value;
      }
    } catch (e) {}
  }
  return '';
}

/** Legacy: load Anthropic key (for initial panel setup check). */
function loadApiKeyValue(): string {
  return loadProviderApiKey(0);
}

// ---------------------------------------------------------------------------
// Build request body
// ---------------------------------------------------------------------------

function getProviderName(idx: number): string {
  if (idx === 0) return 'anthropic';
  if (idx === 1) return 'openai';
  if (idx === 2) return 'google';
  if (idx === 3) return 'deepseek';
  if (idx === 4) return 'xai';
  if (idx === 5) return 'ollama';
  if (idx === 6) return 'custom';
  return 'unknown';
}

function buildRequestBody(fileContent: string, systemPrompt: string, includeStream: number, toolsJson: string): string {
  const modelStr = getModelApiId(selectedModelId);
  const format = getProviderFormat(selectedModelId);
  return buildProviderBody(format, fileContent, systemPrompt, includeStream, toolsJson, modelStr);
}

// ---------------------------------------------------------------------------
// Streaming via Perry native SSE
// ---------------------------------------------------------------------------

function buildProviderHeaders(providerIdx: number, apiKey: string): string {
  // Anthropic
  if (providerIdx === 0) {
    let h = '{"Content-Type":"application/json","x-api-key":"';
    h += apiKey;
    h += '","anthropic-version":"2023-06-01"}';
    return h;
  }
  // Google — key goes in URL, no auth header
  if (providerIdx === 2) {
    return '{"Content-Type":"application/json"}';
  }
  // Ollama — no auth
  if (providerIdx === 5) {
    return '{"Content-Type":"application/json"}';
  }
  // OpenAI, DeepSeek, xAI, Custom — Bearer token
  let h = '{"Content-Type":"application/json","Authorization":"Bearer ';
  h += apiKey;
  h += '"}';
  return h;
}

function buildGoogleStreamUrl(modelId: number, apiKey: string): string {
  let url = 'https://generativelanguage.googleapis.com/v1beta/models/';
  url += getModelApiId(modelId);
  url += ':streamGenerateContent?alt=sse&key=';
  url += apiKey;
  return url;
}

function startStream(requestBody: string): void {
  const providerIdx = getProviderIndex(selectedModelId);
  const format = getProviderFormat(selectedModelId);
  activeProviderFormat = format;

  // Load the right API key
  const apiKey = loadProviderApiKey(providerIdx);
  if (apiKey.length < 2 && providerIdx !== 5) {
    appendMessage(0, t('No API key for this provider. Add one in Settings.'));
    updateMessages();
    return;
  }

  // Build URL (Google puts key in URL)
  let url = getProviderApiUrl(selectedModelId);
  if (format === 2) {
    url = buildGoogleStreamUrl(selectedModelId, apiKey);
  }

  // Build headers
  const headersJson = buildProviderHeaders(providerIdx, apiKey);

  streamAccumulated = '';
  streamActive = 1;
  // Stream inactivity watchdog: without this, a network stall (server
  // silent-but-connected, proxy buffering, a hung native reader) leaves
  // streamStatus at 0/1 forever — finishStream() never fires, the thinking
  // indicator spins permanently, and only an app restart recovers. Track
  // the last time data (or a connect) was observed; pollStreamTick aborts
  // with a surfaced error if the gap exceeds STREAM_IDLE_TIMEOUT_MS.
  _streamLastDataMs = Date.now();

  streamHandle = streamStart(url, 'POST', requestBody, headersJson);

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
  let gotData = 0;
  for (let drain = 0; drain < 50; drain++) {
    const line = streamPoll(streamHandle);
    if (line.length < 1) break;
    gotData = 1;
    currentSSELine = '' + line;
    processCurrentLine();
  }
  if (gotData > 0) _streamLastDataMs = Date.now();

  // Re-check status after drain (avoid race with Rust tokio task)
  const statusAfter = streamStatus(streamHandle);

  // Inactivity watchdog — only when the stream hasn't already reported
  // done/error (status>=2 falls through to the normal finalize below).
  if (statusAfter < 2) {
    if (Date.now() - _streamLastDataMs > STREAM_IDLE_TIMEOUT_MS) {
      if (streamAccumulated.length > 0) {
        streamAccumulated += '\n\n';
        streamAccumulated += t('[Connection timed out — response may be incomplete.]');
      } else {
        streamAccumulated = t('Request timed out — no response from the AI provider. Check your network and try again.');
      }
      finishStream();
      return;
    }
  }

  // Check if done or error
  if (statusAfter >= 2) {
    // Final drain pass — MUST fully drain. The per-tick loop above caps at
    // 50 for UI responsiveness, but at stream-close the entire remaining
    // buffer has to be consumed before finishStream(): a long code-heavy
    // response flushes many `data:` delta lines at once, and a 50-cap here
    // silently dropped lines 51+ → the tail of the assistant message was
    // truncated in both the display and the saved transcript. Safe to loop
    // unbounded: status>=2 means the stream is finished, so the buffer is
    // finite and streamPoll returns empty once drained (the break exits).
    // A defensive upper bound (1e6) guarantees no pathological infinite loop
    // if the native layer ever misbehaves, while being far above any real
    // SSE line count.
    for (let drain2 = 0; drain2 < 1000000; drain2++) {
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
            else if (next === 117) { result += decodeUHexCP(sseDataPayload, j - 1); j += 4; } // \uXXXX
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

// ---------------------------------------------------------------------------
// OpenAI-compat SSE extraction: find "delta" then "content" value
// Pattern: "delta":{"content":"<value>"}
// ---------------------------------------------------------------------------

function inlineExtractOpenAIContent(): void {
  sseExtractedText = '';
  // Find "delta" in payload
  // d=100, e=101, l=108, t=116, a=97
  let deltaPos = -1;
  for (let i = 0; i < sseDataPayload.length - 10; i++) {
    if (sseDataPayload.charCodeAt(i) === 34 &&       // "
        sseDataPayload.charCodeAt(i + 1) === 100 &&  // d
        sseDataPayload.charCodeAt(i + 2) === 101 &&  // e
        sseDataPayload.charCodeAt(i + 3) === 108 &&  // l
        sseDataPayload.charCodeAt(i + 4) === 116 &&  // t
        sseDataPayload.charCodeAt(i + 5) === 97) {   // a
      deltaPos = i + 6;
      break;
    }
  }
  if (deltaPos < 0) return;

  // Now find "content" after delta
  // c=99, o=111, n=110, t=116, e=101, n=110, t=116
  for (let i = deltaPos; i < sseDataPayload.length - 12; i++) {
    if (sseDataPayload.charCodeAt(i) === 34 &&       // "
        sseDataPayload.charCodeAt(i + 1) === 99 &&   // c
        sseDataPayload.charCodeAt(i + 2) === 111 &&  // o
        sseDataPayload.charCodeAt(i + 3) === 110 &&  // n
        sseDataPayload.charCodeAt(i + 4) === 116 &&  // t
        sseDataPayload.charCodeAt(i + 5) === 101 &&  // e
        sseDataPayload.charCodeAt(i + 6) === 110 &&  // n
        sseDataPayload.charCodeAt(i + 7) === 116 &&  // t
        sseDataPayload.charCodeAt(i + 8) === 34) {   // "
      // Found "content", extract value
      let j = i + 9;
      while (j < sseDataPayload.length && sseDataPayload.charCodeAt(j) !== 34) {
        if (sseDataPayload.charCodeAt(j) === 58) { j += 1; break; }
        j += 1;
      }
      // Skip whitespace
      while (j < sseDataPayload.length && (sseDataPayload.charCodeAt(j) === 32 || sseDataPayload.charCodeAt(j) === 9)) j += 1;
      // Check for null (content can be null in OpenAI)
      if (j < sseDataPayload.length && sseDataPayload.charCodeAt(j) === 110) return; // n(ull)
      if (j >= sseDataPayload.length || sseDataPayload.charCodeAt(j) !== 34) return;
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
            else if (next === 117) { result += decodeUHexCP(sseDataPayload, j - 1); j += 4; }
            else { result += sseDataPayload.slice(j, j + 1); }
          }
        } else if (ch === 34) {
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

// ---------------------------------------------------------------------------
// Google Gemini extraction: find "text" in parts context
// ---------------------------------------------------------------------------

function inlineExtractGoogleText(): void {
  // Reuse the existing inlineExtractText — Google also uses "text":"..." in parts
  inlineExtractText();
}

// ---------------------------------------------------------------------------
// Ollama NDJSON: raw JSON lines, no "data: " prefix
// Pattern: {"message":{"content":"<value>"},"done":false}
// ---------------------------------------------------------------------------

function processOllamaLine(): void {
  sseExtractedText = '';
  // Ollama sends raw JSON lines (no "data: " prefix)
  const line = currentSSELine;
  if (line.length < 5) return;

  // Check for "done":true
  // d=100, o=111, n=110, e=101
  for (let i = 0; i < line.length - 10; i++) {
    if (line.charCodeAt(i) === 34 &&       // "
        line.charCodeAt(i + 1) === 100 &&  // d
        line.charCodeAt(i + 2) === 111 &&  // o
        line.charCodeAt(i + 3) === 110 &&  // n
        line.charCodeAt(i + 4) === 101 &&  // e
        line.charCodeAt(i + 5) === 34) {   // "
      // Check if value is true
      let j = i + 6;
      while (j < line.length && (line.charCodeAt(j) === 58 || line.charCodeAt(j) === 32)) j += 1;
      if (j < line.length && line.charCodeAt(j) === 116) { // t(rue)
        // Stream is done
        return;
      }
    }
  }

  // Find "content" inside "message"
  // c=99, o=111, n=110, t=116, e=101
  for (let i = 0; i < line.length - 12; i++) {
    if (line.charCodeAt(i) === 34 &&       // "
        line.charCodeAt(i + 1) === 99 &&   // c
        line.charCodeAt(i + 2) === 111 &&  // o
        line.charCodeAt(i + 3) === 110 &&  // n
        line.charCodeAt(i + 4) === 116 &&  // t
        line.charCodeAt(i + 5) === 101 &&  // e
        line.charCodeAt(i + 6) === 110 &&  // n
        line.charCodeAt(i + 7) === 116 &&  // t
        line.charCodeAt(i + 8) === 34) {   // "
      let j = i + 9;
      while (j < line.length && (line.charCodeAt(j) === 58 || line.charCodeAt(j) === 32)) j += 1;
      if (j >= line.length || line.charCodeAt(j) !== 34) continue;
      j += 1;
      let result = '';
      while (j < line.length) {
        const ch = line.charCodeAt(j);
        if (ch === 92) {
          j += 1;
          if (j < line.length) {
            const next = line.charCodeAt(j);
            if (next === 110) { result += '\n'; }
            else if (next === 116) { result += '\t'; }
            else if (next === 34) { result += '"'; }
            else if (next === 92) { result += '\\'; }
            else if (next === 117) { result += decodeUHexCP(line, j - 1); j += 4; }
            else { result += line.slice(j, j + 1); }
          }
        } else if (ch === 34) {
          break;
        } else {
          result += line.slice(j, j + 1);
        }
        j += 1;
      }
      sseExtractedText = result;
      if (sseExtractedText.length > 0) {
        streamAccumulated += sseExtractedText;
      }
      return;
    }
  }
}

function processCurrentLine(): void {
  // Ollama: raw JSON lines, no "data: " prefix
  if (activeProviderFormat === 3) {
    processOllamaLine();
    return;
  }

  const isDL = isDataLine();
  if (isDL < 1) return;
  sseDataPayload = currentSSELine.slice(6);

  if (panelMode > 0) {
    processAgentSSELine(currentSSELine);
    return;
  }

  // Chat mode — format-aware text extraction
  if (inlineCheckDone() > 0) return;

  if (activeProviderFormat === 0) {
    inlineExtractText();           // Anthropic: "text":"..."
  } else if (activeProviderFormat === 1) {
    inlineExtractOpenAIContent();  // OpenAI-compat: delta.content
  } else if (activeProviderFormat === 2) {
    inlineExtractGoogleText();     // Google: parts[0].text
  }

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
  if (timeDiff > 300 || lenDiff > 20) shouldRebuild = 1;

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

  // Generate AI title after first exchange (2 messages = 1 user + 1 assistant)
  if (msgCount === 2 && panelMode < 3) {
    requestTitleGeneration();
  }

  streamAccumulated = '';
  streamingMsgBlock = null;
  streamDisplayLabel = null;
  streamContainer = null;

  updateMessages();
}

// ---------------------------------------------------------------------------
// AI title generation
// ---------------------------------------------------------------------------

let titleStreamHandle: number = 0;
let titleStreamTimer: number = 0;
let titleAccumulated = '';

function requestTitleGeneration(): void {
  if (titleStreamActive > 0) return;
  titleStreamActive = 1;
  // Get the first user message for context
  const fp = getCurrentMsgFilePath();
  let fileContent = '';
  try { fileContent = readFileSync(fp); } catch (e) {}
  if (fileContent.length < 2) { titleStreamActive = 0; return; }

  // Extract first user message (line 1 = 'U', line 2 = content)
  let firstLine = 1;
  let userMsg = '';
  let lineStart = 0;
  let lineIdx = 0;
  for (let i = 0; i <= fileContent.length; i++) {
    if (i === fileContent.length || fileContent.charCodeAt(i) === 10) {
      if (lineIdx === 1) {
        userMsg = decodeContent(fileContent.slice(lineStart, i));
      }
      lineIdx += 1;
      lineStart = i + 1;
      if (lineIdx > 2) break;
    }
  }
  if (userMsg.length < 3) { titleStreamActive = 0; return; }

  // Truncate to avoid large requests
  if (userMsg.length > 200) userMsg = userMsg.slice(0, 200);

  // Build a small request to generate a title
  const providerIdx = getProviderIndex(selectedModelId);
  const apiKey = loadProviderApiKey(providerIdx);
  if (apiKey.length < 3 && providerIdx !== 5) { titleStreamActive = 0; return; }

  let prompt = 'Generate a concise 3-8 word title summarizing this message. Return ONLY the title, nothing else.\n\nMessage: ';
  prompt += userMsg;

  const modelStr = getModelApiId(selectedModelId);
  const format = getProviderFormat(selectedModelId);

  let body = '';
  if (format === 0) {
    // Anthropic
    body = '{"model":"';
    body += modelStr;
    body += '","max_tokens":30,"stream":true,"messages":[{"role":"user","content":"';
    body += jsonEscape(prompt);
    body += '"}]}';
  } else if (format === 1) {
    // OpenAI-compat
    body = '{"model":"';
    body += modelStr;
    body += '","max_tokens":30,"stream":true,"messages":[{"role":"user","content":"';
    body += jsonEscape(prompt);
    body += '"}]}';
  } else {
    // Skip for Google/Ollama — use heuristic title
    titleStreamActive = 0;
    return;
  }

  const url = getProviderApiUrl(selectedModelId);
  const headers = buildProviderHeaders(providerIdx, apiKey);
  titleAccumulated = '';
  titleStreamHandle = streamStart(url, 'POST', body, headers);
  if (titleStreamHandle > 0) {
    titleStreamTimer = setInterval(() => { pollTitleStream(); }, 100) as unknown as number;
  }
}

function pollTitleStream(): void {
  if (titleStreamHandle < 1) return;
  const status = streamStatus(titleStreamHandle);
  // `>= 2` catches DONE (2) AND ERROR (3). The old `=== 2` missed the error
  // case entirely: a failed title-generation request (transient provider
  // 429/500 or a network blip on the title call) left this 100ms timer +
  // the stream handle dangling FOREVER — a resource leak that accumulated
  // across every session whose first message hit a transient title-call
  // error. Same status-handling pattern the main pollStreamTick already
  // uses. On error titleAccumulated is empty/partial; the existing
  // `length > 2` guard below already declines to set a junk title.
  if (status >= 2) {
    // Done or errored — clean up either way.
    if (titleStreamTimer > 0) { clearInterval(titleStreamTimer); titleStreamTimer = 0; }
    streamClose(titleStreamHandle);
    titleStreamHandle = 0;
    titleStreamActive = 0;
    if (titleAccumulated.length > 2) {
      // Clean up: remove quotes, trim
      let title = titleAccumulated;
      // Remove leading/trailing quotes
      if (title.charCodeAt(0) === 34) title = title.slice(1);
      if (title.length > 0 && title.charCodeAt(title.length - 1) === 34) title = title.slice(0, title.length - 1);
      // Trim whitespace
      while (title.length > 0 && title.charCodeAt(0) === 32) title = title.slice(1);
      while (title.length > 0 && title.charCodeAt(title.length - 1) === 32) title = title.slice(0, title.length - 1);
      if (title.length > 0) {
        updateSessionTitle(getActiveSessionId(), title);
        refreshSessionList();
      }
    }
    return;
  }
  const chunk = streamPoll(titleStreamHandle);
  if (chunk.length < 1) return;

  // Parse SSE data lines for text content
  let cLineStart = 0;
  for (let i = 0; i <= chunk.length; i++) {
    if (i === chunk.length || chunk.charCodeAt(i) === 10) {
      const cLine = chunk.slice(cLineStart, i);
      cLineStart = i + 1;
      // Check for "data: " prefix
      if (cLine.length > 6 && cLine.charCodeAt(0) === 100 && cLine.charCodeAt(5) === 32) {
        const payload = cLine.slice(6);
        if (activeProviderFormat === 0) {
          // Anthropic: extract "text":"..."
          const extracted = parseSSETextDelta(payload);
          if (extracted.length > 0) titleAccumulated += extracted;
        } else {
          // OpenAI: extract delta.content
          const extracted = extractJsonString(payload, 'content');
          if (extracted.length > 0) titleAccumulated += extracted;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Thinking indicator
// ---------------------------------------------------------------------------

function startThinking(): void {
  thinkingDots = 0;
  if (chatMessagesContainer) {
    thinkingLabel = Text(t('Thinking'));
    textSetFontSize(thinkingLabel, 12);
    setFg(thinkingLabel, getSideBarForeground());
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
  let txt = t('Thinking');
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

  let toolLabel = '\u2699 ' + t('Using tool') + ': ';
  toolLabel += name;
  const toolText = Text(toolLabel);
  textSetFontSize(toolText, 11);
  textSetFontFamily(toolText, 11, monoFont());
  setFg(toolText, getSideBarForeground());

  toolDisplayContainer = VStackWithInsets(2, 4, 8, 4, 8);
  setChatBgCode(toolDisplayContainer);
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
  textSetFontFamily(resultText, 10, monoFont());
  textSetWraps(resultText, 300);
  setFg(resultText, getSideBarForeground());
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
  if (isCurrentThemeDark() > 0) { widgetSetBackgroundColor(approvalContainer, 0.25, 0.18, 0.12, 1.0); } else { widgetSetBackgroundColor(approvalContainer, 1.0, 0.95, 0.88, 1.0); };

  let warnText = '\u26A0 ' + t('Tool') + ' "';
  warnText += name;
  warnText += '" ' + t('requires approval');
  const warnLabel = Text(warnText);
  textSetFontSize(warnLabel, 12);
  textSetFontWeight(warnLabel, 12, 0.5);
  setFg(warnLabel, getSideBarForeground());
  widgetAddChild(approvalContainer, warnLabel);

  // Show args preview
  let argsPreview = args;
  if (argsPreview.length > 200) argsPreview = args.slice(0, 200) + '...';
  const argsText = Text(argsPreview);
  textSetFontSize(argsText, 10);
  textSetFontFamily(argsText, 10, monoFont());
  setFg(argsText, getSideBarForeground());
  widgetAddChild(approvalContainer, argsText);

  const allowBtn = Button(t('Allow'), () => { onAllowClick(); });
  buttonSetBordered(allowBtn, 0);
  textSetFontSize(allowBtn, 12);
  setBtnFg(allowBtn, getSideBarForeground());

  const denyBtn = Button(t('Deny'), () => { onDenyClick(); });
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
    setFg(errText, getSideBarForeground());
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
    textSetFontFamily(toolText, 11, monoFont());
    textSetWraps(toolText, 300);
    setFg(toolText, getSideBarForeground());

    claudeToolContainer = VStackWithInsets(2, 4, 8, 4, 8);
    setChatBgCode(claudeToolContainer);
    widgetAddChild(claudeToolContainer, toolText);
    widgetAddChild(chatMessagesContainer, claudeToolContainer);
    lastAddedWidget = claudeToolContainer;
    scrollToBottom();
  } else {
    // Tool done — mark container
    if (claudeToolContainer) {
      const doneText = Text('\u2713 ' + t('done'));
      textSetFontSize(doneText, 10);
      textSetFontFamily(doneText, 10, monoFont());
      setFg(doneText, getSideBarForeground());
      widgetAddChild(claudeToolContainer, doneText);
      claudeToolContainer = null;
    }
  }
}

function onClaudeToolResult(output: string, isError: number, filePath: string): void {
  if (!claudeToolContainer) return;
  if (output.length < 1 && filePath.length < 1) return;

  // Show file path header if available
  if (filePath.length > 0) {
    let fpLabel = Text(filePath);
    textSetFontSize(fpLabel, 10);
    textSetFontFamily(fpLabel, 10, monoFont());
    setFg(fpLabel, getSecondaryTextColor());
    widgetAddChild(claudeToolContainer, fpLabel);
  }

  if (output.length > 0) {
    let displayOutput = output;
    if (displayOutput.length > 500) {
      displayOutput = output.slice(0, 500);
      displayOutput += '\n... (truncated)';
    }

    if (isError > 0) {
      // Error result — red tinted container
      let errContainer = VStackWithInsets(2, 4, 4, 4, 4);
      if (isCurrentThemeDark() > 0) { widgetSetBackgroundColor(errContainer, 0.3, 0.12, 0.12, 1.0); } else { widgetSetBackgroundColor(errContainer, 1.0, 0.9, 0.9, 1.0); };
      let errLabel = Text(displayOutput);
      textSetFontSize(errLabel, 10);
      textSetFontFamily(errLabel, 10, monoFont());
      textSetWraps(errLabel, 300);
      setFg(errLabel, getSideBarForeground());
      widgetAddChild(errContainer, errLabel);
      widgetAddChild(claudeToolContainer, errContainer);
    } else {
      let resultLabel = Text(displayOutput);
      textSetFontSize(resultLabel, 10);
      textSetFontFamily(resultLabel, 10, monoFont());
      textSetWraps(resultLabel, 300);
      setFg(resultLabel, getSecondaryTextColor());
      widgetAddChild(claudeToolContainer, resultLabel);
    }
  }
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

  // Collapse history dropdown after selection
  hideHistoryDropdown();
  historySearchText = '';
  if (historySearchField) textfieldSetString(historySearchField, '');

  setActiveSessionId(id);
  loadSessionMeta(id);

  panelMode = getActiveSessionMode();
  selectedModelId = getActiveSessionModel();
  activeProviderFormat = getProviderFormat(selectedModelId);
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
  // Sync model button with loaded session's model
  if (modelBtn) {
    let title = '\u25BE ';
    title += getPickerLabel(selectedModelId);
    buttonSetTitle(modelBtn, title);
  }
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

// SHIP-V1-GAPS.md #110 + followup §5: rename a chat session.
// macOS: AppleScript. Windows: PowerShell + VB InputBox. Else: no prompt.
function promptForSessionTitle(currentTitle: string): string {
  if (__platform__ === 3) return promptSessionTitleWindows(currentTitle);
  if (__platform__ === 0) return promptSessionTitleMacos(currentTitle);
  return '';
}

function promptSessionTitleMacos(currentTitle: string): string {
  let script = 'try\n';
  script += '  set result to text returned of (display dialog "Rename chat:" default answer "';
  // Escape backslashes and double-quotes for AppleScript string literal.
  for (let i = 0; i < currentTitle.length; i++) {
    const c = currentTitle.charCodeAt(i);
    if (c === 92) script += '\\\\';
    else if (c === 34) script += '\\"';
    else script += currentTitle.charAt(i);
  }
  script += '" buttons {"Cancel", "Rename"} default button "Rename" cancel button "Cancel")\n';
  script += '  return result\n';
  script += 'on error number -128\n';
  script += '  return ""\n';
  script += 'end try\n';
  try {
    const r = spawnText('osascript', ['-e', script]);
    if (r.status !== 0) return '';
    let out = r.stdout;
    let end = out.length;
    while (end > 0 && (out.charCodeAt(end - 1) === 10 || out.charCodeAt(end - 1) === 13)) end--;
    return out.slice(0, end);
  } catch (_e: any) {
    return '';
  }
}

function promptSessionTitleWindows(currentTitle: string): string {
  // Escape single quotes for PowerShell single-quoted strings (double them).
  let escaped = '';
  for (let i = 0; i < currentTitle.length; i++) {
    const c = currentTitle.charCodeAt(i);
    if (c === 39) escaped += "''";
    else escaped += currentTitle.charAt(i);
  }
  let ps = '[void][System.Reflection.Assembly]::LoadWithPartialName(\'Microsoft.VisualBasic\');';
  ps += '$r = [Microsoft.VisualBasic.Interaction]::InputBox(\'Rename chat:\',\'Hone\',\'' + escaped + '\');';
  ps += '[Console]::Out.Write($r)';
  try {
    const r = spawnText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    if (r.status !== 0) return '';
    let out = r.stdout;
    let end = out.length;
    while (end > 0 && (out.charCodeAt(end - 1) === 10 || out.charCodeAt(end - 1) === 13)) end--;
    return out.slice(0, end);
  } catch (_e: any) {
    return '';
  }
}

function renameSlot(idx: number): void {
  const id = getSlotId(idx);
  if (id.length < 1) return;
  // Pull the current displayed title for the prompt default.
  loadSessionMeta(id);
  let current = getParsedTitle();
  if (current.length < 1) current = '';
  const fresh = promptForSessionTitle(current);
  if (fresh.length < 1) return;
  updateSessionTitle(id, fresh);
  refreshSessionList();
}

function onRenameSession0(): void { renameSlot(0); }
function onRenameSession1(): void { renameSlot(1); }
function onRenameSession2(): void { renameSlot(2); }
function onRenameSession3(): void { renameSlot(3); }
function onRenameSession4(): void { renameSlot(4); }
function onRenameSession5(): void { renameSlot(5); }
function onRenameSession6(): void { renameSlot(6); }
function onRenameSession7(): void { renameSlot(7); }
function onRenameSession8(): void { renameSlot(8); }
function onRenameSession9(): void { renameSlot(9); }
function onRenameSession10(): void { renameSlot(10); }
function onRenameSession11(): void { renameSlot(11); }
function onRenameSession12(): void { renameSlot(12); }
function onRenameSession13(): void { renameSlot(13); }
function onRenameSession14(): void { renameSlot(14); }
function onRenameSession15(): void { renameSlot(15); }

function getRenameSessionFn(idx: number): () => void {
  if (idx === 0) return onRenameSession0;
  if (idx === 1) return onRenameSession1;
  if (idx === 2) return onRenameSession2;
  if (idx === 3) return onRenameSession3;
  if (idx === 4) return onRenameSession4;
  if (idx === 5) return onRenameSession5;
  if (idx === 6) return onRenameSession6;
  if (idx === 7) return onRenameSession7;
  if (idx === 8) return onRenameSession8;
  if (idx === 9) return onRenameSession9;
  if (idx === 10) return onRenameSession10;
  if (idx === 11) return onRenameSession11;
  if (idx === 12) return onRenameSession12;
  if (idx === 13) return onRenameSession13;
  if (idx === 14) return onRenameSession14;
  return onRenameSession15;
}

// SHIP-V1-GAPS.md #111: export the currently active chat as Markdown.
// Format: ## User / ## Assistant pairs. Stored on disk as `U|...` / `A|...` lines
// (one per line) — we read the session file directly and translate the role
// prefix into a Markdown heading.
function buildSessionMarkdown(): string {
  const id = getActiveSessionId();
  if (id.length < 1) return '';
  let title = 'Chat';
  loadSessionMeta(id);
  const parsed = getParsedTitle();
  if (parsed.length > 0) title = parsed;

  const fp = getSessionFilePath(id);
  let content = '';
  try { content = readFileSync(fp); } catch (_e) { content = ''; }

  let out = '# ';
  out += title;
  out += '\n\n';

  let lineStart = 0;
  for (let i = 0; i <= content.length; i++) {
    if (i === content.length || content.charCodeAt(i) === 10) {
      if (i > lineStart) {
        const line = content.slice(lineStart, i);
        if (line.length > 2 && line.charCodeAt(1) === 124) {
          const role = line.charCodeAt(0);
          const body = line.slice(2);
          if (role === 85) {
            out += '## User\n\n';
            out += body;
            out += '\n\n';
          } else if (role === 65) {
            out += '## Assistant\n\n';
            out += body;
            out += '\n\n';
          } else {
            out += body;
            out += '\n\n';
          }
        }
      }
      lineStart = i + 1;
    }
  }
  return out;
}

function exportActiveSession(): void {
  const md = buildSessionMarkdown();
  if (md.length < 1) return;
  const id = getActiveSessionId();
  let suggested = 'chat-';
  // 8 chars of id as a slug.
  const slugLen = id.length < 8 ? id.length : 8;
  for (let i = 0; i < slugLen; i++) suggested += id.charAt(i);
  suggested += '.md';
  saveFileDialog((path: string) => {
    if (path.length < 1) return;
    try { writeFileSync(path, md); } catch (_e) {}
  }, suggested, '');
}

// ---------------------------------------------------------------------------
// Session list rendering
// ---------------------------------------------------------------------------

/** Format a Unix ms timestamp into a relative or short date string. */
function formatTimestamp(tsStr: string): string {
  // Parse digits from timestamp string
  let ts: number = 0;
  for (let i = 0; i < tsStr.length; i++) {
    const d = tsStr.charCodeAt(i);
    if (d >= 48 && d <= 57) {
      ts = ts * 10 + (d - 48);
    }
  }
  if (ts < 1000000000000) return '';

  const now = Date.now();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t('just now');
  if (diffMin < 60) {
    let r = '';
    r += String(diffMin);
    r += 'm ago';
    return r;
  }
  if (diffHr < 24) {
    let r = '';
    r += String(diffHr);
    r += 'h ago';
    return r;
  }
  if (diffDay < 7) {
    let r = '';
    r += String(diffDay);
    r += 'd ago';
    return r;
  }
  if (diffDay < 30) {
    let r = '';
    r += String(Math.floor(diffDay / 7));
    r += 'w ago';
    return r;
  }
  let r = '';
  r += String(Math.floor(diffDay / 30));
  r += 'mo ago';
  return r;
}

/** Check if a title matches the search query (case-insensitive substring). */
function titleMatchesSearch(title: string, query: string): number {
  if (query.length < 1) return 1;
  if (title.length < query.length) return 0;
  const limit = title.length - query.length + 1;
  for (let i = 0; i < limit; i++) {
    let match: number = 1;
    for (let j = 0; j < query.length; j++) {
      let tc = title.charCodeAt(i + j);
      let qc = query.charCodeAt(j);
      // Lowercase ASCII
      if (tc >= 65 && tc <= 90) tc = tc + 32;
      if (qc >= 65 && qc <= 90) qc = qc + 32;
      if (tc !== qc) { match = 0; break; }
    }
    if (match > 0) return 1;
  }
  return 0;
}

function refreshSessionList(): void {
  if (!sessionListContainer) return;
  widgetClearChildren(sessionListContainer);

  const total = getSessionList();
  if (total < 1) return;

  const activeId = getActiveSessionId();
  const query = historySearchText;

  // Show most recent first — iterate from end, max 16
  let displayed = 0;
  for (let revIdx = total - 1; revIdx >= 0; revIdx--) {
    if (displayed >= 16) break;
    getSessionAt(revIdx);
    const sid = getParsedId();
    const smode = getParsedMode();
    const stitle = getParsedTitle();
    const stimestamp = getParsedTimestamp();

    if (sid.length < 1) continue;

    // Filter by search query
    let displayTitle = stitle;
    if (displayTitle.length < 1) displayTitle = t('New chat');
    if (query.length > 0 && titleMatchesSearch(displayTitle, query) < 1) continue;

    setSlotId(displayed, sid);

    // Mode badge
    let badge = 'C';
    if (smode === 1) badge = 'A';
    if (smode === 2) badge = 'P';
    if (smode === 3) badge = 'CC';
    const badgeLabel = Text(badge);
    textSetFontSize(badgeLabel, 9);
    textSetFontFamily(badgeLabel, 9, monoFont());
    setFg(badgeLabel, getSideBarForeground());

    // Click handler for the row
    const clickFn = getSessionClickFn(displayed);
    const rowBtn = Button(displayTitle, () => { clickFn(); });
    buttonSetBordered(rowBtn, 0);
    textSetFontSize(rowBtn, 11);
    setBtnFg(rowBtn, getSideBarForeground());

    // Timestamp
    const timeStr = formatTimestamp(stimestamp);
    const timeLabel = Text(timeStr);
    textSetFontSize(timeLabel, 9);
    setFg(timeLabel, getSecondaryTextColor());

    // Rename button (pencil)
    const renameFn = getRenameSessionFn(displayed);
    const renameBtn = Button('\u270E', () => { renameFn(); });
    buttonSetBordered(renameBtn, 0);
    textSetFontSize(renameBtn, 10);
    setBtnFg(renameBtn, getSideBarForeground());

    // Delete button
    const delFn = getDelSessionFn(displayed);
    const delBtn = Button('\u00D7', () => { delFn(); });
    buttonSetBordered(delBtn, 0);
    textSetFontSize(delBtn, 10);
    setBtnFg(delBtn, getSideBarForeground());

    // Check active session
    let isActive: number = 0;
    if (sid.length === activeId.length) {
      isActive = 1;
      for (let c = 0; c < sid.length; c++) {
        if (sid.charCodeAt(c) !== activeId.charCodeAt(c)) { isActive = 0; break; }
      }
    }

    // Two-line layout: title on top, badge + time on bottom
    const titleRow = HStack(4, [rowBtn, Spacer(), renameBtn, delBtn]);
    const metaRow = HStack(4, [badgeLabel, timeLabel, Spacer()]);
    const cell = VStackWithInsets(1, 4, 4, 4, 4);
    widgetAddChild(cell, titleRow);
    widgetAddChild(cell, metaRow);

    if (isActive > 0) {
      setChatBgActive(cell);
    }

    widgetAddChild(sessionListContainer, cell);
    displayed += 1;
  }
}

function showHistoryDropdown(): void {
  if (historyDropdownVisible > 0) return;
  historyDropdownVisible = 1;
  if (historyDropdown) widgetSetOverlayFrame(historyDropdown, 0, 28, 320, 200);
  refreshSessionList();
}

function hideHistoryDropdown(): void {
  if (historyDropdownVisible < 1) return;
  historyDropdownVisible = 0;
  if (historyDropdown) widgetSetOverlayFrame(historyDropdown, 0, 28, 320, 0);
  textfieldBlurAll();
}

function onHistorySearchFocus(): void {
  showHistoryDropdown();
}


function toggleHistoryDropdown(): void {
  if (historyDropdownVisible > 0) {
    hideHistoryDropdown();
  } else {
    showHistoryDropdown();
  }
}

function onHistorySearch(text: string): void {
  historySearchText = text;
  if (text.length > 0) {
    showHistoryDropdown();
  } else {
    hideHistoryDropdown();
  }
  if (historyDropdownVisible > 0) {
    refreshSessionList();
  }
}

// ---------------------------------------------------------------------------
// UI event handlers
// ---------------------------------------------------------------------------

function onChatInput(text: string): void {
  chatInputText = text;
  // SHIP-V1-GAPS.md #61: scan for an `@`-mention being typed. We look at the
  // last word — i.e. the substring after the last whitespace — and if it
  // starts with `@` we treat the remainder as the search query. Hide the
  // popup as soon as the user moves past the mention (types space, deletes
  // the @, etc.).
  let lastSpace = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 10 || c === 9) { lastSpace = i; break; }
  }
  const word = lastSpace >= 0 ? text.slice(lastSpace + 1) : text;
  if (word.length === 0 || word.charCodeAt(0) !== 64) {
    hideMentionsPopup();
    return;
  }
  const query = word.slice(1);
  showMentionsPopup(query);
}

function hideMentionsPopup(): void {
  if (mentionsContainer === null) return;
  if (mentionsVisible < 1) return;
  widgetSetHidden(mentionsContainer, 1);
  mentionsVisible = 0;
  mentionsLastQuery = '';
}

function showMentionsPopup(query: string): void {
  if (mentionsContainer === null) return;
  if (query === mentionsLastQuery && mentionsVisible > 0) return;
  mentionsLastQuery = query;
  buildChatFileIndex();
  const matches = matchFileIndex(query, 8);
  widgetClearChildren(mentionsContainer);
  if (matches.length === 0) {
    const empty = Text(query.length > 0 ? t('No file matches @' + query) : t('Type to search files…'));
    textSetFontSize(empty, 11);
    setFg(empty, getSecondaryTextColor());
    widgetAddChild(mentionsContainer, empty);
  } else {
    for (let i = 0; i < matches.length; i++) {
      const rel = matches[i];
      const row = Button(rel, () => { insertMention(rel); });
      buttonSetBordered(row, 0);
      textSetFontSize(row, 11);
      setBtnFg(row, getSideBarForeground());
      widgetAddChild(mentionsContainer, row);
    }
  }
  widgetSetHidden(mentionsContainer, 0);
  mentionsVisible = 1;
}

function insertMention(rel: string): void {
  // Replace the trailing `@<query>` token in chatInputText with `@<rel> `.
  let lastSpace = -1;
  for (let i = chatInputText.length - 1; i >= 0; i--) {
    const c = chatInputText.charCodeAt(i);
    if (c === 32 || c === 10 || c === 9) { lastSpace = i; break; }
  }
  const head = lastSpace >= 0 ? chatInputText.slice(0, lastSpace + 1) : '';
  const next = head + '@' + rel + ' ';
  chatInputText = next;
  if (chatInput) {
    textfieldSetString(chatInput, next);
    textfieldFocus(chatInput);
  }
  hideMentionsPopup();
}

// Build a workspace file index on first @-typing. Capped at 5000 entries +
// depth-8 to keep the walk bounded. Honors the existing skip-list for
// dotfiles, `node_modules`, `dist`, `target`, `.git`.
function buildChatFileIndex(): void {
  if (_chatFileIndexBuilt > 0 && _chatFileIndexRoot === wsRoot) return;
  if (wsRoot.length < 1) return;
  _chatFileIndex = [];
  walkChatDir(wsRoot, '', 0);
  _chatFileIndexBuilt = 1;
  _chatFileIndexRoot = wsRoot;
}

function walkChatDir(absPath: string, relPrefix: string, depth: number): void {
  if (depth > 8) return;
  if (_chatFileIndex.length > 5000) return;
  let names: string[] = [];
  try { names = readdirSync(absPath); } catch (_e: any) { return; }
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (n.charCodeAt(0) === 46) continue; // dotfiles (incl .git)
    if (n.length === 12 && n === 'node_modules') continue;
    if (n.length === 4 && n === 'dist') continue;
    if (n.length === 6 && n === 'target') continue;
    const full = join(absPath, n);
    const rel = relPrefix.length > 0 ? relPrefix + '/' + n : n;
    let isDir = 0;
    try { if (isDirectory(full)) isDir = 1; } catch (_e: any) {}
    if (isDir > 0) {
      walkChatDir(full, rel, depth + 1);
    } else {
      _chatFileIndex.push(rel);
      if (_chatFileIndex.length > 5000) return;
    }
  }
}

function matchFileIndex(query: string, limit: number): string[] {
  const out: string[] = [];
  if (query.length === 0) {
    // Show first `limit` files (useful when user just typed `@`).
    for (let i = 0; i < _chatFileIndex.length && out.length < limit; i++) {
      out.push(_chatFileIndex[i]);
    }
    return out;
  }
  // Case-insensitive substring match. Prefer matches whose basename starts
  // with the query — those score higher and surface first.
  const q = query.toLowerCase();
  const starts: string[] = [];
  const contains: string[] = [];
  for (let i = 0; i < _chatFileIndex.length; i++) {
    const path = _chatFileIndex[i];
    const lower = path.toLowerCase();
    // Pull basename.
    let lastSlash = -1;
    for (let j = lower.length - 1; j >= 0; j--) {
      if (lower.charCodeAt(j) === 47) { lastSlash = j; break; }
    }
    const baseLower = lastSlash >= 0 ? lower.slice(lastSlash + 1) : lower;
    if (baseLower.length >= q.length && baseLower.slice(0, q.length) === q) {
      starts.push(path);
      if (starts.length + contains.length >= limit * 4) break;
    } else if (lower.indexOf(q) >= 0) {
      contains.push(path);
      if (starts.length + contains.length >= limit * 4) break;
    }
  }
  for (let i = 0; i < starts.length && out.length < limit; i++) out.push(starts[i]);
  for (let i = 0; i < contains.length && out.length < limit; i++) out.push(contains[i]);
  return out;
}

/** Called when user presses Enter/Return in the text field. */
function onSubmitFromField(text: string): void {
  // SHIP-V1-GAPS.md #62: slash commands. If the message begins with one of
  // the known slash commands, expand it into a fully-formed prompt with the
  // current file's context. Anything else falls through to `onSend()`.
  const expanded = expandSlashCommand(text);
  chatInputText = expanded;
  onSend();
}

/**
 * Expand `/fix`, `/explain`, `/test`, `/refactor`, `/doc` into prompts that
 * the AI provider sees. The user can still type a regular message that
 * starts with `/`-something — only the known commands are intercepted, and
 * each one explicitly carries the slash so the model knows it was a command.
 */
function expandSlashCommand(text: string): string {
  if (text.length === 0 || text.charCodeAt(0) !== 47) return text;
  // Find the end of the first word.
  let wordEnd = 1;
  while (wordEnd < text.length && text.charCodeAt(wordEnd) !== 32) wordEnd++;
  const cmd = text.slice(0, wordEnd).toLowerCase();
  const remainder = wordEnd < text.length ? text.slice(wordEnd + 1) : '';
  const filePath = getCurrentFilePath ? getCurrentFilePath() : '';
  const fileName = shortFileNameForSlash(filePath);

  if (cmd === '/fix') {
    let out = 'Fix the bug in ';
    out += fileName.length > 0 ? fileName : 'the open file';
    out += '. ';
    out += 'Identify what is broken and supply a minimal change that addresses the root cause. Return a diff or the corrected snippet.';
    if (remainder.length > 0) { out += ' '; out += remainder; }
    return out;
  }
  if (cmd === '/explain') {
    let out = 'Explain ';
    if (remainder.length > 0) out += remainder; else out += fileName.length > 0 ? fileName : 'the selection';
    out += '. Focus on intent, not syntax. Mention non-obvious invariants or edge cases.';
    return out;
  }
  if (cmd === '/test') {
    let out = 'Write tests for ';
    out += fileName.length > 0 ? fileName : 'the open file';
    out += '. Cover the happy path and at least two edge cases. Match the existing test framework.';
    if (remainder.length > 0) { out += ' Focus area: '; out += remainder; }
    return out;
  }
  if (cmd === '/refactor') {
    let out = 'Refactor ';
    out += fileName.length > 0 ? fileName : 'the open file';
    out += ' for readability. Preserve behavior. Highlight what changed and why in one paragraph after the diff.';
    if (remainder.length > 0) { out += ' '; out += remainder; }
    return out;
  }
  if (cmd === '/doc') {
    let out = 'Write or improve doc comments for ';
    out += fileName.length > 0 ? fileName : 'the open file';
    out += '. Cover purpose, parameters, returns, and one usage example. Match the file\'s existing comment style.';
    return out;
  }
  return text; // not a recognized command — pass through
}

function shortFileNameForSlash(path: string): string {
  let lastSlash = -1;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 47 || c === 92) lastSlash = i;
  }
  return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
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
        else if (next === 117) { result += decodeUHexCP(json, pos - 1); pos += 4; }
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
  // Look for "type":"X" near the start of the line (first 30 chars) to avoid
  // matching nested "type":"tool_result" etc.
  // 1=system, 2=assistant, 3=result, 4=user, 5=rate_limit_event
  if (lineContains(line, '"type":"system"') > 0) return 1;
  if (lineContains(line, '"type":"assistant"') > 0) return 2;
  if (lineContains(line, '"type":"rate_limit_event"') > 0) return 5;
  // Check "type":"result" BEFORE "type":"user" — result events also contain
  // "type":"tool_result" in permission_denials, but "type":"result" appears first
  if (line.length > 15 && line.charCodeAt(9) === 114 && line.charCodeAt(10) === 101) {
    // Quick check: {"type":"re... — likely "result"
    if (lineContains(line, '"type":"result"') > 0) return 3;
  }
  if (lineContains(line, '"type":"user"') > 0) return 4;
  // Fallback: check result without position hint
  if (lineContains(line, '"type":"result"') > 0) return 3;
  return 0;
}

/**
 * Process a single NDJSON line from Claude Code output.
 * All processing is inline in this module — no cross-module dependencies.
 *
 * Handles: system, assistant (text + tool_use + thinking), user (tool results),
 * result (final output + permission denials + stop reason), rate_limit_event.
 */
function handleClaudeLine(line: string): void {
  if (line.length < 10) return;

  const evtType = detectClaudeEventType(line);
  if (evtType < 1) return;

  // If host is running Claude for a remote guest, forward the raw line
  if (isRelayHostMode > 0) {
    _relayForwardFn(line);
  }

  // -----------------------------------------------------------------------
  // System event (1) — session init with metadata
  // -----------------------------------------------------------------------
  if (evtType === 1) {
    let sid = inlineExtractValue(line, '"session_id":');
    if (sid.length > 0) {
      claudeSessionUUID = sid;
      saveClaudeSessionUUID(getActiveSessionId(), sid);
    }
    // Extract metadata for info display
    claudeModelDisplay = inlineExtractValue(line, '"model":');
    claudeVersionDisplay = inlineExtractValue(line, '"claude_code_version":');
    claudePermModeDisplay = inlineExtractValue(line, '"permissionMode":');

    // Show session info row
    if (chatMessagesContainer) {
      let infoStr = '';
      if (claudeVersionDisplay.length > 0) {
        infoStr += 'Claude Code v';
        infoStr += claudeVersionDisplay;
      }
      if (claudeModelDisplay.length > 0) {
        if (infoStr.length > 0) infoStr += ' | ';
        infoStr += claudeModelDisplay;
      }
      if (claudePermModeDisplay.length > 0) {
        if (infoStr.length > 0) infoStr += ' | ';
        infoStr += claudePermModeDisplay;
      }
      if (infoStr.length > 0) {
        claudeInfoRow = Text(infoStr);
        textSetFontSize(claudeInfoRow, 10);
        textSetFontFamily(claudeInfoRow, 10, monoFont());
        setFg(claudeInfoRow, getSecondaryTextColor());
        widgetAddChild(chatMessagesContainer, claudeInfoRow);
      }
    }
    stopThinking();
    return;
  }

  // -----------------------------------------------------------------------
  // Rate limit event (5) — show warning with countdown
  // -----------------------------------------------------------------------
  if (evtType === 5) {
    let rlStatus = inlineExtractValue(line, '"status":');
    // "rate_limited" starts with 'r'(114) at [0] and 'l'(108) at [5]
    let isLimited: number = 0;
    if (rlStatus.length > 10 && rlStatus.charCodeAt(0) === 114 && rlStatus.charCodeAt(5) === 108) {
      isLimited = 1;
    }
    if (isLimited > 0) {
      claudeRateLimited = 1;
      // Extract resetsAt as number (inline)
      let resetStr = inlineExtractValue(line, '"resetsAt":');
      if (resetStr.length > 0) {
        claudeRateLimitResetEpoch = Number(resetStr);
      }
      // Show rate limit banner
      if (chatMessagesContainer) {
        let rlBlock = VStackWithInsets(4, 8, 8, 8, 8);
        if (isCurrentThemeDark() > 0) { widgetSetBackgroundColor(rlBlock, 0.35, 0.25, 0.05, 1.0); } else { widgetSetBackgroundColor(rlBlock, 1.0, 0.95, 0.85, 1.0); };
        claudeRateLimitLabel = Text(t('Rate limited. Waiting...'));
        textSetFontSize(claudeRateLimitLabel, 12);
        textSetFontFamily(claudeRateLimitLabel, 12, monoFont());
        setFg(claudeRateLimitLabel, getSideBarForeground());
        widgetAddChild(rlBlock, claudeRateLimitLabel);
        widgetAddChild(chatMessagesContainer, rlBlock);
        lastAddedWidget = rlBlock;
        scrollToBottom();
      }
      // Start countdown timer
      if (claudeRateLimitTimer > 0) { clearInterval(claudeRateLimitTimer); }
      claudeRateLimitTimer = setInterval(() => { updateRateLimitCountdown(); }, 1000) as unknown as number;
    } else {
      // Rate limit cleared
      claudeRateLimited = 0;
      if (claudeRateLimitTimer > 0) {
        clearInterval(claudeRateLimitTimer);
        claudeRateLimitTimer = 0;
      }
      if (claudeRateLimitLabel) {
        textSetString(claudeRateLimitLabel, t('Rate limit cleared'));
      }
    }
    return;
  }

  // -----------------------------------------------------------------------
  // Assistant event (2) — iterate content blocks (text, tool_use, thinking)
  // -----------------------------------------------------------------------
  if (evtType === 2) {
    processAssistantBlocks(line);
    return;
  }

  // -----------------------------------------------------------------------
  // Result event (3) — final output with stop_reason, permission denials, duration
  // -----------------------------------------------------------------------
  if (evtType === 3) {
    let isError: number = 0;
    if (lineContains(line, '"is_error":true') > 0) {
      isError = 1;
    }

    let resultText = inlineExtractValue(line, ',"result":');
    let costVal = parseNDJSONCost(line);
    let turnsVal = parseNDJSONTurns(line);
    let sid = inlineExtractValue(line, '"session_id":');
    if (sid.length > 0) {
      claudeSessionUUID = sid;
      saveClaudeSessionUUID(getActiveSessionId(), sid);
      claudeResumeSessionId = sid;
    }

    // Extract stop_reason
    let stopReason = inlineExtractValue(line, '"stop_reason":');

    // Extract duration
    let durationStr = inlineExtractValue(line, '"duration_ms":');
    if (durationStr.length > 0) {
      claudeTotalDurationMs = Number(durationStr);
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
    // Clear rate limit state
    if (claudeRateLimitTimer > 0) {
      clearInterval(claudeRateLimitTimer);
      claudeRateLimitTimer = 0;
    }
    claudeRateLimited = 0;

    // Finalize UI
    stopThinking();
    claudeModeActive = 0;
    isRelayHostMode = 0;

    if (isError > 0) {
      let errMsg = resultText;
      if (errMsg.length < 1) errMsg = t('Claude Code returned an error.');
      if (chatMessagesContainer) {
        const errBlock = VStackWithInsets(4, 8, 8, 8, 8);
        if (isCurrentThemeDark() > 0) { widgetSetBackgroundColor(errBlock, 0.3, 0.12, 0.12, 1.0); } else { widgetSetBackgroundColor(errBlock, 1.0, 0.9, 0.9, 1.0); };
        const errLabel = Text(errMsg);
        textSetFontSize(errLabel, 12);
        textSetWraps(errLabel, 300);
        setFg(errLabel, getSideBarForeground());
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

    // Show stats row: Cost, Turns, Duration, Stop Reason, Permission Denials
    if (chatMessagesContainer) {
      let statsStr = '';
      if (costVal >= 0) {
        statsStr += t('Cost') + ': $';
        let costInt = Math.floor(costVal * 10000);
        let costMain = Math.floor(costVal);
        let costFrac = costInt % 10000;
        statsStr += String(costMain);
        statsStr += '.';
        if (costFrac < 1000) statsStr += '0';
        if (costFrac < 100) statsStr += '0';
        if (costFrac < 10) statsStr += '0';
        statsStr += String(costFrac);
      }
      if (turnsVal >= 0) {
        if (statsStr.length > 0) statsStr += ' | ';
        statsStr += t('Turns') + ': ';
        statsStr += String(turnsVal);
      }
      if (claudeTotalDurationMs > 0) {
        if (statsStr.length > 0) statsStr += ' | ';
        let secs = Math.floor(claudeTotalDurationMs / 100) / 10;
        statsStr += String(secs);
        statsStr += 's';
      }
      // Show stop_reason if not normal end_turn
      // "max_turns" — m(0)a(1)x(2)_(3)t(4)
      if (stopReason.length > 5 && stopReason.charCodeAt(0) === 109 && stopReason.charCodeAt(3) === 95) {
        if (statsStr.length > 0) statsStr += ' | ';
        statsStr += t('INCOMPLETE (max turns reached)');
      }
      if (claudeTotalInputTokens > 0 || claudeTotalOutputTokens > 0) {
        if (statsStr.length > 0) statsStr += ' | ';
        statsStr += t('Tokens') + ': ';
        statsStr += String(claudeTotalInputTokens);
        statsStr += ' in / ';
        statsStr += String(claudeTotalOutputTokens);
        statsStr += ' out';
      }

      if (statsStr.length > 0) {
        claudeCostLabel = Text(statsStr);
        textSetFontSize(claudeCostLabel, 10);
        textSetFontFamily(claudeCostLabel, 10, monoFont());
        setFg(claudeCostLabel, getSecondaryTextColor());
        widgetAddChild(chatMessagesContainer, claudeCostLabel);
        lastAddedWidget = claudeCostLabel;
      }

      // Show permission denials as warning
      showPermissionDenials(line);
    }
    updateMessages();
    return;
  }

  // -----------------------------------------------------------------------
  // User event (4) — tool results with error detection and ID linking
  // -----------------------------------------------------------------------
  if (evtType === 4) {
    // Check if tool result is an error
    let isToolError: number = 0;
    if (lineContains(line, '"is_error":true') > 0) {
      isToolError = 1;
    }
    // Extract tool output — try tool_use_result first (richer), then stdout, then content
    let toolOutput = inlineExtractValue(line, '"stdout":');
    if (toolOutput.length < 1) {
      // Try content field within tool_result
      let trPos = lineContainPos(line, '"tool_result"');
      if (trPos >= 0) {
        let trRemainder = line.slice(trPos);
        toolOutput = inlineExtractValue(trRemainder, '"content":');
      }
    }
    if (toolOutput.length < 1) {
      toolOutput = inlineExtractValue(line, '"content":');
    }
    // Extract file path from tool_use_result if present
    let resultFilePath = inlineExtractValue(line, '"filePath":');
    if (resultFilePath.length > 0 && toolOutput.length < 1) {
      toolOutput = inlineExtractValue(line, '"content":');
    }

    onClaudeToolResult(toolOutput, isToolError, resultFilePath);
    onClaudeToolActivity('', 'done', '');
  }
}

// -----------------------------------------------------------------------
// Multi-block assistant event parser
// -----------------------------------------------------------------------

/**
 * Parse content blocks from an assistant event. Handles: text, tool_use, thinking.
 * Walks through "content":[{...},{...},...] by tracking brace depth.
 */
function processAssistantBlocks(line: string): void {
  // Find "content":[ in the line
  let contentStart = lineContainPos(line, '"content":[');
  if (contentStart < 0) return;
  let pos = contentStart + 11; // after '['

  let depth: number = 0;
  let blockStart: number = -1;
  let inString: number = 0;
  let hadUpdate: number = 0;

  for (let i = pos; i < line.length; i++) {
    let ch = line.charCodeAt(i);

    // Track string boundaries to skip braces inside strings
    if (ch === 34 && (i === 0 || line.charCodeAt(i - 1) !== 92)) { // " not preceded by backslash
      inString = inString > 0 ? 0 : 1;
      continue;
    }
    if (inString > 0) continue;

    if (ch === 123) { // {
      if (depth === 0) blockStart = i;
      depth += 1;
    }
    if (ch === 125) { // }
      depth -= 1;
      if (depth === 0 && blockStart >= 0) {
        let block = line.slice(blockStart, i + 1);
        hadUpdate += processOneContentBlock(block);
        blockStart = -1;
      }
    }
    if (ch === 93 && depth === 0) break; // ] end of content array
  }

  // Accumulate token usage from this assistant event's usage block
  let inputTokStr = inlineExtractValue(line, '"input_tokens":');
  if (inputTokStr.length > 0) {
    let tokVal = Number(inputTokStr);
    if (tokVal > 0) claudeTotalInputTokens = tokVal; // latest cumulative value
  }
  let outputTokStr = inlineExtractValue(line, '"output_tokens":');
  if (outputTokStr.length > 0) {
    let tokVal = Number(outputTokStr);
    if (tokVal > 0) claudeTotalOutputTokens = tokVal;
  }

  if (hadUpdate > 0) {
    updateStreamingDisplay();
  }
}

/**
 * Process a single content block JSON object. Returns 1 if text was added.
 */
function processOneContentBlock(block: string): number {
  // Determine block type
  let blockType = inlineExtractValue(block, '"type":');

  // --- text block ---
  // "text" — t(0)e(1)x(2)t(3), length 4
  if (blockType.length === 4 && blockType.charCodeAt(0) === 116 && blockType.charCodeAt(2) === 120) {
    let textVal = inlineExtractValue(block, '"text":');
    if (textVal.length > 0) {
      streamAccumulated += textVal;
      return 1;
    }
    return 0;
  }

  // --- tool_use block ---
  // "tool_use" — t(0)o(1)o(2)l(3)_(4)u(5)s(6)e(7), length 8
  if (blockType.length === 8 && blockType.charCodeAt(0) === 116 && blockType.charCodeAt(4) === 95) {
    let toolName = inlineExtractValue(block, '"name":');
    let toolId = inlineExtractValue(block, '"id":');
    if (toolName.length > 0) {
      claudeLastToolUseId = toolId;
      claudeLastToolUseName = toolName;
      // Extract tool input — try many keys for comprehensive coverage
      let toolInput = inlineExtractValue(block, '"command":');
      if (toolInput.length < 1) toolInput = inlineExtractValue(block, '"file_path":');
      if (toolInput.length < 1) toolInput = inlineExtractValue(block, '"path":');
      if (toolInput.length < 1) toolInput = inlineExtractValue(block, '"pattern":');
      if (toolInput.length < 1) toolInput = inlineExtractValue(block, '"query":');
      if (toolInput.length < 1) toolInput = inlineExtractValue(block, '"url":');
      if (toolInput.length < 1) toolInput = inlineExtractValue(block, '"description":');
      if (toolInput.length < 1) toolInput = inlineExtractValue(block, '"skill":');
      if (toolInput.length < 1) toolInput = inlineExtractValue(block, '"old_string":');
      if (toolInput.length < 1) toolInput = inlineExtractValue(block, '"content":');

      // Check for Edit tool — show old_string/new_string as diff
      let isEdit: number = 0;
      // "Edit" — E(69)d(100)i(105)t(116)
      if (toolName.length === 4 && toolName.charCodeAt(0) === 69 && toolName.charCodeAt(3) === 116) {
        isEdit = 1;
      }
      // "Write" — W(87)r(114)i(105)t(116)e(101)
      if (toolName.length === 5 && toolName.charCodeAt(0) === 87) {
        isEdit = 1;
      }
      if (isEdit > 0) {
        onClaudeToolActivityWithDiff(toolName, toolInput, block);
      } else {
        onClaudeToolActivity(toolName, 'running', toolInput);
      }
    }
    return 0;
  }

  // --- thinking block ---
  // "thinking" — t(0)h(1)i(2)n(3)k(4)i(5)n(6)g(7), length 8
  if (blockType.length === 8 && blockType.charCodeAt(0) === 116 && blockType.charCodeAt(1) === 104) {
    let thinkingText = inlineExtractValue(block, '"thinking":');
    if (thinkingText.length > 0) {
      showThinkingBlock(thinkingText);
    }
    return 0;
  }

  return 0;
}

/** Find position of substring in line. Returns -1 if not found. */
function lineContainPos(line: string, sub: string): number {
  if (sub.length > line.length) return -1;
  for (let i = 0; i <= line.length - sub.length; i++) {
    let m: number = 1;
    for (let j = 0; j < sub.length; j++) {
      if (line.charCodeAt(i + j) !== sub.charCodeAt(j)) {
        m = 0;
        break;
      }
    }
    if (m > 0) return i;
  }
  return -1;
}

// -----------------------------------------------------------------------
// Rate limit countdown
// -----------------------------------------------------------------------

function updateRateLimitCountdown(): void {
  let nowSec = Math.floor(Date.now() / 1000);
  let remaining = claudeRateLimitResetEpoch - nowSec;
  if (remaining <= 0) {
    claudeRateLimited = 0;
    if (claudeRateLimitTimer > 0) {
      clearInterval(claudeRateLimitTimer);
      claudeRateLimitTimer = 0;
    }
    if (claudeRateLimitLabel) {
      textSetString(claudeRateLimitLabel, t('Rate limit cleared'));
    }
    return;
  }
  let mins = Math.floor(remaining / 60);
  let secs = remaining % 60;
  let text = t('Rate limited. Resets in') + ' ';
  text += String(mins);
  text += 'm ';
  text += String(secs);
  text += 's';
  if (claudeRateLimitLabel) textSetString(claudeRateLimitLabel, text);
}

// -----------------------------------------------------------------------
// Permission denials display
// -----------------------------------------------------------------------

function showPermissionDenials(line: string): void {
  if (!chatMessagesContainer) return;
  // Only show if permission_denials is non-empty
  if (lineContains(line, 'permission_denials') < 1) return;
  // Check for empty array
  if (lineContains(line, '"permission_denials":[]') > 0) return;

  // Extract tool names from permission_denials array
  let pdPos = lineContainPos(line, 'permission_denials');
  if (pdPos < 0) return;
  let after = line.slice(pdPos);
  let toolNames = '';
  let searchOff = 0;
  let count = 0;
  while (count < 10) {
    let tnPos = lineContainPos(after.slice(searchOff), '"tool_name":');
    if (tnPos < 0) break;
    let absOff = searchOff + tnPos;
    let snippet = after.slice(absOff);
    let tn = inlineExtractValue(snippet, '"tool_name":');
    if (tn.length > 0) {
      if (toolNames.length > 0) toolNames += ', ';
      toolNames += tn;
    }
    searchOff = absOff + 12;
    count += 1;
  }
  if (toolNames.length < 1) return;

  let warnBlock = VStackWithInsets(4, 8, 8, 8, 8);
  if (isCurrentThemeDark() > 0) { widgetSetBackgroundColor(warnBlock, 0.35, 0.25, 0.05, 1.0); } else { widgetSetBackgroundColor(warnBlock, 1.0, 0.95, 0.85, 1.0); };
  let warnStr = '\u26A0 ' + t('Permission denied for') + ': ';
  warnStr += toolNames;
  let warnLabel = Text(warnStr);
  textSetFontSize(warnLabel, 11);
  textSetWraps(warnLabel, 300);
  setFg(warnLabel, getSideBarForeground());
  widgetAddChild(warnBlock, warnLabel);
  widgetAddChild(chatMessagesContainer, warnBlock);
  lastAddedWidget = warnBlock;
}

// -----------------------------------------------------------------------
// Thinking block display (collapsible)
// -----------------------------------------------------------------------

function showThinkingBlock(text: string): void {
  if (!chatMessagesContainer) return;
  let container = VStackWithInsets(2, 6, 6, 6, 6);
  setChatBgDeep(container);

  // Header — click toggles content
  let headerBtn = Button('\u{1F4AD} ' + t('Thinking...'), () => { toggleThinkingExpand(); });
  buttonSetBordered(headerBtn, 0);
  textSetFontSize(headerBtn, 10);
  setBtnFg(headerBtn, getSecondaryTextColor());
  widgetAddChild(container, headerBtn);

  // Content — hidden by default
  let contentLabel = Text(text);
  textSetFontSize(contentLabel, 10);
  textSetFontFamily(contentLabel, 10, monoFont());
  textSetWraps(contentLabel, 300);
  setFg(contentLabel, getSecondaryTextColor());
  widgetSetHidden(contentLabel, 1);
  widgetAddChild(container, contentLabel);

  thinkingBlockWidget = container;
  thinkingBlockContent = contentLabel;
  thinkingBlockExpanded = 0;

  widgetAddChild(chatMessagesContainer, container);
  lastAddedWidget = container;
  scrollToBottom();
}

function toggleThinkingExpand(): void {
  if (!thinkingBlockContent) return;
  thinkingBlockExpanded = thinkingBlockExpanded > 0 ? 0 : 1;
  widgetSetHidden(thinkingBlockContent, thinkingBlockExpanded > 0 ? 0 : 1);
}

// -----------------------------------------------------------------------
// Enhanced tool activity display (with diff for Edit/Write)
// -----------------------------------------------------------------------

function onClaudeToolActivityWithDiff(toolName: string, filePath: string, block: string): void {
  if (!chatMessagesContainer) return;

  let toolLabel = '\u2699 ';
  toolLabel += toolName;
  if (filePath.length > 0) {
    toolLabel += ': ';
    if (filePath.length > 80) {
      toolLabel += filePath.slice(0, 80);
      toolLabel += '...';
    } else {
      toolLabel += filePath;
    }
  }
  let toolText = Text(toolLabel);
  textSetFontSize(toolText, 11);
  textSetFontFamily(toolText, 11, monoFont());
  textSetWraps(toolText, 300);
  setFg(toolText, getSideBarForeground());

  claudeToolContainer = VStackWithInsets(2, 4, 8, 4, 8);
  setChatBgCode(claudeToolContainer);
  widgetAddChild(claudeToolContainer, toolText);

  // Extract old_string and new_string for diff display
  let oldStr = inlineExtractValue(block, '"old_string":');
  let newStr = inlineExtractValue(block, '"new_string":');

  if (oldStr.length > 0) {
    let oldTrunc = oldStr;
    if (oldTrunc.length > 200) oldTrunc = oldStr.slice(0, 200) + '...';
    let oldBlock = VStackWithInsets(2, 4, 4, 4, 4);
    if (isCurrentThemeDark() > 0) { widgetSetBackgroundColor(oldBlock, 0.25, 0.10, 0.10, 1.0); } else { widgetSetBackgroundColor(oldBlock, 1.0, 0.92, 0.92, 1.0); };
    let oldLabel = Text('- ' + oldTrunc);
    textSetFontSize(oldLabel, 10);
    textSetFontFamily(oldLabel, 10, monoFont());
    textSetWraps(oldLabel, 280);
    setFg(oldLabel, getSideBarForeground());
    widgetAddChild(oldBlock, oldLabel);
    widgetAddChild(claudeToolContainer, oldBlock);
  }
  if (newStr.length > 0) {
    let newTrunc = newStr;
    if (newTrunc.length > 200) newTrunc = newStr.slice(0, 200) + '...';
    let newBlock = VStackWithInsets(2, 4, 4, 4, 4);
    if (isCurrentThemeDark() > 0) { widgetSetBackgroundColor(newBlock, 0.10, 0.25, 0.10, 1.0); } else { widgetSetBackgroundColor(newBlock, 0.92, 1.0, 0.92, 1.0); };
    let newLabel = Text('+ ' + newTrunc);
    textSetFontSize(newLabel, 10);
    textSetFontFamily(newLabel, 10, monoFont());
    textSetWraps(newLabel, 280);
    setFg(newLabel, getSideBarForeground());
    widgetAddChild(newBlock, newLabel);
    widgetAddChild(claudeToolContainer, newBlock);
  }

  widgetAddChild(chatMessagesContainer, claudeToolContainer);
  lastAddedWidget = claudeToolContainer;
  scrollToBottom();
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
    // Inactivity watchdog: a claude subprocess that's alive but silent
    // forever (hung) would otherwise spin this poll loop indefinitely and
    // leak the process. Kill it, finalize, and surface a timeout so the
    // user is unblocked (session-switch is gated on claudeModeActive, so a
    // wedged claude also locks them out of every other session).
    if (Date.now() - _claudeLastDataMs > CLAUDE_IDLE_TIMEOUT_MS) {
      stopClaudeSession();
      claudeProcessDone = 1;
      if (claudePollTimer > 0) {
        clearInterval(claudePollTimer);
        claudePollTimer = 0;
      }
      if (claudeModeActive > 0) {
        claudeModeActive = 0;
        isRelayHostMode = 0;
        stopThinking();
        if (streamAccumulated.length > 0) {
          streamAccumulated += '\n\n';
          streamAccumulated += t('[Claude Code timed out — response may be incomplete.]');
        } else {
          streamAccumulated = t('Claude Code timed out (no output). The process was stopped — try again.');
        }
        appendMessage(0, streamAccumulated);
        streamAccumulated = '';
        streamDisplayLabel = null;
        streamContainer = null;
        updateMessages();
      }
      return;
    }
    // After 60 empty polls (~3 seconds), check if process exited via kill -0
    if (claudeNoDataCount > 60) {
      claudeNoDataCount = 0;
      // SHIP-V1-GAPS.md followup §5: process-alive check. POSIX `kill -0
       // <pid>` exits 0 if alive, non-zero if dead. Windows equivalent:
       // `tasklist /FI "PID eq <pid>" /NH` prints "INFO: No tasks..." when
       // no match (and stdout starts with `INFO:`). We treat status != 0
       // OR an INFO-prefixed line as "process gone".
      let processGone: number = 0;
      try {
        const pidStr = String(claudeSpawnedPid);
        if (__platform__ === 3) {
          const r = spawnText('tasklist', ['/FI', 'PID eq ' + pidStr, '/NH']);
          if (r.status !== 0) {
            processGone = 1;
          } else if (r.stdout.length >= 5 && r.stdout.charCodeAt(0) === 73 && r.stdout.charCodeAt(1) === 78) {
            // 'IN'FO: prefix → no match
            processGone = 1;
          }
        } else {
          const r = spawnText('kill', ['-0', pidStr]);
          if (r.status !== 0) processGone = 1;
        }
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
          isRelayHostMode = 0;
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

  // Got new data — reset no-data counter + watchdog timestamp
  claudeNoDataCount = 0;
  _claudeLastDataMs = Date.now();

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
  hideHistoryDropdown();
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

  // Track telemetry (provider + model, no message content)
  const _tProvider = getProviderName(getProviderIndex(selectedModelId));
  const _tModel = getModelApiId(selectedModelId);
  if (panelMode === 1) {
    telemetryTrackAiAgent(_tProvider, _tModel);
  } else {
    telemetryTrackAiChat(_tProvider, _tModel);
  }

  // Build request — use fresh path (Perry: module vars stale in callbacks)
  const currentPath = getCurrentMsgFilePath();
  let fileContent = '';
  try { fileContent = readFileSync(currentPath); } catch (e) {}

  let systemPrompt = 'You are Hone, an AI coding assistant built into the Hone IDE. Be concise and helpful.';
  let toolsJson = '';

  if (panelMode === 3) {
    // Claude Code mode
    claudeModeActive = 1;
    streamAccumulated = '';
    streamDisplayLabel = null;
    streamContainer = null;
    claudeLineBuffer = '';
    claudeLogOffset = 0;
    claudeProcessDone = 0;
    claudeNoDataCount = 0;
    startThinking();

    // Remote guest: forward prompt to host via relay instead of local subprocess
    if (isRemoteGuest > 0) {
      _relaySendFn(sendText);
      // No local polling — host will stream events back via handleClaudeRelayEvent()
      return;
    }

    // Local host: spawn subprocess
    // Build log file path in THIS module (avoids cross-module string returns)
    let logPath = getAppDataDir();
    logPath += '/claude-session-';
    logPath += String(Date.now());
    logPath += '.log';
    claudeLogFilePath = logPath;

    // Load resume ID from stored session
    const storedUUID = loadClaudeSessionUUID(getActiveSessionId());

    // Pass log path to startClaudeSession so it redirects output there
    // Use resume ID from module-level var if available (multi-turn support)
    let resumeId = claudeResumeSessionId;
    if (resumeId.length < 1) resumeId = storedUUID;
    claudeSpawnedPid = startClaudeSession(sendText, wsRoot, resumeId, logPath, '', '', 0);

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
  claudeModelDisplay = '';
  claudeVersionDisplay = '';
  claudePermModeDisplay = '';
  claudeInfoRow = null;
  claudeRateLimited = 0;
  claudeRateLimitResetEpoch = 0;
  if (claudeRateLimitTimer > 0) { clearInterval(claudeRateLimitTimer); claudeRateLimitTimer = 0; }
  claudeRateLimitLabel = null;
  claudeLastToolUseId = '';
  claudeLastToolUseName = '';
  thinkingBlockWidget = null;
  thinkingBlockContent = null;
  thinkingBlockExpanded = 0;
  claudeTotalDurationMs = 0;
  claudeTotalInputTokens = 0;
  claudeTotalOutputTokens = 0;
  streamingMsgBlock = null;
  streamContainer = null;
  firstUserMsgSent = 0;

  // New sessions always default to Chat mode (0)
  panelMode = 0;
  setActiveSessionMode(0);
  const newId = createNewSession(0);
  msgFilePath = getSessionFilePath(newId);

  // Persist model choice for new session
  updateSessionModel(newId, selectedModelId);

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
    setBtnFg(btn, getActivityBarForeground());
    if (isCurrentThemeDark() > 0) {
      if (wrap) widgetSetBackgroundColor(wrap, 0.25, 0.30, 0.58, 1.0);
    } else {
      if (wrap) widgetSetBackgroundColor(wrap, 0.0, 0.47, 0.80, 0.15);
    }
  } else {
    setBtnFg(btn, getSecondaryTextColor());
    if (wrap) widgetSetBackgroundColor(wrap, 0.0, 0.0, 0.0, 0.0);
  }
}

function styleDisabledTab(btn: unknown, wrap: unknown): void {
  if (!btn) return;
  const disabledColor = isCurrentThemeDark() > 0 ? '#404040' : '#b0b0b0';
  setBtnFg(btn, disabledColor);
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
  updateModelPickerVisibility();
}

// ---------------------------------------------------------------------------
// Model picker
// ---------------------------------------------------------------------------

function onModelPickerChange(idx: number): void {
  selectedModelId = idx;
  activeProviderFormat = getProviderFormat(idx);
  updateSessionModel(getActiveSessionId(), idx);
  setActiveSessionModel(idx);
  // Update button title
  if (modelBtn) {
    let title = '\u25BE ';
    title += getPickerLabel(idx);
    buttonSetTitle(modelBtn, title);
  }
  // Close dropdown
  modelListVisible = 0;
  if (modelListContainer) widgetSetHidden(modelListContainer, 1);
}

/** Toggle model selection dropdown. */
function toggleModelList(): void {
  if (modelListVisible > 0) {
    modelListVisible = 0;
    if (modelListContainer) widgetSetHidden(modelListContainer, 1);
  } else {
    modelListVisible = 1;
    if (modelListContainer) {
      rebuildModelList();
      widgetSetHidden(modelListContainer, 0);
    }
  }
}

function rebuildModelList(): void {
  if (!modelListContainer) return;
  widgetClearChildren(modelListContainer);
  const total = getModelCount();
  for (let i = 0; i < total; i++) {
    const fn = getModelSelectFn(i);
    const label = getPickerLabel(i);
    let displayLabel = '';
    if (i === selectedModelId) {
      displayLabel += '\u2713 ';
    } else {
      displayLabel += '  ';
    }
    displayLabel += label;
    const btn = Button(displayLabel, () => { fn(); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 11);
    setBtnFg(btn, getSideBarForeground());
    widgetAddChild(modelListContainer, btn);
  }
}

// Fixed model select callbacks (Perry: closures capture by value)
function selectModel0(): void { onModelPickerChange(0); }
function selectModel1(): void { onModelPickerChange(1); }
function selectModel2(): void { onModelPickerChange(2); }
function selectModel3(): void { onModelPickerChange(3); }
function selectModel4(): void { onModelPickerChange(4); }
function selectModel5(): void { onModelPickerChange(5); }
function selectModel6(): void { onModelPickerChange(6); }
function selectModel7(): void { onModelPickerChange(7); }
function selectModel8(): void { onModelPickerChange(8); }
function selectModel9(): void { onModelPickerChange(9); }
function selectModel10(): void { onModelPickerChange(10); }
function selectModel11(): void { onModelPickerChange(11); }
function selectModel12(): void { onModelPickerChange(12); }
function selectModel13(): void { onModelPickerChange(13); }
function selectModel14(): void { onModelPickerChange(14); }
function selectModel15(): void { onModelPickerChange(15); }

function getModelSelectFn(idx: number): () => void {
  if (idx === 0) return selectModel0;
  if (idx === 1) return selectModel1;
  if (idx === 2) return selectModel2;
  if (idx === 3) return selectModel3;
  if (idx === 4) return selectModel4;
  if (idx === 5) return selectModel5;
  if (idx === 6) return selectModel6;
  if (idx === 7) return selectModel7;
  if (idx === 8) return selectModel8;
  if (idx === 9) return selectModel9;
  if (idx === 10) return selectModel10;
  if (idx === 11) return selectModel11;
  if (idx === 12) return selectModel12;
  if (idx === 13) return selectModel13;
  if (idx === 14) return selectModel14;
  return selectModel15;
}

function updateModelPickerVisibility(): void {
  // Nothing needed — model button is always in bottom bar
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
    let hintText = t('Ask a question about your code');
    if (panelMode === 1) hintText = t('Describe a task for the AI agent');
    if (panelMode === 2) hintText = t('Describe what you want to plan');
    if (panelMode === 3) hintText = t('Ask Claude Code (uses your Claude.ai subscription)');
    const hint = Text(hintText);
    textSetFontSize(hint, 12);
    setFg(hint, getSideBarForeground());
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
    hiddenText += ' ' + t('older messages hidden');
    const hiddenLabel = Text(hiddenText);
    textSetFontSize(hiddenLabel, 10);
    setFg(hiddenLabel, getSideBarForeground());
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
          setChatBgCode(toolBlock);
          const toolLabel = Text('\u2699 ' + t('Tool result'));
          textSetFontSize(toolLabel, 10);
          textSetFontFamily(toolLabel, 10, monoFont());
          setFg(toolLabel, getSideBarForeground());
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
          textSetFontFamily(resultText, 10, monoFont());
          setFg(resultText, getSideBarForeground());
          widgetAddChild(toolBlock, resultText);
          widgetAddChild(chatMessagesContainer, toolBlock);
          lastAddedWidget = toolBlock;
        } else {
          // User or assistant message
          const roleLabel = Text(isUser > 0 ? t('You') : t('Hone'));
          textSetFontSize(roleLabel, 10);
          textSetFontWeight(roleLabel, 10, 0.7);
          setFg(roleLabel, getSideBarForeground());

          const msgBlock = VStackWithInsets(2, 4, 8, 4, 8);
          widgetAddChild(msgBlock, roleLabel);

          // Use markdown rendering for all messages
          renderMarkdownBlock(content, msgBlock, panelColors, 320);

          if (isUser > 0 && panelColors) {
            setChatBg(msgBlock);
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

/**
 * Pre-fill the chat input with `text` and focus it. The user can review
 * and press Enter to submit. SHIP-V1-GAPS.md #63 (generate commit message)
 * uses this to seed the prompt with the diff.
 */
export function prefillChatInput(text: string): void {
  if (chatInput) {
    textfieldSetString(chatInput, text);
  }
  chatFocusCountdown = 5;
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

  // --- Header row: New Chat + History search + Export ---
  const newChatBtn = Button(t('+ New'), () => { onNewChat(); });
  buttonSetBordered(newChatBtn, 0);
  textSetFontSize(newChatBtn, 11);
  setBtnFg(newChatBtn, getSideBarForeground());

  historySearchField = TextField('', (text: string) => { onHistorySearch(text); });
  textfieldSetOnSubmit(historySearchField, () => { toggleHistoryDropdown(); });
  textfieldSetOnFocus(historySearchField, () => { onHistorySearchFocus(); });
  widgetSetWidth(historySearchField, 140);

  const exportBtn = Button(t('Export'), () => { exportActiveSession(); });
  buttonSetBordered(exportBtn, 0);
  textSetFontSize(exportBtn, 11);
  setBtnFg(exportBtn, getSideBarForeground());

  const headerRow = HStack(4, [newChatBtn, historySearchField, Spacer(), exportBtn]);
  widgetAddChild(container, headerRow);

  // --- History dropdown (overlay, hidden by default) ---
  sessionListContainer = VStack(1, []);
  setChatBg(sessionListContainer);
  historyDropdown = ScrollView();
  scrollViewSetChild(historyDropdown, sessionListContainer);
  // Add as floating overlay on the container, positioned below header
  widgetAddOverlay(container, historyDropdown);
  widgetSetOverlayFrame(historyDropdown, 0, 28, 320, 0);
  historyDropdownVisible = 0;

  // --- Mode tabs ---
  modeChatBtn = Button(t('Chat'), () => { onModeChat(); });
  buttonSetBordered(modeChatBtn, 0);
  textSetFontSize(modeChatBtn, 11);
  modeChatWrap = HStackWithInsets(0, 6, 3, 6, 3);
  widgetAddChild(modeChatWrap, modeChatBtn);

  modeAgentBtn = Button(t('Agent'), () => { onModeAgent(); });
  buttonSetBordered(modeAgentBtn, 0);
  textSetFontSize(modeAgentBtn, 11);
  modeAgentWrap = HStackWithInsets(0, 6, 3, 6, 3);
  widgetAddChild(modeAgentWrap, modeAgentBtn);

  modePlanBtn = Button(t('Plan'), () => { onModePlan(); });
  buttonSetBordered(modePlanBtn, 0);
  textSetFontSize(modePlanBtn, 11);
  modePlanWrap = HStackWithInsets(0, 6, 3, 6, 3);
  widgetAddChild(modePlanWrap, modePlanBtn);

  modeClaudeBtn = Button(t('Claude Code'), () => { onModeClaude(); });
  buttonSetBordered(modeClaudeBtn, 0);
  textSetFontSize(modeClaudeBtn, 11);
  modeClaudeWrap = HStackWithInsets(0, 6, 3, 6, 3);
  widgetAddChild(modeClaudeWrap, modeClaudeBtn);

  const modeRow = HStack(2, [modeChatWrap, modeAgentWrap, modePlanWrap, modeClaudeWrap, Spacer()]);
  widgetAddChild(container, modeRow);

  // --- Model selector (init, button goes in bottom bar) ---
  selectedModelId = getActiveSessionModel();
  activeProviderFormat = getProviderFormat(selectedModelId);

  // 1px divider
  const divider = Text('');
  widgetSetHeight(divider, 1);
  setChatDivider(divider);
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
      if (isCurrentThemeDark() > 0) { widgetSetBackgroundColor(hintBlock, 0.15, 0.18, 0.25, 1.0); } else { widgetSetBackgroundColor(hintBlock, 0.90, 0.93, 0.98, 1.0); };

      const hintTitle = Text(t('Claude Code Required'));
      textSetFontSize(hintTitle, 12);
      textSetFontWeight(hintTitle, 12, 0.7);
      setFg(hintTitle, getSideBarForeground());
      widgetAddChild(hintBlock, hintTitle);

      const hint1 = Text(t('Install Claude Code: npm install -g @anthropic-ai/claude-code'));
      textSetFontSize(hint1, 11);
      setFg(hint1, getSideBarForeground());
      widgetAddChild(hintBlock, hint1);

      widgetAddChild(chatMessagesContainer, hintBlock);
    } else {
      const authOk = checkClaudeAuth();
      if (authOk < 1) {
        const hintBlock = VStackWithInsets(4, 8, 8, 8, 8);
        if (isCurrentThemeDark() > 0) { widgetSetBackgroundColor(hintBlock, 0.15, 0.18, 0.25, 1.0); } else { widgetSetBackgroundColor(hintBlock, 0.90, 0.93, 0.98, 1.0); };

        const hintTitle = Text(t('Sign In Required'));
        textSetFontSize(hintTitle, 12);
        textSetFontWeight(hintTitle, 12, 0.7);
        setFg(hintTitle, getSideBarForeground());
        widgetAddChild(hintBlock, hintTitle);

        const hint1 = Text(t('Run "claude auth login" in your terminal to sign in.'));
        textSetFontSize(hint1, 11);
        setFg(hint1, getSideBarForeground());
        widgetAddChild(hintBlock, hint1);

        widgetAddChild(chatMessagesContainer, hintBlock);
      } else {
        updateMessages();
      }
    }
  } else {
    // Check if current provider has a key (skip for Ollama which needs no key)
    const initProviderIdx = getProviderIndex(selectedModelId);
    const initKey = loadProviderApiKey(initProviderIdx);
    if (initKey.length < 2 && initProviderIdx !== 5) {
      const hintBlock = VStackWithInsets(4, 8, 8, 8, 8);
      if (isCurrentThemeDark() > 0) { widgetSetBackgroundColor(hintBlock, 0.15, 0.18, 0.25, 1.0); } else { widgetSetBackgroundColor(hintBlock, 0.90, 0.93, 0.98, 1.0); };

      const hintTitle = Text(t('API Key Required'));
      textSetFontSize(hintTitle, 12);
      textSetFontWeight(hintTitle, 12, 0.7);
      setFg(hintTitle, getSideBarForeground());
      widgetAddChild(hintBlock, hintTitle);

      const hint1 = Text(t('Open Settings to configure your provider API key.'));
      textSetFontSize(hint1, 11);
      setFg(hint1, getSideBarForeground());
      widgetAddChild(hintBlock, hint1);

      widgetAddChild(chatMessagesContainer, hintBlock);
    } else {
      updateMessages();
    }
  }

  // --- Context chips ---
  chipsContainer = HStack(4, []);
  widgetAddChild(container, chipsContainer);

  // --- Model selector dropdown (hidden, shown above bottom bar) ---
  modelListContainer = VStackWithInsets(1, 4, 4, 4, 4);
  setChatBg(modelListContainer);
  widgetSetHidden(modelListContainer, 1);
  modelListVisible = 0;
  widgetAddChild(container, modelListContainer);

  // --- Bottom bar: model + attach buttons ---
  let modelTitle = '\u25BE ';
  modelTitle += getPickerLabel(selectedModelId);
  modelBtn = Button(modelTitle, () => { toggleModelList(); });
  buttonSetBordered(modelBtn, 0);
  textSetFontSize(modelBtn, 10);
  setBtnFg(modelBtn, getSideBarForeground());

  const attachFileBtn = Button(t('+ File'), () => { onAttachFile(); });
  buttonSetBordered(attachFileBtn, 0);
  textSetFontSize(attachFileBtn, 10);
  setBtnFg(attachFileBtn, getSideBarForeground());

  const attachSelBtn = Button(t('+ Selection'), () => { onAttachSelection(); });
  buttonSetBordered(attachSelBtn, 0);
  textSetFontSize(attachSelBtn, 10);
  setBtnFg(attachSelBtn, getSideBarForeground());

  const bottomRow = HStack(6, [modelBtn, attachFileBtn, attachSelBtn, Spacer()]);
  widgetAddChild(container, bottomRow);

  // --- @-mention popup (SHIP-V1-GAPS.md #61) ---
  // Sits between the bottom bar and the input so suggestions appear visually
  // close to the cursor. Hidden until the user types `@` somewhere in the
  // input; populated on each keystroke that changes the query.
  mentionsContainer = VStack(2, []);
  widgetSetHidden(mentionsContainer, 1);
  mentionsVisible = 0;
  widgetAddChild(container, mentionsContainer);

  // --- Input ---
  chatInput = TextField('', (text: string) => { onChatInput(text); });
  // Enter/Return key triggers onSubmit
  textfieldSetOnSubmit(chatInput, (text: string) => { onSubmitFromField(text); });
  textfieldSetOnFocus(chatInput, () => { hideHistoryDropdown(); });
  widgetAddChild(container, chatInput);

  const sendBtn = Button(t('Send'), () => { onSend(); });
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
