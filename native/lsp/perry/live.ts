/**
 * LSP bridge FFI declarations for Perry.
 * Import this module to trigger Perry's package.json FFI discovery.
 */

declare function hone_lsp_start(cmd: number, args: number, cwd: number): number;
declare function hone_lsp_send(handle: number, message: number): number;
declare function hone_lsp_poll(handle: number): number;
declare function hone_lsp_is_alive(handle: number): number;
declare function hone_lsp_stop(handle: number): number;

export const LSP_BRIDGE_LIVE = 1;
