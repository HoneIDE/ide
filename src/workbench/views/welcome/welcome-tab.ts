/**
 * Welcome tab — shown when no file is open in the editor area.
 */
import {
  VStack, VStackWithInsets, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetImage, buttonSetImagePosition,
  widgetAddChild,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { setFg, setBtnFg, setBg, setBtnTint } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getEditorForeground, getEditorBackground } from '../../theme/theme-colors';
import { getRecentCount, getRecentPath, getRecentType } from '../recent/recent-store';

let _onOpenFolder: () => void = () => {};
let _onOpenFile: () => void = () => {};
let _onNewFile: () => void = () => {};
let _onRecentItem: (idx: number) => void = _noopRecent;

function _noopRecent(idx: number): void {}

export function setWelcomeActions(
  onOpenFolder: () => void,
  onOpenFile: () => void,
  onNewFile: () => void,
): void {
  _onOpenFolder = onOpenFolder;
  _onOpenFile = onOpenFile;
  _onNewFile = onNewFile;
}

export function setWelcomeRecentCallback(cb: (idx: number) => void): void {
  _onRecentItem = cb;
}

function onOpenFolderClick(): void { _onOpenFolder(); }
function onOpenFileClick(): void { _onOpenFile(); }
function onNewFileClick(): void { _onNewFile(); }

// Deferred recent item click (Perry closures capture by value)
let pendingWelcomeRecentIdx: number = -1;

function onWelcomeRecentClick(idx: number): void {
  pendingWelcomeRecentIdx = idx;
  setTimeout(() => { onWelcomeRecentDeferred(); }, 0);
}

function onWelcomeRecentDeferred(): void {
  const idx = pendingWelcomeRecentIdx;
  if (idx < 0) return;
  pendingWelcomeRecentIdx = -1;
  _onRecentItem(idx);
}

/** Extract display name from path (last segment). */
function getDisplayName(path: string): string {
  let lastSlash = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path.charCodeAt(i) === 47 || path.charCodeAt(i) === 92) {
      lastSlash = i;
      break;
    }
  }
  if (lastSlash >= 0) return path.slice(lastSlash + 1);
  return path;
}

export function createWelcomeContent(colors: ResolvedUIColors): unknown {
  const titleText = Text(t('Hone IDE'));
  textSetFontSize(titleText, 24);
  textSetFontWeight(titleText, 24, 0.7);
  setFg(titleText, getEditorForeground());

  const subtitle = Text(t('A lightweight, native code editor'));
  textSetFontSize(subtitle, 14);
  setFg(subtitle, getEditorForeground());

  // Quick actions
  const actionsTitle = Text(t('Quick Actions'));
  textSetFontSize(actionsTitle, 14);
  textSetFontWeight(actionsTitle, 14, 0.6);
  setFg(actionsTitle, getEditorForeground());

  const openFolderBtn = Button(t('Open Folder'), () => { onOpenFolderClick(); });
  buttonSetBordered(openFolderBtn, 0);
  textSetFontSize(openFolderBtn, 13);
  setBtnFg(openFolderBtn, getEditorForeground());

  const openFileBtn = Button(t('Open File'), () => { onOpenFileClick(); });
  buttonSetBordered(openFileBtn, 0);
  textSetFontSize(openFileBtn, 13);
  setBtnFg(openFileBtn, getEditorForeground());

  const newFileBtn = Button(t('New File'), () => { onNewFileClick(); });
  buttonSetBordered(newFileBtn, 0);
  textSetFontSize(newFileBtn, 13);
  setBtnFg(newFileBtn, getEditorForeground());

  // Tips
  const tipsTitle = Text(t('Tips'));
  textSetFontSize(tipsTitle, 14);
  textSetFontWeight(tipsTitle, 14, 0.6);
  setFg(tipsTitle, getEditorForeground());

  const tip1 = Text(t('Cmd+P to quick open files'));
  textSetFontSize(tip1, 12);
  setFg(tip1, getEditorForeground());

  const tip2 = Text(t('Cmd+Shift+P for command palette'));
  textSetFontSize(tip2, 12);
  setFg(tip2, getEditorForeground());

  const tip3 = Text(t('Cmd+B to toggle sidebar'));
  textSetFontSize(tip3, 12);
  setFg(tip3, getEditorForeground());

  const content = VStackWithInsets(12, 40, 40, 40, 40);
  setBg(content, getEditorBackground());
  widgetAddChild(content, Spacer());
  widgetAddChild(content, titleText);
  widgetAddChild(content, subtitle);
  widgetAddChild(content, actionsTitle);
  widgetAddChild(content, openFolderBtn);
  widgetAddChild(content, openFileBtn);
  widgetAddChild(content, newFileBtn);

  // Recent items section
  const recentCount = getRecentCount();
  if (recentCount > 0) {
    const recentTitle = Text(t('Recent'));
    textSetFontSize(recentTitle, 14);
    textSetFontWeight(recentTitle, 14, 0.6);
    setFg(recentTitle, getEditorForeground());
    widgetAddChild(content, recentTitle);

    const maxShow = recentCount < 5 ? recentCount : 5;
    for (let i = 0; i < maxShow; i++) {
      const idx = i;
      const path = getRecentPath(i);
      const type = getRecentType(i);
      const displayName = getDisplayName(path);

      const recentBtn = Button(displayName, () => { onWelcomeRecentClick(idx); });
      buttonSetBordered(recentBtn, 0);
      textSetFontSize(recentBtn, 13);
      setBtnFg(recentBtn, getEditorForeground());

      // Icon: folder or file
      if (type > 0) {
        buttonSetImage(recentBtn, 'folder.fill');
        buttonSetImagePosition(recentBtn, 0);
        setBtnTint(recentBtn, '#E8AB53');
      } else {
        buttonSetImage(recentBtn, 'doc.text');
        buttonSetImagePosition(recentBtn, 0);
      }

      widgetAddChild(content, recentBtn);
    }
  }

  widgetAddChild(content, tipsTitle);
  widgetAddChild(content, tip1);
  widgetAddChild(content, tip2);
  widgetAddChild(content, tip3);
  widgetAddChild(content, Spacer());

  return content;
}
