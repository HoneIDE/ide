/**
 * File operations — create, rename, delete, move files and directories.
 *
 * These operations interact with the real filesystem (via node:fs)
 * and update the file tree view model accordingly.
 *
 * On mobile:
 * - iOS: File picker integrates with Files.app
 * - Android: File picker integrates with Storage Access Framework
 * - Confirmations use platform-native dialogs (action sheets on iOS, dialogs on Android)
 */

import { mkdir, writeFile, rename as fsRename, rm, cp, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileOperationType = 'create-file' | 'create-directory' | 'rename' | 'delete' | 'move' | 'copy';

export interface FileOperationResult {
  success: boolean;
  type: FileOperationType;
  /** Source path (for rename/move/copy/delete). */
  sourcePath: string;
  /** Destination path (for rename/move/copy/create). */
  destinationPath: string | null;
  error: string | null;
}

export type OperationListener = (result: FileOperationResult) => void;

// ---------------------------------------------------------------------------
// FileOperations
// ---------------------------------------------------------------------------

const _listeners: Set<OperationListener> = new Set();

export function onFileOperation(listener: OperationListener): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

function emit(result: FileOperationResult): void {
  for (const fn of _listeners) fn(result);
}

// -----------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------

/**
 * Create a new empty file.
 */
export async function createFile(parentDir: string, fileName: string): Promise<FileOperationResult> {
  const filePath = join(parentDir, fileName);

  try {
    // Check if already exists
    try {
      await stat(filePath);
      return { success: false, type: 'create-file', sourcePath: filePath, destinationPath: filePath, error: `File already exists: ${fileName}` };
    } catch {
      // Does not exist — good
    }

    // Ensure parent directory exists
    await mkdir(parentDir, { recursive: true });
    await writeFile(filePath, '', 'utf-8');

    const result: FileOperationResult = {
      success: true,
      type: 'create-file',
      sourcePath: filePath,
      destinationPath: filePath,
      error: null,
    };
    emit(result);
    return result;
  } catch (err) {
    const result: FileOperationResult = {
      success: false,
      type: 'create-file',
      sourcePath: filePath,
      destinationPath: null,
      error: String(err),
    };
    emit(result);
    return result;
  }
}

/**
 * Create a new directory.
 */
export async function createDirectory(parentDir: string, dirName: string): Promise<FileOperationResult> {
  const dirPath = join(parentDir, dirName);

  try {
    await mkdir(dirPath, { recursive: true });

    const result: FileOperationResult = {
      success: true,
      type: 'create-directory',
      sourcePath: dirPath,
      destinationPath: dirPath,
      error: null,
    };
    emit(result);
    return result;
  } catch (err) {
    const result: FileOperationResult = {
      success: false,
      type: 'create-directory',
      sourcePath: dirPath,
      destinationPath: null,
      error: String(err),
    };
    emit(result);
    return result;
  }
}

/**
 * Rename a file or directory.
 */
export async function renameFile(oldPath: string, newName: string): Promise<FileOperationResult> {
  const dir = dirname(oldPath);
  const newPath = join(dir, newName);

  try {
    // Check target doesn't already exist
    try {
      await stat(newPath);
      return { success: false, type: 'rename', sourcePath: oldPath, destinationPath: newPath, error: `A file with name '${newName}' already exists` };
    } catch {
      // Good — doesn't exist
    }

    await fsRename(oldPath, newPath);

    const result: FileOperationResult = {
      success: true,
      type: 'rename',
      sourcePath: oldPath,
      destinationPath: newPath,
      error: null,
    };
    emit(result);
    return result;
  } catch (err) {
    const result: FileOperationResult = {
      success: false,
      type: 'rename',
      sourcePath: oldPath,
      destinationPath: null,
      error: String(err),
    };
    emit(result);
    return result;
  }
}

/**
 * Delete a file or directory.
 */
export async function deleteFile(filePath: string): Promise<FileOperationResult> {
  try {
    await rm(filePath, { recursive: true, force: true });

    const result: FileOperationResult = {
      success: true,
      type: 'delete',
      sourcePath: filePath,
      destinationPath: null,
      error: null,
    };
    emit(result);
    return result;
  } catch (err) {
    const result: FileOperationResult = {
      success: false,
      type: 'delete',
      sourcePath: filePath,
      destinationPath: null,
      error: String(err),
    };
    emit(result);
    return result;
  }
}

/**
 * Move a file or directory to a new location.
 */
export async function moveFile(sourcePath: string, destinationDir: string): Promise<FileOperationResult> {
  const name = basename(sourcePath);
  const destPath = join(destinationDir, name);

  try {
    await fsRename(sourcePath, destPath);

    const result: FileOperationResult = {
      success: true,
      type: 'move',
      sourcePath,
      destinationPath: destPath,
      error: null,
    };
    emit(result);
    return result;
  } catch (err) {
    const result: FileOperationResult = {
      success: false,
      type: 'move',
      sourcePath,
      destinationPath: null,
      error: String(err),
    };
    emit(result);
    return result;
  }
}

/**
 * Copy a file or directory.
 */
export async function copyFile(sourcePath: string, destinationDir: string): Promise<FileOperationResult> {
  const name = basename(sourcePath);
  const destPath = join(destinationDir, name);

  try {
    await cp(sourcePath, destPath, { recursive: true });

    const result: FileOperationResult = {
      success: true,
      type: 'copy',
      sourcePath,
      destinationPath: destPath,
      error: null,
    };
    emit(result);
    return result;
  } catch (err) {
    const result: FileOperationResult = {
      success: false,
      type: 'copy',
      sourcePath,
      destinationPath: null,
      error: String(err),
    };
    emit(result);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;

/**
 * Validate a filename (no path separators, no invalid chars).
 */
export function validateFileName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return 'File name cannot be empty';
  }
  if (name.startsWith('.') && name.length === 1) {
    return 'File name cannot be just a dot';
  }
  if (name === '..') {
    return 'File name cannot be ".."';
  }
  if (INVALID_FILENAME_CHARS.test(name)) {
    return 'File name contains invalid characters';
  }
  if (name.endsWith(' ') || name.endsWith('.')) {
    return 'File name cannot end with a space or period';
  }
  return null; // Valid
}
