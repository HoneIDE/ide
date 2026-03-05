/**
 * Terminal panel — real PTY-backed interactive terminal.
 * Embeds a native NSView that renders the terminal grid and routes
 * keyboard input directly to the shell via the PTY master fd.
 * TypeScript only polls for redraws every 16ms.
 */
import {
  widgetAddChild, widgetSetHugging,
  embedNSView,
} from 'perry/ui';
// Import triggers Perry to discover @honeide/terminal package.json FFI manifest
import { TERMINAL_LIVE } from '@honeide/terminal/perry/live';

// FFI declarations — LiveTerminal API
declare function hone_terminal_open(rows: number, cols: number, shell: number, cwd: number): number;
declare function hone_terminal_nsview(handle: number): number;
declare function hone_terminal_poll(handle: number): number;
declare function hone_terminal_write(handle: number, data: number): number;
declare function hone_terminal_resize(handle: number, rows: number, cols: number): number;
declare function hone_terminal_close(handle: number): number;

// Module-level state (Perry closures capture by value)
let termHandle: number = 0;
let termView: unknown = null;
let pollInterval: number = 0;
let termCwd: string = '/Users/amlug';
let termContainer: unknown = null;
let termStarted: number = 0;

export function setTerminalCwd(cwd: string): void {
  termCwd = cwd;
}

function doPoll(): void {
  if (termHandle === 0) return;
  hone_terminal_poll(termHandle);
}

export function renderTerminalPanel(container: unknown, colors: any): void {
  termContainer = container;

  // Open terminal: 14 rows x 80 cols
  const shell = '/bin/zsh';
  const cwd = termCwd;
  termHandle = hone_terminal_open(14, 80, shell as any, cwd as any);

  // Get the NSView and embed it
  const nsview = hone_terminal_nsview(termHandle);
  termView = embedNSView(nsview);
  widgetSetHugging(termView, 1);
  widgetAddChild(container, termView);

  // Poll every 16ms for PTY output
  pollInterval = setInterval(doPoll, 16);
}

export function destroyTerminalPanel(): void {
  if (pollInterval !== 0) {
    clearInterval(pollInterval);
    pollInterval = 0;
  }
  if (termHandle !== 0) {
    hone_terminal_close(termHandle);
    termHandle = 0;
  }
  termView = null;
  termContainer = null;
}
