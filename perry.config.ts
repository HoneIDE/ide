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
  perry: '0.2.162',

  targets: {
    macos: {
      arch: ['arm64', 'x86_64'],
      minOs: '13.0',
      appBundle: {
        identifier: 'dev.hone.ide',
        name: 'Hone',
        icon: 'assets/icon.icns',
      },
    },
    ios: {
      arch: ['arm64'],
      minOs: '16.0',
      appBundle: {
        identifier: 'dev.hone.ide',
        name: 'Hone',
        icon: 'assets/icon.xcassets',
        orientations: ['portrait', 'landscapeLeft', 'landscapeRight'],
        supportsMultitasking: true,
        supportsMultipleWindows: true,
      },
    },
    windows: {
      arch: ['x86_64', 'aarch64'],
      minOs: '10.0.17763',
      appBundle: {
        identifier: 'dev.hone.ide',
        name: 'Hone',
        icon: 'assets/icon.ico',
      },
    },
    linux: {
      arch: ['x86_64', 'aarch64'],
      appBundle: {
        identifier: 'dev.hone.ide',
        name: 'Hone',
        icon: 'assets/icon.svg',
        desktopFile: 'assets/hone.desktop',
      },
    },
    android: {
      arch: ['arm64-v8a', 'armeabi-v7a', 'x86_64'],
      minSdk: 26,
      appBundle: {
        identifier: 'dev.hone.ide',
        name: 'Hone',
        icon: 'assets/icon-android/',
      },
    },
    web: {
      wasmTarget: 'wasm32-unknown-unknown',
      wasmBindgen: true,
      optimizeSize: true,
      spa: {
        index: 'assets/index.html',
        serviceWorker: true,
      },
    },
  },

  compiler: {
    stripDebug: true,
    lto: true,
    rustEdition: '2021',
  },

  dev: {
    defaultTarget: 'macos',
    hotReload: true,
  },
};
