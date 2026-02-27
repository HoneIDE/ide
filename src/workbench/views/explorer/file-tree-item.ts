/**
 * File tree item — view model for a single node in the file explorer tree.
 *
 * Each item represents a file or directory with:
 * - Icon (resolved by file extension)
 * - Expand/collapse state (directories)
 * - Selection state
 * - Context menu actions (platform-adaptive)
 */

import type { LayoutMode } from '../../../platform';
import { MIN_TOUCH_TARGET } from '../../../platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileItemType = 'file' | 'directory' | 'symlink';

export interface FileTreeItemData {
  /** Unique ID (absolute path). */
  id: string;
  /** Display name. */
  name: string;
  /** Absolute path. */
  path: string;
  /** Relative path from workspace root. */
  relativePath: string;
  type: FileItemType;
  /** Nesting depth (0 = root level). */
  depth: number;
  /** Whether this directory is expanded. */
  expanded: boolean;
  /** Whether this item is currently selected. */
  selected: boolean;
  /** Whether this item is being renamed. */
  renaming: boolean;
  /** Icon identifier (resolved from file extension). */
  icon: string;
  /** Children (for expanded directories). */
  children: FileTreeItemData[];
}

export interface ContextMenuAction {
  id: string;
  label: string;
  icon: string;
  /** Command to execute. */
  command: string;
  /** Whether to show a separator before this action. */
  separator: boolean;
  /** Whether this action is destructive (shown in red on mobile). */
  destructive: boolean;
}

// ---------------------------------------------------------------------------
// Icon resolution
// ---------------------------------------------------------------------------

const EXTENSION_ICONS: Record<string, string> = {
  // Languages
  '.ts': 'file-typescript',
  '.tsx': 'file-typescript',
  '.js': 'file-javascript',
  '.jsx': 'file-javascript',
  '.py': 'file-python',
  '.rs': 'file-rust',
  '.go': 'file-go',
  '.java': 'file-java',
  '.c': 'file-c',
  '.cpp': 'file-cpp',
  '.h': 'file-c',
  '.hpp': 'file-cpp',
  '.cs': 'file-csharp',
  '.rb': 'file-ruby',
  '.php': 'file-php',
  '.swift': 'file-swift',
  '.kt': 'file-kotlin',

  // Web
  '.html': 'file-html',
  '.css': 'file-css',
  '.scss': 'file-scss',
  '.less': 'file-less',
  '.svg': 'file-svg',

  // Data / Config
  '.json': 'file-json',
  '.yaml': 'file-yaml',
  '.yml': 'file-yaml',
  '.toml': 'file-toml',
  '.xml': 'file-xml',
  '.env': 'file-env',
  '.ini': 'file-config',
  '.conf': 'file-config',

  // Docs
  '.md': 'file-markdown',
  '.txt': 'file-text',
  '.pdf': 'file-pdf',

  // Images
  '.png': 'file-image',
  '.jpg': 'file-image',
  '.jpeg': 'file-image',
  '.gif': 'file-image',
  '.webp': 'file-image',
  '.ico': 'file-image',

  // Shell
  '.sh': 'file-shell',
  '.bash': 'file-shell',
  '.zsh': 'file-shell',
  '.fish': 'file-shell',

  // Build
  '.lock': 'file-lock',
  '.dockerfile': 'file-docker',
};

const FILENAME_ICONS: Record<string, string> = {
  'package.json': 'file-npm',
  'tsconfig.json': 'file-typescript-config',
  'Cargo.toml': 'file-rust',
  'go.mod': 'file-go',
  'Makefile': 'file-makefile',
  'Dockerfile': 'file-docker',
  'docker-compose.yml': 'file-docker',
  '.gitignore': 'file-git',
  '.gitattributes': 'file-git',
  'LICENSE': 'file-license',
  'README.md': 'file-readme',
};

export function resolveFileIcon(name: string, type: FileItemType): string {
  if (type === 'directory') return 'folder';

  // Check filename-specific icons first
  if (FILENAME_ICONS[name]) return FILENAME_ICONS[name];

  // Check extension
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = name.substring(dotIdx).toLowerCase();
    if (EXTENSION_ICONS[ext]) return EXTENSION_ICONS[ext];
  }

  return 'file';
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

export function getFileContextActions(
  item: FileTreeItemData,
  layoutMode: LayoutMode,
): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [];

  if (item.type === 'file') {
    actions.push({ id: 'open', label: 'Open', icon: 'edit', command: 'file.open', separator: false, destructive: false });
    actions.push({ id: 'openToSide', label: 'Open to the Side', icon: 'split-horizontal', command: 'file.openToSide', separator: false, destructive: false });
  }

  if (item.type === 'directory') {
    actions.push({ id: 'newFile', label: 'New File...', icon: 'file-plus', command: 'explorer.newFile', separator: false, destructive: false });
    actions.push({ id: 'newFolder', label: 'New Folder...', icon: 'folder-plus', command: 'explorer.newFolder', separator: false, destructive: false });
  }

  actions.push({ id: 'rename', label: 'Rename...', icon: 'pencil', command: 'explorer.rename', separator: true, destructive: false });
  actions.push({ id: 'delete', label: 'Delete', icon: 'trash', command: 'explorer.delete', separator: false, destructive: true });

  if (item.type === 'file') {
    actions.push({ id: 'copyPath', label: 'Copy Path', icon: 'clipboard', command: 'explorer.copyPath', separator: true, destructive: false });
    actions.push({ id: 'copyRelativePath', label: 'Copy Relative Path', icon: 'clipboard', command: 'explorer.copyRelativePath', separator: false, destructive: false });
  }

  // On compact (phone), skip "Open to the Side" (no split view)
  if (layoutMode === 'compact') {
    return actions.filter(a => a.id !== 'openToSide');
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/**
 * Get the row height for a file tree item based on layout mode.
 */
export function getTreeItemHeight(layoutMode: LayoutMode): number {
  if (layoutMode === 'compact') {
    return MIN_TOUCH_TARGET; // 44pt — minimum for touch
  }
  return 22; // Compact row height for mouse-driven desktop
}

/**
 * Get the indentation width per depth level.
 */
export function getIndentWidth(layoutMode: LayoutMode): number {
  if (layoutMode === 'compact') return 24;
  return 16;
}
