/**
 * Extensions panel — lists built-in extensions with enable/disable toggles.
 */
import {
  VStack, HStack, Text, Button, Spacer, TextField,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetSetWidth,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

// Extension enable states — individual vars (Perry no-hoist, no Map in callbacks)
let ext0on: number = 1;
let ext1on: number = 1;
let ext2on: number = 1;
let ext3on: number = 1;
let ext4on: number = 1;
let ext5on: number = 1;
let ext6on: number = 1;
let ext7on: number = 1;
let ext8on: number = 1;
let ext9on: number = 1;
let ext10on: number = 1;

// Toggle button refs
let toggleBtns: unknown[] = [];

function toggleExt(idx: number): void {
  if (idx === 0) { ext0on = ext0on > 0 ? 0 : 1; }
  if (idx === 1) { ext1on = ext1on > 0 ? 0 : 1; }
  if (idx === 2) { ext2on = ext2on > 0 ? 0 : 1; }
  if (idx === 3) { ext3on = ext3on > 0 ? 0 : 1; }
  if (idx === 4) { ext4on = ext4on > 0 ? 0 : 1; }
  if (idx === 5) { ext5on = ext5on > 0 ? 0 : 1; }
  if (idx === 6) { ext6on = ext6on > 0 ? 0 : 1; }
  if (idx === 7) { ext7on = ext7on > 0 ? 0 : 1; }
  if (idx === 8) { ext8on = ext8on > 0 ? 0 : 1; }
  if (idx === 9) { ext9on = ext9on > 0 ? 0 : 1; }
  if (idx === 10) { ext10on = ext10on > 0 ? 0 : 1; }
  updateToggleLabel(idx);
}

function isExtOn(idx: number): number {
  if (idx === 0) return ext0on;
  if (idx === 1) return ext1on;
  if (idx === 2) return ext2on;
  if (idx === 3) return ext3on;
  if (idx === 4) return ext4on;
  if (idx === 5) return ext5on;
  if (idx === 6) return ext6on;
  if (idx === 7) return ext7on;
  if (idx === 8) return ext8on;
  if (idx === 9) return ext9on;
  if (idx === 10) return ext10on;
  return 0;
}

function updateToggleLabel(idx: number): void {
  if (idx < toggleBtns.length) {
    const on = isExtOn(idx);
    if (on > 0) {
      buttonSetTitle(toggleBtns[idx], 'Disable');
    } else {
      buttonSetTitle(toggleBtns[idx], 'Enable');
    }
  }
}

export function renderExtensionsPanel(container: unknown, colors: ResolvedUIColors): void {
  const title = Text('EXTENSIONS');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  // Search field
  const search = TextField('Search extensions', (t: string) => {});
  widgetAddChild(container, search);

  // Built-in extensions
  const names = ['TypeScript', 'Python', 'Rust', 'Go', 'C/C++', 'HTML/CSS', 'JSON', 'Markdown', 'Git', 'Docker', 'TOML/YAML'];
  const descs = [
    'Language support for TypeScript and JavaScript',
    'Language support for Python',
    'Language support for Rust',
    'Language support for Go',
    'Language support for C and C++',
    'Language support for HTML and CSS',
    'JSON language support',
    'Markdown preview and editing',
    'Git integration and source control',
    'Dockerfile and compose support',
    'TOML and YAML language support',
  ];

  toggleBtns = [];
  for (let i = 0; i < names.length; i++) {
    const idx = i;
    const nameLabel = Text(names[i]);
    textSetFontSize(nameLabel, 13);
    textSetFontWeight(nameLabel, 13, 0.5);
    setFg(nameLabel, colors.sideBarForeground);

    const descLabel = Text(descs[i]);
    textSetFontSize(descLabel, 11);
    setFg(descLabel, colors.sideBarForeground);

    const on = isExtOn(i);
    let btnLabel = 'Disable';
    if (on < 1) btnLabel = 'Enable';
    const toggleBtn = Button(btnLabel, () => { toggleExt(idx); });
    buttonSetBordered(toggleBtn, 0);
    textSetFontSize(toggleBtn, 11);
    setBtnFg(toggleBtn, colors.sideBarForeground);
    toggleBtns.push(toggleBtn);

    const infoCol = VStack(1, [nameLabel, descLabel]);
    const row = HStack(8, [infoCol, Spacer(), toggleBtn]);
    widgetAddChild(container, row);
  }

  widgetAddChild(container, Spacer());
}
