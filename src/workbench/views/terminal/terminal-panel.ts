/**
 * Terminal panel — real PTY-backed interactive terminal.
 * Embeds a native NSView that renders the terminal grid and routes
 * keyboard input directly to the shell via the PTY master fd.
 * TypeScript only polls for redraws every 16ms.
 */
import {
  VStack, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetImage, buttonSetImagePosition,
  widgetAddChild, widgetSetHugging, widgetSetHeight, widgetSetWidth,
  widgetSetBackgroundColor,
  embedNSView,
} from 'perry/ui';
// Import triggers Perry to discover @honeide/terminal package.json FFI manifest
import { TERMINAL_LIVE } from '@honeide/terminal/perry/live';
import { hexToRGBA, setBg, setFg, setBtnFg, setBtnTint } from '../../ui-helpers';

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

// Header tab buttons
let headerTabBtns: unknown[] = [];
let activeHeaderTab: number = 2; // TERMINAL active by default

// External close callback
let _closeCallback: () => void = _noopClose;
function _noopClose(): void {}

export function setTerminalCloseCallback(fn: () => void): void {
  _closeCallback = fn;
}

export function setTerminalCwd(cwd: string): void {
  termCwd = cwd;
}

function doPoll(): void {
  if (termHandle === 0) return;
  hone_terminal_poll(termHandle);
}

function onHeaderTabClick(idx: number): void {
  activeHeaderTab = idx;
  // Only TERMINAL tab (idx=2) is functional for now
}

function onMaximizeClick(): void {
  // Placeholder for maximize behavior
}

function onCloseClick(): void {
  _closeCallback();
}

function buildTerminalHeader(colors: any): unknown {
  const tabNames = ['PROBLEMS', 'OUTPUT', 'TERMINAL', 'DEBUG CONSOLE'];
  headerTabBtns = [];

  const row = HStack(0, []);
  setBg(row, colors.panelBackground);

  for (let i = 0; i < 4; i++) {
    const idx = i;
    const btn = Button(tabNames[i], () => { onHeaderTabClick(idx); });
    buttonSetBordered(btn, 0);
    textSetFontSize(btn, 11);
    if (i === activeHeaderTab) {
      setBtnFg(btn, colors.editorForeground);
    } else {
      setBtnFg(btn, colors.sideBarForeground + '80');
    }
    headerTabBtns[i] = btn;
    widgetAddChild(row, btn);
  }

  widgetAddChild(row, Spacer());

  // Maximize button
  const maxBtn = Button('', () => { onMaximizeClick(); });
  buttonSetBordered(maxBtn, 0);
  buttonSetImage(maxBtn, 'arrow.up.left.and.arrow.down.right');
  buttonSetImagePosition(maxBtn, 1);
  textSetFontSize(maxBtn, 10);
  setBtnTint(maxBtn, colors.sideBarForeground);
  widgetAddChild(row, maxBtn);

  // Close button
  const closeBtn = Button('', () => { onCloseClick(); });
  buttonSetBordered(closeBtn, 0);
  buttonSetImage(closeBtn, 'xmark');
  buttonSetImagePosition(closeBtn, 1);
  textSetFontSize(closeBtn, 10);
  setBtnTint(closeBtn, colors.sideBarForeground);
  widgetAddChild(row, closeBtn);

  widgetSetHeight(row, 32);
  widgetSetHugging(row, 750);

  // Top border line
  const topBorder = HStack(0, []);
  setBg(topBorder, colors.panelBorder);
  widgetSetHeight(topBorder, 1);
  widgetSetHugging(topBorder, 750);

  // Active tab underline (2px accent under TERMINAL tab)
  const underline = HStack(0, []);
  setBg(underline, colors.focusBorder);
  widgetSetHeight(underline, 2);
  widgetSetHugging(underline, 750);

  const header = VStack(0, [topBorder, row]);
  widgetSetHugging(header, 750);

  return header;
}

export function renderTerminalPanel(container: unknown, colors: any): void {
  termContainer = container;

  // Build header bar
  const header = buildTerminalHeader(colors);
  widgetAddChild(container, header);

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
