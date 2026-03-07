/**
 * Workbench runtime settings.
 *
 * This is the IDE's native runtime settings module, separate from the
 * headless @honeide/core SettingsStore (which is used in tests and services).
 * Perry compiles this natively — no V8 runtime needed.
 *
 * Settings are stored in memory and can be changed at runtime. In future
 * versions these will persist to disk via Perry's fs API.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkbenchSettings {
  /** 'left' | 'right' — which side the Explorer sidebar appears */
  sidebarLocation: string;
  /** 'side' | 'top' | 'bottom' | 'hidden' — activity bar position */
  activityBarLocation: string;
  /** Whether the status bar is visible */
  statusBarVisible: boolean;
  /** Color theme name */
  colorTheme: string;
  /** Editor font size */
  editorFontSize: number;
  /** Whether to show line numbers */
  editorLineNumbers: string;
  /** AI provider */
  aiProvider: string;
  /** AI inline completion enabled */
  aiInlineCompletionEnabled: boolean;
}

type SettingsChangeListener = (settings: WorkbenchSettings) => void;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _settings: WorkbenchSettings = {
  sidebarLocation: 'left',
  activityBarLocation: 'side',
  statusBarVisible: true,
  colorTheme: 'Hone Dark',
  editorFontSize: 13,
  editorLineNumbers: 'on',
  aiProvider: 'anthropic',
  aiInlineCompletionEnabled: true,
};

const _listeners: SettingsChangeListener[] = [];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Get current workbench settings (read-only snapshot). */
export function getWorkbenchSettings(): WorkbenchSettings {
  return _settings;
}

/** Update one or more settings. Fires change listeners. */
export function updateSettings(patch: Partial<WorkbenchSettings>): void {
  let changed = false;
  const next = { ..._settings };
  for (const key of Object.keys(patch) as (keyof WorkbenchSettings)[]) {
    if (patch[key] !== undefined && patch[key] !== next[key]) {
      (next as Record<string, unknown>)[key] = patch[key];
      changed = true;
    }
  }
  if (!changed) return;
  _settings = next;
  for (const listener of _listeners) {
    listener(_settings);
  }
}

/** Register a callback for settings changes. Returns unsubscribe function. */
export function onSettingsChange(listener: SettingsChangeListener): () => void {
  _listeners.push(listener);
  return () => {
    const idx = _listeners.indexOf(listener);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

/** Toggle sidebar location between 'left' and 'right'. */
export function toggleSidebarLocation(): void {
  updateSettings({
    sidebarLocation: _settings.sidebarLocation === 'left' ? 'right' : 'left',
  });
}
