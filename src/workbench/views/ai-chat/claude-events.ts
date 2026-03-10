/**
 * NDJSON event parser for Claude Code's --output-format stream-json.
 *
 * Each line from the log file is a complete JSON object.
 * Parsing is charCodeAt-based (Perry-safe, no JSON.parse).
 *
 * Event types:
 *   "system"    — session init: session_id, model
 *   "assistant" — message with content (text + tool_use blocks)
 *   "user"      — tool results (internal to Claude Code)
 *   "result"    — final result: result text, cost, session_id, num_turns
 */

import { extractJsonString } from './sse-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if str contains substr starting at any position. */
function containsSubstr(str: string, sub: string): number {
  if (sub.length > str.length) return 0;
  for (let i = 0; i <= str.length - sub.length; i++) {
    let match: number = 1;
    for (let j = 0; j < sub.length; j++) {
      if (str.charCodeAt(i + j) !== sub.charCodeAt(j)) {
        match = 0;
        break;
      }
    }
    if (match > 0) return 1;
  }
  return 0;
}

/** Extract a JSON number value for a given key. Returns -1 if not found. */
function extractJsonNumber(json: string, key: string): number {
  let pattern = '"';
  pattern += key;
  pattern += '"';

  // Find key
  let pos = -1;
  for (let i = 0; i <= json.length - pattern.length; i++) {
    let match: number = 1;
    for (let j = 0; j < pattern.length; j++) {
      if (json.charCodeAt(i + j) !== pattern.charCodeAt(j)) {
        match = 0;
        break;
      }
    }
    if (match > 0) { pos = i; break; }
  }
  if (pos < 0) return -1;

  // Skip key + colon + whitespace
  let afterKey = pos + pattern.length;
  while (afterKey < json.length) {
    const ch = json.charCodeAt(afterKey);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13) { afterKey += 1; }
    else { break; }
  }
  if (afterKey >= json.length || json.charCodeAt(afterKey) !== 58) return -1; // :
  afterKey += 1;
  while (afterKey < json.length) {
    const ch = json.charCodeAt(afterKey);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13) { afterKey += 1; }
    else { break; }
  }

  // Read digits (and optional decimal point)
  let numStr = '';
  while (afterKey < json.length) {
    const ch = json.charCodeAt(afterKey);
    // 0-9 = 48-57, '.' = 46, '-' = 45, 'e' = 101, 'E' = 69, '+' = 43
    if ((ch >= 48 && ch <= 57) || ch === 46 || ch === 45 || ch === 101 || ch === 69 || ch === 43) {
      numStr += json.slice(afterKey, afterKey + 1);
      afterKey += 1;
    } else {
      break;
    }
  }
  if (numStr.length < 1) return -1;
  return Number(numStr);
}

// ---------------------------------------------------------------------------
// Event type detection
// ---------------------------------------------------------------------------

/**
 * Parse the "type" field from an NDJSON line.
 * Returns: 'system', 'assistant', 'user', 'result', or empty string.
 */
export function parseNDJSONType(line: string): string {
  if (line.length < 10) return '';
  return extractJsonString(line, 'type');
}

/**
 * Check if this is a "system" event.
 * "system" — s(0)y(1)s(2)t(3)e(4)m(5)
 */
export function isSystemEvent(evtType: string): number {
  if (evtType.length !== 6) return 0;
  if (evtType.charCodeAt(0) !== 115) return 0; // s
  if (evtType.charCodeAt(1) !== 121) return 0; // y
  if (evtType.charCodeAt(2) !== 115) return 0; // s
  if (evtType.charCodeAt(3) !== 116) return 0; // t
  if (evtType.charCodeAt(4) !== 101) return 0; // e
  if (evtType.charCodeAt(5) !== 109) return 0; // m
  return 1;
}

/**
 * Check if this is an "assistant" event.
 * "assistant" — a(0)s(1)s(2)i(3)s(4)t(5)a(6)n(7)t(8)
 */
export function isAssistantEvent(evtType: string): number {
  if (evtType.length !== 9) return 0;
  if (evtType.charCodeAt(0) !== 97) return 0;  // a
  if (evtType.charCodeAt(4) !== 115) return 0; // s
  if (evtType.charCodeAt(8) !== 116) return 0; // t
  return 1;
}

/**
 * Check if this is a "result" event.
 * "result" — r(0)e(1)s(2)u(3)l(4)t(5)
 */
export function isResultEvent(evtType: string): number {
  if (evtType.length !== 6) return 0;
  if (evtType.charCodeAt(0) !== 114) return 0; // r
  if (evtType.charCodeAt(1) !== 101) return 0; // e
  if (evtType.charCodeAt(2) !== 115) return 0; // s
  if (evtType.charCodeAt(3) !== 117) return 0; // u
  if (evtType.charCodeAt(4) !== 108) return 0; // l
  if (evtType.charCodeAt(5) !== 116) return 0; // t
  return 1;
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

/**
 * Extract session_id from a system event line.
 */
export function parseNDJSONSessionId(line: string): string {
  return extractJsonString(line, 'session_id');
}

/**
 * Extract text content from an assistant event.
 *
 * Claude Code stream-json assistant events have:
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."},...]},...}
 *
 * We look for the "text" field value. If there are multiple text blocks,
 * this returns the first one. For tool_use blocks, use parseNDJSONToolUse.
 */
export function parseNDJSONText(line: string): string {
  // Quick check: does line contain "text" (as a content type)?
  // Look for "type":"text" pattern
  let hasTextType: number = 0;
  // Search for: "type":"text"
  // Use compact check: find "text" after "type"
  if (containsSubstr(line, '"text"') > 0) {
    hasTextType = 1;
  }
  if (hasTextType < 1) return '';

  // Extract the "text" field value — this gets the text content
  // We need to be careful: there's a "type":"text" AND a "text":"actual content"
  // extractJsonString returns the first match, so we search for the content "text" key
  // which appears after "type":"text"

  // Find position of "type":"text" to skip past it
  let typeTextPos = -1;
  for (let i = 0; i < line.length - 12; i++) {
    // "type":"text" pattern
    if (line.charCodeAt(i) === 116) {     // t
      if (line.charCodeAt(i + 1) === 121) { // y
        if (line.charCodeAt(i + 2) === 112) { // p
          if (line.charCodeAt(i + 3) === 101) { // e
            // Found "type", check if value is "text"
            // Skip ahead to find "text" value
            let j = i + 4;
            // Skip ","
            while (j < line.length && line.charCodeAt(j) !== 116) j += 1;
            if (j + 3 < line.length) {
              if (line.charCodeAt(j) === 116) {     // t
                if (line.charCodeAt(j + 1) === 101) { // e
                  if (line.charCodeAt(j + 2) === 120) { // x
                    if (line.charCodeAt(j + 3) === 116) { // t
                      typeTextPos = j + 4;
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (typeTextPos < 0) return '';

  // Now extract "text" field after typeTextPos
  const remainder = line.slice(typeTextPos);
  return extractJsonString(remainder, 'text');
}

/**
 * Extract tool name from an assistant event's tool_use content block.
 * Returns tool name or empty string.
 */
export function parseNDJSONToolUse(line: string): string {
  if (containsSubstr(line, 'tool_use') < 1) return '';
  return extractJsonString(line, 'name');
}

/**
 * Extract tool input (as raw JSON string) from an assistant event's tool_use block.
 */
export function parseNDJSONToolInput(line: string): string {
  if (containsSubstr(line, 'tool_use') < 1) return '';
  return extractJsonString(line, 'input');
}

/**
 * Extract result text from a result event.
 */
export function parseNDJSONResult(line: string): string {
  return extractJsonString(line, 'result');
}

/**
 * Extract total_cost_usd from a result event. Returns -1 if not found.
 */
export function parseNDJSONCost(line: string): number {
  return extractJsonNumber(line, 'total_cost_usd');
}

/**
 * Extract num_turns from a result event. Returns -1 if not found.
 */
export function parseNDJSONTurns(line: string): number {
  return extractJsonNumber(line, 'num_turns');
}

/**
 * Extract model name from a system event.
 */
export function parseNDJSONModel(line: string): string {
  return extractJsonString(line, 'model');
}

/**
 * Check if an assistant event contains a tool_use block.
 */
export function hasToolUseBlock(line: string): number {
  return containsSubstr(line, 'tool_use');
}

/**
 * Extract subtype from an assistant event (e.g., for streaming deltas).
 * Claude Code stream-json may include a "subtype" field.
 */
export function parseNDJSONSubtype(line: string): string {
  return extractJsonString(line, 'subtype');
}
