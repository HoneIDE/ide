/**
 * Platform detection and layout mode selection.
 *
 * Detects the current platform, screen dimensions, and determines
 * which layout mode to use. Provides a reactive LayoutContext that
 * components subscribe to for adaptive rendering.
 */

// Platform detection: on Windows we know the platform at compile time.
// The perry_get_* FFI functions are not available on all platforms,
// so we use compile-time defaults for Windows builds.

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
  // Hardcoded for Windows build — perry_get_platform() FFI not available
  return 'windows';
}

export function detectScreen(): ScreenInfo {
  try {
    const w = perry_get_screen_width();
    const h = perry_get_screen_height();
    const s = perry_get_scale_factor();
    const o = perry_get_orientation();
    // Validate — if FFI stubs returned 0, fall through to defaults
    if (w > 0 && h > 0) {
      return {
        width: w,
        height: h,
        scaleFactor: s > 0 ? s : 2,
        orientation: o === 'landscape' ? 'landscape' : 'portrait',
      };
    }
  } catch {
    // FFI not available
  }
  // Platform-appropriate defaults
  if (__platform__ === 1) {
    // iOS (iPhone) — compact portrait
    return { width: 393, height: 852, scaleFactor: 3, orientation: 'portrait' };
  }
  // Desktop fallback
  return { width: 1440, height: 900, scaleFactor: 2, orientation: 'landscape' };
}

export function detectHasHardwareKeyboard(): boolean {
  return true;
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
  // Desktop: always full layout (macOS, Windows, Linux)
  if (deviceClass === 'desktop') return 'full';
  // Web: use viewport width for responsive layout
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
  // perry_on_resize / perry_on_orientation_change FFI not available on Windows yet.
  // TODO: Implement via Win32 WM_SIZE / WM_DISPLAYCHANGE messages.
}

// ---------------------------------------------------------------------------
// Constants for touch target sizing
// ---------------------------------------------------------------------------

/** Minimum touch target size in logical points (Apple HIG + Material). */
export const MIN_TOUCH_TARGET = 44;

/** Minimum spacing between interactive elements on touch devices. */
export const MIN_TOUCH_SPACING = 8;
