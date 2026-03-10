/**
 * Claude Code state machine — simpler than agent-state because
 * Claude Code handles its own tool loop. We just render output.
 *
 * States:
 *   0 = IDLE
 *   1 = STARTING (process spawned, waiting for first event)
 *   2 = STREAMING (receiving text content)
 *   3 = TOOL_RUNNING (Claude Code is executing a tool internally)
 *   4 = COMPLETED (result event received)
 *   5 = ERROR
 *
 * All state is module-level (Perry constraint).
 */

import {
  parseNDJSONType, isSystemEvent, isAssistantEvent, isResultEvent,
  parseNDJSONSessionId, parseNDJSONText, parseNDJSONToolUse,
  parseNDJSONResult, parseNDJSONCost, parseNDJSONTurns,
  parseNDJSONModel, hasToolUseBlock,
} from './claude-events';

// --- Module-level state ---

let claudeStatus: number = 0; // 0=idle,1=starting,2=streaming,3=tool,4=completed,5=error
let claudeSessionUUID = '';
let claudeModelName = '';
let claudeResultText = '';
let claudeResultCost: number = -1;
let claudeResultTurns: number = -1;
let claudeAccumulatedText = '';

// Callbacks set by chat-panel
let onTextDeltaCb: ((text: string) => void) | null = null;
let onToolActivityCb: ((name: string, status: string) => void) | null = null;
let onCompleteCb: ((result: string, cost: number, turns: number) => void) | null = null;
let onErrorCb: ((msg: string) => void) | null = null;
let onSessionInitCb: ((sessionId: string, model: string) => void) | null = null;

// --- Public getters/setters ---

export function getClaudeStatus(): number { return claudeStatus; }
export function getClaudeSessionUUID(): string { return claudeSessionUUID; }
export function getClaudeModelName(): string { return claudeModelName; }
export function getClaudeResultText(): string { return claudeResultText; }
export function getClaudeResultCost(): number { return claudeResultCost; }
export function getClaudeResultTurns(): number { return claudeResultTurns; }
export function getClaudeAccumulatedText(): string { return claudeAccumulatedText; }

export function setClaudeCallbacks(
  onTextDelta: (text: string) => void,
  onToolActivity: (name: string, status: string) => void,
  onComplete: (result: string, cost: number, turns: number) => void,
  onError: (msg: string) => void,
  onSessionInit: (sessionId: string, model: string) => void,
): void {
  onTextDeltaCb = onTextDelta;
  onToolActivityCb = onToolActivity;
  onCompleteCb = onComplete;
  onErrorCb = onError;
  onSessionInitCb = onSessionInit;
}

export function resetClaudeState(): void {
  claudeStatus = 0;
  claudeSessionUUID = '';
  claudeModelName = '';
  claudeResultText = '';
  claudeResultCost = -1;
  claudeResultTurns = -1;
  claudeAccumulatedText = '';
}

export function setClaudeStarting(): void {
  claudeStatus = 1;
  claudeAccumulatedText = '';
}

export function setClaudeError(msg: string): void {
  claudeStatus = 5;
  if (onErrorCb) onErrorCb(msg);
}

// --- Process NDJSON lines ---

/**
 * Process a single NDJSON line from Claude Code's stream-json output.
 * Called by claude-process.ts poll loop for each new line.
 */
export function processClaudeLine(line: string): void {
  if (line.length < 5) return;

  const evtType = parseNDJSONType(line);
  if (evtType.length < 4) return;

  // System event — session init
  if (isSystemEvent(evtType) > 0) {
    const sid = parseNDJSONSessionId(line);
    if (sid.length > 0) {
      claudeSessionUUID = sid;
    }
    const model = parseNDJSONModel(line);
    if (model.length > 0) {
      claudeModelName = model;
    }
    claudeStatus = 2; // Move to streaming
    if (onSessionInitCb) onSessionInitCb(claudeSessionUUID, claudeModelName);
    return;
  }

  // Assistant event — text or tool_use
  if (isAssistantEvent(evtType) > 0) {
    // Check for tool_use blocks first
    if (hasToolUseBlock(line) > 0) {
      const toolName = parseNDJSONToolUse(line);
      if (toolName.length > 0) {
        claudeStatus = 3; // TOOL_RUNNING
        if (onToolActivityCb) onToolActivityCb(toolName, 'running');
      }
    }
    // Extract text content
    const text = parseNDJSONText(line);
    if (text.length > 0) {
      claudeStatus = 2; // STREAMING
      claudeAccumulatedText += text;
      if (onTextDeltaCb) onTextDeltaCb(text);
    }
    return;
  }

  // Result event — final output
  if (isResultEvent(evtType) > 0) {
    claudeResultText = parseNDJSONResult(line);
    claudeResultCost = parseNDJSONCost(line);
    claudeResultTurns = parseNDJSONTurns(line);
    // Also grab session_id from result for resume
    const sid = parseNDJSONSessionId(line);
    if (sid.length > 0) {
      claudeSessionUUID = sid;
    }
    claudeStatus = 4; // COMPLETED
    if (onCompleteCb) onCompleteCb(claudeResultText, claudeResultCost, claudeResultTurns);
    return;
  }

  // "user" events are internal to Claude Code (tool results) — show as tool activity
  // Check for "user" type: u(0)s(1)e(2)r(3)
  if (evtType.length === 4) {
    if (evtType.charCodeAt(0) === 117) { // u
      if (evtType.charCodeAt(1) === 115) { // s
        if (evtType.charCodeAt(2) === 101) { // e
          if (evtType.charCodeAt(3) === 114) { // r
            // Tool result from Claude Code — indicate tool finished
            if (claudeStatus === 3) {
              claudeStatus = 2; // Back to streaming
              if (onToolActivityCb) onToolActivityCb('', 'done');
            }
          }
        }
      }
    }
  }
}
