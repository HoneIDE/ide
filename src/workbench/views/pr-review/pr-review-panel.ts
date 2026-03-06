/**
 * PR Review panel — lists pull requests and shows AI review annotations.
 */
import {
  VStack, HStack, Text, Button, Spacer, TextField,
  ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString,
  buttonSetBordered,
  widgetAddChild, widgetClearChildren,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

let prContainer: unknown = null;
let prColors: ResolvedUIColors = null as any;
let tokenField: unknown = null;
let tokenValue = '';

function onTokenInput(text: string): void {
  tokenValue = text;
}

function onLoadPRs(): void {
  if (!prContainer || !prColors) return;
  if (tokenValue.length < 1) return;
  widgetClearChildren(prContainer);

  const loading = Text('Loading pull requests...');
  textSetFontSize(loading, 12);
  setFg(loading, prColors.sideBarForeground);
  widgetAddChild(prContainer, loading);

  // Actual API call would go here via execSync('curl ...')
  // For now, show placeholder
  widgetClearChildren(prContainer);
  const hint = Text('PR list will appear when GitHub API is connected');
  textSetFontSize(hint, 12);
  setFg(hint, prColors.sideBarForeground);
  widgetAddChild(prContainer, hint);
}

export function renderPRReviewPanel(container: unknown, colors: ResolvedUIColors): void {
  prColors = colors;

  const title = Text('PULL REQUESTS');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  // Token input
  const tokenLabel = Text('GitHub Token');
  textSetFontSize(tokenLabel, 12);
  setFg(tokenLabel, colors.sideBarForeground);
  widgetAddChild(container, tokenLabel);

  tokenField = TextField('ghp_...', (text: string) => { onTokenInput(text); });
  widgetAddChild(container, tokenField);

  const loadBtn = Button('Load PRs', () => { onLoadPRs(); });
  buttonSetBordered(loadBtn, 0);
  textSetFontSize(loadBtn, 12);
  setBtnFg(loadBtn, colors.sideBarForeground);
  widgetAddChild(container, loadBtn);

  // PR list container
  prContainer = VStack(4, []);
  widgetAddChild(container, prContainer);

  const hint = Text('Configure GitHub token to view pull requests');
  textSetFontSize(hint, 12);
  setFg(hint, colors.sideBarForeground);
  widgetAddChild(prContainer, hint);

  widgetAddChild(container, Spacer());
}
