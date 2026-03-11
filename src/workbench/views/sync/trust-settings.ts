/**
 * Trust Settings — per-source trust level configuration UI.
 *
 * Shows connected/paired devices with trust level selection:
 * review, auto-accept-clean, auto-accept-all, block.
 *
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight,
  textSetString, textSetColor,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetClearChildren,
  widgetSetBackgroundColor, widgetSetWidth,
} from 'perry/ui';
import { setFg, setBtnFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

// --- Module-level state ---

let trustContainer: unknown = null;
let trustColors: ResolvedUIColors = null as any;
let trustPanelReady: number = 0;

// Trust data (parallel arrays — Perry-safe)
let trustSourceIds: string[] = [];
let trustSourceNames: string[] = [];
let trustLevels: string[] = [];  // 'review' | 'auto-accept-clean' | 'auto-accept-all' | 'block'
let trustCount: number = 0;

// Default trust level
let defaultTrustLevel = 'review';

// Callback when trust changes
let _onTrustChanged: (sourceId: string, level: string) => void = _noopTrust;
let _onDefaultChanged: (level: string) => void = _noopDefault;

function _noopTrust(id: string, level: string): void {}
function _noopDefault(level: string): void {}

const TRUST_LABELS: string[] = ['review', 'auto-accept-clean', 'auto-accept-all', 'block'];
const TRUST_DISPLAY: string[] = ['Review', 'Auto (clean)', 'Auto (all)', 'Block'];

// --- Public API ---

export function buildTrustSettings(colors: ResolvedUIColors): unknown {
  trustColors = colors;

  const title = Text('Trust Settings');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.6);
  setFg(title, colors.sideBarForeground);

  const desc = Text('Configure how changes from each source are handled');
  textSetFontSize(desc, 10);
  textSetColor(desc, 0.5, 0.5, 0.5, 1.0);

  trustContainer = VStack(4, []);

  const panel = VStack(8, [title, desc, trustContainer]);
  trustPanelReady = 1;
  refreshTrustPanel();
  return panel;
}

export function setTrustColors(colors: ResolvedUIColors): void {
  trustColors = colors;
}

export function setTrustCallbacks(
  onChanged: (sourceId: string, level: string) => void,
  onDefault: (level: string) => void,
): void {
  _onTrustChanged = onChanged;
  _onDefaultChanged = onDefault;
}

export function setTrustSources(
  sourceIds: string[],
  sourceNames: string[],
  levels: string[],
): void {
  trustSourceIds = sourceIds;
  trustSourceNames = sourceNames;
  trustLevels = levels;
  trustCount = sourceIds.length;
  refreshTrustPanel();
}

export function setDefaultTrust(level: string): void {
  defaultTrustLevel = level;
  refreshTrustPanel();
}

function refreshTrustPanel(): void {
  if (trustPanelReady === 0) return;
  if (!trustContainer) return;

  widgetClearChildren(trustContainer);

  // Default trust level row
  const defaultLabel = Text('Default trust level:');
  textSetFontSize(defaultLabel, 11);
  if (trustColors) setFg(defaultLabel, trustColors.sideBarForeground);

  const defaultValueLabel = Text(getDisplayForLevel(defaultTrustLevel));
  textSetFontSize(defaultValueLabel, 11);
  textSetFontWeight(defaultValueLabel, 11, 0.6);
  if (trustColors) setFg(defaultValueLabel, trustColors.sideBarForeground);

  const cycleDefaultBtn = Button('Change', () => { cycleDefaultTrust(); });
  buttonSetBordered(cycleDefaultBtn, 0);
  if (trustColors) setBtnFg(cycleDefaultBtn, trustColors.buttonForeground);

  const defaultRow = HStack(8, [defaultLabel, defaultValueLabel, Spacer(), cycleDefaultBtn]);
  widgetAddChild(trustContainer, defaultRow);

  // Per-source entries
  if (trustCount === 0) {
    const emptyLabel = Text('No paired devices');
    textSetFontSize(emptyLabel, 12);
    textSetColor(emptyLabel, 0.5, 0.5, 0.5, 1.0);
    widgetAddChild(trustContainer, emptyLabel);
    return;
  }

  for (let i = 0; i < trustCount; i++) {
    const row = buildTrustRow(i);
    widgetAddChild(trustContainer, row);
  }
}

function buildTrustRow(idx: number): unknown {
  const name = trustSourceNames[idx];
  const level = trustLevels[idx];

  const nameLabel = Text(name);
  textSetFontSize(nameLabel, 12);
  if (trustColors) setFg(nameLabel, trustColors.sideBarForeground);

  const levelLabel = Text(getDisplayForLevel(level));
  textSetFontSize(levelLabel, 10);
  applyLevelColor(levelLabel, level);

  const cycleBtn = Button('Change', () => { cycleTrustLevel(idx); });
  buttonSetBordered(cycleBtn, 0);
  if (trustColors) setBtnFg(cycleBtn, trustColors.buttonForeground);

  const row = HStack(8, [nameLabel, levelLabel, Spacer(), cycleBtn]);
  if (trustColors) {
    widgetSetBackgroundColor(row,
      (trustColors.editorBackground as unknown as number[])[0] || 0.15,
      (trustColors.editorBackground as unknown as number[])[1] || 0.15,
      (trustColors.editorBackground as unknown as number[])[2] || 0.15,
      1.0);
  }
  return row;
}

function cycleTrustLevel(idx: number): void {
  if (idx < 0 || idx >= trustCount) return;
  const current = trustLevels[idx];
  const nextLevel = getNextLevel(current);
  trustLevels[idx] = nextLevel;
  _onTrustChanged(trustSourceIds[idx], nextLevel);
  refreshTrustPanel();
}

function cycleDefaultTrust(): void {
  defaultTrustLevel = getNextLevel(defaultTrustLevel);
  _onDefaultChanged(defaultTrustLevel);
  refreshTrustPanel();
}

function getNextLevel(current: string): string {
  for (let i = 0; i < TRUST_LABELS.length; i++) {
    if (TRUST_LABELS[i] === current) {
      return TRUST_LABELS[(i + 1) % TRUST_LABELS.length];
    }
  }
  return 'review';
}

function getDisplayForLevel(level: string): string {
  for (let i = 0; i < TRUST_LABELS.length; i++) {
    if (TRUST_LABELS[i] === level) return TRUST_DISPLAY[i];
  }
  return 'Review';
}

function applyLevelColor(widget: unknown, level: string): void {
  if (level === 'auto-accept-clean') {
    textSetColor(widget, 0.3, 0.7, 0.3, 1.0); // green
  } else if (level === 'auto-accept-all') {
    textSetColor(widget, 0.3, 0.5, 0.9, 1.0); // blue
  } else if (level === 'block') {
    textSetColor(widget, 0.8, 0.3, 0.3, 1.0); // red
  } else {
    textSetColor(widget, 0.6, 0.6, 0.6, 1.0); // gray for review
  }
}
