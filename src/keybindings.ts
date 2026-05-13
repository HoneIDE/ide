/**
 * Keybinding definitions and resolution.
 *
 * Keybindings map keyboard shortcuts to command IDs. They support:
 * - Modifier keys: Ctrl (Cmd on macOS), Shift, Alt, Meta
 * - Chord sequences: e.g. Ctrl+K Ctrl+C (press Ctrl+K, then Ctrl+C)
 * - When-clauses: context conditions for when a binding is active
 * - Platform-specific bindings (Cmd on macOS vs Ctrl on others)
 */

import type { Platform } from './platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeyCombo {
  key: string;        // e.g. 'p', 'Enter', 'F1', 'Tab'
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;      // Cmd on macOS, Win on Windows
}

export interface Keybinding {
  /** Command ID to execute. */
  command: string;
  /** Key combos — single key or chord (multiple combos in sequence). */
  keys: KeyCombo[];
  /** Optional when-clause expression. */
  when: string | null;
  /** Human-readable display string (e.g. "Ctrl+Shift+P"). */
  display: string;
}

// ---------------------------------------------------------------------------
// Platform modifier normalization
// ---------------------------------------------------------------------------

/**
 * On macOS, "CmdOrCtrl" resolves to Cmd (meta). On all other platforms, Ctrl.
 */
function cmdOrCtrl(platform: Platform): Pick<KeyCombo, 'ctrl' | 'meta'> {
  if (platform === 'macos' || platform === 'ios' || platform === 'ipados') {
    return { ctrl: false, meta: true };
  }
  return { ctrl: true, meta: false };
}

function modLabel(platform: Platform): string {
  if (platform === 'macos' || platform === 'ios' || platform === 'ipados') {
    return 'Cmd';
  }
  return 'Ctrl';
}

// ---------------------------------------------------------------------------
// Default keybinding set
// ---------------------------------------------------------------------------

export function getDefaultKeybindings(platform: Platform): Keybinding[] {
  const mod = cmdOrCtrl(platform);
  const ml = modLabel(platform);
  const isIpad = platform === 'ipados';
  const isIos = platform === 'ios';

  const out: Keybinding[] = [
    // File
    kb('file.newFile', [{ key: 'n', ...mod, shift: false, alt: false }], null, `${ml}+N`),
    kb('file.openFile', [{ key: 'o', ...mod, shift: false, alt: false }], null, `${ml}+O`),
    kb('file.save', [{ key: 's', ...mod, shift: false, alt: false }], null, `${ml}+S`),
    kb('file.saveAs', [{ key: 's', ...mod, shift: true, alt: false }], null, `${ml}+Shift+S`),
    kb('file.saveAll', [{ key: 's', ...mod, shift: false, alt: true }], null, `${ml}+Alt+S`),

    // Edit
    kb('edit.undo', [{ key: 'z', ...mod, shift: false, alt: false }], null, `${ml}+Z`),
    kb('edit.redo', [{ key: 'z', ...mod, shift: true, alt: false }], null, `${ml}+Shift+Z`),
    kb('edit.cut', [{ key: 'x', ...mod, shift: false, alt: false }], null, `${ml}+X`),
    kb('edit.copy', [{ key: 'c', ...mod, shift: false, alt: false }], null, `${ml}+C`),
    kb('edit.paste', [{ key: 'v', ...mod, shift: false, alt: false }], null, `${ml}+V`),
    kb('edit.selectAll', [{ key: 'a', ...mod, shift: false, alt: false }], null, `${ml}+A`),
    kb('edit.find', [{ key: 'f', ...mod, shift: false, alt: false }], null, `${ml}+F`),
    kb('edit.replace', [{ key: 'h', ...mod, shift: false, alt: false }], null, `${ml}+H`),

    // View / Navigation
    kb('view.commandPalette', [{ key: 'p', ...mod, shift: true, alt: false }], null, `${ml}+Shift+P`),
    kb('view.quickOpen', [{ key: 'p', ...mod, shift: false, alt: false }], null, `${ml}+P`),
    kb('view.toggleSidebar', [{ key: 'b', ...mod, shift: false, alt: false }], null, `${ml}+B`),
    kb('view.toggleBottomPanel', [{ key: 'j', ...mod, shift: false, alt: false }], null, `${ml}+J`),
    kb('view.toggleTerminal', [{ key: '`', ...mod, shift: false, alt: false }], null, `${ml}+\``),
    kb('view.zoomIn', [{ key: '=', ...mod, shift: false, alt: false }], null, `${ml}+=`),
    kb('view.zoomOut', [{ key: '-', ...mod, shift: false, alt: false }], null, `${ml}+-`),
    kb('view.resetZoom', [{ key: '0', ...mod, shift: false, alt: false }], null, `${ml}+0`),

    // Editor
    kb('workbench.action.closeActiveEditor', [{ key: 'w', ...mod, shift: false, alt: false }], 'editorFocus', `${ml}+W`),
    kb('workbench.action.closeAllEditors', [{ key: 'w', ...mod, shift: true, alt: true }], null, `${ml}+Shift+Alt+W`),
  ];

  // SHIP-V1-GAPS.md #114: iPad-specific extras for hardware-keyboard users.
  // iPadOS apps conventionally bind Cmd+1/2/3 to top-level navigation; we
  // mirror that to the activity bar so Files (1) / Search (2) / Source
  // Control (3) are reachable without leaving the keyboard. iOS phones omit
  // these because the layout is single-pane and there's nothing to switch.
  if (isIpad) {
    out.push(kb('view.activity.files', [{ key: '1', ...mod, shift: false, alt: false }], null, `${ml}+1`));
    out.push(kb('view.activity.search', [{ key: '2', ...mod, shift: false, alt: false }], null, `${ml}+2`));
    out.push(kb('view.activity.git', [{ key: '3', ...mod, shift: false, alt: false }], null, `${ml}+3`));
    out.push(kb('view.activity.chat', [{ key: '4', ...mod, shift: false, alt: false }], null, `${ml}+4`));
    // Dismiss the software keyboard — iPad-specific because macOS doesn't
    // surface a soft keyboard the user might want to hide.
    out.push(kb('view.dismissKeyboard', [{ key: 'Escape', ctrl: false, shift: false, alt: false, meta: false }], null, 'Esc'));
  }

  // Block bindings that don't make sense on iPad/iOS where the OS handles
  // window lifecycle (no quit, no manual close-window from Cmd+Q):
  if (isIpad || isIos) {
    // No additional removals today — `closeActiveEditor`/`closeAllEditors`
    // remain useful because they close editor tabs, not the app window.
  }

  return out;
}

function kb(
  command: string,
  keys: KeyCombo[],
  when: string | null,
  display: string,
): Keybinding {
  const fullKeys: KeyCombo[] = keys.map(k => ({
    key: k.key,
    ctrl: k.ctrl ?? false,
    shift: k.shift ?? false,
    alt: k.alt ?? false,
    meta: k.meta ?? false,
  }));
  return { command, keys: fullKeys, when, display };
}

// ---------------------------------------------------------------------------
// Keybinding resolution
// ---------------------------------------------------------------------------

/** State for chord keybinding matching. */
let _pendingChord: KeyCombo | null = null;

/**
 * Match a key event against the keybinding set.
 * Returns the command ID if matched, or null.
 * Handles chord sequences (two-key combos).
 */
export function matchKeybinding(
  event: KeyCombo,
  bindings: Keybinding[],
  context: Record<string, boolean>,
): string | null {
  for (const binding of bindings) {
    // Check when-clause
    if (binding.when && !evaluateWhen(binding.when, context)) {
      continue;
    }

    if (binding.keys.length === 1) {
      // Single key binding
      if (_pendingChord === null && keyComboEquals(event, binding.keys[0])) {
        return binding.command;
      }
    } else if (binding.keys.length === 2) {
      // Chord binding
      if (_pendingChord === null) {
        // Check if this is the first key of a chord
        if (keyComboEquals(event, binding.keys[0])) {
          _pendingChord = event;
          return null; // Wait for second key
        }
      } else {
        // We have a pending chord — check if this completes it
        if (keyComboEquals(_pendingChord, binding.keys[0]) &&
            keyComboEquals(event, binding.keys[1])) {
          _pendingChord = null;
          return binding.command;
        }
      }
    }
  }

  // If we had a pending chord but nothing matched, clear it
  if (_pendingChord !== null) {
    _pendingChord = null;
  }

  return null;
}

/** Reset chord state. Used in tests. */
export function resetChordState(): void {
  _pendingChord = null;
}

function keyComboEquals(a: KeyCombo, b: KeyCombo): boolean {
  return a.key.toLowerCase() === b.key.toLowerCase() &&
    a.ctrl === b.ctrl &&
    a.shift === b.shift &&
    a.alt === b.alt &&
    a.meta === b.meta;
}

/**
 * Simple when-clause evaluation.
 * Supports: bare identifiers (e.g. "editorFocus"),
 *   negation ("!editorFocus"),
 *   AND ("editorFocus && textInputFocus").
 */
export function evaluateWhen(expr: string, context: Record<string, boolean>): boolean {
  const parts = expr.split('&&').map(s => s.trim());
  return parts.every(part => {
    if (part.startsWith('!')) {
      return !context[part.slice(1)];
    }
    return !!context[part];
  });
}
