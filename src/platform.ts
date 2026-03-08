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

// Compile-time platform ID injected by Perry codegen:
// 0 = macOS, 1 = iOS, 2 = Android, 3 = Windows, 4 = Linux, 5 = Web
declare const __platform__: number;

// Screen detection FFI — implemented in perry-ui-ios (and perry-ui-gtk4, web).
// Returns real values on iOS; stubs return TAG_UNDEF on platforms without implementation.
declare function perry_get_screen_width(): number;
declare function perry_get_screen_height(): number;
declare function perry_get_scale_factor(): number;
declare function perry_get_orientation(): string;
declare function perry_on_layout_change(callback: () => void): void;
declare function perry_get_device_idiom(): number;

export function detectPlatform(): Platform {
  if (__platform__ === 0) return 'macos';
  if (__platform__ === 1) {
    // Use UIDevice.userInterfaceIdiom to distinguish iPhone from iPad.
    // UIScreen.mainScreen.bounds returns 320x480 on iPad before scene connection,
    // so we can't rely on screen dimensions during early init.
    const idiom = perry_get_device_idiom();
    if (idiom === 1) return 'ipados'; // UIUserInterfaceIdiomPad
    return 'ios';
  }
  if (__platform__ === 2) return 'android';
  if (__platform__ === 3) return 'windows';
  if (__platform__ === 4) return 'linux';
  if (__platform__ === 5) return 'web';
  return 'macos'; // default for unknown
}

export function detectScreen(): ScreenInfo {
  // Call platform FFI — on platforms without real implementation, stubs return TAG_UNDEF (NaN).
  const w = perry_get_screen_width();
  const h = perry_get_screen_height();
  const s = perry_get_scale_factor();
  // Validate — NaN and 0 both fail the > 0 check.
  // Also reject 320x480 on iPad (UIScreen.mainScreen returns bogus values before scene connection).
  let validScreen = 0;
  if (w > 0) {
    if (h > 0) {
      // On iPad, reject 320x480 (pre-scene default)
      if (__platform__ === 1) {
        const idiom = perry_get_device_idiom();
        if (idiom === 1) {
          // iPad: only accept if short side >= 600
          const short = w < h ? w : h;
          if (short >= 600) {
            validScreen = 1;
          }
        } else {
          validScreen = 1;
        }
      } else {
        validScreen = 1;
      }
    }
  }
  if (validScreen > 0) {
    let orient: Orientation = 'portrait';
    if (w > h) {
      orient = 'landscape';
    }
    return {
      width: w,
      height: h,
      scaleFactor: s > 0 ? s : 2,
      orientation: orient,
    };
  }
  // Platform-appropriate defaults (FFI unavailable or returned invalid values)
  if (__platform__ === 1) {
    const idiom = perry_get_device_idiom();
    if (idiom === 1) {
      // iPad default (1024×1366 = iPad Air 13" portrait)
      return { width: 1024, height: 1366, scaleFactor: 2, orientation: 'portrait' };
    }
    // iPhone default (393×852 = iPhone 15)
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
    // iPad landscape has enough room for full workbench layout
    if (screen.orientation === 'landscape') return 'full';
    // iPad portrait: split layout (sidebar + editor side by side)
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
// PlatformContext -- observable state
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

// Numeric getters — cross-module string returns are broken in Perry iOS.
// Return numbers that the caller maps to strings in the same module.
// Layout: 0=compact, 1=split, 2=full
export function getLayoutModeNum(): number {
  const ctx = getPlatformContext();
  if (ctx.layoutMode === 'compact') return 0;
  if (ctx.layoutMode === 'split') return 1;
  return 2;
}

// Device: 0=phone, 1=tablet, 2=desktop
export function getDeviceClassNum(): number {
  const ctx = getPlatformContext();
  if (ctx.deviceClass === 'phone') return 0;
  if (ctx.deviceClass === 'tablet') return 1;
  return 2;
}

export function getScreenWidth(): number {
  const ctx = getPlatformContext();
  return ctx.screen.width;
}

export function getScreenHeight(): number {
  const ctx = getPlatformContext();
  return ctx.screen.height;
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
