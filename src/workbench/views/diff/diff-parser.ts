/**
 * Unified diff parser — extracts line types from `git diff` output.
 *
 * Perry-safe: uses only charCodeAt, indexOf, slice (no regex, no split, no Int32Array).
 *
 * Output arrays are 1-indexed (index 0 unused) so line numbers map directly:
 *   oldLineTypes[lineNum] = 0 (unchanged) | 1 (deleted)
 *   newLineTypes[lineNum] = 0 (unchanged) | 1 (added)
 */

// Line type constants
const LINE_UNCHANGED = 0;
const LINE_CHANGED = 1;

/**
 * Parse a unified diff string and return per-line type arrays for old (HEAD)
 * and new (working copy) sides.
 *
 * @param diffText  Full unified diff output from `git diff -- <file>`
 * @param oldLineCount  Total lines in the old (HEAD) version
 * @param newLineCount  Total lines in the new (working copy) version
 */
export function parseDiffOutput(
  diffText: string,
  oldLineCount: number,
  newLineCount: number,
): { oldLineTypes: number[]; newLineTypes: number[] } {
  // Initialize arrays with LINE_UNCHANGED (0). Index 0 unused (1-based).
  const oldLineTypes: number[] = [];
  const newLineTypes: number[] = [];
  for (let i = 0; i <= oldLineCount; i++) {
    oldLineTypes[i] = LINE_UNCHANGED;
  }
  for (let i = 0; i <= newLineCount; i++) {
    newLineTypes[i] = LINE_UNCHANGED;
  }

  if (diffText.length < 1) return { oldLineTypes: oldLineTypes, newLineTypes: newLineTypes };

  // Scan through the diff text line by line
  let pos = 0;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = 0;

  while (pos < diffText.length) {
    // Find end of current line
    let lineEnd = pos;
    while (lineEnd < diffText.length && diffText.charCodeAt(lineEnd) !== 10) {
      lineEnd = lineEnd + 1;
    }
    const lineLen = lineEnd - pos;

    if (lineLen < 1) {
      pos = lineEnd + 1;
      continue;
    }

    const firstChar = diffText.charCodeAt(pos);

    // Check for @@ hunk header
    // @@ = 64 64
    if (firstChar === 64 && lineLen > 3 && diffText.charCodeAt(pos + 1) === 64) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      inHunk = 1;

      // Find -oldStart
      let j = pos + 2;
      // Skip to '-'
      while (j < lineEnd && diffText.charCodeAt(j) !== 45) { j = j + 1; } // 45 = '-'
      j = j + 1; // skip '-'
      let oldStart = 0;
      while (j < lineEnd && diffText.charCodeAt(j) >= 48 && diffText.charCodeAt(j) <= 57) {
        oldStart = oldStart * 10 + (diffText.charCodeAt(j) - 48);
        j = j + 1;
      }

      // Find +newStart
      while (j < lineEnd && diffText.charCodeAt(j) !== 43) { j = j + 1; } // 43 = '+'
      j = j + 1; // skip '+'
      let newStart = 0;
      while (j < lineEnd && diffText.charCodeAt(j) >= 48 && diffText.charCodeAt(j) <= 57) {
        newStart = newStart * 10 + (diffText.charCodeAt(j) - 48);
        j = j + 1;
      }

      oldLine = oldStart;
      newLine = newStart;
      pos = lineEnd + 1;
      continue;
    }

    if (inHunk < 1) {
      pos = lineEnd + 1;
      continue;
    }

    // Inside a hunk: classify lines
    if (firstChar === 45) {
      // '-' = deleted line (exists in old, not in new)
      if (oldLine >= 1 && oldLine <= oldLineCount) {
        oldLineTypes[oldLine] = LINE_CHANGED;
      }
      oldLine = oldLine + 1;
    } else if (firstChar === 43) {
      // '+' = added line (exists in new, not in old)
      if (newLine >= 1 && newLine <= newLineCount) {
        newLineTypes[newLine] = LINE_CHANGED;
      }
      newLine = newLine + 1;
    } else if (firstChar === 32) {
      // ' ' = context line (unchanged, exists in both)
      oldLine = oldLine + 1;
      newLine = newLine + 1;
    } else if (firstChar === 92) {
      // '\' = "\ No newline at end of file" — skip
    } else {
      // Any other line terminates the hunk
      inHunk = 0;
    }

    pos = lineEnd + 1;
  }

  return { oldLineTypes: oldLineTypes, newLineTypes: newLineTypes };
}

/**
 * Count lines in a text string. Returns 0 for empty string.
 */
export function countLines(text: string): number {
  if (text.length < 1) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count = count + 1;
  }
  return count;
}
