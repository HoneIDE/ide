/**
 * Extensions panel — lists built-in extensions with enable/disable toggles.
 *
 * Built-in extensions are always visible. Plugin management UI is gated
 * behind the __plugins__ compile-time flag (only present when compiled
 * with `perry compile --features plugins`).
 */
import {
  VStack, HStack, Text, Button, Spacer, TextField,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetSetWidth,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getWorkbenchSettings, setNumberSetting } from '../../settings';

declare const __plugins__: number;

// Extension enable states — individual vars (Perry no-hoist, no Map in callbacks)
// SHIP-V1-GAPS.md #57: extension-enable flags persisted as a bitmask in
// settings (`extensionsEnabledMask`). Decoded on first read; encoded on toggle.
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
let _enableMaskLoaded: number = 0;

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
  persistEnabledMask();
}

function decodeEnabledMask(mask: number): void {
  ext0on = (mask & 1) > 0 ? 1 : 0;
  ext1on = (mask & 2) > 0 ? 1 : 0;
  ext2on = (mask & 4) > 0 ? 1 : 0;
  ext3on = (mask & 8) > 0 ? 1 : 0;
  ext4on = (mask & 16) > 0 ? 1 : 0;
  ext5on = (mask & 32) > 0 ? 1 : 0;
  ext6on = (mask & 64) > 0 ? 1 : 0;
  ext7on = (mask & 128) > 0 ? 1 : 0;
  ext8on = (mask & 256) > 0 ? 1 : 0;
  ext9on = (mask & 512) > 0 ? 1 : 0;
  ext10on = (mask & 1024) > 0 ? 1 : 0;
}

function encodeEnabledMask(): number {
  let m = 0;
  if (ext0on > 0) m += 1;
  if (ext1on > 0) m += 2;
  if (ext2on > 0) m += 4;
  if (ext3on > 0) m += 8;
  if (ext4on > 0) m += 16;
  if (ext5on > 0) m += 32;
  if (ext6on > 0) m += 64;
  if (ext7on > 0) m += 128;
  if (ext8on > 0) m += 256;
  if (ext9on > 0) m += 512;
  if (ext10on > 0) m += 1024;
  return m;
}

function persistEnabledMask(): void {
  setNumberSetting('extensionsEnabledMask', encodeEnabledMask());
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
      buttonSetTitle(toggleBtns[idx], t('Disable'));
    } else {
      buttonSetTitle(toggleBtns[idx], t('Enable'));
    }
  }
}

export function renderExtensionsPanel(container: unknown, colors: ResolvedUIColors): void {
  // SHIP-V1-GAPS.md #57: hydrate ext on/off from the bitmask setting on first
  // mount. Toggles persist via `setNumberSetting('extensionsEnabledMask', …)`.
  if (_enableMaskLoaded < 1) {
    decodeEnabledMask(getWorkbenchSettings().extensionsEnabledMask);
    _enableMaskLoaded = 1;
  }
  const title = Text(t('EXTENSIONS'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  // Search field
  const search = TextField(t('Search extensions'), (txt: string) => {});
  widgetAddChild(container, search);

  // Built-in extensions
  const names = [t('TypeScript'), t('Python'), t('Rust'), t('Go'), t('C/C++'), t('HTML/CSS'), t('JSON'), t('Markdown'), t('Git'), t('Docker'), t('TOML/YAML')];
  const descs = [
    t('Language support for TypeScript and JavaScript'),
    t('Language support for Python'),
    t('Language support for Rust'),
    t('Language support for Go'),
    t('Language support for C and C++'),
    t('Language support for HTML and CSS'),
    t('JSON language support'),
    t('Markdown preview and editing'),
    t('Git integration and source control'),
    t('Dockerfile and compose support'),
    t('TOML and YAML language support'),
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
    let btnLabel = t('Disable');
    if (on < 1) btnLabel = t('Enable');
    const toggleBtn = Button(btnLabel, () => { toggleExt(idx); });
    buttonSetBordered(toggleBtn, 0);
    textSetFontSize(toggleBtn, 11);
    setBtnFg(toggleBtn, colors.sideBarForeground);
    toggleBtns.push(toggleBtn);

    const infoCol = VStack(1, [nameLabel, descLabel]);
    const row = HStack(8, [infoCol, Spacer(), toggleBtn]);
    widgetAddChild(container, row);
  }

  // Plugin management section — only when compiled with --features plugins
  if (__plugins__) {
    const pluginHeader = Text(t('INSTALLED PLUGINS'));
    textSetFontSize(pluginHeader, 11);
    textSetFontWeight(pluginHeader, 11, 0.7);
    setFg(pluginHeader, colors.sideBarForeground);
    widgetAddChild(container, pluginHeader);

    const noPlugins = Text(t('No plugins installed'));
    textSetFontSize(noPlugins, 11);
    setFg(noPlugins, colors.sideBarForeground);
    widgetAddChild(container, noPlugins);
  }

  widgetAddChild(container, Spacer());
}
