/**
 * Perry compiler configuration for hone-ide.
 *
 * hone-ide is a Perry application (not a library). It uses perry/ui widgets
 * for layout and embeds @honeide/editor and @honeide/terminal components
 * which bring their own native FFI crates.
 *
 * Build commands:
 *   perry compile src/app.ts --target macos
 *   perry compile src/app.ts --target windows
 *   perry compile src/app.ts --target linux
 *   perry compile src/app.ts --target ios
 *   perry compile src/app.ts --target android
 *   perry compile src/app.ts --target web
 */

export default {
  name: '@honeide/ide',
  version: '0.1.0',
  entry: 'src/app.ts',
  perry: '0.4.40',

  targets: {
    // Icon: every platform uses the same source PNG at the repo root.
    // Perry's per-platform icon generation (icns / ico / xcassets / android
    // mipmap set) reads from this source. Per-platform paths to pre-built
    // icons can be added back here once the `assets/` directory is populated
    // — until then we point everyone at hone-icon.png (matches perry.toml).
    macos: {
      arch: ['arm64', 'x86_64'],
      minOs: '13.0',
      appBundle: {
        identifier: 'com.hone.ide',
        name: 'Hone',
        icon: 'hone-icon.png',
      },
    },
    ios: {
      arch: ['arm64'],
      minOs: '16.0',
      appBundle: {
        identifier: 'com.hone.ide',
        name: 'Hone',
        icon: 'hone-icon.png',
        orientations: ['portrait', 'landscapeLeft', 'landscapeRight'],
        supportsMultitasking: true,
        supportsMultipleWindows: true,
      },
    },
    windows: {
      arch: ['x86_64', 'aarch64'],
      minOs: '10.0.17763',
      appBundle: {
        identifier: 'com.hone.ide',
        name: 'Hone',
        icon: 'hone-icon.png',
      },
    },
    linux: {
      arch: ['x86_64', 'aarch64'],
      appBundle: {
        identifier: 'com.hone.ide',
        name: 'Hone',
        icon: 'hone-icon.png',
      },
    },
    android: {
      arch: ['arm64-v8a', 'armeabi-v7a', 'x86_64'],
      minSdk: 26,
      appBundle: {
        identifier: 'com.hone.ide',
        name: 'Hone',
        icon: 'hone-icon.png',
      },
    },
    web: {
      wasmTarget: 'wasm32-unknown-unknown',
      wasmBindgen: true,
      optimizeSize: true,
    },
  },

  compiler: {
    stripDebug: true,
    lto: true,
    rustEdition: '2021',
  },

  dev: {
    defaultTarget: 'linux',
    hotReload: true,
  },
};
