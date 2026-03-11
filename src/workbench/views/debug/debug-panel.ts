/**
 * Debug panel stub — placeholder until DAP wiring is done.
 */
import {
  VStack, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetImage, buttonSetImagePosition,
} from 'perry/ui';
import { setFg, setBtnFg, setBtnTint } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getStatusAddedColor, getStatusDeletedColor } from '../../theme/theme-colors';
import { widgetAddChild } from 'perry/ui';

export function renderDebugPanel(container: unknown, colors: ResolvedUIColors): void {
  const title = Text('RUN AND DEBUG');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  // Toolbar row
  const playBtn = Button('', () => {});
  buttonSetBordered(playBtn, 0);
  buttonSetImage(playBtn, 'play.fill');
  buttonSetImagePosition(playBtn, 1);
  setBtnTint(playBtn, getStatusAddedColor());

  const pauseBtn = Button('', () => {});
  buttonSetBordered(pauseBtn, 0);
  buttonSetImage(pauseBtn, 'pause.fill');
  buttonSetImagePosition(pauseBtn, 1);
  setBtnTint(pauseBtn, colors.sideBarForeground);

  const stepOverBtn = Button('', () => {});
  buttonSetBordered(stepOverBtn, 0);
  buttonSetImage(stepOverBtn, 'arrow.right');
  buttonSetImagePosition(stepOverBtn, 1);
  setBtnTint(stepOverBtn, colors.sideBarForeground);

  const stepIntoBtn = Button('', () => {});
  buttonSetBordered(stepIntoBtn, 0);
  buttonSetImage(stepIntoBtn, 'arrow.down.right');
  buttonSetImagePosition(stepIntoBtn, 1);
  setBtnTint(stepIntoBtn, colors.sideBarForeground);

  const stepOutBtn = Button('', () => {});
  buttonSetBordered(stepOutBtn, 0);
  buttonSetImage(stepOutBtn, 'arrow.up.left');
  buttonSetImagePosition(stepOutBtn, 1);
  setBtnTint(stepOutBtn, colors.sideBarForeground);

  const stopBtn = Button('', () => {});
  buttonSetBordered(stopBtn, 0);
  buttonSetImage(stopBtn, 'stop.fill');
  buttonSetImagePosition(stopBtn, 1);
  setBtnTint(stopBtn, getStatusDeletedColor());

  const toolbar = HStack(4, [playBtn, pauseBtn, stepOverBtn, stepIntoBtn, stepOutBtn, stopBtn]);
  widgetAddChild(container, toolbar);

  // Sections
  const bpHeader = Text('BREAKPOINTS');
  textSetFontSize(bpHeader, 10);
  textSetFontWeight(bpHeader, 10, 0.6);
  setFg(bpHeader, colors.sideBarForeground);
  widgetAddChild(container, bpHeader);

  const bpHint = Text('No breakpoints set');
  textSetFontSize(bpHint, 12);
  setFg(bpHint, colors.sideBarForeground);
  widgetAddChild(container, bpHint);

  const varHeader = Text('VARIABLES');
  textSetFontSize(varHeader, 10);
  textSetFontWeight(varHeader, 10, 0.6);
  setFg(varHeader, colors.sideBarForeground);
  widgetAddChild(container, varHeader);

  const varHint = Text('Not paused');
  textSetFontSize(varHint, 12);
  setFg(varHint, colors.sideBarForeground);
  widgetAddChild(container, varHint);

  const csHeader = Text('CALL STACK');
  textSetFontSize(csHeader, 10);
  textSetFontWeight(csHeader, 10, 0.6);
  setFg(csHeader, colors.sideBarForeground);
  widgetAddChild(container, csHeader);

  const csHint = Text('Not paused');
  textSetFontSize(csHint, 12);
  setFg(csHint, colors.sideBarForeground);
  widgetAddChild(container, csHint);

  widgetAddChild(container, Spacer());
}
