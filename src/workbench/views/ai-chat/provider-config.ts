/**
 * Multi-provider model registry.
 *
 * Flat numeric ID scheme — each model gets a unique index (0–15).
 * All functions use cascading `if` statements (Perry-safe).
 */

// Settings import deferred to avoid module init issues
// import { getWorkbenchSettings } from '../../settings';

// ---------------------------------------------------------------------------
// Model API IDs
// ---------------------------------------------------------------------------

export function getModelApiId(id: number): string {
  if (id === 0) return 'claude-sonnet-4-20250514';
  if (id === 1) return 'claude-opus-4-20250514';
  if (id === 2) return 'claude-haiku-4-5-20251001';
  if (id === 3) return 'gpt-4o';
  if (id === 4) return 'gpt-4o-mini';
  if (id === 5) return 'o3';
  if (id === 6) return 'o4-mini';
  if (id === 7) return 'gemini-2.0-flash';
  if (id === 8) return 'gemini-2.5-pro';
  if (id === 9) return 'deepseek-chat';
  if (id === 10) return 'deepseek-coder';
  if (id === 11) return 'deepseek-reasoner';
  if (id === 12) return 'grok-3';
  if (id === 13) return 'grok-3-mini';
  if (id === 14) return 'llama3:8b';
  if (id === 15) return 'custom-model';
  return 'claude-sonnet-4-20250514';
}

// ---------------------------------------------------------------------------
// Display names (for message UI, etc.)
// ---------------------------------------------------------------------------

export function getModelDisplayName(id: number): string {
  if (id === 0) return 'Anthropic: Sonnet 4';
  if (id === 1) return 'Anthropic: Opus 4';
  if (id === 2) return 'Anthropic: Haiku 4.5';
  if (id === 3) return 'OpenAI: GPT-4o';
  if (id === 4) return 'OpenAI: GPT-4o Mini';
  if (id === 5) return 'OpenAI: o3';
  if (id === 6) return 'OpenAI: o4-mini';
  if (id === 7) return 'Google: Gemini 2.0 Flash';
  if (id === 8) return 'Google: Gemini 2.5 Pro';
  if (id === 9) return 'DeepSeek: Chat';
  if (id === 10) return 'DeepSeek: Coder';
  if (id === 11) return 'DeepSeek: Reasoner';
  if (id === 12) return 'xAI: Grok 3';
  if (id === 13) return 'xAI: Grok 3 Mini';
  if (id === 14) return 'Ollama';
  if (id === 15) return 'Custom';
  return 'Sonnet 4';
}

// ---------------------------------------------------------------------------
// Picker labels (short, for dropdown)
// ---------------------------------------------------------------------------

export function getPickerLabel(id: number): string {
  if (id === 0) return 'Sonnet 4';
  if (id === 1) return 'Opus 4';
  if (id === 2) return 'Haiku 4.5';
  if (id === 3) return 'GPT-4o';
  if (id === 4) return 'GPT-4o Mini';
  if (id === 5) return 'o3';
  if (id === 6) return 'o4-mini';
  if (id === 7) return 'Gemini 2.0 Flash';
  if (id === 8) return 'Gemini 2.5 Pro';
  if (id === 9) return 'DeepSeek Chat';
  if (id === 10) return 'DeepSeek Coder';
  if (id === 11) return 'DeepSeek Reasoner';
  if (id === 12) return 'Grok 3';
  if (id === 13) return 'Grok 3 Mini';
  if (id === 14) return 'Ollama (local)';
  if (id === 15) return 'Custom endpoint';
  return 'Sonnet 4';
}

// ---------------------------------------------------------------------------
// Provider index (which provider a model belongs to)
// 0=Anthropic, 1=OpenAI, 2=Google, 3=DeepSeek, 4=xAI, 5=Ollama, 6=Custom
// ---------------------------------------------------------------------------

export function getProviderIndex(id: number): number {
  if (id <= 2) return 0;
  if (id <= 6) return 1;
  if (id <= 8) return 2;
  if (id <= 11) return 3;
  if (id <= 13) return 4;
  if (id === 14) return 5;
  if (id === 15) return 6;
  return 0;
}

// ---------------------------------------------------------------------------
// Provider format (determines request body + SSE parsing)
// 0=Anthropic, 1=OpenAI-compat, 2=Google, 3=Ollama
// ---------------------------------------------------------------------------

export function getProviderFormat(id: number): number {
  if (id <= 2) return 0;
  if (id <= 6) return 1;
  if (id <= 8) return 2;
  if (id <= 13) return 1; // DeepSeek + xAI are OpenAI-compat
  if (id === 14) return 3;
  if (id === 15) return 1; // Custom is OpenAI-compat
  return 0;
}

// ---------------------------------------------------------------------------
// Provider API URL
// ---------------------------------------------------------------------------

export function getProviderApiUrl(id: number): string {
  if (id <= 2) return 'https://api.anthropic.com/v1/messages';
  if (id <= 6) return 'https://api.openai.com/v1/chat/completions';
  if (id <= 8) return 'https://generativelanguage.googleapis.com/v1beta/models/';
  if (id <= 11) return 'https://api.deepseek.com/v1/chat/completions';
  if (id <= 13) return 'https://api.x.ai/v1/chat/completions';
  if (id === 14) return 'http://localhost:11434/api/chat';
  if (id === 15) return '';
  return 'https://api.anthropic.com/v1/messages';
}

// ---------------------------------------------------------------------------
// Total model count
// ---------------------------------------------------------------------------

export function getModelCount(): number {
  return 16;
}

// ---------------------------------------------------------------------------
// Settings key for the provider's API key
// ---------------------------------------------------------------------------

export function getProviderSettingsKey(id: number): string {
  if (id <= 2) return 'aiKeyAnthropic';
  if (id <= 6) return 'aiKeyOpenai';
  if (id <= 8) return 'aiKeyGoogle';
  if (id <= 11) return 'aiKeyDeepseek';
  if (id <= 13) return 'aiKeyXai';
  if (id === 14) return '';
  if (id === 15) return 'aiCustomKey';
  return 'aiKeyAnthropic';
}
