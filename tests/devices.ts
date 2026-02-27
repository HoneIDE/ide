/**
 * Device presets for testing — simulates different screen sizes and platforms.
 *
 * Each preset represents a real device with its actual screen dimensions
 * (in logical points), scale factor, and platform classification.
 */

import type { PlatformContext, Platform, LayoutMode } from '../src/platform';

export interface DevicePreset {
  name: string;
  context: PlatformContext;
  expectedLayoutMode: LayoutMode;
}

function device(
  name: string,
  platform: Platform,
  width: number,
  height: number,
  scaleFactor: number,
  orientation: 'portrait' | 'landscape',
  expectedLayoutMode: LayoutMode,
): DevicePreset {
  const deviceClass =
    platform === 'macos' || platform === 'windows' || platform === 'linux' ? 'desktop' :
    platform === 'ipados' ? 'tablet' :
    platform === 'ios' ? 'phone' :
    platform === 'android' ? (Math.min(width, height) >= 600 ? 'tablet' : 'phone') :
    // web: classify by width
    width <= 767 ? 'phone' : width <= 1023 ? 'tablet' : 'desktop';

  const hasHardwareKeyboard = deviceClass === 'desktop';
  const inputMode = deviceClass === 'desktop' ? 'keyboard-mouse' as const :
    hasHardwareKeyboard ? 'touch-keyboard' as const : 'touch' as const;

  return {
    name,
    context: {
      platform,
      deviceClass,
      layoutMode: expectedLayoutMode,
      inputMode,
      screen: { width, height, scaleFactor, orientation },
      hasHardwareKeyboard,
    },
    expectedLayoutMode,
  };
}

// ---------------------------------------------------------------------------
// Phone devices — expect compact layout
// ---------------------------------------------------------------------------

export const IPHONE_SE = device(
  'iPhone SE', 'ios', 375, 667, 2, 'portrait', 'compact',
);

export const IPHONE_15 = device(
  'iPhone 15', 'ios', 393, 852, 3, 'portrait', 'compact',
);

export const IPHONE_15_PRO_MAX = device(
  'iPhone 15 Pro Max', 'ios', 430, 932, 3, 'portrait', 'compact',
);

export const ANDROID_SMALL = device(
  'Android Small (360x800)', 'android', 360, 800, 3, 'portrait', 'compact',
);

export const ANDROID_MEDIUM = device(
  'Android Medium (412x915)', 'android', 412, 915, 2.625, 'portrait', 'compact',
);

export const PIXEL_FOLD_OUTER = device(
  'Pixel Fold (outer)', 'android', 360, 832, 3, 'portrait', 'compact',
);

// ---------------------------------------------------------------------------
// Tablet devices — expect split (portrait) or full (landscape)
// ---------------------------------------------------------------------------

export const IPAD_MINI_PORTRAIT = device(
  'iPad mini (portrait)', 'ipados', 744, 1133, 2, 'portrait', 'split',
);

export const IPAD_MINI_LANDSCAPE = device(
  'iPad mini (landscape)', 'ipados', 1133, 744, 2, 'landscape', 'full',
);

export const IPAD_AIR_PORTRAIT = device(
  'iPad Air (portrait)', 'ipados', 820, 1180, 2, 'portrait', 'split',
);

export const IPAD_AIR_LANDSCAPE = device(
  'iPad Air (landscape)', 'ipados', 1180, 820, 2, 'landscape', 'full',
);

export const IPAD_PRO_13_PORTRAIT = device(
  'iPad Pro 13" (portrait)', 'ipados', 1024, 1366, 2, 'portrait', 'split',
);

export const IPAD_PRO_13_LANDSCAPE = device(
  'iPad Pro 13" (landscape)', 'ipados', 1366, 1024, 2, 'landscape', 'full',
);

export const ANDROID_TABLET_PORTRAIT = device(
  'Android Tablet (portrait)', 'android', 800, 1280, 2, 'portrait', 'split',
);

export const ANDROID_TABLET_LANDSCAPE = device(
  'Android Tablet (landscape)', 'android', 1280, 800, 2, 'landscape', 'full',
);

export const PIXEL_FOLD_INNER = device(
  'Pixel Fold (inner)', 'android', 884, 832, 2.5, 'landscape', 'split',
);

// ---------------------------------------------------------------------------
// Desktop devices — expect full layout
// ---------------------------------------------------------------------------

export const MACBOOK_AIR_13 = device(
  'MacBook Air 13"', 'macos', 1470, 956, 2, 'landscape', 'full',
);

export const MACBOOK_PRO_16 = device(
  'MacBook Pro 16"', 'macos', 1728, 1117, 2, 'landscape', 'full',
);

export const IMAC_24 = device(
  'iMac 24"', 'macos', 2560, 1440, 2, 'landscape', 'full',
);

export const WINDOWS_1080P = device(
  'Windows 1080p', 'windows', 1920, 1080, 1.25, 'landscape', 'full',
);

export const WINDOWS_1440P = device(
  'Windows 1440p', 'windows', 2560, 1440, 1.5, 'landscape', 'full',
);

export const LINUX_1080P = device(
  'Linux 1080p', 'linux', 1920, 1080, 1, 'landscape', 'full',
);

// ---------------------------------------------------------------------------
// Web breakpoints
// ---------------------------------------------------------------------------

export const WEB_MOBILE = device(
  'Web Mobile (375px)', 'web', 375, 812, 2, 'portrait', 'compact',
);

export const WEB_TABLET = device(
  'Web Tablet (768px)', 'web', 768, 1024, 2, 'portrait', 'split',
);

export const WEB_DESKTOP = device(
  'Web Desktop (1440px)', 'web', 1440, 900, 1, 'landscape', 'full',
);

export const WEB_NARROW = device(
  'Web Narrow (900px)', 'web', 900, 700, 1, 'landscape', 'split',
);

// ---------------------------------------------------------------------------
// Grouped collections for test iteration
// ---------------------------------------------------------------------------

export const PHONE_DEVICES: DevicePreset[] = [
  IPHONE_SE, IPHONE_15, IPHONE_15_PRO_MAX,
  ANDROID_SMALL, ANDROID_MEDIUM, PIXEL_FOLD_OUTER,
  WEB_MOBILE,
];

export const TABLET_DEVICES: DevicePreset[] = [
  IPAD_MINI_PORTRAIT, IPAD_MINI_LANDSCAPE,
  IPAD_AIR_PORTRAIT, IPAD_AIR_LANDSCAPE,
  IPAD_PRO_13_PORTRAIT, IPAD_PRO_13_LANDSCAPE,
  ANDROID_TABLET_PORTRAIT, ANDROID_TABLET_LANDSCAPE,
  PIXEL_FOLD_INNER,
  WEB_TABLET, WEB_NARROW,
];

export const DESKTOP_DEVICES: DevicePreset[] = [
  MACBOOK_AIR_13, MACBOOK_PRO_16, IMAC_24,
  WINDOWS_1080P, WINDOWS_1440P,
  LINUX_1080P,
  WEB_DESKTOP,
];

export const ALL_DEVICES: DevicePreset[] = [
  ...PHONE_DEVICES,
  ...TABLET_DEVICES,
  ...DESKTOP_DEVICES,
];
