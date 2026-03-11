# Hone IDE

AI-native code editor for all platforms — macOS, Windows, Linux, iOS, iPadOS, Android, Web.

Built with [Perry](https://github.com/perry-lang/perry): TypeScript compiled to native UI.
Powered by [@honeide/core](https://github.com/HoneIDE/core) for all headless services.

**hone.codes** · [Website](https://hone.codes)

---

## What it is

Hone is an IDE designed from the ground up for AI-assisted development:

- **Native on every platform** — one TypeScript codebase, compiled to native UI via Perry
- **Mobile-first** — full IDE experience on iPad and Android tablet; focused editing on iPhone/Android phone
- **AI-native** — inline completions, chat sidebar, autonomous agent mode, AI PR review
- **Fully customizable** — sidebar left or right, activity bar position, keybindings, themes

## Status

| Slice | Feature | Status |
|-------|---------|--------|
| 0 | Workbench shell, theme engine | ✅ |
| 1 | Workspace & file explorer | ✅ |
| 2 | Settings, keybindings, onboarding | ✅ |
| 3 | Editor integration | ✅ |
| 4 | Git & source control | ✅ |
| 5 | Search | ✅ |
| 6 | LSP & language intelligence | ✅ |
| 7 | Debug (DAP) | ✅ |
| 8 | AI provider system | ✅ |
| 9 | AI inline completion | ✅ |
| 10 | AI chat | ✅ |
| 11 | Terminal integration | ✅ |
| 12 | AI agent mode | ✅ |
| 13 | AI PR review | ✅ |
| 14 | Extension system | ✅ |
| 15 | Polish & packaging | 🔜 |

## Architecture

```
hone-ide/
├── src/
│   ├── app.ts                    # Perry entry point
│   ├── platform.ts               # Platform detection (macOS/iOS/Android/Web)
│   ├── commands.ts               # Built-in command registrations
│   ├── keybindings.ts            # Default keybindings per platform
│   ├── menu.ts                   # Application menu (desktop) / action sheet (mobile)
│   ├── window.ts                 # Window management
│   └── workbench/
│       ├── render.ts             # Main workbench renderer
│       ├── settings.ts           # Runtime workbench settings
│       ├── layout/
│       │   ├── grid.ts           # Resizable split panel engine
│       │   ├── tab-manager.ts    # Editor tab management
│       │   ├── panel-registry.ts # Panel registration
│       │   └── activity-bar.ts   # Activity bar / bottom nav
│       ├── theme/
│       │   ├── theme-loader.ts   # Load & resolve theme colors
│       │   ├── builtin-themes.ts # Bundled themes (Hone Dark, ...)
│       │   └── token-theme.ts    # TextMate token color resolution
│       └── views/                # (coming: explorer, git, search, AI chat, ...)
```

## Building

Perry compiler required. Install from [perry-lang.dev](https://perry-lang.dev).

### macOS

```bash
perry compile src/app.ts --output hone-ide
./hone-ide
```

### Windows

```bash
perry compile src/app.ts --target windows --output hone-ide
mv hone-ide hone-ide.exe
./hone-ide.exe
```

### iOS Simulator

```bash
perry compile src/app.ts --target ios-simulator --output Hone
xcrun simctl install booted Hone.app
xcrun simctl launch booted com.hone.ide
```

### iOS Device (no Xcode project needed)

Requires: Apple Developer account, `codesign` identity, and a provisioning profile.

**One-time setup** — generate a provisioning profile:

```bash
# Create a stub Xcode project to trigger automatic provisioning
mkdir -p /tmp/HoneSigner/Sources
cat > /tmp/HoneSigner/Sources/main.swift <<< 'import UIKit'
cat > /tmp/HoneSigner/project.yml << 'EOF'
name: HoneSigner
targets:
  Hone:
    type: application
    platform: iOS
    deploymentTarget: "17.0"
    sources: [{ path: Sources }]
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.hone.ide
        DEVELOPMENT_TEAM: YOUR_TEAM_ID
        CODE_SIGN_STYLE: Automatic
        GENERATE_INFOPLIST_FILE: YES
EOF
cd /tmp/HoneSigner && xcodegen generate
xcodebuild build -project HoneSigner.xcodeproj -scheme Hone \
  -destination "generic/platform=iOS" -allowProvisioningUpdates
```

This builds a throwaway app but downloads the provisioning profile you need. Find it in the built `.app`:

```bash
BUILT_APP=$(find ~/Library/Developer/Xcode/DerivedData/HoneSigner-*/Build/Products -name "Hone.app" -type d | head -1)
```

**Build, sign, and deploy:**

```bash
# 1. Build for device (run from the Perry repo root so it finds libraries)
cd /path/to/perry
perry compile /path/to/hone-ide/src/app.ts --target ios --output /path/to/hone-ide/Hone

# 2. Embed provisioning profile
cp "$BUILT_APP/embedded.mobileprovision" Hone.app/embedded.mobileprovision

# 3. Sign
codesign --force --sign "Apple Development: Your Name (XXXXXXXXXX)" \
  --entitlements <(cat << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>application-identifier</key>
    <string>YOUR_TEAM_ID.com.hone.ide</string>
    <key>com.apple.developer.team-identifier</key>
    <string>YOUR_TEAM_ID</string>
    <key>get-task-allow</key>
    <true/>
</dict>
</plist>
EOF
) --timestamp=none Hone.app

# 4. Install and launch
DEVICE_ID=$(xcrun devicectl list devices 2>&1 | grep "iPhone" | grep "available" | awk '{print $5}')
xcrun devicectl device install app --device "$DEVICE_ID" Hone.app
xcrun devicectl device process launch --device "$DEVICE_ID" com.hone.ide
```

Replace `YOUR_TEAM_ID` with your Apple Developer Team ID and the signing identity with your certificate name (find with `security find-identity -v -p codesigning`).

## Platform layout modes

| Mode | Platforms | Layout |
|------|-----------|--------|
| Full workbench | Desktop, iPad landscape | Activity bar + sidebar + editor + panels |
| Split | iPad portrait, Android tablet | Narrow sidebar + editor |
| Compact | iPhone, Android phone | Single panel, bottom tab bar |

## Customization

Settings are respected at runtime:

```typescript
import { updateSettings } from './workbench/settings';

// Move explorer to the right
updateSettings({ sidebarLocation: 'right' });

// Change theme
updateSettings({ colorTheme: 'Hone Light' });
```

Full settings UI in Slice 2.

## License

MIT
