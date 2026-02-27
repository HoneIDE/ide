/**
 * Platform detection and layout mode selection.
 *
 * Detects the current platform, screen dimensions, and determines
 * which layout mode to use. Provides a reactive LayoutContext that
 * components subscribe to for adaptive rendering.
 */

// Perry platform detection APIs
declare function perry_get_platform(): string;
declare function perry_get_screen_width(): number;
declare function perry_get_screen_height(): number;
declare function perry_get_scale_factor(): number;
declare function perry_has_hardware_keyboard(): boolean;
declare function perry_get_orientation(): string;
declare function perry_on_resize(callback: (width: number, height: number) => void): void;
declare function perry_on_orientation_change(callback: (orientation: string) => void): void;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Platform =
  | 'macos'
  | 'windows'
  | 'linux'
  | 'ios'
  | 'ipados'
  | 'android'
  | 'web';

export type DeviceClass = 'desktop' | 'tablet' | 'phone';

export type LayoutMode = 'full' | 'split' | 'compact';

export type Orientation = 'portrait' | 'landscape';

export type InputMode = 'keyboard-mouse' | 'touch' | 'touch-keyboard';

export interface ScreenInfo {
  /** Logical width in points. */
  width: number;
  /** Logical height in points. */
  height: number;
  /** Device pixel ratio (e.g. 2.0 on Retina). */
  scaleFactor: number;
  orientation: Orientation;
}

export interface PlatformContext {
  platform: Platform;
  deviceClass: DeviceClass;
  layoutMode: LayoutMode;
  inputMode: InputMode;
  screen: ScreenInfo;
  hasHardwareKeyboard: boolean;
}

// ---------------------------------------------------------------------------
// Layout mode breakpoints (in logical points)
// ---------------------------------------------------------------------------

/** Below this width, use compact (phone) layout. */
const COMPACT_MAX_WIDTH = 767;

/** Below this width, use split (tablet portrait) layout. */
const SPLIT_MAX_WIDTH = 1023;

// Above SPLIT_MAX_WIDTH → full workbench layout.

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function detectPlatform(): Platform {
  try {
    const p = perry_get_platform();
    if (p === 'macos' || p === 'windows' || p === 'linux' ||
        p === 'ios' || p === 'ipados' || p === 'android' || p === 'web') {
      return p as Platform;
    }
  } catch {
    // Fallback for test environment
  }
  return 'web';
}

export function detectScreen(): ScreenInfo {
  try {
    const w = perry_get_screen_width();
    const h = perry_get_screen_height();
    const s = perry_get_scale_factor();
    const o = perry_get_orientation();
    return {
      width: w,
      height: h,
      scaleFactor: s,
      orientation: o === 'landscape' ? 'landscape' : 'portrait',
    };
  } catch {
    // Default for test/web environment
    return { width: 1440, height: 900, scaleFactor: 2, orientation: 'landscape' };
  }
}

export function detectHasHardwareKeyboard(): boolean {
  try {
    return perry_has_hardware_keyboard();
  } catch {
    return true;
  }
}

export function classifyDevice(platform: Platform, screen: ScreenInfo): DeviceClass {
  if (platform === 'macos' || platform === 'windows' || platform === 'linux') {
    return 'desktop';
  }
  if (platform === 'ipados') {
    return 'tablet';
  }
  if (platform === 'ios') {
    return 'phone';
  }
  if (platform === 'android') {
    // Android: use screen size to distinguish phone from tablet
    const shortSide = Math.min(screen.width, screen.height);
    return shortSide >= 600 ? 'tablet' : 'phone';
  }
  // Web: classify by viewport width
  if (screen.width <= COMPACT_MAX_WIDTH) return 'phone';
  if (screen.width <= SPLIT_MAX_WIDTH) return 'tablet';
  return 'desktop';
}

export function selectLayoutMode(
  deviceClass: DeviceClass,
  screen: ScreenInfo,
): LayoutMode {
  if (deviceClass === 'phone') {
    return 'compact';
  }
  if (deviceClass === 'tablet') {
    // Tablet in landscape with sufficient width gets full layout.
    // Narrow landscape or any portrait gets split.
    if (screen.orientation === 'landscape' && screen.width > SPLIT_MAX_WIDTH) {
      return 'full';
    }
    return 'split';
  }
  // Desktop + web wide
  if (screen.width <= COMPACT_MAX_WIDTH) return 'compact';
  if (screen.width <= SPLIT_MAX_WIDTH) return 'split';
  return 'full';
}

export function detectInputMode(
  deviceClass: DeviceClass,
  hasHardwareKeyboard: boolean,
): InputMode {
  if (deviceClass === 'desktop') return 'keyboard-mouse';
  if (hasHardwareKeyboard) return 'touch-keyboard';
  return 'touch';
}

// ---------------------------------------------------------------------------
// PlatformContext — observable state
// ---------------------------------------------------------------------------

type Listener = (ctx: PlatformContext) => void;

let _current: PlatformContext | null = null;
const _listeners: Set<Listener> = new Set();

export function getPlatformContext(): PlatformContext {
  if (!_current) {
    _current = buildContext();
    installNativeListeners();
  }
  return _current;
}

/**
 * Override the platform context (for testing). Pass `null` to reset.
 */
export function setPlatformContextOverride(ctx: PlatformContext | null): void {
  _current = ctx;
  if (ctx) notifyListeners();
}

export function onPlatformContextChange(listener: Listener): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

function buildContext(): PlatformContext {
  const platform = detectPlatform();
  const screen = detectScreen();
  const hasHardwareKeyboard = detectHasHardwareKeyboard();
  const deviceClass = classifyDevice(platform, screen);
  const layoutMode = selectLayoutMode(deviceClass, screen);
  const inputMode = detectInputMode(deviceClass, hasHardwareKeyboard);

  return { platform, deviceClass, layoutMode, inputMode, screen, hasHardwareKeyboard };
}

function notifyListeners(): void {
  if (!_current) return;
  for (const fn of _listeners) {
    fn(_current);
  }
}

function installNativeListeners(): void {
  try {
    perry_on_resize((width, height) => {
      if (!_current) return;
      const screen: ScreenInfo = { ..._current.screen, width, height };
      const deviceClass = classifyDevice(_current.platform, screen);
      const layoutMode = selectLayoutMode(deviceClass, screen);
      _current = { ..._current, screen, deviceClass, layoutMode };
      notifyListeners();
    });

    perry_on_orientation_change((orientation) => {
      if (!_current) return;
      const o: Orientation = orientation === 'landscape' ? 'landscape' : 'portrait';
      const screen: ScreenInfo = { ..._current.screen, orientation: o };
      const layoutMode = selectLayoutMode(_current.deviceClass, screen);
      _current = { ..._current, screen, layoutMode };
      notifyListeners();
    });
  } catch {
    // Native listeners not available (test/web fallback)
  }
}

// ---------------------------------------------------------------------------
// Constants for touch target sizing
// ---------------------------------------------------------------------------

/** Minimum touch target size in logical points (Apple HIG + Material). */
export const MIN_TOUCH_TARGET = 44;

/** Minimum spacing between interactive elements on touch devices. */
export const MIN_TOUCH_SPACING = 8;
