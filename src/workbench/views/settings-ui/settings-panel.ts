/**
 * Settings UI panel — displays editable settings categories.
 */
import {
  VStack, HStack, Text, Button, Spacer, TextField,
  ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetSetWidth,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import { getWorkbenchSettings, updateSettings } from '../../settings';
import type { ResolvedUIColors } from '../../theme/theme-loader';

function renderSettingRow(
  container: unknown,
  colors: ResolvedUIColors,
  label: string,
  value: string,
  onChange: (text: string) => void,
): void {
  const lbl = Text(label);
  textSetFontSize(lbl, 12);
  setFg(lbl, colors.sideBarForeground);

  const field = TextField(value, onChange);
  widgetSetWidth(field, 120);

  const row = HStack(8, [lbl, Spacer(), field]);
  widgetAddChild(container, row);
}

function renderToggleRow(
  container: unknown,
  colors: ResolvedUIColors,
  label: string,
  isOn: number,
  onToggle: () => void,
): void {
  const lbl = Text(label);
  textSetFontSize(lbl, 12);
  setFg(lbl, colors.sideBarForeground);

  let btnLabel = 'Off';
  if (isOn > 0) btnLabel = 'On';
  const btn = Button(btnLabel, onToggle);
  buttonSetBordered(btn, 0);
  textSetFontSize(btn, 11);
  setBtnFg(btn, colors.sideBarForeground);

  const row = HStack(8, [lbl, Spacer(), btn]);
  widgetAddChild(container, row);
}

function renderSectionHeader(container: unknown, colors: ResolvedUIColors, title: string): void {
  const header = Text(title);
  textSetFontSize(header, 12);
  textSetFontWeight(header, 12, 0.6);
  setFg(header, colors.sideBarForeground);
  widgetAddChild(container, header);
}

export function renderSettingsPanel(container: unknown, colors: ResolvedUIColors): void {
  const title = Text('SETTINGS');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  const settings = getWorkbenchSettings();

  // Editor section
  renderSectionHeader(container, colors, 'Editor');
  renderSettingRow(container, colors, 'Font Size', '14', (t: string) => {
    const n = parseInt(t, 10);
    if (n > 0) updateSettings({ editorFontSize: n });
  });
  renderSettingRow(container, colors, 'Tab Size', '2', (t: string) => {
    const n = parseInt(t, 10);
    if (n > 0) updateSettings({ editorTabSize: n });
  });

  // Workbench section
  renderSectionHeader(container, colors, 'Workbench');
  renderSettingRow(container, colors, 'Sidebar Location', settings.sidebarLocation, (t: string) => {
    if (t === 'left' || t === 'right') updateSettings({ sidebarLocation: t });
  });
  renderSettingRow(container, colors, 'Color Theme', settings.colorTheme, (t: string) => {
    updateSettings({ colorTheme: t });
  });

  // AI section
  renderSectionHeader(container, colors, 'AI');
  renderSettingRow(container, colors, 'Provider', 'anthropic', (t: string) => {});
  renderSettingRow(container, colors, 'Model', 'claude-sonnet-4-6', (t: string) => {});

  // Files section
  renderSectionHeader(container, colors, 'Files');
  renderSettingRow(container, colors, 'Auto Save', 'off', (t: string) => {});
  renderSettingRow(container, colors, 'Exclude', '.git,node_modules', (t: string) => {});

  widgetAddChild(container, Spacer());
}
