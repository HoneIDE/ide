/**
 * Anonymous usage telemetry — opt-in, privacy-first, fire-and-forget.
 *
 * Collects anonymous event counts (no PII, no file content, no paths).
 * Events are batched and sent to Chirp every 5 minutes.
 * Uses Perry-safe patterns: module-level vars, no closures, += concat.
 *
 * NEVER collected: file paths/names/content, keystrokes, AI prompts/responses,
 * API keys, credentials, user names, emails, git messages/diffs/branches, IPs.
 */

import { streamStart } from 'node-fetch';
import { getWorkbenchSettings } from './settings';
import { getOrCreateDeviceId } from './paths';
import { getPlatformContext } from '../platform';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const CHIRP_URL = 'https://api.chirp247.com/api/v1/events';
const CHIRP_KEY = 'hone_proj_01';
const HONE_VERSION = '0.1.0';
const MAX_QUEUE = 50;

let _telemetryEnabled: number = 0;
let _platform: string = '';
let _version: string = '';
let _deviceId: string = '';
let _layoutMode: string = '';
let _deviceClass: string = '';

// Parallel arrays for event queue (Perry-safe — no object arrays with string fields)
let _queueEvent: string[] = [];
let _queueDims: string[] = [];
let _queueLen: number = 0;

let _flushInterval: number = 0;
let _startupTracked: number = 0;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initTelemetry(): void {
  const s = getWorkbenchSettings();
  if (s.telemetryEnabled === false) {
    _telemetryEnabled = 0;
    return;
  }
  _telemetryEnabled = 1;

  // Compute constants once
  const ctx = getPlatformContext();
  _version = HONE_VERSION;
  _deviceId = getOrCreateDeviceId();

  // Map platform (Perry-safe: use charCodeAt, not string comparison from cross-module)
  const p = ctx.platform;
  if (p.charCodeAt(0) === 109) _platform = 'macos';     // 'm'acos
  else if (p.charCodeAt(0) === 105) _platform = 'ios';   // 'i'os
  else if (p.charCodeAt(0) === 119) _platform = 'windows'; // 'w'indows
  else if (p.charCodeAt(0) === 108) _platform = 'linux';   // 'l'inux
  else if (p.charCodeAt(0) === 97) _platform = 'android';  // 'a'ndroid
  else _platform = 'unknown';

  // Layout mode
  const lm = ctx.layoutMode;
  if (lm.charCodeAt(0) === 102) _layoutMode = 'full';
  else if (lm.charCodeAt(0) === 115) _layoutMode = 'split';
  else if (lm.charCodeAt(0) === 99) _layoutMode = 'compact';
  else _layoutMode = 'full';

  // Device class
  const dc = ctx.deviceClass;
  if (dc.charCodeAt(0) === 100) _deviceClass = 'desktop';
  else if (dc.charCodeAt(0) === 116) _deviceClass = 'tablet';
  else if (dc.charCodeAt(0) === 112) _deviceClass = 'phone';
  else _deviceClass = 'desktop';

  // Queue session_start event
  queueEvent('session_start', buildDims4(_platform, _version, _layoutMode, _deviceClass));

  // Set up 5-minute flush interval
  _flushInterval = setInterval(flushTelemetryTick, 300000);
}

// ---------------------------------------------------------------------------
// Track functions — each returns immediately if disabled
// ---------------------------------------------------------------------------

export function telemetryTrackFileOpen(): void {
  if (_telemetryEnabled < 1) return;
  queueEvent('file_open', buildDims2(_platform, _version));
}

export function telemetryTrackSearch(): void {
  if (_telemetryEnabled < 1) return;
  queueEvent('search', buildDims2(_platform, _version));
}

export function telemetryTrackGitCommit(): void {
  if (_telemetryEnabled < 1) return;
  queueEvent('git_commit', buildDims2(_platform, _version));
}

export function telemetryTrackTerminalOpen(): void {
  if (_telemetryEnabled < 1) return;
  queueEvent('terminal_open', buildDims2(_platform, _version));
}

export function telemetryTrackSettingsOpen(): void {
  if (_telemetryEnabled < 1) return;
  queueEvent('settings_open', buildDims2(_platform, _version));
}

export function telemetryTrackAiChat(provider: string, model: string): void {
  if (_telemetryEnabled < 1) return;
  queueEvent('ai_chat', buildDims3(_platform, provider, model));
}

export function telemetryTrackAiInline(provider: string, model: string): void {
  if (_telemetryEnabled < 1) return;
  queueEvent('ai_inline', buildDims3(_platform, provider, model));
}

export function telemetryTrackAiAgent(provider: string, model: string): void {
  if (_telemetryEnabled < 1) return;
  queueEvent('ai_agent', buildDims3(_platform, provider, model));
}

export function telemetryTrackError(type: string): void {
  if (_telemetryEnabled < 1) return;
  queueEvent('error', buildDims3(_platform, _version, type));
}

export function telemetryTrackStartup(ms: number): void {
  if (_telemetryEnabled < 1) return;
  if (_startupTracked > 0) return;
  _startupTracked = 1;
  let bucket = 'normal';
  if (ms < 500) bucket = 'fast';
  else if (ms > 2000) bucket = 'slow';
  queueEvent('perf_startup', buildDims3(_platform, _version, bucket));
}

export function telemetryTrackThemeChange(theme: string): void {
  if (_telemetryEnabled < 1) return;
  queueEvent('theme_change', buildDims2(_platform, theme));
}

// ---------------------------------------------------------------------------
// Queue helpers (Perry-safe — no object construction, only string concat)
// ---------------------------------------------------------------------------

function queueEvent(eventName: string, dimsJson: string): void {
  if (_queueLen >= MAX_QUEUE) return;
  _queueEvent.push(eventName);
  _queueDims.push(dimsJson);
  _queueLen = _queueLen + 1;
}

function buildDims2(a: string, b: string): string {
  // Pre-computed key names embedded inline to avoid string-returning function issues
  // Returns the inner dims JSON without the outer {}
  let d = '"d0":"';
  d += a;
  d += '","d1":"';
  d += b;
  d += '"';
  return d;
}

function buildDims3(a: string, b: string, c: string): string {
  let d = '"d0":"';
  d += a;
  d += '","d1":"';
  d += b;
  d += '","d2":"';
  d += c;
  d += '"';
  return d;
}

function buildDims4(a: string, b: string, c: string, e: string): string {
  let d = '"d0":"';
  d += a;
  d += '","d1":"';
  d += b;
  d += '","d2":"';
  d += c;
  d += '","d3":"';
  d += e;
  d += '"';
  return d;
}

// Dimension key lookup tables (Chirp expects named dims)
const DIM_KEYS_SESSION: string[] = ['platform', 'version', 'layout', 'device_class'];
const DIM_KEYS_PV: string[] = ['platform', 'version'];
const DIM_KEYS_AI: string[] = ['platform', 'provider', 'model'];
const DIM_KEYS_ERR: string[] = ['platform', 'version', 'type'];
const DIM_KEYS_THEME: string[] = ['platform', 'theme'];

function getDimKeys(eventName: string): string[] {
  // Match by first character + length (Perry-safe)
  if (eventName.charCodeAt(0) === 115 && eventName.length === 13) return DIM_KEYS_SESSION; // session_start
  if (eventName.charCodeAt(0) === 97 && eventName.charCodeAt(3) === 99) return DIM_KEYS_AI; // ai_chat
  if (eventName.charCodeAt(0) === 97 && eventName.charCodeAt(3) === 105) return DIM_KEYS_AI; // ai_inline
  if (eventName.charCodeAt(0) === 97 && eventName.charCodeAt(3) === 97) return DIM_KEYS_AI; // ai_agent
  if (eventName.charCodeAt(0) === 101) return DIM_KEYS_ERR; // error
  if (eventName.charCodeAt(0) === 112) return DIM_KEYS_ERR; // perf_startup (same shape: platform, version, bucket→type)
  if (eventName.charCodeAt(0) === 116 && eventName.length === 12) return DIM_KEYS_THEME; // theme_change
  return DIM_KEYS_PV; // file_open, search, git_commit, terminal_open, settings_open
}

// ---------------------------------------------------------------------------
// Flush — fire-and-forget POST to Chirp
// ---------------------------------------------------------------------------

function flushTelemetryTick(): void {
  flushTelemetry();
}

export function flushTelemetry(): void {
  if (_queueLen < 1) return;

  // Build the JSON payload with proper dim names
  let body = '{"events":[';
  for (let i = 0; i < _queueLen; i++) {
    if (i > 0) body += ',';
    body += '{"event":"';
    body += _queueEvent[i];
    body += '","dims":{';

    // Parse the dim values from the pre-built string
    const dimStr = _queueDims[i];
    const dimKeys = getDimKeys(_queueEvent[i]);

    // Extract values from "d0":"val","d1":"val",... format
    let valIdx = 0;
    let pos = 0;
    while (pos < dimStr.length && valIdx < dimKeys.length) {
      // Find next ":"
      const qStart = dimStr.indexOf('":"', pos);
      if (qStart < 0) break;
      const valStart = qStart + 3;
      const valEnd = dimStr.indexOf('"', valStart);
      if (valEnd < 0) break;
      const val = dimStr.slice(valStart, valEnd);

      if (valIdx > 0) body += ',';
      body += '"';
      body += dimKeys[valIdx];
      body += '":"';
      body += val;
      body += '"';

      valIdx = valIdx + 1;
      pos = valEnd + 1;
    }

    body += '}}';
  }
  body += ']}';

  // Build headers JSON for streamStart
  let headers = '{"Content-Type":"application/json"';
  headers += ',"X-Chirp-Key":"';
  headers += CHIRP_KEY;
  headers += '","X-Chirp-Client":"';
  headers += _deviceId;
  headers += '"}';

  // Fire-and-forget — we don't poll for response
  streamStart(CHIRP_URL, 'POST', body, headers);

  // Clear queue regardless of network success
  _queueEvent = [];
  _queueDims = [];
  _queueLen = 0;
}
