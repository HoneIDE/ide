/**
 * Tab bar — extracted from render.ts.
 *
 * Manages editor tabs: open, close, switch, dirty state.
 * All state is module-level (Perry closures capture by value).
 */
import {
  VStack, HStack, Button,
  HStackWithInsets,
  textSetFontSize,
  buttonSetBordered, buttonSetImage, buttonSetImagePosition,
  widgetAddChild, widgetClearChildren, widgetSetHeight, widgetSetHugging,
  widgetSetContextMenu, menuCreate, menuAddItem,
} from 'perry/ui';
import { readFileSync } from 'fs';
import { setBg, setBtnFg, setBtnTint, getFileIcon, getFileIconColor } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

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
let tabDirty: number[] = [];
let tabSavedLengths: number[] = [];

let tabBarContainer: unknown = null;
let tabBarReady: number = 0;
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
        if (stored.charCodeAt(j) !== filePath.charCodeAt(j)) { match = 0; break; }
      }
      if (match > 0) {
        activeTabIdx = i;
        if (tabBarReady > 0) {
          applyTabColors(openTabCount);
        }
        return 1;
      }
    }
  }

  // Extract display name
  let lastSlash = -1;
  for (let i = 0; i < filePath.length; i++) {
    if (filePath.charCodeAt(i) === 47) lastSlash = i;
  }
  let displayName = filePath;
  if (lastSlash >= 0) {
    displayName = filePath.slice(lastSlash + 1);
  } else if (fileName.length > 0) {
    displayName = fileName;
  }

  // Add to tracking arrays
  openTabs[openTabCount] = filePath;
  openTabNames[openTabCount] = displayName;
  openTabCount = openTabCount + 1;
  activeTabIdx = openTabCount - 1;

  // Rebuild tab bar
  if (tabBarReady > 0) {
    rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Dirty state
// ---------------------------------------------------------------------------

/** Mark the active tab as saved with the given content length. */
export function markTabSaved(contentLength: number): void {
  if (activeTabIdx >= 0 && activeTabIdx < tabDirty.length) {
    tabDirty[activeTabIdx] = 0;
    tabSavedLengths[activeTabIdx] = contentLength;
    if (activeTabIdx < tabCloseButtons.length) {
      buttonSetImage(tabCloseButtons[activeTabIdx], 'xmark');
    }
  }
}

/** Update dirty indicator based on editor content length. */
export function updateTabDirtyIcon(contentLength: number): void {
  if (activeTabIdx < 0 || activeTabIdx >= tabDirty.length) return;
  const savedLen = tabSavedLengths[activeTabIdx];
  const wasDirty = tabDirty[activeTabIdx];
  if (contentLength !== savedLen) {
    if (wasDirty < 1) {
      tabDirty[activeTabIdx] = 1;
      if (activeTabIdx < tabCloseButtons.length) {
        buttonSetImage(tabCloseButtons[activeTabIdx], 'circle.fill');
      }
    }
  } else {
    if (wasDirty > 0) {
      tabDirty[activeTabIdx] = 0;
      if (activeTabIdx < tabCloseButtons.length) {
        buttonSetImage(tabCloseButtons[activeTabIdx], 'xmark');
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
  tabDirty = [];
  tabSavedLengths = [];
  for (let i = 0; i < count; i++) {
    const idx = i;
    const path = paths[i];
    const name = names[i];
    const tabGroup = HStackWithInsets(4, 0, 10, 0, 6);
    // File type icon
    const tabIcon = Button('', () => { onTabClickDirect(idx, path); });
    buttonSetBordered(tabIcon, 0);
    const tIcon = getFileIcon(name);
    buttonSetImage(tabIcon, tIcon);
    buttonSetImagePosition(tabIcon, 1);
    textSetFontSize(tabIcon, 11);
    const tabBtn = Button(name, () => { onTabClickDirect(idx, path); });
    buttonSetBordered(tabBtn, 0);
    textSetFontSize(tabBtn, 13);
    const closeBtn = Button('', () => { onTabClose(idx); });
    buttonSetBordered(closeBtn, 0);
    buttonSetImage(closeBtn, 'xmark');
    buttonSetImagePosition(closeBtn, 1);
    textSetFontSize(closeBtn, 9);
    widgetAddChild(tabGroup, tabIcon);
    widgetAddChild(tabGroup, tabBtn);
    widgetAddChild(tabGroup, closeBtn);

    // 2px accent bar at top of tab
    const accent = HStack(0, []);
    widgetSetHeight(accent, 2);
    widgetSetHugging(accent, 750);

    if (panelColors) {
      if (i === activeTabIdx) {
        setBtnFg(tabBtn, panelColors.tabActiveForeground);
        setBg(tabGroup, panelColors.tabActiveBackground);
        setBg(accent, panelColors.focusBorder);
      } else {
        setBtnFg(tabBtn, panelColors.tabInactiveForeground);
        setBg(tabGroup, panelColors.tabInactiveBackground);
        setBg(accent, panelColors.tabInactiveBackground);
      }
      setBtnFg(closeBtn, panelColors.tabActiveForeground);
      // Color the file icon
      const tColor = getFileIconColor(name);
      if (tColor.length > 0) {
        setBtnTint(tabIcon, tColor);
      } else {
        setBtnTint(tabIcon, panelColors.tabActiveForeground);
      }
    }

    // Wrap tab in VStack with accent bar on top
    const tabWrapper = VStack(0, [accent, tabGroup]);
    const tabMenu = menuCreate();
    menuAddItem(tabMenu, 'Close', () => { onTabClose(idx); });
    menuAddItem(tabMenu, 'Close Others', () => { closeOtherTabs(idx); });
    menuAddItem(tabMenu, 'Close All', () => { closeAllTabs(); });
    widgetSetContextMenu(tabWrapper, tabMenu);
    widgetAddChild(container, tabWrapper);
    tabBarButtons.push(tabGroup);
    tabAccentBars.push(accent);
    tabCloseButtons.push(closeBtn);
    tabDirty.push(0);
    // Initialize saved length: try to read the file length
    let savedLen = 0;
    try {
      const fc = readFileSync(path);
      savedLen = fc.length;
    } catch (e) {
      savedLen = 0;
    }
    tabSavedLengths.push(savedLen);
  }
}

function applyTabColors(count: number): void {
  if (!panelColors) return;
  for (let i = 0; i < count; i++) {
    if (i === activeTabIdx) {
      setBg(tabBarButtons[i], panelColors.tabActiveBackground);
      if (i < tabAccentBars.length) setBg(tabAccentBars[i], panelColors.focusBorder);
    } else {
      setBg(tabBarButtons[i], panelColors.tabInactiveBackground);
      if (i < tabAccentBars.length) setBg(tabAccentBars[i], panelColors.tabInactiveBackground);
    }
  }
}

/** Re-apply tab colors after theme change. */
export function applyAllTabColors(): void {
  applyTabColors(openTabCount);
}

// ---------------------------------------------------------------------------
// Tab click / close handlers
// ---------------------------------------------------------------------------

function onTabClickDirect(idx: number, path: string): void {
  activeTabIdx = idx;
  if (tabBarButtons.length > 0) {
    applyTabColors(tabBarButtons.length);
  }
  _displayCallback(path);
}

function onTabClose(idx: number): void {
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
  let j = 0;
  for (let i = 0; i < openTabCount; i++) {
    if (i === idx) continue;
    newTabs[j] = openTabs[i];
    newNames[j] = openTabNames[i];
    j = j + 1;
  }
  const newCount = j;
  openTabs = newTabs;
  openTabNames = newNames;
  openTabCount = newCount;

  if (activeTabIdx === idx) {
    if (activeTabIdx >= newCount) activeTabIdx = newCount - 1;
  } else if (activeTabIdx > idx) {
    activeTabIdx = activeTabIdx - 1;
  }

  if (tabBarReady > 0) {
    rebuildTabBarDirect(newCount, newNames, newTabs, tabBarContainer);
  }
  if (activeTabIdx >= 0 && activeTabIdx < newCount) {
    _displayCallback(newTabs[activeTabIdx]);
  }
}

function closeAllTabs(): void {
  setTimeout(() => { closeAllTabsDeferred(); }, 0);
}

function closeAllTabsDeferred(): void {
  openTabs = [];
  openTabNames = [];
  openTabCount = 0;
  activeTabIdx = 0;
  if (tabBarReady > 0) {
    widgetClearChildren(tabBarContainer);
  }
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
  _displayCallback(keptPath);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
  setBg(container, colors.tabInactiveBackground);

  // Open default tab
  openTabs = [defaultPath];
  openTabNames = [defaultName];
  openTabCount = 1;
  activeTabIdx = 0;
  rebuildTabBarDirect(openTabCount, openTabNames, openTabs, tabBarContainer);
}
