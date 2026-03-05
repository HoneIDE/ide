/**
 * LSP bridge — spawns language servers and forwards diagnostics to the editor.
 */
import type { ResolvedUIColors } from '../../theme/theme-loader';

let lspReady: number = 0;
let lspWorkspaceRoot = '';

export function setLspWorkspaceRoot(root: string): void {
  lspWorkspaceRoot = root;
}

export function initLspBridge(): void {
  if (lspWorkspaceRoot.length < 1) return;
  lspReady = 1;
  // Future: spawn LSP servers based on detected languages
}

export function stopLspBridge(): void {
  lspReady = 0;
}
