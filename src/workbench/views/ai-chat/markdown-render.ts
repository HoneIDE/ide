/**
 * Perry-safe line-by-line markdown renderer.
 * Renders markdown text into Perry UI widgets.
 */
import {
  VStack, VStackWithInsets, HStack, Text, Spacer,
  textSetFontSize, textSetFontWeight, textSetFontFamily, textSetWraps,
  widgetAddChild, widgetSetBackgroundColor, widgetSetWidth,
} from 'perry/ui';
import { setFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { getSideBarForeground, getSecondaryTextColor, isCurrentThemeDark } from '../../theme/theme-colors';

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
function renderInlineText(text: string, container: unknown, fontSize: number, colors: ResolvedUIColors, wrapWidth: number): void {
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
    textSetWraps(t, wrapWidth);
    setFg(t, getSideBarForeground());
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
          textSetWraps(t, wrapWidth);
        }
        setFg(t, getSideBarForeground());
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
export function renderMarkdownBlock(content: string, container: unknown, colors: ResolvedUIColors, wrapWidth: number): void {
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
          if (isCurrentThemeDark() > 0) {
            widgetSetBackgroundColor(codeLines, 0.12, 0.12, 0.14, 1.0);
          } else {
            widgetSetBackgroundColor(codeLines, 0.92, 0.92, 0.94, 1.0);
          }
          if (codeLang.length > 0) {
            const langLabel = Text(codeLang);
            textSetFontSize(langLabel, 9);
            setFg(langLabel, getSideBarForeground());
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
        setFg(t, getSideBarForeground());
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
        textSetWraps(h, wrapWidth);
        setFg(h, getSideBarForeground());
        widgetAddChild(container, h);
        continue;
      }

      // Bullet list item
      if (isBulletItem(line) > 0) {
        const bulletText = line.slice(2);
        let bulletStr = '\u2022 ';
        bulletStr += bulletText;
        const row = VStack(0, []);
        renderInlineText(bulletStr, row, 12, colors, wrapWidth);
        widgetAddChild(container, row);
        continue;
      }

      // SHIP-V1-GAPS.md #59: ordered list item ("1. " through "999. ").
      const olLen = orderedListPrefixLength(line);
      if (olLen > 0) {
        const numText = line.slice(0, olLen - 1); // includes "."
        const itemText = line.slice(olLen + 1); // skip ". " or ".  "
        let prefix = numText;
        prefix += '. ';
        prefix += itemText;
        const row = VStack(0, []);
        renderInlineText(prefix, row, 12, colors, wrapWidth);
        widgetAddChild(container, row);
        continue;
      }

      // SHIP-V1-GAPS.md #59: blockquote (`> text`).
      if (line.length >= 2 && line.charCodeAt(0) === 62 && line.charCodeAt(1) === 32) {
        const qText = line.slice(2);
        const t = Text('\u2502 ' + qText); // box-drawing left-bar prefix
        textSetFontSize(t, 12);
        textSetFontWeight(t, 12, 0.4);
        setFg(t, getSecondaryTextColor());
        textSetWraps(t, wrapWidth);
        widgetAddChild(container, t);
        continue;
      }

      // SHIP-V1-GAPS.md #59: pipe-delimited tables. Rough heuristic \u2014 a line
      // starting with `|` and containing \u22652 more `|`. Subsequent lines that
      // match the pattern join the same table block; the separator line
      // (`|---|---|`) is skipped.
      if (isTableLine(line) > 0) {
        let tableRows: string[][] = [];
        // Re-scan the upcoming table block.
        let ti = lineStart - line.length - 1; // start of current line
        let tj = ti;
        while (tj <= content.length) {
          if (tj === content.length || content.charCodeAt(tj) === 10) {
            const tLine = content.slice(ti, tj);
            if (isTableLine(tLine) < 1) break;
            // Skip the separator row (`|---|---|`).
            if (isTableSeparator(tLine) < 1) {
              tableRows.push(splitTableCells(tLine));
            }
            ti = tj + 1;
          }
          tj = tj + 1;
        }
        if (tableRows.length > 0) {
          renderTable(tableRows, container, colors, wrapWidth);
          // Advance the outer loop past consumed table lines.
          lineStart = ti;
          i = ti - 1;
          continue;
        }
      }

      // Regular text
      const row = VStack(0, []);
      renderInlineText(line, row, 12, colors, wrapWidth);
      widgetAddChild(container, row);
    }
  }
}

/**
 * Detect ordered-list prefix length. Returns the position right after the
 * `.` (so the item text starts at `idx + 1` to skip the space). 0 = no match.
 * Accepts up to 3 digits to cap matches at sensible item numbers.
 */
function orderedListPrefixLength(line: string): number {
  if (line.length < 3) return 0;
  let p = 0;
  while (p < 3 && p < line.length) {
    const c = line.charCodeAt(p);
    if (c >= 48 && c <= 57) p++; else break;
  }
  if (p === 0) return 0;
  if (p >= line.length) return 0;
  if (line.charCodeAt(p) !== 46) return 0;
  if (p + 1 >= line.length) return 0;
  if (line.charCodeAt(p + 1) !== 32) return 0;
  return p + 1;
}

function isTableLine(line: string): number {
  if (line.length < 3) return 0;
  if (line.charCodeAt(0) !== 124) return 0;
  let pipes = 0;
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) === 124) pipes = pipes + 1;
  }
  return pipes >= 3 ? 1 : 0;
}

function isTableSeparator(line: string): number {
  // Matches `|---|---|` or `| --- | :--- |` etc \u2014 cells are dashes / colons.
  if (line.length < 3) return 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 124 || c === 45 || c === 58 || c === 32) continue;
    return 0;
  }
  return 1;
}

function splitTableCells(line: string): string[] {
  // Strip outer `|` then split on inner `|`.
  let start = 0;
  let end = line.length;
  if (line.charCodeAt(0) === 124) start = 1;
  if (line.charCodeAt(line.length - 1) === 124) end = line.length - 1;
  const trimmed = line.slice(start, end);
  const cells: string[] = [];
  let cs = 0;
  for (let i = 0; i <= trimmed.length; i++) {
    if (i === trimmed.length || trimmed.charCodeAt(i) === 124) {
      let cell = trimmed.slice(cs, i);
      // Trim spaces.
      let a = 0;
      let b = cell.length;
      while (a < b && cell.charCodeAt(a) === 32) a++;
      while (b > a && cell.charCodeAt(b - 1) === 32) b--;
      cells.push(cell.slice(a, b));
      cs = i + 1;
    }
  }
  return cells;
}

/**
 * Render a table as stacked rows. First row is the header (bold). Cells in
 * each row are joined with a TAB and rendered as monospace so columns align
 * roughly. A proper grid layout is the v1.1 polish \u2014 perry/ui has no native
 * grid widget today, so this gives the user the data in a readable shape.
 */
function renderTable(rows: string[][], container: unknown, _colors: ResolvedUIColors, wrapWidth: number): void {
  if (rows.length === 0) return;
  const tableBox = VStackWithInsets(2, 6, 8, 6, 8);
  if (isCurrentThemeDark() > 0) {
    widgetSetBackgroundColor(tableBox, 0.12, 0.12, 0.14, 0.6);
  } else {
    widgetSetBackgroundColor(tableBox, 0.94, 0.94, 0.96, 0.8);
  }
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r];
    let row = '';
    for (let c = 0; c < cells.length; c++) {
      if (c > 0) row += '\t';
      row += cells[c];
    }
    const t = Text(row);
    textSetFontFamily(t, 11, 'Menlo');
    textSetFontSize(t, 11);
    setFg(t, getSideBarForeground());
    textSetWraps(t, wrapWidth);
    if (r === 0) textSetFontWeight(t, 11, 0.6);
    widgetAddChild(tableBox, t);
  }
  widgetAddChild(container, tableBox);
}
