/**
 * Hover popup — floating tooltip showing type info and documentation.
 * Triggered when cursor dwells on a symbol for 500ms.
 *
 * SHIP-V1-GAPS.md #34: LSP servers now return MarkupContent in markdown
 * (init handshake advertises `["markdown", "plaintext"]`). The popup strips
 * the most common markdown syntax markers so docs read cleanly without
 * embedding the full chat markdown engine — Phase 1.1 can promote the
 * popup to use `renderMarkdownBlock` for full fidelity.
 *
 * Perry-safe: module-level state, no closures on `this`.
 */
import {
  VStack, VStackWithInsets, Text,
  textSetFontSize, textSetFontFamily, textSetFontWeight,
  widgetAddChild, widgetClearChildren, widgetSetWidth, widgetSetHidden,
  widgetSetBackgroundColor,
} from 'perry/ui';
import { setFg, setBg, monoFont } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getEditorBackground, getEditorForeground, getInputBorder } from '../../theme/theme-colors';
import { renderMarkdownBlock } from '../ai-chat/markdown-render';

// SHIP-V1-GAPS.md #34: theme colors captured at popup-create time so hover
// rendering can pick them up without plumbing a colors arg through every
// caller of `showHoverPopup`. Re-set on theme change via `setHoverThemeColors`.
let _hoverColors: ResolvedUIColors = null as any;
export function setHoverThemeColors(c: ResolvedUIColors): void {
  _hoverColors = c;
}

/**
 * Strip markdown markers so the popup reads as plain prose:
 *   `\`code\`` → `code`
 *   `\`\`\`lang` fences → stripped
 *   `**bold**` → `bold`
 *   `__bold__` → `bold`
 *   `*ital*`   → `ital`
 *   `_ital_`   → `ital`
 *   `[text](url)` → `text`
 * Keeps newlines so block structure survives.
 */
function stripMarkdown(input: string): string {
  let out = '';
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input.charCodeAt(i);
    // Skip code-fence lines entirely (` ``` ` and ` ```lang `).
    if (c === 96 && i + 2 < n && input.charCodeAt(i + 1) === 96 && input.charCodeAt(i + 2) === 96) {
      // Advance to end of line
      while (i < n && input.charCodeAt(i) !== 10) i++;
      continue;
    }
    // Inline code: `text` → text
    if (c === 96) { i++; continue; }
    // Bold/italic: ** __ * _ (double first, then single)
    if (c === 42 && i + 1 < n && input.charCodeAt(i + 1) === 42) { i += 2; continue; }
    if (c === 95 && i + 1 < n && input.charCodeAt(i + 1) === 95) { i += 2; continue; }
    if (c === 42 || c === 95) { i++; continue; }
    // Links: [text](url) → text
    if (c === 91) {
      const close = input.indexOf(']', i + 1);
      if (close > 0 && close + 1 < n && input.charCodeAt(close + 1) === 40) {
        const closeParen = input.indexOf(')', close + 2);
        if (closeParen > close) {
          out += input.slice(i + 1, close);
          i = closeParen + 1;
          continue;
        }
      }
    }
    // Heading markers at line start: # ## ### …
    if (c === 35 && (i === 0 || input.charCodeAt(i - 1) === 10)) {
      while (i < n && input.charCodeAt(i) === 35) i++;
      while (i < n && input.charCodeAt(i) === 32) i++;
      continue;
    }
    out += input.charAt(i);
    i++;
  }
  return out;
}

let hoverWidget: unknown = null;
let hoverReady: number = 0;
let hoverVisible: number = 0;

export function createHoverPopup(colors: ResolvedUIColors): unknown {
  const popup = VStackWithInsets(4, 6, 8, 6, 8);
  widgetSetBackgroundColor(popup, 0.15, 0.15, 0.17, 0.97);
  widgetSetWidth(popup, 400);
  widgetSetHidden(popup, 1);
  hoverWidget = popup;
  hoverReady = 1;
  _hoverColors = colors;
  return popup;
}

export function showHoverPopup(content: string): void {
  if (hoverReady < 1 || !hoverWidget) return;
  if (content.length < 1) return;

  widgetClearChildren(hoverWidget);

  // Split content by newlines — first line is type/signature, rest is docs.
  // The first line is always rendered monospace (LSP servers put the function
  // signature there). Doc body now routes through the full markdown renderer
  // (#34 follow-up) so bold/inline-code/links/lists/blockquotes work.
  let firstNewline = -1;
  for (let i = 0; i < content.length; i = i + 1) {
    if (content.charCodeAt(i) === 10) {
      firstNewline = i;
      break;
    }
  }

  let typeLine = content;
  let docText = '';
  if (firstNewline > 0) {
    typeLine = content.slice(0, firstNewline);
    docText = content.slice(firstNewline + 1);
  }

  if (typeLine.length > 0) {
    // Strip markdown only on the type/signature line — keep it tight.
    const typeStripped = stripMarkdown(typeLine);
    const typeLabel = Text(typeStripped);
    textSetFontSize(typeLabel, 12);
    textSetFontFamily(typeLabel, monoFont());
    textSetFontWeight(typeLabel, 12, 0.5);
    setFg(typeLabel, '#e0e0e0');
    widgetAddChild(hoverWidget, typeLabel);
  }

  if (docText.length > 0) {
    let trimmed = docText;
    while (trimmed.length > 0 && trimmed.charCodeAt(0) === 10) {
      trimmed = trimmed.slice(1);
    }
    if (trimmed.length > 0) {
      // Full markdown render for the doc body — code blocks become monospace,
      // [text](url) becomes clickable, lists/tables/blockquotes layout.
      if (_hoverColors !== null) {
        renderMarkdownBlock(trimmed, hoverWidget, _hoverColors, 380);
      } else {
        const docLabel = Text(stripMarkdown(trimmed));
        textSetFontSize(docLabel, 12);
        setFg(docLabel, '#a0a0a0');
        widgetAddChild(hoverWidget, docLabel);
      }
    }
  }

  widgetSetHidden(hoverWidget, 0);
  hoverVisible = 1;
}

export function hideHoverPopup(): void {
  if (hoverWidget) {
    widgetSetHidden(hoverWidget, 1);
    hoverVisible = 0;
  }
}

export function isHoverVisible(): number {
  return hoverVisible;
}
