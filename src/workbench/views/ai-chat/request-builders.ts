/**
 * Per-format request body builders for multi-provider AI chat.
 *
 * Four formats:
 *   0 = Anthropic: system as top-level, "text" deltas
 *   1 = OpenAI-compat: system as message, delta.content deltas
 *   2 = Google: contents/parts format
 *   3 = Ollama: NDJSON message.content
 *
 * Each builder has its own message-file parsing loop (Perry-safe).
 */

import { jsonEscape } from './sse-parser';

// ---------------------------------------------------------------------------
// Shared: decode content lines (same as chat-panel.ts decodeContent)
// ---------------------------------------------------------------------------

function decodeContent(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 37) { // %
      if (i + 2 < s.length) {
        const h1 = s.charCodeAt(i + 1);
        const h2 = s.charCodeAt(i + 2);
        let val = 0;
        if (h1 >= 48 && h1 <= 57) val = (h1 - 48) * 16;
        else if (h1 >= 65 && h1 <= 70) val = (h1 - 55) * 16;
        else if (h1 >= 97 && h1 <= 102) val = (h1 - 87) * 16;
        if (h2 >= 48 && h2 <= 57) val += (h2 - 48);
        else if (h2 >= 65 && h2 <= 70) val += (h2 - 55);
        else if (h2 >= 97 && h2 <= 102) val += (h2 - 87);
        if (val === 10) result += '\n';
        else if (val === 13) result += '\r';
        else if (val === 37) result += '%';
        else result += s.slice(i, i + 3); // fallback
        i += 2;
      } else {
        result += '%';
      }
    } else {
      result += s.slice(i, i + 1);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Anthropic format (format 0)
// ---------------------------------------------------------------------------

export function buildAnthropicBody(
  fileContent: string, systemPrompt: string, includeStream: number,
  toolsJson: string, modelStr: string,
): string {
  let body = '{"model":"';
  body += modelStr;
  body += '","max_tokens":4096';
  if (includeStream > 0) {
    body += ',"stream":true';
  }

  body += ',"system":"';
  body += jsonEscape(systemPrompt);
  body += '"';

  if (toolsJson.length > 2) {
    body += ',"tools":';
    body += toolsJson;
  }

  body += ',"messages":[';

  // Parse message file — Anthropic uses tool_use/tool_result blocks
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
          currentRole = 'tool_result';
        } else if (line.length > 0 && line.charCodeAt(0) === 87) {
          currentRole = 'assistant_tool';
        } else {
          currentRole = 'assistant';
        }
      } else {
        const decoded: string = decodeContent(line);
        if (firstMsg < 1) body += ',';
        firstMsg = 0;

        if (currentRole.length === 14) {
          // assistant_tool
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
            if (aToolArgs.length > 1) {
              body += aToolArgs;
            } else {
              body += '{}';
            }
            body += '}]}';
          }
        } else if (currentRole.length === 11) {
          // tool_result
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
// OpenAI-compat format (format 1) — OpenAI, DeepSeek, xAI, Custom
// ---------------------------------------------------------------------------

export function buildOpenAIBody(
  fileContent: string, systemPrompt: string, includeStream: number,
  toolsJson: string, modelStr: string,
): string {
  let body = '{"model":"';
  body += modelStr;
  body += '"';
  if (includeStream > 0) {
    body += ',"stream":true';
  }
  body += ',"messages":[';

  // System prompt as first message
  body += '{"role":"system","content":"';
  body += jsonEscape(systemPrompt);
  body += '"}';

  // Parse message file
  let lineStart = 0;
  let lineIdx = 0;
  let currentRole = '';
  for (let i = 0; i <= fileContent.length; i++) {
    if (i === fileContent.length || fileContent.charCodeAt(i) === 10) {
      const line = fileContent.slice(lineStart, i);
      if (lineIdx % 2 === 0) {
        if (line.length > 0 && line.charCodeAt(0) === 85) {
          currentRole = 'user';
        } else if (line.length > 0 && line.charCodeAt(0) === 84) {
          currentRole = 'tool_result';
        } else if (line.length > 0 && line.charCodeAt(0) === 87) {
          currentRole = 'assistant_tool';
        } else {
          currentRole = 'assistant';
        }
      } else {
        const decoded: string = decodeContent(line);
        body += ',';

        if (currentRole.length === 14) {
          // assistant_tool → assistant with tool_calls
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
            body += '{"role":"assistant"';
            if (aText.length > 0) {
              body += ',"content":"';
              body += jsonEscape(aText);
              body += '"';
            }
            body += ',"tool_calls":[{"id":"';
            body += jsonEscape(aToolId);
            body += '","type":"function","function":{"name":"';
            body += jsonEscape(aToolName);
            body += '","arguments":';
            if (aToolArgs.length > 1) {
              body += '"';
              body += jsonEscape(aToolArgs);
              body += '"';
            } else {
              body += '"{}"';
            }
            body += '}}]}';
          } else {
            body += '{"role":"assistant","content":"';
            body += jsonEscape(decoded);
            body += '"}';
          }
        } else if (currentRole.length === 11) {
          // tool_result → tool role
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
            body += '{"role":"tool","tool_call_id":"';
            body += jsonEscape(toolId);
            body += '","content":"';
            body += jsonEscape(toolResult);
            body += '"}';
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

  body += ']';
  body += ',"max_tokens":4096}';
  return body;
}

// ---------------------------------------------------------------------------
// Google Gemini format (format 2)
// ---------------------------------------------------------------------------

export function buildGoogleBody(
  fileContent: string, systemPrompt: string, includeStream: number,
  toolsJson: string, modelStr: string,
): string {
  let body = '{';

  // System instruction
  body += '"systemInstruction":{"parts":[{"text":"';
  body += jsonEscape(systemPrompt);
  body += '"}]}';

  body += ',"contents":[';

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
          currentRole = 'skip'; // no tool_result in basic Gemini
        } else if (line.length > 0 && line.charCodeAt(0) === 87) {
          currentRole = 'model'; // assistant_tool → model
        } else {
          currentRole = 'model';
        }
      } else {
        if (currentRole.length > 0 && currentRole.charCodeAt(0) !== 115) { // skip 's'
          const decoded: string = decodeContent(line);
          // For assistant_tool, extract just the text part
          let msgText = decoded;
          if (currentRole.length === 5 && line.length > 0) {
            // 'model' from 'W' line — extract text before SOH
            for (let s = 0; s < decoded.length; s++) {
              if (decoded.charCodeAt(s) === 1) {
                msgText = decoded.slice(0, s);
                break;
              }
            }
          }

          if (firstMsg < 1) body += ',';
          firstMsg = 0;
          body += '{"role":"';
          body += currentRole;
          body += '","parts":[{"text":"';
          body += jsonEscape(msgText);
          body += '"}]}';
        }
      }
      lineIdx += 1;
      lineStart = i + 1;
    }
  }

  body += ']';
  body += ',"generationConfig":{"maxOutputTokens":4096}';
  body += '}';
  return body;
}

// ---------------------------------------------------------------------------
// Ollama format (format 3)
// ---------------------------------------------------------------------------

export function buildOllamaBody(
  fileContent: string, systemPrompt: string, includeStream: number,
  toolsJson: string, modelStr: string,
): string {
  let body = '{"model":"';
  body += modelStr;
  body += '","stream":true,"messages":[';

  // System prompt
  body += '{"role":"system","content":"';
  body += jsonEscape(systemPrompt);
  body += '"}';

  // Parse message file
  let lineStart = 0;
  let lineIdx = 0;
  let currentRole = '';
  for (let i = 0; i <= fileContent.length; i++) {
    if (i === fileContent.length || fileContent.charCodeAt(i) === 10) {
      const line = fileContent.slice(lineStart, i);
      if (lineIdx % 2 === 0) {
        if (line.length > 0 && line.charCodeAt(0) === 85) {
          currentRole = 'user';
        } else {
          currentRole = 'assistant';
        }
      } else {
        const decoded: string = decodeContent(line);
        body += ',{"role":"';
        body += currentRole;
        body += '","content":"';
        body += jsonEscape(decoded);
        body += '"}';
      }
      lineIdx += 1;
      lineStart = i + 1;
    }
  }

  body += ']}';
  return body;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function buildProviderBody(
  format: number,
  fileContent: string, systemPrompt: string, includeStream: number,
  toolsJson: string, modelStr: string,
): string {
  if (format === 0) return buildAnthropicBody(fileContent, systemPrompt, includeStream, toolsJson, modelStr);
  if (format === 1) return buildOpenAIBody(fileContent, systemPrompt, includeStream, toolsJson, modelStr);
  if (format === 2) return buildGoogleBody(fileContent, systemPrompt, includeStream, toolsJson, modelStr);
  if (format === 3) return buildOllamaBody(fileContent, systemPrompt, includeStream, toolsJson, modelStr);
  return buildOpenAIBody(fileContent, systemPrompt, includeStream, toolsJson, modelStr);
}
