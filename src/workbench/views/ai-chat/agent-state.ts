/**
 * Agent loop state machine.
 *
 * States:
 *   0 = IDLE
 *   1 = STREAMING (text deltas)
 *   2 = TOOL_ACCUMULATING (collecting tool args JSON)
 *   3 = AWAITING_APPROVAL (destructive tool, show Allow/Deny)
 *   4 = EXECUTING_TOOL (running tool, then continue)
 *
 * All state is module-level (Perry constraint).
 */
import { extractJsonString, jsonEscape, getSSEData, parseSSEEventType, parseSSETextDelta, parseSSEToolUse, parseSSEToolId, parseSSEToolDelta, isSSEDone } from './sse-parser';
import { executeTool, isDestructiveTool, buildToolDefinitionsJSON, buildReadOnlyToolsJSON, getToolWorkspaceRoot } from './agent-tools';
import { getAppDataDir } from '../../paths';

// --- Module-level state ---

let agentStatus: number = 0; // 0=idle,1=streaming,2=tool_accum,3=approval,4=executing
let agentIterationCount: number = 0;
let agentMaxIterations: number = 25;

let pendingToolName = '';
let pendingToolArgs = '';
let pendingToolId = '';
let toolCallArgsAccumulator = '';
let lastToolResult = '';

// Conversation messages stored as file (same pattern as chat-panel)
// Path set lazily via getAppDataDir() on first use
let agentMsgFilePath = '';

// Current stream accumulated text
let agentStreamText = '';

// Callbacks set by chat-panel
let onTextDeltaCb: ((text: string) => void) | null = null;
let onToolStartCb: ((name: string, id: string) => void) | null = null;
let onToolResultCb: ((name: string, result: string) => void) | null = null;
let onApprovalNeededCb: ((name: string, args: string) => void) | null = null;
let onStreamDoneCb: (() => void) | null = null;
let onAgentErrorCb: ((msg: string) => void) | null = null;
let onIterationStartCb: ((n: number) => void) | null = null;

// --- Public getters/setters ---

export function getAgentStatus(): number { return agentStatus; }
export function getAgentIterationCount(): number { return agentIterationCount; }
export function getPendingToolName(): string { return pendingToolName; }
export function getPendingToolArgs(): string { return pendingToolArgs; }

export function setAgentCallbacks(
  onTextDelta: (text: string) => void,
  onToolStart: (name: string, id: string) => void,
  onToolResult: (name: string, result: string) => void,
  onApprovalNeeded: (name: string, args: string) => void,
  onStreamDone: () => void,
  onAgentError: (msg: string) => void,
  onIterationStart: (n: number) => void,
): void {
  onTextDeltaCb = onTextDelta;
  onToolStartCb = onToolStart;
  onToolResultCb = onToolResult;
  onApprovalNeededCb = onApprovalNeeded;
  onStreamDoneCb = onStreamDone;
  onAgentErrorCb = onAgentError;
  onIterationStartCb = onIterationStart;
}

export function resetAgentState(): void {
  agentStatus = 0;
  agentIterationCount = 0;
  pendingToolName = '';
  pendingToolArgs = '';
  pendingToolId = '';
  toolCallArgsAccumulator = '';
  agentStreamText = '';
  lastToolResult = '';
}

/** Process a single SSE line during agent streaming. Called by chat-panel's poll loop. */
export function processAgentSSELine(line: string): void {
  if (isSSEDone(line) > 0) {
    // Stream ended — check if we have a pending tool
    if (agentStatus === 2) {
      // Finish tool accumulation
      onToolBlockComplete();
    } else if (agentStatus === 5 || agentStatus === 3) {
      // NEEDS_CONTINUE or AWAITING_APPROVAL — don't reset
    } else {
      agentStatus = 0;
      if (onStreamDoneCb) onStreamDoneCb();
    }
    return;
  }

  const evtType = parseSSEEventType(line);
  if (evtType.length < 3) return;

  // "content_block_start"
  if (evtType.charCodeAt(0) === 99 && evtType.length > 18 && evtType.charCodeAt(14) === 115) {
    // Check for tool_use
    const toolName = parseSSEToolUse(line);
    if (toolName.length > 0) {
      const toolId = parseSSEToolId(line);
      pendingToolName = toolName;
      pendingToolId = toolId;
      toolCallArgsAccumulator = '';
      agentStatus = 2; // TOOL_ACCUMULATING
      if (onToolStartCb) onToolStartCb(toolName, toolId);
      return;
    }
    return;
  }

  // "content_block_delta"
  if (evtType.charCodeAt(0) === 99 && evtType.length > 18 && evtType.charCodeAt(14) === 100) {
    if (agentStatus === 2) {
      // Accumulating tool args
      const partial = parseSSEToolDelta(line);
      if (partial.length > 0) {
        toolCallArgsAccumulator += partial;
      }
      return;
    }
    // Text delta
    const text = parseSSETextDelta(line);
    if (text.length > 0) {
      agentStreamText += text;
      if (onTextDeltaCb) onTextDeltaCb(text);
    }
    return;
  }

  // "content_block_stop" (charCodeAt(16) === 111 'o' to distinguish from 'start' which has 'a'=97)
  if (evtType.charCodeAt(0) === 99 && evtType.length >= 18 && evtType.charCodeAt(14) === 115 && evtType.charCodeAt(16) === 111) {
    if (agentStatus === 2) {
      onToolBlockComplete();
    }
    return;
  }

  // "message_stop" (charCodeAt(10)===111 'o' to distinguish from "message_start" which has 'r'=114)
  if (evtType.charCodeAt(0) === 109 && evtType.length >= 12 && evtType.charCodeAt(10) === 111) {
    if (agentStatus === 2) {
      onToolBlockComplete();
    } else if (agentStatus === 5 || agentStatus === 3) {
      // NEEDS_CONTINUE or AWAITING_APPROVAL — don't reset, let chat-panel handle it
    } else {
      agentStatus = 0;
      if (onStreamDoneCb) onStreamDoneCb();
    }
    return;
  }
}

/** Called when a tool_use content block is complete. */
function onToolBlockComplete(): void {
  pendingToolArgs = toolCallArgsAccumulator;
  if (isDestructiveTool(pendingToolName) > 0) {
    agentStatus = 3; // AWAITING_APPROVAL
    if (onApprovalNeededCb) onApprovalNeededCb(pendingToolName, pendingToolArgs);
  } else {
    executeAndContinue();
  }
}

/** Execute the pending tool and prepare to continue the agent loop. */
function executeAndContinue(): void {
  agentStatus = 4; // EXECUTING_TOOL
  const result = executeTool(pendingToolName, pendingToolArgs);
  lastToolResult = result;
  if (onToolResultCb) onToolResultCb(pendingToolName, result);

  // Reset for next iteration
  const toolName = pendingToolName;
  const toolId = pendingToolId;
  const toolArgs = pendingToolArgs;
  pendingToolName = '';
  pendingToolArgs = '';
  pendingToolId = '';
  toolCallArgsAccumulator = '';
  agentStreamText = '';

  agentIterationCount += 1;
  if (agentIterationCount >= agentMaxIterations) {
    agentStatus = 0;
    if (onAgentErrorCb) onAgentErrorCb('Agent reached maximum iterations');
    return;
  }

  // Signal that we need to continue — chat-panel will build and send the next request
  agentStatus = 5; // NEEDS_CONTINUE (special state)
  // Store the info needed for continuation
  pendingToolName = toolName;
  pendingToolId = toolId;
  pendingToolArgs = toolArgs;
  lastToolResult = result;
}

/** Called by chat-panel to get continuation info after state=5. */
export function getLastToolResult(): string { return lastToolResult; }
export function getLastToolName(): string { return pendingToolName; }
export function getLastToolId(): string { return pendingToolId; }

/** Called when user approves a destructive tool. */
export function onApprovalAllow(): void {
  if (agentStatus !== 3) return;
  executeAndContinue();
}

/** Called when user denies a destructive tool. */
export function onApprovalDeny(): void {
  if (agentStatus !== 3) return;
  lastToolResult = 'Tool execution denied by user';
  if (onToolResultCb) onToolResultCb(pendingToolName, lastToolResult);

  const toolName = pendingToolName;
  const toolId = pendingToolId;
  pendingToolName = '';
  pendingToolArgs = '';
  pendingToolId = '';
  toolCallArgsAccumulator = '';
  agentStreamText = '';

  agentIterationCount += 1;
  agentStatus = 5; // NEEDS_CONTINUE
  pendingToolName = toolName;
  pendingToolId = toolId;
}

/** Build agent system prompt. */
export function buildAgentSystemPrompt(): string {
  let prompt = 'You are Hone, an AI coding agent built into the Hone IDE. ';
  prompt += 'You have access to tools to read files, edit files, create files, run terminal commands, search code, and check git status. ';
  prompt += 'Use tools to understand the codebase before making changes. ';
  prompt += 'Be concise in your explanations. ';
  prompt += 'Always read relevant files before editing them. ';
  const root = getToolWorkspaceRoot();
  if (root.length > 0) {
    prompt += 'The workspace root is: ';
    prompt += root;
    prompt += '. ';
  }
  return prompt;
}

/** Build plan mode system prompt (read-only tools only). */
export function buildPlanSystemPrompt(): string {
  let prompt = 'You are Hone, an AI coding assistant in Plan mode. ';
  prompt += 'Generate a detailed plan for the requested task. ';
  prompt += 'Do NOT execute any changes. Only use file_read, search, git_status, git_diff, and list_dir tools to understand the codebase. ';
  prompt += 'Present your plan as a numbered list of steps with file paths and descriptions of changes. ';
  const root = getToolWorkspaceRoot();
  if (root.length > 0) {
    prompt += 'The workspace root is: ';
    prompt += root;
    prompt += '. ';
  }
  return prompt;
}
