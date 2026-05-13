/**
 * Command system — register and execute named commands.
 *
 * Commands are the central action mechanism. Keybindings, menus,
 * the command palette, and programmatic calls all go through commands.
 */

import { t } from 'perry/i18n';

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
  registerCommand('file.newFile', t('New File'), () => {
    executeCommand('workbench.action.newEditor');
  }, { category: t('File') });

  registerCommand('file.openFile', t('Open File...'), () => {
    // Triggers native file picker
  }, { category: t('File') });

  registerCommand('file.save', t('Save'), () => {}, { category: t('File') });
  registerCommand('file.saveAs', t('Save As...'), () => {}, { category: t('File') });
  registerCommand('file.saveAll', t('Save All'), () => {}, { category: t('File') });

  // Edit commands
  registerCommand('edit.undo', t('Undo'), () => {}, { category: t('Edit') });
  registerCommand('edit.redo', t('Redo'), () => {}, { category: t('Edit') });
  registerCommand('edit.cut', t('Cut'), () => {}, { category: t('Edit') });
  registerCommand('edit.copy', t('Copy'), () => {}, { category: t('Edit') });
  registerCommand('edit.paste', t('Paste'), () => {}, { category: t('Edit') });
  registerCommand('edit.selectAll', t('Select All'), () => {}, { category: t('Edit') });
  registerCommand('edit.find', t('Find'), () => {}, { category: t('Edit') });
  registerCommand('edit.replace', t('Replace'), () => {}, { category: t('Edit') });

  // View commands
  registerCommand('view.commandPalette', t('Command Palette'), () => {
    executeCommand('workbench.action.showCommandPalette');
  }, { category: t('View') });

  registerCommand('view.quickOpen', t('Quick Open'), () => {
    executeCommand('workbench.action.quickOpen');
  }, { category: t('View') });

  registerCommand('view.outline', t('Show Outline'), () => {
    executeCommand('workbench.action.showOutline');
  }, { category: t('View') });
  registerCommand('workbench.action.showOutline', t('Show Outline'), () => {}, {
    showInPalette: false,
  });

  // SHIP-V1-GAPS.md #58: workspace trust commands. v1.0 ships the storage;
  // plugin gating lands with the `@honeide/api` runtime.
  registerCommand('workspace.trust', t('Workspaces: Trust Current Folder'), () => {
    executeCommand('workbench.action.trustWorkspace');
  }, { category: t('Workspaces') });
  registerCommand('workspace.revokeTrust', t('Workspaces: Revoke Trust'), () => {
    executeCommand('workbench.action.revokeWorkspaceTrust');
  }, { category: t('Workspaces') });
  registerCommand('workbench.action.trustWorkspace', t('Trust Workspace'), () => {}, {
    showInPalette: false,
  });
  registerCommand('workbench.action.revokeWorkspaceTrust', t('Revoke Workspace Trust'), () => {}, {
    showInPalette: false,
  });

  registerCommand('tasks.runTask', t('Tasks: Run Task...'), () => {
    executeCommand('workbench.action.showTasks');
  }, { category: t('Tasks') });
  registerCommand('tasks.runBuildTask', t('Tasks: Run Build Task'), () => {
    executeCommand('workbench.action.runBuildTask');
  }, { category: t('Tasks') });
  registerCommand('workbench.action.showTasks', t('Show Tasks'), () => {}, {
    showInPalette: false,
  });
  registerCommand('workbench.action.runBuildTask', t('Run Build Task'), () => {}, {
    showInPalette: false,
  });

  registerCommand('view.toggleSidebar', t('Toggle Sidebar'), () => {}, { category: t('View') });
  registerCommand('view.toggleBottomPanel', t('Toggle Bottom Panel'), () => {}, { category: t('View') });
  registerCommand('view.toggleTerminal', t('Toggle Terminal'), () => {}, { category: t('View') });
  registerCommand('view.zoomIn', t('Zoom In'), () => {}, { category: t('View') });
  registerCommand('view.zoomOut', t('Zoom Out'), () => {}, { category: t('View') });
  registerCommand('view.resetZoom', t('Reset Zoom'), () => {}, { category: t('View') });

  // Workbench actions (internal, not shown in palette)
  registerCommand('workbench.action.newEditor', t('New Editor'), () => {}, {
    showInPalette: false,
  });
  registerCommand('workbench.action.showCommandPalette', t('Show Command Palette'), () => {}, {
    showInPalette: false,
  });
  registerCommand('workbench.action.quickOpen', t('Quick Open'), () => {}, {
    showInPalette: false,
  });
  registerCommand('workbench.action.closeActiveEditor', t('Close Editor'), () => {}, {
    category: t('View'),
  });
  registerCommand('workbench.action.closeAllEditors', t('Close All Editors'), () => {}, {
    category: t('View'),
  });

  // Theme commands
  registerCommand('workbench.action.selectTheme', t('Color Theme'), () => {}, {
    category: t('Preferences'),
  });
}
