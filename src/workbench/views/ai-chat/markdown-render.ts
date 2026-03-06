/**
 * Perry-safe line-by-line markdown renderer.
 * Renders markdown text into Perry UI widgets.
 */
import {
  VStack, VStackWithInsets, HStack, Text, Spacer,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  widgetAddChild, widgetSetBackgroundColor, widgetSetWidth,
} from 'perry/ui';
import { setFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

/** Check if line starts with ``` (code fence). */
function isCodeFence(line: string): number {
  if (line.length < 3) return 0;
  if (line.charCodeAt(0) === 96 && line.charCodeAt(1) === 96 && line.charCodeAt(2) === 96) {
    return 1;
  }
  return 0;
}

/** Get header level (1-3) or 0 if not a header. */
function getHeaderLevel(line: string): number {
  if (line.length < 2) return 0;
  if (line.charCodeAt(0) !== 35) return 0; // '#'
  if (line.charCodeAt(1) === 32) return 1; // "# "
  if (line.charCodeAt(1) !== 35) return 0;
  if (line.length < 3) return 0;
  if (line.charCodeAt(2) === 32) return 2; // "## "
  if (line.charCodeAt(2) !== 35) return 0;
  if (line.length < 4) return 0;
  if (line.charCodeAt(3) === 32) return 3; // "### "
  return 0;
}

/** Check if line starts with "- " or "* " (bullet list). */
function isBulletItem(line: string): number {
  if (line.length < 2) return 0;
  const c0 = line.charCodeAt(0);
  if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) return 1; // '-' or '*' + ' '
  return 0;
}

/** Render a text line with inline `code` spans detected. */
function renderInlineText(text: string, container: unknown, fontSize: number, colors: ResolvedUIColors): void {
  // Scan for backtick pairs
  let hasBacktick: number = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 96) {
      hasBacktick = 1;
      break;
    }
  }

  if (hasBacktick < 1) {
    // Simple text, no inline code
    const t = Text(text);
    textSetFontSize(t, fontSize);
    setFg(t, colors.sideBarForeground);
    widgetAddChild(container, t);
    return;
  }

  // Has backticks — split into segments
  let segStart = 0;
  let inCode: number = 0;
  for (let i = 0; i <= text.length; i++) {
    const isEnd = i === text.length ? 1 : 0;
    const isTick = isEnd < 1 && text.charCodeAt(i) === 96 ? 1 : 0;

    if (isTick > 0 || isEnd > 0) {
      if (segStart < i) {
        const seg = text.slice(segStart, i);
        const t = Text(seg);
        if (inCode > 0) {
          textSetFontFamily(t, fontSize, 'Menlo');
          textSetFontSize(t, fontSize - 1);
        } else {
          textSetFontSize(t, fontSize);
        }
        setFg(t, colors.sideBarForeground);
        widgetAddChild(container, t);
      }
      if (isTick > 0) {
        if (inCode > 0) {
          inCode = 0;
        } else {
          inCode = 1;
        }
      }
      segStart = i + 1;
    }
  }
}

/** Render bold text (** markers). Returns 1 if text had bold markers. */
function hasBoldMarkers(text: string): number {
  if (text.length < 4) return 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text.charCodeAt(i) === 42 && text.charCodeAt(i + 1) === 42) return 1;
  }
  return 0;
}

/**
 * Main entry: render markdown content into a container widget.
 * Parses line by line, detects code fences, headers, bullets, etc.
 */
export function renderMarkdownBlock(content: string, container: unknown, colors: ResolvedUIColors): void {
  let lineStart = 0;
  let inCodeBlock: number = 0;
  let codeLang = '';
  let codeLines: unknown = null;

  for (let i = 0; i <= content.length; i++) {
    if (i === content.length || content.charCodeAt(i) === 10) {
      let line = content.slice(lineStart, i);
      lineStart = i + 1;

      // Check for code fence
      if (isCodeFence(line) > 0) {
        if (inCodeBlock > 0) {
          // End code block
          inCodeBlock = 0;
          codeLines = null;
          codeLang = '';
        } else {
          // Start code block
          inCodeBlock = 1;
          if (line.length > 3) {
            codeLang = line.slice(3);
          } else {
            codeLang = '';
          }
          // Create code block container
          codeLines = VStackWithInsets(2, 8, 8, 8, 8);
          widgetSetBackgroundColor(codeLines, 0.12, 0.12, 0.14, 1.0);
          if (codeLang.length > 0) {
            const langLabel = Text(codeLang);
            textSetFontSize(langLabel, 9);
            setFg(langLabel, colors.sideBarForeground);
            widgetAddChild(codeLines, langLabel);
          }
          widgetAddChild(container, codeLines);
        }
        continue;
      }

      if (inCodeBlock > 0 && codeLines) {
        // Inside code block — monospace
        let codeLine = line;
        if (codeLine.length < 1) codeLine = ' ';
        const t = Text(codeLine);
        textSetFontFamily(t, 11, 'Menlo');
        textSetFontSize(t, 11);
        setFg(t, colors.sideBarForeground);
        widgetAddChild(codeLines, t);
        continue;
      }

      // Empty line → spacer
      if (line.length < 1) {
        const spacer = Text(' ');
        textSetFontSize(spacer, 6);
        widgetAddChild(container, spacer);
        continue;
      }

      // Header
      const hLevel = getHeaderLevel(line);
      if (hLevel > 0) {
        let hStart = hLevel + 1; // skip "# " / "## " / "### "
        const hText = line.slice(hStart);
        const h = Text(hText);
        if (hLevel === 1) {
          textSetFontSize(h, 16);
          textSetFontWeight(h, 16, 0.7);
        } else if (hLevel === 2) {
          textSetFontSize(h, 14);
          textSetFontWeight(h, 14, 0.5);
        } else {
          textSetFontSize(h, 13);
          textSetFontWeight(h, 13, 0.5);
        }
        setFg(h, colors.sideBarForeground);
        widgetAddChild(container, h);
        continue;
      }

      // Bullet list item
      if (isBulletItem(line) > 0) {
        const bulletText = line.slice(2);
        let bulletStr = '\u2022 ';
        bulletStr += bulletText;
        const row = VStack(0, []);
        renderInlineText(bulletStr, row, 12, colors);
        widgetAddChild(container, row);
        continue;
      }

      // Regular text
      const row = VStack(0, []);
      renderInlineText(line, row, 12, colors);
      widgetAddChild(container, row);
    }
  }
}
