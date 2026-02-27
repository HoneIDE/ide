/**
 * Command system — register and execute named commands.
 *
 * Commands are the central action mechanism. Keybindings, menus,
 * the command palette, and programmatic calls all go through commands.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandHandler = (...args: unknown[]) => void | Promise<void>;

export interface CommandDescriptor {
  id: string;
  title: string;
  /** Category for grouping in the command palette (e.g. "File", "Edit", "View"). */
  category: string;
  handler: CommandHandler;
  /** Whether this command appears in the command palette. */
  showInPalette: boolean;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _commands: Map<string, CommandDescriptor> = new Map();
const _listeners: Set<() => void> = new Set();

export function registerCommand(
  id: string,
  title: string,
  handler: CommandHandler,
  options?: { category?: string; showInPalette?: boolean },
): () => void {
  const descriptor: CommandDescriptor = {
    id,
    title,
    category: options?.category ?? '',
    handler,
    showInPalette: options?.showInPalette ?? true,
  };
  _commands.set(id, descriptor);
  notifyListeners();
  return () => {
    _commands.delete(id);
    notifyListeners();
  };
}

export async function executeCommand(id: string, ...args: unknown[]): Promise<void> {
  const cmd = _commands.get(id);
  if (!cmd) {
    console.warn(`Command not found: ${id}`);
    return;
  }
  await cmd.handler(...args);
}

export function getCommand(id: string): CommandDescriptor | undefined {
  return _commands.get(id);
}

export function getAllCommands(): CommandDescriptor[] {
  return Array.from(_commands.values());
}

export function getPaletteCommands(): CommandDescriptor[] {
  return getAllCommands()
    .filter(c => c.showInPalette)
    .sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.title.localeCompare(b.title);
    });
}

export function onCommandsChange(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

/** Clear all commands. Used in tests. */
export function clearCommands(): void {
  _commands.clear();
}

function notifyListeners(): void {
  for (const fn of _listeners) fn();
}

// ---------------------------------------------------------------------------
// Built-in commands (registered during app startup)
// ---------------------------------------------------------------------------

export function registerBuiltinCommands(): void {
  // File commands
  registerCommand('file.newFile', 'New File', () => {
    executeCommand('workbench.action.newEditor');
  }, { category: 'File' });

  registerCommand('file.openFile', 'Open File...', () => {
    // Triggers native file picker
  }, { category: 'File' });

  registerCommand('file.save', 'Save', () => {}, { category: 'File' });
  registerCommand('file.saveAs', 'Save As...', () => {}, { category: 'File' });
  registerCommand('file.saveAll', 'Save All', () => {}, { category: 'File' });

  // Edit commands
  registerCommand('edit.undo', 'Undo', () => {}, { category: 'Edit' });
  registerCommand('edit.redo', 'Redo', () => {}, { category: 'Edit' });
  registerCommand('edit.cut', 'Cut', () => {}, { category: 'Edit' });
  registerCommand('edit.copy', 'Copy', () => {}, { category: 'Edit' });
  registerCommand('edit.paste', 'Paste', () => {}, { category: 'Edit' });
  registerCommand('edit.selectAll', 'Select All', () => {}, { category: 'Edit' });
  registerCommand('edit.find', 'Find', () => {}, { category: 'Edit' });
  registerCommand('edit.replace', 'Replace', () => {}, { category: 'Edit' });

  // View commands
  registerCommand('view.commandPalette', 'Command Palette', () => {
    executeCommand('workbench.action.showCommandPalette');
  }, { category: 'View' });

  registerCommand('view.quickOpen', 'Quick Open', () => {
    executeCommand('workbench.action.quickOpen');
  }, { category: 'View' });

  registerCommand('view.toggleSidebar', 'Toggle Sidebar', () => {}, { category: 'View' });
  registerCommand('view.toggleBottomPanel', 'Toggle Bottom Panel', () => {}, { category: 'View' });
  registerCommand('view.toggleTerminal', 'Toggle Terminal', () => {}, { category: 'View' });
  registerCommand('view.zoomIn', 'Zoom In', () => {}, { category: 'View' });
  registerCommand('view.zoomOut', 'Zoom Out', () => {}, { category: 'View' });
  registerCommand('view.resetZoom', 'Reset Zoom', () => {}, { category: 'View' });

  // Workbench actions (internal, not shown in palette)
  registerCommand('workbench.action.newEditor', 'New Editor', () => {}, {
    showInPalette: false,
  });
  registerCommand('workbench.action.showCommandPalette', 'Show Command Palette', () => {}, {
    showInPalette: false,
  });
  registerCommand('workbench.action.quickOpen', 'Quick Open', () => {}, {
    showInPalette: false,
  });
  registerCommand('workbench.action.closeActiveEditor', 'Close Editor', () => {}, {
    category: 'View',
  });
  registerCommand('workbench.action.closeAllEditors', 'Close All Editors', () => {}, {
    category: 'View',
  });

  // Theme commands
  registerCommand('workbench.action.selectTheme', 'Color Theme', () => {}, {
    category: 'Preferences',
  });
}
