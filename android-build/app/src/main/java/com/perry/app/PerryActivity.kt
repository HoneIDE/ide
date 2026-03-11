package com.perry.app

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.FrameLayout
import java.io.File

/**
 * Minimal Activity that hosts a Perry-compiled native UI.
 *
 * Lifecycle:
 * 1. onCreate: create root FrameLayout, init PerryBridge, spawn native thread
 * 2. Native thread runs the compiled TypeScript (which creates widgets via JNI)
 * 3. Native thread calls App() which blocks forever
 * 4. onDestroy: signal native thread to unpark and exit
 */
class PerryActivity : Activity() {

    private lateinit var rootLayout: FrameLayout
    private var nativeThread: Thread? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        rootLayout = FrameLayout(this)
        setContentView(rootLayout)

        // Initialize the bridge with this Activity
        PerryBridge.init(this, rootLayout)

        // Create sample workspace for demo
        createSampleWorkspace()

        // Load native libraries — dependencies first, then the main Perry app
        System.loadLibrary("hone_editor_android")
        System.loadLibrary("perry_app")

        // Initialize JNI cache on the UI thread first
        PerryBridge.nativeInit()

        // Spawn native init thread — this runs the compiled TypeScript main()
        nativeThread = Thread {
            // This calls the entry point of the compiled TypeScript.
            // It will create widgets via JNI, then call App() which blocks.
            PerryBridge.nativeMain()
        }.apply {
            name = "perry-native"
            isDaemon = true
            start()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 43) { // LOCATION_PERMISSION_REQUEST
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            PerryBridge.onLocationPermissionResult(granted)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        PerryBridge.nativeShutdown()
    }

    private fun createSampleWorkspace() {
        val workspace = File(filesDir, "workspace/src")
        if (!workspace.exists()) workspace.mkdirs()

        val appTs = File(workspace, "app.ts")
        if (!appTs.exists()) {
            appTs.writeText("""
import { App, VStack, HStack, Text, Button, Spacer } from 'perry/ui';
import { textSetColor, textSetFontSize, buttonSetBordered } from 'perry/ui';

// Hone IDE — Mobile Code Editor
const VERSION = '1.0.0';
const DESCRIPTION = 'A native code editor for every platform';

interface EditorConfig {
  fontSize: number;
  theme: string;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
}

const defaultConfig: EditorConfig = {
  fontSize: 14,
  theme: 'hone-dark',
  tabSize: 2,
  wordWrap: true,
  minimap: false,
};

class EditorState {
  private config: EditorConfig;
  private lineCount: number = 0;

  constructor(config: EditorConfig) {
    this.config = config;
  }

  getTheme(): string {
    return this.config.theme;
  }

  setFontSize(size: number): void {
    this.config.fontSize = size;
  }
}

function createStatusBar(state: EditorState): unknown {
  const theme = Text(state.getTheme());
  textSetFontSize(theme, 11);
  const info = Text('TypeScript | UTF-8 | LF');
  textSetFontSize(info, 11);
  return HStack(8, [theme, Spacer(), info]);
}

export function main(): void {
  const state = new EditorState(defaultConfig);
  const header = Text('Hone IDE v' + VERSION);
  textSetFontSize(header, 18);
  const desc = Text(DESCRIPTION);
  textSetFontSize(desc, 13);

  const openBtn = Button('Open File', () => {});
  buttonSetBordered(openBtn, 0);

  const statusBar = createStatusBar(state);
  const layout = VStack(12, [header, desc, openBtn, Spacer(), statusBar]);
  App(layout);
}
""".trimIndent())
        }

        val platformTs = File(workspace, "platform.ts")
        if (!platformTs.exists()) {
            platformTs.writeText("""
// Platform detection for Hone IDE
// __platform__: 0=macOS, 1=iOS, 2=Android, 3=Windows, 4=Linux

export type LayoutMode = 'full' | 'split' | 'compact';

export function getLayoutMode(): LayoutMode {
  if (__platform__ === 0 || __platform__ === 3 || __platform__ === 4) {
    return 'full';
  }
  return 'compact';
}

export function isMobile(): boolean {
  return __platform__ === 1 || __platform__ === 2;
}

export function isDesktop(): boolean {
  return !isMobile();
}
""".trimIndent())
        }
    }
}
