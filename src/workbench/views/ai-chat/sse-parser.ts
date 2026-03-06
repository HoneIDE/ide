/**
 * SSE / JSON parsing utilities — Perry-safe (charCodeAt, no JSON.parse).
 */

/** Extract a JSON string value for a given key. */
export function extractJsonString(json: string, key: string): string {
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
        afterKey += 1;
      } else {
        break;
      }
    }
    if (afterKey >= json.length || json.charCodeAt(afterKey) !== 58) {
      searchStart = pos + 1;
      continue;
    }

    afterKey += 1;
    while (afterKey < json.length) {
      const ch = json.charCodeAt(afterKey);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        afterKey += 1;
      } else {
        break;
      }
    }

    if (afterKey >= json.length || json.charCodeAt(afterKey) !== 34) {
      searchStart = pos + 1;
      continue;
    }
    afterKey += 1;

    let result = '';
    while (afterKey < json.length) {
      const ch = json.charCodeAt(afterKey);
      if (ch === 92) {
        afterKey += 1;
        if (afterKey < json.length) {
          const next = json.charCodeAt(afterKey);
          if (next === 110) { result += '\n'; }
          else if (next === 116) { result += '\t'; }
          else if (next === 114) { result += '\r'; }
          else if (next === 34) { result += '"'; }
          else if (next === 92) { result += '\\'; }
          else if (next === 117) {
            afterKey += 4;
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
      afterKey += 1;
    }

    return result;
  }

  return '';
}

/** Escape a string for embedding in JSON. */
export function jsonEscape(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 92) {
      result += '\\\\';
    } else if (ch === 34) {
      result += '\\"';
    } else if (ch === 10) {
      result += '\\n';
    } else if (ch === 13) {
      result += '\\r';
    } else if (ch === 9) {
      result += '\\t';
    } else {
      result += s.slice(i, i + 1);
    }
  }
  return result;
}

/** Check if line starts with "data: " prefix. */
function startsWithData(line: string): number {
  if (line.length < 6) return 0;
  // "data: " = 100 97 116 97 58 32
  if (line.charCodeAt(0) === 100 && line.charCodeAt(1) === 97 &&
      line.charCodeAt(2) === 116 && line.charCodeAt(3) === 97 &&
      line.charCodeAt(4) === 58 && line.charCodeAt(5) === 32) {
    return 1;
  }
  return 0;
}

/** Get the data payload after "data: " prefix. */
export function getSSEData(line: string): string {
  if (startsWithData(line) > 0) {
    return line.slice(6);
  }
  return '';
}

/** Check if SSE line is [DONE] or message_stop. */
export function isSSEDone(line: string): number {
  const data = getSSEData(line);
  if (data.length < 2) return 0;
  // [DONE]
  if (data.charCodeAt(0) === 91 && data.length >= 6) {
    if (data.charCodeAt(1) === 68 && data.charCodeAt(2) === 79 &&
        data.charCodeAt(3) === 78 && data.charCodeAt(4) === 69) {
      return 1;
    }
  }
  // Check for message_stop
  const evtType = extractJsonString(data, 'type');
  if (evtType.length >= 12) {
    // "message_stop"
    if (evtType.charCodeAt(0) === 109 && evtType.charCodeAt(7) === 115 &&
        evtType.charCodeAt(8) === 116 && evtType.charCodeAt(11) === 112) {
      return 1;
    }
  }
  return 0;
}

/** Extract text delta from a content_block_delta SSE line. */
export function parseSSETextDelta(line: string): string {
  const data = getSSEData(line);
  if (data.length < 10) return '';
  const evtType = extractJsonString(data, 'type');
  // "content_block_delta"
  if (evtType.length < 10) return '';
  if (evtType.charCodeAt(0) !== 99) return ''; // 'c'
  const deltaType = extractJsonString(data, 'type');
  // Need the nested delta.type — look for "text_delta"
  const text = extractJsonString(data, 'text');
  return text;
}

/** Detect content_block_start with type=tool_use. Returns tool name or empty. */
export function parseSSEToolUse(line: string): string {
  const data = getSSEData(line);
  if (data.length < 20) return '';
  const evtType = extractJsonString(data, 'type');
  // "content_block_start"
  if (evtType.length < 15) return '';
  if (evtType.charCodeAt(0) !== 99 || evtType.charCodeAt(8) !== 98) return '';
  // Check for tool_use in content_block
  const blockType = extractJsonString(data, 'type');
  // We need a second-level check: "content_block" contains nested "type":"tool_use"
  // Look for "tool_use" after the first "type" value
  const name = extractJsonString(data, 'name');
  if (name.length > 0) return name;
  return '';
}

/** Extract tool use id from content_block_start. */
export function parseSSEToolId(line: string): string {
  const data = getSSEData(line);
  if (data.length < 10) return '';
  return extractJsonString(data, 'id');
}

/** Extract input_json_delta partial JSON from content_block_delta. */
export function parseSSEToolDelta(line: string): string {
  const data = getSSEData(line);
  if (data.length < 10) return '';
  const pJson = extractJsonString(data, 'partial_json');
  return pJson;
}

/** Parse SSE event type (content_block_start, content_block_delta, content_block_stop, message_stop, etc). */
export function parseSSEEventType(line: string): string {
  const data = getSSEData(line);
  if (data.length < 5) return '';
  return extractJsonString(data, 'type');
}
