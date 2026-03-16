/**
 * Plugin decoration bridge — manages editor decorations from plugins.
 *
 * Decorations: underlines (wavy/solid/dashed), background highlights, gutter icons.
 * Perry-safe: module-level state, for-loops.
 */

// Decoration type definition
export interface DecorationTypeDef {
  id: number;
  underlineColor: string;
  underlineStyle: string;
  backgroundColor: string;
  gutterIcon: string;
  isWholeLine: number;
}

// Decoration range
export interface DecorationRangeEntry {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  hoverMessage: string;
}

// Per-buffer decoration state: typeId -> ranges[]
export interface BufferDecorations {
  types: Map<number, DecorationRangeEntry[]>;
}

// Global state
let decorationTypes: Map<number, DecorationTypeDef> = new Map();
let bufferDecorations: Map<number, BufferDecorations> = new Map();
let nextTypeId: number = 1;
let renderCallback: (() => void) | null = null;

/**
 * Set a callback that will be invoked when decorations change,
 * so the editor can re-render to show updated underlines/highlights.
 */
export function setDecorationRenderCallback(cb: () => void): void {
  renderCallback = cb;
}

/** Trigger editor re-render after decoration changes. */
function triggerRender(): void {
  if (renderCallback !== null) {
    renderCallback();
  }
}

/**
 * Create a decoration type. Returns its ID.
 */
export function pluginCreateDecorationType(
  underlineColor: string,
  underlineStyle: string,
  backgroundColor: string,
  gutterIcon: string,
  isWholeLine: number,
): number {
  const id = nextTypeId;
  nextTypeId++;

  decorationTypes.set(id, {
    id: id,
    underlineColor: underlineColor,
    underlineStyle: underlineStyle,
    backgroundColor: backgroundColor,
    gutterIcon: gutterIcon,
    isWholeLine: isWholeLine,
  });

  return id;
}

/**
 * Set decorations for a buffer and type.
 */
export function pluginSetDecorations(
  bufferId: number,
  typeId: number,
  ranges: DecorationRangeEntry[],
): void {
  let bd = bufferDecorations.get(bufferId);
  if (bd === undefined) {
    bd = { types: new Map() };
    bufferDecorations.set(bufferId, bd);
  }
  bd.types.set(typeId, ranges);

  // Trigger editor re-render to show the updated decorations
  triggerRender();
}

/**
 * Clear all decorations for a type across all buffers.
 */
export function pluginClearDecorations(typeId: number): void {
  const keys = Array.from(bufferDecorations.keys());
  for (let i = 0; i < keys.length; i++) {
    const bd = bufferDecorations.get(keys[i]);
    if (bd !== undefined) {
      bd.types.delete(typeId);
    }
  }
}

/**
 * Get all decorations for a buffer (for the editor renderer).
 */
export function getDecorationsForBuffer(bufferId: number): { type: DecorationTypeDef; ranges: DecorationRangeEntry[] }[] {
  const result: { type: DecorationTypeDef; ranges: DecorationRangeEntry[] }[] = [];
  const bd = bufferDecorations.get(bufferId);
  if (bd === undefined) return result;

  const entries = Array.from(bd.types.entries());
  for (let i = 0; i < entries.length; i++) {
    const typeId = entries[i][0];
    const ranges = entries[i][1];
    const typeDef = decorationTypes.get(typeId);
    if (typeDef !== undefined) {
      result.push({ type: typeDef, ranges: ranges });
    }
  }
  return result;
}

/**
 * Remove all decoration types and ranges for a plugin (cleanup on deactivate).
 */
export function pluginDecorationCleanup(typeIds: number[]): void {
  for (let i = 0; i < typeIds.length; i++) {
    pluginClearDecorations(typeIds[i]);
    decorationTypes.delete(typeIds[i]);
  }
}
