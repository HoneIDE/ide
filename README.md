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
| 3 | Editor integration | 🔜 |
| 4 | Git & source control | 🔜 |
| 5 | Search | 🔜 |
| 6 | LSP & language intelligence | 🔜 |
| 7 | Debug (DAP) | 🔜 |
| 8 | AI provider system | 🔜 |
| 9 | AI inline completion | 🔜 |
| 10 | AI chat | 🔜 |
| 11 | Terminal integration | 🔜 |
| 12 | AI agent mode | 🔜 |
| 13 | AI PR review | 🔜 |
| 14 | Extension system | 🔜 |
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

```bash
# Compile for current platform
perry compile src/app.ts --output hone-ide

# Run
./hone-ide
```

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
