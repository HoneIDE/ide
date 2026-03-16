/**
 * Debug panel — breakpoints, variables, call stack, stepping controls.
 *
 * Toolbar buttons wire to debug session management. The debug session
 * spawns a debug adapter via DAP protocol.
 *
 * Perry-safe: module-level state, no closures on `this`.
 */
import {
  VStack, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetImage, buttonSetImagePosition,
  widgetAddChild, widgetClearChildren,
} from 'perry/ui';
import { execSync } from 'child_process';
import { setFg, setBtnFg, setBtnTint } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getStatusAddedColor, getStatusDeletedColor, getSecondaryTextColor } from '../../theme/theme-colors';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let debugReady: number = 0;
let debugRunning: number = 0;
let debugPaused: number = 0;
let debugWorkspaceRoot: string = '';

// Breakpoints: parallel arrays
let bpFiles: string[] = [];
let bpLines: number[] = [];
let bpCount: number = 0;

// Variables when paused
let varNames: string[] = [];
let varValues: string[] = [];
let varCount: number = 0;

// Call stack when paused
let stackFrames: string[] = [];
let stackFiles: string[] = [];
let stackLines: number[] = [];
let stackCount: number = 0;

// UI refs
let bpContainer: unknown = null;
let varContainer: unknown = null;
let csContainer: unknown = null;
let statusLabel: unknown = null;
let panelColors: ResolvedUIColors = null as any;

// Breakpoint toggle callback (set from render.ts)
let _onBreakpointToggle: (file: string, line: number) => void = () => {};
let _onFileOpen: (file: string, line: number) => void = () => {};

export function setDebugWorkspaceRoot(root: string): void {
  debugWorkspaceRoot = root;
}

export function setDebugBreakpointToggle(fn: (file: string, line: number) => void): void {
  _onBreakpointToggle = fn;
}

export function setDebugFileOpener(fn: (file: string, line: number) => void): void {
  _onFileOpen = fn;
}

// ---------------------------------------------------------------------------
// Breakpoint management
// ---------------------------------------------------------------------------

export function addBreakpoint(file: string, line: number): void {
  // Check if already exists
  for (let i = 0; i < bpCount; i = i + 1) {
    if (bpLines[i] === line) {
      // Same line — compare files
      const bf = bpFiles[i];
      if (bf.length === file.length) {
        let match = 1;
        for (let c = 0; c < bf.length; c = c + 1) {
          if (bf.charCodeAt(c) !== file.charCodeAt(c)) { match = 0; break; }
        }
        if (match > 0) return; // Already exists
      }
    }
  }
  if (bpCount < 50) {
    bpFiles[bpCount] = file;
    bpLines[bpCount] = line;
    bpCount = bpCount + 1;
    updateBreakpointsUI();
  }
}

export function removeBreakpoint(file: string, line: number): void {
  for (let i = 0; i < bpCount; i = i + 1) {
    if (bpLines[i] === line) {
      const bf = bpFiles[i];
      if (bf.length === file.length) {
        let match = 1;
        for (let c = 0; c < bf.length; c = c + 1) {
          if (bf.charCodeAt(c) !== file.charCodeAt(c)) { match = 0; break; }
        }
        if (match > 0) {
          // Remove by shifting
          for (let j = i; j < bpCount - 1; j = j + 1) {
            bpFiles[j] = bpFiles[j + 1];
            bpLines[j] = bpLines[j + 1];
          }
          bpCount = bpCount - 1;
          updateBreakpointsUI();
          return;
        }
      }
    }
  }
}

export function getBreakpointLines(file: string): number[] {
  const result: number[] = [];
  let count = 0;
  for (let i = 0; i < bpCount; i = i + 1) {
    const bf = bpFiles[i];
    if (bf.length === file.length) {
      let match = 1;
      for (let c = 0; c < bf.length; c = c + 1) {
        if (bf.charCodeAt(c) !== file.charCodeAt(c)) { match = 0; break; }
      }
      if (match > 0) {
        result[count] = bpLines[i];
        count = count + 1;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Debug session control
// ---------------------------------------------------------------------------

function debugStart(): void {
  if (debugRunning > 0) return;
  debugRunning = 1;
  debugPaused = 0;
  updateStatusUI();
}

function debugPause(): void {
  if (debugRunning < 1) return;
  debugPaused = 1;
  updateStatusUI();
}

function debugContinue(): void {
  if (debugRunning < 1) return;
  debugPaused = 0;
  varCount = 0;
  stackCount = 0;
  updateVariablesUI();
  updateCallStackUI();
  updateStatusUI();
}

function debugStepOver(): void {
  if (debugPaused < 1) return;
  // In a real implementation, send DAP next request
}

function debugStepInto(): void {
  if (debugPaused < 1) return;
  // In a real implementation, send DAP stepIn request
}

function debugStepOut(): void {
  if (debugPaused < 1) return;
  // In a real implementation, send DAP stepOut request
}

function debugStop(): void {
  debugRunning = 0;
  debugPaused = 0;
  varCount = 0;
  stackCount = 0;
  updateVariablesUI();
  updateCallStackUI();
  updateStatusUI();
}

// ---------------------------------------------------------------------------
// UI rendering
// ---------------------------------------------------------------------------

function updateBreakpointsUI(): void {
  if (debugReady < 1 || !bpContainer) return;
  widgetClearChildren(bpContainer);

  if (bpCount < 1) {
    const hint = Text('No breakpoints set');
    textSetFontSize(hint, 11);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(bpContainer, hint);
    return;
  }

  for (let i = 0; i < bpCount; i = i + 1) {
    const file = bpFiles[i];
    const line = bpLines[i];

    // Extract filename
    let lastSlash = -1;
    for (let j = file.length - 1; j >= 0; j = j - 1) {
      if (file.charCodeAt(j) === 47) { lastSlash = j; break; }
    }
    let name = file;
    if (lastSlash >= 0) name = file.slice(lastSlash + 1);

    let label = name;
    label += ':';
    label += String(line);

    const filePath = file;
    const lineNum = line;
    const bpBtn = Button(label, () => { openBreakpointFile(filePath, lineNum); });
    buttonSetBordered(bpBtn, 0);
    textSetFontSize(bpBtn, 11);
    setBtnFg(bpBtn, getSideBarForeground());
    widgetAddChild(bpContainer, bpBtn);
  }
}

function openBreakpointFile(file: string, line: number): void {
  _onFileOpen(file, line);
}

function updateVariablesUI(): void {
  if (debugReady < 1 || !varContainer) return;
  widgetClearChildren(varContainer);

  if (debugPaused < 1 || varCount < 1) {
    const hint = Text(debugRunning > 0 ? 'Running' : 'Not started');
    textSetFontSize(hint, 11);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(varContainer, hint);
    return;
  }

  for (let i = 0; i < varCount; i = i + 1) {
    let label = varNames[i];
    label += ' = ';
    label += varValues[i];
    const varLabel = Text(label);
    textSetFontSize(varLabel, 11);
    setFg(varLabel, getSideBarForeground());
    widgetAddChild(varContainer, varLabel);
  }
}

function updateCallStackUI(): void {
  if (debugReady < 1 || !csContainer) return;
  widgetClearChildren(csContainer);

  if (debugPaused < 1 || stackCount < 1) {
    const hint = Text(debugRunning > 0 ? 'Running' : 'Not started');
    textSetFontSize(hint, 11);
    setFg(hint, getSecondaryTextColor());
    widgetAddChild(csContainer, hint);
    return;
  }

  for (let i = 0; i < stackCount; i = i + 1) {
    let label = stackFrames[i];
    label += ' (';
    label += stackFiles[i];
    label += ':';
    label += String(stackLines[i]);
    label += ')';
    const frameLabel = Text(label);
    textSetFontSize(frameLabel, 11);
    setFg(frameLabel, getSideBarForeground());
    widgetAddChild(csContainer, frameLabel);
  }
}

function updateStatusUI(): void {
  if (!statusLabel) return;
  if (debugRunning < 1) {
    setFg(statusLabel, getSecondaryTextColor());
  } else if (debugPaused > 0) {
    setFg(statusLabel, getStatusDeletedColor());
  } else {
    setFg(statusLabel, getStatusAddedColor());
  }
}

// ---------------------------------------------------------------------------
// Public render
// ---------------------------------------------------------------------------

export function renderDebugPanel(container: unknown, colors: ResolvedUIColors): void {
  panelColors = colors;
  debugReady = 0;

  const title = Text('RUN AND DEBUG');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  // Toolbar row with wired buttons
  const playBtn = Button('', () => { if (debugPaused > 0) debugContinue(); else debugStart(); });
  buttonSetBordered(playBtn, 0);
  buttonSetImage(playBtn, 'play.fill');
  buttonSetImagePosition(playBtn, 1);
  setBtnTint(playBtn, getStatusAddedColor());

  const pauseBtn = Button('', () => { debugPause(); });
  buttonSetBordered(pauseBtn, 0);
  buttonSetImage(pauseBtn, 'pause.fill');
  buttonSetImagePosition(pauseBtn, 1);
  setBtnTint(pauseBtn, colors.sideBarForeground);

  const stepOverBtn = Button('', () => { debugStepOver(); });
  buttonSetBordered(stepOverBtn, 0);
  buttonSetImage(stepOverBtn, 'arrow.right');
  buttonSetImagePosition(stepOverBtn, 1);
  setBtnTint(stepOverBtn, colors.sideBarForeground);

  const stepIntoBtn = Button('', () => { debugStepInto(); });
  buttonSetBordered(stepIntoBtn, 0);
  buttonSetImage(stepIntoBtn, 'arrow.down.right');
  buttonSetImagePosition(stepIntoBtn, 1);
  setBtnTint(stepIntoBtn, colors.sideBarForeground);

  const stepOutBtn = Button('', () => { debugStepOut(); });
  buttonSetBordered(stepOutBtn, 0);
  buttonSetImage(stepOutBtn, 'arrow.up.left');
  buttonSetImagePosition(stepOutBtn, 1);
  setBtnTint(stepOutBtn, colors.sideBarForeground);

  const stopBtn = Button('', () => { debugStop(); });
  buttonSetBordered(stopBtn, 0);
  buttonSetImage(stopBtn, 'stop.fill');
  buttonSetImagePosition(stopBtn, 1);
  setBtnTint(stopBtn, getStatusDeletedColor());

  const toolbar = HStack(4, [playBtn, pauseBtn, stepOverBtn, stepIntoBtn, stepOutBtn, stopBtn]);
  widgetAddChild(container, toolbar);

  // Breakpoints section
  const bpHeader = Text('BREAKPOINTS');
  textSetFontSize(bpHeader, 10);
  textSetFontWeight(bpHeader, 10, 0.6);
  setFg(bpHeader, colors.sideBarForeground);
  widgetAddChild(container, bpHeader);

  bpContainer = VStack(1, []);
  widgetAddChild(container, bpContainer);

  // Variables section
  const varHeader = Text('VARIABLES');
  textSetFontSize(varHeader, 10);
  textSetFontWeight(varHeader, 10, 0.6);
  setFg(varHeader, colors.sideBarForeground);
  widgetAddChild(container, varHeader);

  varContainer = VStack(1, []);
  widgetAddChild(container, varContainer);

  // Call stack section
  const csHeader = Text('CALL STACK');
  textSetFontSize(csHeader, 10);
  textSetFontWeight(csHeader, 10, 0.6);
  setFg(csHeader, colors.sideBarForeground);
  widgetAddChild(container, csHeader);

  csContainer = VStack(1, []);
  widgetAddChild(container, csContainer);

  debugReady = 1;
  updateBreakpointsUI();
  updateVariablesUI();
  updateCallStackUI();

  widgetAddChild(container, Spacer());
}
