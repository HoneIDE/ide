/**
 * Tab bar — extracted from render.ts.
 *
 * Manages editor tabs: open, close, switch, dirty state.
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, Button, Spacer,
  HStackWithInsets,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetImagePosition,
  widgetAddChild, widgetClearChildren, widgetSetWidth, widgetSetHeight, widgetSetHugging,
  widgetSetBackgroundColor,
  widgetSetContextMenu, menuCreate, menuAddItem,
} from 'perry/ui';
import { readFileSync } from 'fs';
import { setBg, setBtnFg, setBtnTint, getFileIcon, getFileIconColor, setIconButton } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getTabActiveForeground, getTabActiveBackground, getTabInactiveForeground, getTabInactiveBackground, getTabBorder, getFocusBorder } from '../../theme/theme-colors';
import { setStringSetting, setNumberSetting } from '../../settings';

// ---------------------------------------------------------------------------
// Module-level state (must be declared BEFORE any function — Perry no-hoist)
// ---------------------------------------------------------------------------

let openTabs: string[] = [];
let openTabNames: string[] = [];
let openTabCount: number = 0;
let activeTabIdx = 0;

let tabBarButtons: unknown[] = [];
let tabAccentBars: unknown[] = [];
let tabCloseButtons: unknown[] = [];
let tabLabelButtons: unknown[] = [];
let tabIconButtons: unknown[] = [];
let tabDirty: number[] = [];
let tabSavedLengths: number[] = [];
// SHIP-V1-GAPS.md #26: per-tab pinned flag. Parallel array to openTabs/Names.
// Pinned tabs always render before unpinned ones; persisted via settings.
let tabPinned: number[] = [];

let tabBarContainer: unknown = null;
let tabBarReady: number = 0;
let tabBarRestoring: number = 0;
let panelColors: ResolvedUIColors = null as any;

let pendingTabClickIdx: number = -1;
let pendingTabCloseIdx: number = -1;
let pendingCloseOthersIdx: number = -1;

// External callbacks
let _displayCallback: (path: string) => void = _noopDisplay;

function _noopDisplay(_p: string): void {}

// ---------------------------------------------------------------------------
// Setter functions (wired by render.ts)
// ---------------------------------------------------------------------------

export function setTabDisplayCallback(cb: (path: string) => void): void {
  _displayCallback = cb;
}

export function setTabThemeColors(colors: ResolvedUIColors): void {
  panelColors = colors;
}

// ---------------------------------------------------------------------------
// Tab data accessors
// ---------------------------------------------------------------------------

export function getActiveTabPath(): string {
  if (activeTabIdx >= 0 && activeTabIdx < openTabCount) {
    return openTabs[activeTabIdx];
  }
  return '';
}

export function getActiveTabIdx(): number {
  return activeTabIdx;
}

export function getTabCount(): number {
  return openTabCount;
}

export function getOpenTabCount(): number {
  return openTabCount;
}

export function getOpenTabPath(idx: number): string {
  if (idx >= 0 && idx < openTabCount) {
    return openTabs[idx];
  }
  return '';
}

export function setActiveTabByIndex(idx: number): void {
  if (idx >= 0 && idx < openTabCount) {
    activeTabIdx = idx;
    if (tabBarReady > 0) {
      applyTabColors(openTabCount);
    }
  }
}

/**
 * Open a tab for the given file. If already open, switch to it.
 * Returns 1 if the tab was already open, 0 if newly added.
 */
export function openTab(filePath: string, fileName: string): number {
  // Check if already open (use length + charCodeAt — Perry === can fail for array strings)
  for (let i = 0; i < openTabCount; i++) {
    const stored = openTabs[i];
    if (stored.length === filePath.length && stored.length > 0) {
      let match = 1;
      for (let j = 0; j < stored.length; j++) {
        if (stored.charCodeAt(j) !== filePath.charCodeAt(j)) {
          match = 0; break;
        }
      }
      if (match > 0) {
        activeTabIdx = i;
        if (tabBarReady > 0) {
          applyTabColors(openTabCount);
        }
        persistTabState();
        return 1;
      }
    }
  }

  // Extract display name. Accept '/' (47) AND '\' (92): Windows OS paths
  // are backslash-delimited, so a /-only scan left lastSlash=-1 and the
  // tab showed the entire `C:\Users\…\foo.ts` (the `fileName` fallback
  // below only saved it when a caller happened to pass one — load-bearing
  // by accident). Now the primary extraction works on Windows directly.
  let lastSlash = -1;
  for (let i = 0; i < filePath.length; i++) {
    const c = filePath.charCodeAt(i);
    if (c === 47 || c === 92) lastSlash = i;
  }
  let displayName = filePath;
  if (lastSlash >= 0) {
    displayName = filePath.slice(lastSlash + 1);
  } else if (fileName.length > 0) {
    displayName = fileName;
  }

  // Add to tracking arrays — use .push() (Perry AOT indexed assignment broken)
  openTabs.push(filePath);
  openTabNames.push(displayName);
  tabPinned.push(0);
  openTabCount = openTabCount + 1;
  activeTabIdx = openTabCount - 1;

  // Rebuild tab bar
  if (tabBarReady > 0) {
    rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);
  }
  persistTabState();
  return 0;
}

// ---------------------------------------------------------------------------
// Dirty state
// ---------------------------------------------------------------------------

/** Returns 1 if the tab at `idx` is currently flagged dirty (unsaved). */
export function isTabDirty(idx: number): number {
  if (idx < 0 || idx >= tabDirty.length) return 0;
  return tabDirty[idx];
}

/** Mark the active tab as saved with the given content length. */
export function markTabSaved(contentLength: number): void {
  if (activeTabIdx >= 0 && activeTabIdx < tabDirty.length) {
    tabDirty[activeTabIdx] = 0;
    tabSavedLengths[activeTabIdx] = contentLength;
    if (activeTabIdx < tabCloseButtons.length) {
      setIconButton(tabCloseButtons[activeTabIdx], 'xmark');
      textSetFontSize(tabCloseButtons[activeTabIdx], 9);
    }
  }
}

/** Update dirty indicator based on editor content length. */
export function updateTabDirtyIcon(contentLength: number): void {
  if (activeTabIdx < 0 || activeTabIdx >= tabDirty.length) return;
  const savedLen = tabSavedLengths[activeTabIdx];
  // First check after tab open — initialize saved length, don't mark dirty
  if (savedLen < 0) {
    tabSavedLengths[activeTabIdx] = contentLength;
    return;
  }
  const wasDirty = tabDirty[activeTabIdx];
  if (contentLength !== savedLen) {
    if (wasDirty < 1) {
      tabDirty[activeTabIdx] = 1;
      if (activeTabIdx < tabCloseButtons.length) {
        setIconButton(tabCloseButtons[activeTabIdx], 'circle.fill');
        textSetFontSize(tabCloseButtons[activeTabIdx], 6);
      }
    }
  } else {
    if (wasDirty > 0) {
      tabDirty[activeTabIdx] = 0;
      if (activeTabIdx < tabCloseButtons.length) {
        setIconButton(tabCloseButtons[activeTabIdx], 'xmark');
        textSetFontSize(tabCloseButtons[activeTabIdx], 9);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tab bar rendering
// ---------------------------------------------------------------------------

function rebuildTabBarDirect(count: number, names: string[], paths: string[], container: unknown): void {
  widgetClearChildren(container);
  tabBarButtons = [];
  tabAccentBars = [];
  tabCloseButtons = [];
  tabLabelButtons = [];
  tabIconButtons = [];
  tabDirty = [];
  tabSavedLengths = [];

  // SHIP-V1-GAPS.md #26: build tab wrappers in source order so the parallel
  // state arrays (`tabBarButtons[srcIdx]` etc.) stay source-indexed —
  // `applyTabColors` reads them by source idx. The render order (pinned
  // first, unpinned next) is applied at addChild time below.
  const wrappers: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const idx = i;
    const path = paths[i];
    const name = names[i];
    const isPinned = idx < tabPinned.length && tabPinned[idx] > 0 ? 1 : 0;
    // VS Code-like tab padding: spacing=5, top=10, right=10, bottom=10, left=12
    const tabGroup = HStackWithInsets(5, 10, 10, 10, 12);
    // File type icon
    const tabIcon = Button('', () => { onTabClickDirect(idx, path); });
    buttonSetBordered(tabIcon, 0);
    const tIcon = getFileIcon(name);
    setIconButton(tabIcon, tIcon);
    buttonSetImagePosition(tabIcon, 1);
    textSetFontSize(tabIcon, 12);
    const tabBtn = Button(name, () => { onTabClickDirect(idx, path); });
    buttonSetBordered(tabBtn, 0);
    textSetFontSize(tabBtn, 13);
    const closeBtn = Button('', () => { onTabClose(idx); });
    buttonSetBordered(closeBtn, 0);
    setIconButton(closeBtn, 'xmark');
    buttonSetImagePosition(closeBtn, 1);
    textSetFontSize(closeBtn, 9);
    widgetSetWidth(closeBtn, 16);
    widgetSetHeight(closeBtn, 16);
    widgetAddChild(tabGroup, tabIcon);
    widgetAddChild(tabGroup, tabBtn);
    widgetAddChild(tabGroup, closeBtn);

    // 2px accent bar at bottom of active tab (VS Code style)
    const accent = HStack(0, []);
    widgetSetHeight(accent, 2);
    widgetSetHugging(accent, 750);

    // Apply colors from theme
    if (i === activeTabIdx) {
      setBtnFg(tabBtn, getTabActiveForeground());
      setBg(tabGroup, getTabActiveBackground());
      // Blue accent bar
      setBg(accent, getFocusBorder());
      setBtnFg(closeBtn, getTabActiveForeground());
    } else {
      setBtnFg(tabBtn, getTabInactiveForeground());
      setBg(tabGroup, getTabInactiveBackground());
      // No accent bar
      widgetSetBackgroundColor(accent, 0.0, 0.0, 0.0, 0.0);
      setBtnFg(closeBtn, getTabInactiveForeground());
    }
    // Color the file icon
    const tColor = getFileIconColor(name);
    if (tColor.length > 0) {
      setBtnTint(tabIcon, tColor);
    } else {
      if (i === activeTabIdx) {
        setBtnTint(tabIcon, getTabActiveForeground());
      } else {
        setBtnTint(tabIcon, getTabInactiveForeground());
      }
    }

    // SHIP-V1-GAPS.md #26: pinned tabs get a leading pin glyph in front of
    // the file icon. Cheaper than swapping the icon since the file icon
    // still helps users identify the file.
    if (isPinned > 0) {
      setIconButton(tabIcon, 'pin.fill');
    }

    // Wrap tab in VStack with accent bar at bottom (VS Code style)
    const tabWrapper = VStack(0, [tabGroup, accent]);
    const tabMenu = menuCreate();
    if (isPinned > 0) {
      menuAddItem(tabMenu, 'Unpin Tab', () => { unpinTab(idx); });
    } else {
      menuAddItem(tabMenu, 'Pin Tab', () => { pinTab(idx); });
    }
    menuAddItem(tabMenu, 'Close', () => { onTabClose(idx); });
    menuAddItem(tabMenu, 'Close Others', () => { closeOtherTabs(idx); });
    menuAddItem(tabMenu, 'Close All', () => { closeAllTabs(); });
    widgetSetContextMenu(tabWrapper, tabMenu);

    tabBarButtons.push(tabGroup);
    tabAccentBars.push(accent);
    tabCloseButtons.push(closeBtn);
    tabLabelButtons.push(tabBtn);
    tabIconButtons.push(tabIcon);
    tabDirty.push(0);
    tabSavedLengths.push(-1);
    wrappers.push(tabWrapper);
  }

  // SHIP-V1-GAPS.md #26: addChild order is pinned-first then unpinned, both
  // in source-insertion order. Keeps the active-tab idx and the parallel
  // state arrays source-indexed.
  const renderOrder: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i < tabPinned.length && tabPinned[i] > 0) renderOrder.push(i);
  }
  for (let i = 0; i < count; i++) {
    if (i >= tabPinned.length || tabPinned[i] < 1) renderOrder.push(i);
  }
  for (let r = 0; r < renderOrder.length; r++) {
    widgetAddChild(container, wrappers[renderOrder[r]]);
    if (r < renderOrder.length - 1) {
      const sep = VStack(0, []);
      widgetSetWidth(sep, 1);
      setBg(sep, getTabBorder());
      widgetAddChild(container, sep);
    }
  }
  // Push tabs to the left — spacer fills remaining width
  widgetAddChild(container, Spacer());
}

function applyTabColors(count: number): void {
  for (let i = 0; i < count; i++) {
    if (i === activeTabIdx) {
      setBg(tabBarButtons[i], getTabActiveBackground());
      if (i < tabAccentBars.length) setBg(tabAccentBars[i], getFocusBorder());
      if (i < tabLabelButtons.length) setBtnFg(tabLabelButtons[i], getTabActiveForeground());
      if (i < tabCloseButtons.length) setBtnFg(tabCloseButtons[i], getTabActiveForeground());
      if (i < tabIconButtons.length) {
        const n = openTabNames[i];
        const c = getFileIconColor(n);
        if (c.length < 1) {
          setBtnTint(tabIconButtons[i], getTabActiveForeground());
        }
      }
    } else {
      setBg(tabBarButtons[i], getTabInactiveBackground());
      if (i < tabAccentBars.length) widgetSetBackgroundColor(tabAccentBars[i], 0.0, 0.0, 0.0, 0.0);
      if (i < tabLabelButtons.length) setBtnFg(tabLabelButtons[i], getTabInactiveForeground());
      if (i < tabCloseButtons.length) setBtnFg(tabCloseButtons[i], getTabInactiveForeground());
      if (i < tabIconButtons.length) {
        const n = openTabNames[i];
        const c = getFileIconColor(n);
        if (c.length < 1) {
          setBtnTint(tabIconButtons[i], getTabInactiveForeground());
        }
      }
    }
  }
}

/** Re-apply tab colors after theme change. */
export function applyAllTabColors(): void {
  applyTabColors(openTabCount);
}

/** Suppress persistence during tab restore. */
export function setTabBarRestoring(val: number): void {
  tabBarRestoring = val;
}

// SHIP-V1-GAPS.md #26: pin / unpin a tab. Pinned tabs render before unpinned
// ones on the next rebuild; the persisted bitmask survives across restarts.
export function pinTab(idx: number): void {
  if (idx < 0 || idx >= openTabCount) return;
  while (tabPinned.length <= idx) tabPinned.push(0);
  tabPinned[idx] = 1;
  if (tabBarReady > 0) rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);
  persistTabState();
}

export function unpinTab(idx: number): void {
  if (idx < 0 || idx >= tabPinned.length) return;
  tabPinned[idx] = 0;
  if (tabBarReady > 0) rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);
  persistTabState();
}

export function isTabPinned(idx: number): number {
  if (idx < 0 || idx >= tabPinned.length) return 0;
  return tabPinned[idx];
}

/** Persist open tabs to settings (pipe-separated paths). */
function persistTabState(): void {
  if (tabBarReady < 1) return;
  if (tabBarRestoring > 0) return;
  let joined = '';
  for (let i = 0; i < openTabCount; i++) {
    if (i > 0) joined += '|';
    joined += openTabs[i];
  }
  setStringSetting('lastOpenTabs', joined);
  setNumberSetting('lastActiveTab', activeTabIdx);
  // SHIP-V1-GAPS.md #26: pin mask — string of '1'/'0' chars, one per tab.
  let pinMask = '';
  for (let i = 0; i < openTabCount; i++) {
    const p = i < tabPinned.length && tabPinned[i] > 0 ? '1' : '0';
    pinMask += p;
  }
  setStringSetting('lastPinnedTabs', pinMask);
}

// ---------------------------------------------------------------------------
// Tab click / close handlers
// ---------------------------------------------------------------------------

function onTabClickDirect(idx: number, path: string): void {
  activeTabIdx = idx;
  if (tabBarButtons.length > 0) {
    applyTabColors(tabBarButtons.length);
  }
  persistTabState();
  _displayCallback(path);
}

// SHIP-V1-GAPS.md #91: before-close hook. Host installs a function that
// returns 1 (cancel) when the user should be prompted (e.g. unsaved edits) —
// the host is responsible for any UI and re-invoking `forceCloseTab(idx)`
// after the user picks Save or Discard.
let _onBeforeTabClose: (idx: number, path: string) => number = _alwaysAllow;
function _alwaysAllow(_idx: number, _path: string): number { return 0; }

export function setOnBeforeTabClose(fn: (idx: number, path: string) => number): void {
  _onBeforeTabClose = fn;
}

function onTabClose(idx: number): void {
  // Run the guard synchronously before deferring — that way the host has
  // a chance to put up its confirm dialog before the close runs.
  if (idx >= 0 && idx < openTabCount) {
    const path = openTabs[idx];
    if (_onBeforeTabClose(idx, path) > 0) return;
  }
  pendingTabCloseIdx = idx;
  setTimeout(() => { onTabCloseDeferred(); }, 0);
}

/** Force-close a tab without invoking the beforeClose guard. Used by the
 *  host once it has confirmed the user wants to discard or has saved. */
export function forceCloseTab(idx: number): void {
  pendingTabCloseIdx = idx;
  setTimeout(() => { onTabCloseDeferred(); }, 0);
}

function onTabCloseDeferred(): void {
  const idx = pendingTabCloseIdx;
  if (idx < 0) return;
  pendingTabCloseIdx = -1;
  if (openTabCount < 2) return;
  const newTabs: string[] = [];
  const newNames: string[] = [];
  const newPinned: number[] = [];
  for (let i = 0; i < openTabCount; i++) {
    if (i === idx) continue;
    newTabs.push(openTabs[i]);
    newNames.push(openTabNames[i]);
    newPinned.push(i < tabPinned.length ? tabPinned[i] : 0);
  }
  const newCount = newTabs.length;
  openTabs = newTabs;
  openTabNames = newNames;
  tabPinned = newPinned;
  openTabCount = newCount;

  if (activeTabIdx === idx) {
    if (activeTabIdx >= newCount) activeTabIdx = newCount - 1;
  } else if (activeTabIdx > idx) {
    activeTabIdx = activeTabIdx - 1;
  }

  if (tabBarReady > 0) {
    rebuildTabBarDirect(newCount, newNames, newTabs, tabBarContainer);
  }
  persistTabState();
  if (activeTabIdx >= 0 && activeTabIdx < newCount) {
    _displayCallback(newTabs[activeTabIdx]);
  }
}

function closeAllTabs(): void {
  setTimeout(() => { closeAllTabsDeferred(); }, 0);
}

export function closeAllOpenTabs(): void {
  closeAllTabsDeferred();
}

function closeAllTabsDeferred(): void {
  openTabs = [];
  openTabNames = [];
  openTabCount = 0;
  activeTabIdx = 0;
  if (tabBarReady > 0) {
    widgetClearChildren(tabBarContainer);
  }
  persistTabState();
  _displayCallback('');
}

function closeOtherTabs(keepIdx: number): void {
  pendingCloseOthersIdx = keepIdx;
  setTimeout(() => { closeOtherTabsDeferred(); }, 0);
}

function closeOtherTabsDeferred(): void {
  const keepIdx = pendingCloseOthersIdx;
  if (keepIdx < 0) return;
  pendingCloseOthersIdx = -1;
  if (keepIdx >= openTabCount) return;
  const keptPath = openTabs[keepIdx];
  const keptName = openTabNames[keepIdx];
  openTabs = [keptPath];
  openTabNames = [keptName];
  openTabCount = 1;
  activeTabIdx = 0;
  if (tabBarReady > 0) {
    rebuildTabBarDirect(1, openTabNames, openTabs, tabBarContainer);
  }
  persistTabState();
  _displayCallback(keptPath);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Rename the active tab's path and display name, then rebuild UI. */
export function renameActiveTab(newPath: string, newName: string): void {
  if (activeTabIdx < 0 || activeTabIdx >= openTabCount) return;
  openTabs[activeTabIdx] = newPath;
  openTabNames[activeTabIdx] = newName;
  if (tabBarReady > 0) {
    rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);
  }
}

/** Close the active tab. */
export function closeActiveTab(): void {
  if (openTabCount < 1) return;
  onTabClose(activeTabIdx);
}

/** Initialize the tab bar into the given container. */
export function initTabBar(container: unknown, colors: ResolvedUIColors, defaultPath: string, defaultName: string): void {
  panelColors = colors;
  tabBarContainer = container;
  tabBarReady = 1;
  setBg(container, getTabBorder());

  // Open default tab — skip rebuild for bisect
  openTabs = [defaultPath];
  openTabNames = [defaultName];
  openTabCount = 1;
  activeTabIdx = 0;
  rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);
}
