/**
 * Native menu bar — builds macOS menu bar using Perry menu APIs.
 *
 * Uses literal strings throughout (Perry template literals with ${} are broken,
 * and string + operator doesn't work).
 */

import {
  menuCreate, menuAddItem, menuAddSeparator,
  menuBarCreate, menuBarAddMenu, menuBarAttach,
} from 'perry/ui';
import {
  openFolderAction, openFileAction, toggleSidebarAction, closeEditorAction,
  saveFileAction, saveFileAsAction, toggleTerminalAction, newFileAction, findAction,
  openSettingsAction, zoomInAction, zoomOutAction, zoomResetAction,
  showWelcomeAction, goToLineAction, goToFileAction,
} from './render';
import { execSync } from 'child_process';
import { showNotification } from './views/notifications/notifications';

// Module-level function refs for callbacks (Perry closures can't call methods
// on captured variables — must use module-level functions)

function onNewFile(): void {
  newFileAction();
}

function onOpenFile(): void {
  openFileAction();
}

function onOpenFolder(): void {
  openFolderAction();
}

function onSave(): void {
  saveFileAction();
}

function onSaveAs(): void {
  saveFileAsAction();
}

function onCloseEditor(): void {
  closeEditorAction();
}

function onOpenSettings(): void {
  openSettingsAction();
}

function onUndo(): void {
  // Placeholder — handled by NSTextField/editor natively
}

function onRedo(): void {
  // Placeholder — handled by NSTextField/editor natively
}

function onCut(): void {
  // Placeholder — handled natively
}

function onCopy(): void {
  // Placeholder — handled natively
}

function onPaste(): void {
  // Placeholder — handled natively
}

function onFind(): void {
  findAction();
}

function onReplace(): void {
  findAction();
}

function onSelectAll(): void {
  // Placeholder — handled natively
}

function onToggleSidebar(): void {
  toggleSidebarAction();
}

function onToggleBottomPanel(): void {
  toggleTerminalAction();
}

function onToggleTerminal(): void {
  toggleTerminalAction();
}

function onZoomIn(): void {
  zoomInAction();
}

function onZoomOut(): void {
  zoomOutAction();
}

function onResetZoom(): void {
  zoomResetAction();
}

function onGoToFile(): void {
  goToFileAction();
}

function onGoToLine(): void {
  goToLineAction();
}

function onGoToSymbol(): void {
  // Placeholder — future: go to symbol
}

function onWelcome(): void {
  showWelcomeAction();
}

function onDocs(): void {
  try { execSync('open https://hone.dev/docs'); } catch (e) {}
}

function onAbout(): void {
  showNotification('Hone IDE v0.1.0', 'info');
}

/**
 * Build and attach the native macOS menu bar.
 * Call this before App() in app.ts.
 */
export function setupNativeMenuBar(): void {
  // ---- File menu ----
  const fileMenu = menuCreate();
  menuAddItem(fileMenu, 'New File', () => { onNewFile(); }, 'n');
  menuAddItem(fileMenu, 'Open File...', () => { onOpenFile(); }, 'o');
  menuAddItem(fileMenu, 'Open Folder...', () => { onOpenFolder(); });
  menuAddSeparator(fileMenu);
  menuAddItem(fileMenu, 'Save', () => { onSave(); }, 's');
  menuAddItem(fileMenu, 'Save As...', () => { onSaveAs(); }, 'S');
  menuAddSeparator(fileMenu);
  menuAddItem(fileMenu, 'Settings...', () => { onOpenSettings(); }, ',');
  menuAddSeparator(fileMenu);
  menuAddItem(fileMenu, 'Close Editor', () => { onCloseEditor(); });

  // ---- Edit menu ----
  const editMenu = menuCreate();
  menuAddItem(editMenu, 'Undo', () => { onUndo(); }, 'z');
  menuAddItem(editMenu, 'Redo', () => { onRedo(); }, 'Z');
  menuAddSeparator(editMenu);
  menuAddItem(editMenu, 'Cut', () => { onCut(); }, 'x');
  menuAddItem(editMenu, 'Copy', () => { onCopy(); }, 'c');
  menuAddItem(editMenu, 'Paste', () => { onPaste(); }, 'v');
  menuAddSeparator(editMenu);
  menuAddItem(editMenu, 'Find', () => { onFind(); }, 'f');
  menuAddItem(editMenu, 'Replace', () => { onReplace(); }, 'h');
  menuAddSeparator(editMenu);
  menuAddItem(editMenu, 'Select All', () => { onSelectAll(); }, 'a');

  // ---- View menu ----
  const viewMenu = menuCreate();
  menuAddItem(viewMenu, 'Toggle Sidebar', () => { onToggleSidebar(); }, 'b');
  menuAddItem(viewMenu, 'Toggle Bottom Panel', () => { onToggleBottomPanel(); }, 'j');
  menuAddItem(viewMenu, 'Toggle Terminal', () => { onToggleTerminal(); });
  menuAddSeparator(viewMenu);
  menuAddItem(viewMenu, 'Zoom In', () => { onZoomIn(); });
  menuAddItem(viewMenu, 'Zoom Out', () => { onZoomOut(); });
  menuAddItem(viewMenu, 'Reset Zoom', () => { onResetZoom(); });

  // ---- Go menu ----
  const goMenu = menuCreate();
  menuAddItem(goMenu, 'Go to File...', () => { onGoToFile(); }, 'p');
  menuAddItem(goMenu, 'Go to Line...', () => { onGoToLine(); }, 'g');
  menuAddItem(goMenu, 'Go to Symbol...', () => { onGoToSymbol(); });

  // ---- Help menu ----
  const helpMenu = menuCreate();
  menuAddItem(helpMenu, 'Welcome', () => { onWelcome(); });
  menuAddItem(helpMenu, 'Documentation', () => { onDocs(); });
  menuAddSeparator(helpMenu);
  menuAddItem(helpMenu, 'About Hone', () => { onAbout(); });

  // ---- Assemble menu bar ----
  const bar = menuBarCreate();
  menuBarAddMenu(bar, 'File', fileMenu);
  menuBarAddMenu(bar, 'Edit', editMenu);
  menuBarAddMenu(bar, 'View', viewMenu);
  menuBarAddMenu(bar, 'Go', goMenu);
  menuBarAddMenu(bar, 'Help', helpMenu);
  menuBarAttach(bar);
}
