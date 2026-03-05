/**
 * Terminal panel — command shell using execSync.
 * Provides a basic command-line interface within the IDE.
 */
import {
  VStack, HStack, HStackWithInsets, Text, Button, Spacer,
  TextField, ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString,
  buttonSetBordered,
  widgetAddChild, widgetClearChildren,
  widgetSetWidth, widgetSetHugging,
  textfieldSetString, textfieldFocus,
} from 'perry/ui';
import { execSync } from 'child_process';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

// Character codes for string comparison (Perry string === is unreliable)
const CC_C = 99;
const CC_D = 100;
const CC_E = 101;
const CC_A = 97;
const CC_L = 108;
const CC_R = 114;
const CC_SPACE = 32;

// Module-level state (Perry closures capture by value)
let termColors: ResolvedUIColors | null = null;
let termOutputContainer: unknown = null;
let termInput: unknown = null;
let termInputText: string = '';
let termCwd: string = '';
let termCwdLabel: unknown = null;
let termLineCount: number = 0;

function onTermInput(text: string): void {
  termInputText = text;
}

function appendOutput(text: string, isBold: number): void {
  if (!termOutputContainer || !termColors) return;
  const line = Text(text);
  textSetFontSize(line, 12);
  textSetFontFamily(line, 12, 'Menlo');
  setFg(line, termColors.editorForeground);
  if (isBold > 0) {
    textSetFontWeight(line, 12, 0.5);
  }
  widgetAddChild(termOutputContainer, line);
  termLineCount = termLineCount + 1;
}

function appendErrorOutput(text: string): void {
  if (!termOutputContainer || !termColors) return;
  const line = Text(text);
  textSetFontSize(line, 12);
  textSetFontFamily(line, 12, 'Menlo');
  setFg(line, termColors.errorForeground);
  widgetAddChild(termOutputContainer, line);
  termLineCount = termLineCount + 1;
}

function runCommand(): void {
  const cmd = termInputText;
  if (cmd.length < 1) return;

  // Show prompt + command
  const prompt = '$ ' + cmd;
  appendOutput(prompt, 1);

  // Handle cd specially
  if (cmd.length > 2 && cmd.charCodeAt(0) === CC_C && cmd.charCodeAt(1) === CC_D && cmd.charCodeAt(2) === CC_SPACE) {
    // "cd " prefix
    const target = cmd.slice(3);
    if (target.length > 0) {
      try {
        // Resolve the path and verify it exists
        const resolved = execSync('cd ' + termCwd + ' && cd ' + target + ' && pwd', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        const newPath = resolved.trim();
        if (newPath.length > 0) {
          termCwd = newPath;
          updateCwdLabel();
        }
      } catch (e: any) {
        appendErrorOutput('cd: no such directory: ' + target);
      }
    }
  } else if (cmd.length === 2 && cmd.charCodeAt(0) === CC_C && cmd.charCodeAt(1) === CC_D) {
    // bare "cd" — go home
    const home = execSync('echo $HOME', { encoding: 'utf-8', timeout: 2000 }).trim();
    termCwd = home;
    updateCwdLabel();
  } else if (cmd.length === 5 && cmd.charCodeAt(0) === CC_C && cmd.charCodeAt(1) === CC_L &&
             cmd.charCodeAt(2) === CC_E && cmd.charCodeAt(3) === CC_A && cmd.charCodeAt(4) === CC_R) {
    // "clear"
    widgetClearChildren(termOutputContainer);
    termLineCount = 0;
  } else {
    // Run the command
    try {
      const output = execSync(cmd, {
        cwd: termCwd,
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 1024 * 512,
      });
      if (output.length > 0) {
        // Split output into lines and add each
        const lines = output.split('\n');
        let i = 0;
        const maxLines = 200;
        while (i < lines.length && i < maxLines) {
          if (lines[i].length > 0 || i < lines.length - 1) {
            appendOutput(lines[i], 0);
          }
          i = i + 1;
        }
        if (lines.length > maxLines) {
          appendOutput('... (' + (lines.length - maxLines) + ' more lines)', 0);
        }
      }
    } catch (e: any) {
      const errMsg = e.stderr ? e.stderr.toString() : e.message;
      if (errMsg && errMsg.length > 0) {
        const errLines = errMsg.split('\n');
        let i = 0;
        while (i < errLines.length && i < 50) {
          if (errLines[i].length > 0) {
            appendErrorOutput(errLines[i]);
          }
          i = i + 1;
        }
      } else {
        appendErrorOutput('Command failed');
      }
    }
  }

  // Clear input
  termInputText = '';
  if (termInput) textfieldSetString(termInput, '');
}

function updateCwdLabel(): void {
  if (termCwdLabel) {
    textSetString(termCwdLabel, termCwd);
  }
}

export function setTerminalCwd(cwd: string): void {
  termCwd = cwd;
  updateCwdLabel();
}

export function renderTerminalPanel(container: unknown, colors: ResolvedUIColors): void {
  termColors = colors;

  // Initialize cwd if not set
  if (termCwd.length < 1) {
    try {
      termCwd = execSync('pwd', { encoding: 'utf-8', timeout: 2000 }).trim();
    } catch (e: any) {
      termCwd = '/tmp';
    }
  }

  // Header row: TERMINAL label + cwd
  const headerRow = HStackWithInsets(8, 4, 8, 4, 8);
  const title = Text('TERMINAL');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(headerRow, title);

  termCwdLabel = Text(termCwd);
  textSetFontSize(termCwdLabel, 11);
  textSetFontFamily(termCwdLabel, 11, 'Menlo');
  setFg(termCwdLabel, colors.descriptionForeground);
  widgetAddChild(headerRow, termCwdLabel);

  widgetAddChild(headerRow, Spacer());

  const clearBtn = Button('Clear', () => { clearTerminal(); });
  buttonSetBordered(clearBtn, 0);
  textSetFontSize(clearBtn, 11);
  setBtnFg(clearBtn, colors.sideBarForeground);
  widgetAddChild(headerRow, clearBtn);
  widgetAddChild(container, headerRow);

  // Output area (scrollable)
  const outputContent = VStack(1, []);
  termOutputContainer = outputContent;
  setBg(outputContent, colors.editorBackground);

  const scrollWrapper = ScrollView();
  scrollViewSetChild(scrollWrapper, outputContent);
  widgetSetHugging(scrollWrapper, 1);
  widgetAddChild(container, scrollWrapper);

  // Input row
  const inputRow = HStackWithInsets(4, 4, 8, 4, 8);
  setBg(inputRow, colors.inputBackground);

  const promptLabel = Text('$');
  textSetFontSize(promptLabel, 13);
  textSetFontFamily(promptLabel, 13, 'Menlo');
  setFg(promptLabel, colors.editorForeground);
  widgetAddChild(inputRow, promptLabel);

  termInput = TextField('Type a command...', (text: string) => { onTermInput(text); });
  textSetFontSize(termInput, 13);
  widgetSetHugging(termInput, 1);
  widgetAddChild(inputRow, termInput);

  const runBtn = Button('Run', () => { runCommand(); });
  buttonSetBordered(runBtn, 0);
  textSetFontSize(runBtn, 12);
  setBtnFg(runBtn, colors.buttonForeground);
  setBg(runBtn, colors.buttonBackground);
  widgetAddChild(inputRow, runBtn);

  widgetAddChild(container, inputRow);

  // Initial welcome message
  appendOutput('Hone Terminal — type commands below', 0);
  appendOutput('Working directory: ' + termCwd, 0);
}

function clearTerminal(): void {
  if (termOutputContainer) {
    widgetClearChildren(termOutputContainer);
    termLineCount = 0;
  }
}
