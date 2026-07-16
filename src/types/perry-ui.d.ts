/**
 * Type declarations for the Perry UI module.
 * Perry provides these at compile time — this file makes TypeScript aware of them.
 */

/** Handle returned by Picker() — provides addItem/setSelected/getSelected methods. */
interface PerryPickerHandle {
  addItem(title: string): void;
  setSelected(index: number): void;
  getSelected(): number;
}

declare module 'perry/ui' {
  /** Create the application root (positional args). */
  export function App(title: string, width: number, height: number, body: unknown): void;
  /** Create the application root (object form). */
  export function App(options: { title: string; width: number; height: number; body: unknown; icon?: string }): void;

  // Layout containers
  export function VStack(spacing: number, children: unknown[]): unknown;
  export function HStack(spacing: number, children: unknown[]): unknown;
  export function VStackWithInsets(spacing: number, top: number, right: number, bottom: number, left: number): unknown;
  export function HStackWithInsets(spacing: number, top: number, right: number, bottom: number, left: number): unknown;
  export function Spacer(): unknown;
  export function ScrollView(child?: unknown): unknown;

  // Widgets
  export function Text(content: string): unknown;
  export function Button(label: string, onClick: () => void): unknown;
  export function TextField(placeholder: string, onChange: (text: string) => void): unknown;
  export function Picker(label: string, onChange: () => void, style: number): PerryPickerHandle;

  // Frame split (iOS)
  export function frameSplitCreate(initialSize?: number): unknown;
  export function frameSplitAddChild(split: unknown, child: unknown): void;

  // Text mutations
  export function textSetColor(text: unknown, r: number, g: number, b: number, a: number): void;
  export function textSetFontSize(widget: unknown, size: number): void;
  export function textSetFontWeight(widget: unknown, size: number, weight: number): void;
  /** Set the font family. Size is set separately via textSetFontSize — Perry's
   *  signature is (widget, family), unlike textSetFontWeight which takes a size.
   *  Passing an extra arg makes Perry's table dispatch silently skip the call. */
  export function textSetFontFamily(widget: unknown, family: string): void;
  export function textSetString(widget: unknown, value: string): void;
  export function textSetWraps(widget: unknown, wraps: number): void;

  // Button mutations
  export function buttonSetBordered(button: unknown, bordered: number): void;
  export function buttonSetImage(button: unknown, symbolName: string): void;
  export function buttonSetImagePosition(button: unknown, position: number): void;
  export function buttonSetTextColor(button: unknown, r: number, g: number, b: number, a: number): void;
  export function buttonSetContentTintColor(button: unknown, r: number, g: number, b: number, a: number): void;
  export function buttonSetTitle(button: unknown, title: string): void;

  // Widget mutations
  export function widgetAddChild(parent: unknown, child: unknown): void;
  export function widgetAddOverlay(parent: unknown, overlay: unknown): void;
  export function widgetSetOverlayFrame(overlay: unknown, x: number, y: number, width: number, height: number): void;
  export function widgetClearChildren(parent: unknown): void;
  export function widgetRemoveChild(parent: unknown, child: unknown): void;
  export function widgetSetBackgroundColor(widget: unknown, r: number, g: number, b: number, a: number): void;
  export function widgetSetWidth(widget: unknown, width: number): void;
  export function widgetSetHeight(widget: unknown, height: number): void;
  export function widgetSetHugging(widget: unknown, priority: number): void;
  export function widgetSetHidden(widget: unknown, hidden: number): void;
  /** Native tooltip on hover (NSView.setToolTip on macOS — VoiceOver picks it up). */
  export function widgetSetTooltip(widget: unknown, text: string): void;
  export function widgetSetContextMenu(widget: unknown, menu: unknown): void;
  export function widgetMatchParentHeight(widget: unknown): void;
  export function widgetMatchParentWidth(widget: unknown): void;

  // Stack mutations
  export function stackSetDetachesHidden(stack: unknown, detaches: number): void;
  export function stackSetDistribution(stack: unknown, distribution: number): void;

  // ScrollView mutations
  export function scrollViewSetChild(scrollView: unknown, child: unknown): void;
  /** Scroll to coordinates. */
  /** Scroll so `child` is visible. Perry's 8 platform runtimes all implement
   *  perry_ui_scrollview_scroll_to(scroll_handle, child_handle) — this 2-arg
   *  form is the real signature.
   *
   *  ⚠️ It does not currently work: Perry's dispatch table wrongly declares
   *  [Widget, F64, F64], and an arity mismatch lowers to a silent no-op. There
   *  is no (scrollView, x, y) variant to use instead — the runtime takes two
   *  handles, so a numeric x would be read as a widget. Blocked upstream; see
   *  scrollToBottom() in views/ai-chat/chat-panel.ts. */
  /** Scroll to make a widget visible. */
  export function scrollViewScrollTo(scrollView: unknown, widget: unknown): void;

  // TextField mutations
  export function textfieldSetString(field: unknown, value: string): void;
  export function textfieldFocus(field: unknown): void;
  export function textfieldBlurAll(): void;
  export function textfieldGetString(field: unknown): string;
  export function textfieldSetOnSubmit(field: unknown, onSubmit: (text: string) => void): void;
  export function textfieldSetOnFocus(field: unknown, onFocus: () => void): void;
  export function textfieldSetBorderless(field: unknown, borderless: number): void;
  export function textfieldSetBackgroundColor(field: unknown, r: number, g: number, b: number, a: number): void;
  export function textfieldSetFontSize(field: unknown, size: number): void;
  export function textfieldSetTextColor(field: unknown, r: number, g: number, b: number, a: number): void;

  // Native view embedding
  export function embedNSView(view: unknown): unknown;

  // Cross-platform clipboard. Resolves to pbcopy/pbpaste on macOS,
  // clip.exe/PowerShell on Windows, xclip on Linux. Already shipping at
  // runtime; declaration added so callers don't get noise from typecheck.
  export function clipboardWrite(text: string): void;
  export function clipboardRead(): string;

  // Dialogs
  export function openFolderDialog(callback: (path: string) => void): void;
  export function openFileDialog(callback: (path: string) => void): void;
  /** All three args are REQUIRED — Perry's table declares [Closure, Str, Str].
   *  They were marked optional here, but omitting one is an arity mismatch, and
   *  Perry lowers those to a silent no-op rather than an error: the dialog would
   *  simply never open. Pass '' rather than dropping an argument. */
  export function saveFileDialog(callback: (path: string) => void, defaultName: string, directory: string): void;
  export function pollOpenFile(): string;

  // Menu
  export function menuCreate(title?: string): unknown;
  export function menuAddItem(menu: unknown, title: string, callback: () => void, shortcut?: string): void;
  export function menuAddStandardAction(menu: unknown, title: string, selector: string, shortcut: string): void;
  export function menuClear(menu: unknown): void;
  export function menuAddSeparator(menu: unknown): void;
  export function menuAddSubmenu(menu: unknown, title: string, submenu: unknown): void;
  export function menuBarCreate(): unknown;
  export function menuBarAddMenu(bar: unknown, label: string, menu: unknown): void;
  export function menuBarAttach(bar: unknown): void;
}
