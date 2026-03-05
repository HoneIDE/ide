/**
 * Terminal panel stub — placeholder for terminal embedding.
 */
import {
  VStack, Text, Spacer,
  textSetFontSize, textSetFontWeight,
  widgetAddChild,
} from 'perry/ui';
import { setFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

export function renderTerminalPanel(container: unknown, colors: ResolvedUIColors): void {
  const title = Text('TERMINAL');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  const hint = Text('Terminal panel — press Cmd+J to toggle');
  textSetFontSize(hint, 12);
  setFg(hint, colors.sideBarForeground);
  widgetAddChild(container, hint);

  widgetAddChild(container, Spacer());
}
