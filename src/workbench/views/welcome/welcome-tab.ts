/**
 * Welcome tab — shown when no file is open in the editor area.
 */
import {
  VStack, VStackWithInsets, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered,
  widgetAddChild,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

let _onOpenFolder: () => void = () => {};
let _onOpenFile: () => void = () => {};
let _onNewFile: () => void = () => {};

export function setWelcomeActions(
  onOpenFolder: () => void,
  onOpenFile: () => void,
  onNewFile: () => void,
): void {
  _onOpenFolder = onOpenFolder;
  _onOpenFile = onOpenFile;
  _onNewFile = onNewFile;
}

function onOpenFolderClick(): void { _onOpenFolder(); }
function onOpenFileClick(): void { _onOpenFile(); }
function onNewFileClick(): void { _onNewFile(); }

export function createWelcomeContent(colors: ResolvedUIColors): unknown {
  const titleText = Text('Hone IDE');
  textSetFontSize(titleText, 24);
  textSetFontWeight(titleText, 24, 0.7);
  setFg(titleText, colors.editorForeground);

  const subtitle = Text('A lightweight, native code editor');
  textSetFontSize(subtitle, 14);
  setFg(subtitle, colors.editorForeground);

  // Quick actions
  const actionsTitle = Text('Quick Actions');
  textSetFontSize(actionsTitle, 14);
  textSetFontWeight(actionsTitle, 14, 0.6);
  setFg(actionsTitle, colors.editorForeground);

  const openFolderBtn = Button('Open Folder', () => { onOpenFolderClick(); });
  buttonSetBordered(openFolderBtn, 0);
  textSetFontSize(openFolderBtn, 13);
  setBtnFg(openFolderBtn, colors.editorForeground);

  const openFileBtn = Button('Open File', () => { onOpenFileClick(); });
  buttonSetBordered(openFileBtn, 0);
  textSetFontSize(openFileBtn, 13);
  setBtnFg(openFileBtn, colors.editorForeground);

  const newFileBtn = Button('New File', () => { onNewFileClick(); });
  buttonSetBordered(newFileBtn, 0);
  textSetFontSize(newFileBtn, 13);
  setBtnFg(newFileBtn, colors.editorForeground);

  // Tips
  const tipsTitle = Text('Tips');
  textSetFontSize(tipsTitle, 14);
  textSetFontWeight(tipsTitle, 14, 0.6);
  setFg(tipsTitle, colors.editorForeground);

  const tip1 = Text('Cmd+P to quick open files');
  textSetFontSize(tip1, 12);
  setFg(tip1, colors.editorForeground);

  const tip2 = Text('Cmd+Shift+P for command palette');
  textSetFontSize(tip2, 12);
  setFg(tip2, colors.editorForeground);

  const tip3 = Text('Cmd+B to toggle sidebar');
  textSetFontSize(tip3, 12);
  setFg(tip3, colors.editorForeground);

  const content = VStackWithInsets(12, 40, 40, 40, 40);
  setBg(content, colors.editorBackground);
  widgetAddChild(content, Spacer());
  widgetAddChild(content, titleText);
  widgetAddChild(content, subtitle);
  widgetAddChild(content, actionsTitle);
  widgetAddChild(content, openFolderBtn);
  widgetAddChild(content, openFileBtn);
  widgetAddChild(content, newFileBtn);
  widgetAddChild(content, tipsTitle);
  widgetAddChild(content, tip1);
  widgetAddChild(content, tip2);
  widgetAddChild(content, tip3);
  widgetAddChild(content, Spacer());

  return content;
}
