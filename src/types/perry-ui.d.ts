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
  export function textSetFontFamily(widget: unknown, size: number, family: string): void;
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
  export function widgetSetContextMenu(widget: unknown, menu: unknown): void;
  export function widgetMatchParentHeight(widget: unknown): void;
  export function widgetMatchParentWidth(widget: unknown): void;

  // Stack mutations
  export function stackSetDetachesHidden(stack: unknown, detaches: number): void;
  export function stackSetDistribution(stack: unknown, distribution: number): void;

  // ScrollView mutations
  export function scrollViewSetChild(scrollView: unknown, child: unknown): void;
  /** Scroll to coordinates. */
  export function scrollViewScrollTo(scrollView: unknown, x: number, y: number): void;
  /** Scroll to make a widget visible. */
  export function scrollViewScrollTo(scrollView: unknown, widget: unknown): void;

  // TextField mutations
  export function textfieldSetString(field: unknown, value: string): void;
  export function textfieldFocus(field: unknown): void;
  export function textfieldBlurAll(): void;
  export function textfieldGetString(field: unknown): string;
  export function textfieldSetOnSubmit(field: unknown, onSubmit: (text: string) => void): void;
  export function textfieldSetOnFocus(field: unknown, onFocus: () => void): void;

  // Native view embedding
  export function embedNSView(view: unknown): unknown;

  // Dialogs
  export function openFolderDialog(callback: (path: string) => void): void;
  export function openFileDialog(callback: (path: string) => void): void;
  export function saveFileDialog(callback: (path: string) => void, defaultName?: string, directory?: string): void;
  export function pollOpenFile(): string;

  // Menu
  export function menuCreate(title?: string): unknown;
  export function menuAddItem(menu: unknown, title: string, callback: () => void, shortcut?: string): void;
  export function menuAddSeparator(menu: unknown): void;
  export function menuAddSubmenu(menu: unknown, title: string, submenu: unknown): void;
  export function menuBarCreate(): unknown;
  export function menuBarAddMenu(bar: unknown, label: string, menu: unknown): void;
  export function menuBarAttach(bar: unknown): void;
}
