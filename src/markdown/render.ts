import type { TableGrid, TextBox } from "../core/types.js";
import type { TextLinePlugin } from "./plugins/types.js";

function normalizeFullWidthAscii(text: string): string {
  return text.replace(/[！-～]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
}

function escapePipes(text: string): string {
  return normalizeFullWidthAscii(text)
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

/**
 * Render a borderless two-column TableGrid as a nested Markdown list.
 *
 * Each row becomes:
 *   - label text           ← top-level bullet (even when value is empty)
 *       - value text       ← indented sub-bullet (omitted when value is empty)
 */
export function renderBorderlessTableToMarkdown(table: TableGrid): string {
  if (table.rows === 0) return "";

  const rows: string[] = [];
  for (let r = 0; r < table.rows; r++) {
    const labelCell = table.cells.find((c) => c.row === r && c.col === 0);
    const valueCell = table.cells.find((c) => c.row === r && c.col === 1);
    const label = escapePipes(labelCell?.text.trim() ?? "");
    const value = escapePipes(valueCell?.text.trim() ?? "");
    rows.push(`| ${label} | ${value} |`);
  }
  return [`| 項目 | 内容 |`, `| --- | --- |`, ...rows].join("\n");
}

export function renderTableGridToMarkdown(table: TableGrid): string {
  if (table.rows === 0 || table.cols === 0) {
    return "";
  }

  const matrix: string[][] = Array.from({ length: table.rows }, () =>
    Array.from({ length: table.cols }, () => "")
  );

  for (const cell of table.cells) {
    if (cell.row < table.rows && cell.col < table.cols) {
      matrix[cell.row][cell.col] = escapePipes(cell.text.trim());
    }
  }

  const normalizedMatrix = normalizeShiftedSparseColumns(matrix);
  const { matrix: renderedMatrix, notes } = splitTrailingFootnoteRows(normalizedMatrix);

  const header = `| ${renderedMatrix[0].join(" | ")} |`;
  const divider = `| ${Array.from({ length: renderedMatrix[0].length }, () => "---").join(" | ")} |`;
  const body = renderedMatrix
    .slice(1)
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");

  const tableMd = [header, divider, body].filter((line) => line.length > 0).join("\n");
  if (notes.length === 0) return tableMd;
  return `${tableMd}\n\n${notes.join("\n")}`;
}

function normalizeShiftedSparseColumns(matrix: string[][]): string[][] {
  if (matrix.length === 0 || matrix[0].length < 5) return matrix;

  const rows = matrix.length;
  const cols = matrix[0].length;
  const counts = Array.from({ length: cols }, (_, c) =>
    matrix.reduce((n, row) => n + (row[c].trim().length > 0 ? 1 : 0), 0)
  );

  const denseCols = new Set<number>(
    counts
      .map((count, col) => ({ count, col }))
      .filter(({ col, count }) => col === 0 || count >= 2)
      .map(({ col }) => col)
  );

  const sparseCols = counts
    .map((count, col) => ({ count, col }))
    .filter(({ col, count }) => col > 0 && col < cols - 1 && count === 1)
    .map(({ col }) => col);

  // Need at least two sparse columns to avoid overfitting normal tables.
  if (sparseCols.length < 2 || denseCols.size < 4) return matrix;

  // Validate this is a shifted-header pattern:
  // sparse column has one value, and its immediate right dense column is empty on that row.
  const moves: Array<{ from: number; to: number; row: number }> = [];
  for (const from of sparseCols) {
    const row = matrix.findIndex((r) => r[from].trim().length > 0);
    const to = from + 1;
    if (row < 0) return matrix;
    if (!denseCols.has(to)) return matrix;
    if (matrix[row][to].trim().length > 0) return matrix;
    moves.push({ from, to, row });
  }

  const copy = matrix.map((row) => [...row]);
  for (const { from, to, row } of moves) {
    copy[row][to] = copy[row][to].trim().length > 0
      ? `${copy[row][to]} ${copy[row][from]}`
      : copy[row][from];
    copy[row][from] = "";
  }

  const keepCols = Array.from({ length: cols }, (_, c) => c).filter((c) =>
    copy.some((row) => row[c].trim().length > 0)
  );
  if (keepCols.length === cols) return copy;

  return copy.map((row) => keepCols.map((c) => row[c]));
}

function splitTrailingFootnoteRows(matrix: string[][]): { matrix: string[][]; notes: string[] } {
  if (matrix.length <= 1) return { matrix, notes: [] };

  let cut = matrix.length;
  const notes: string[] = [];

  for (let r = matrix.length - 1; r >= 1; r--) {
    const row = matrix[r];
    const nonEmpty = row
      .map((cell, idx) => ({ idx, text: cell.trim() }))
      .filter((item) => item.text.length > 0);

    if (nonEmpty.length === 0) {
      cut = r;
      continue;
    }

    if (nonEmpty.length === 1 && nonEmpty[0].text.startsWith("※")) {
      notes.unshift(nonEmpty[0].text);
      cut = r;
      continue;
    }

    break;
  }

  const pruned = matrix.slice(0, Math.max(cut, 1));
  return { matrix: pruned, notes };
}

function parsePipeRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Normalize malformed tables where the first column is emitted as free text
 * around a markdown table containing only the right-side columns.
 *
 * Pattern (generic):
 *   - A plain-text header line with (N+1) whitespace-separated tokens
 *     just above a N-column markdown table.
 *   - The header tokens are non-numeric (typical column names).
 *   - Standalone short plain-text label lines around the table whose count
 *     equals the logical row count of the table after <br> expansion.
 *
 * When detected, reconstruct into a proper (N+1)-column markdown table.
 */
function normalizeDetachedFirstColumnTables(
  blocks: Array<{ topY: number; content: string }>
): Array<{ topY: number; content: string }> {
  const HEADING_RE = /^#{1,6}\s/;

  const isTableBlock = (text: string): boolean => text.trimStart().startsWith("|");
  const isPlainBlock = (text: string): boolean => !HEADING_RE.test(text) && !isTableBlock(text);
  const isShortLabel = (text: string): boolean => {
    const t = text.trim();
    return t.length > 0 && t.length <= 40 && !/[。！？]/.test(t);
  };
  const splitTokens = (text: string): string[] => text.trim().split(/[ \t　]+/).filter(Boolean);

  const replacements = new Map<number, string>();
  const remove = new Set<number>();

  for (let tableIdx = 0; tableIdx < blocks.length; tableIdx++) {
    if (remove.has(tableIdx)) continue;
    const tableBlock = blocks[tableIdx];
    if (!isTableBlock(tableBlock.content)) continue;

    const tableLines = tableBlock.content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"));
    const dataRows = tableLines
      .filter((line) => !/^\|\s*[-: ]+\|/.test(line))
      .map(parsePipeRow)
      .filter((row) => row.length > 0);
    if (dataRows.length === 0) continue;

    const cols = dataRows[0].length;
    if (cols < 2 || dataRows.some((row) => row.length !== cols)) continue;

    // Expand each markdown row by <br> count to get logical row count.
    const logicalRows: string[][] = [];
    for (const row of dataRows) {
      const splitCells = row.map((cell) => cell.split("<br>").map((part) => part.trim()));
      const rowSpan = Math.max(...splitCells.map((parts) => parts.length));
      for (let k = 0; k < rowSpan; k++) {
        logicalRows.push(splitCells.map((parts) => parts[k] ?? ""));
      }
    }
    if (logicalRows.length < 2) continue;

    // Find nearby non-numeric header tokens with exactly (cols + 1) columns.
    let headerIdx = -1;
    let headerTokens: string[] = [];
    for (let i = Math.max(0, tableIdx - 4); i <= tableIdx - 1; i++) {
      const text = normalizeFullWidthAscii(blocks[i].content).trim();
      if (!isPlainBlock(text)) continue;
      const tokens = splitTokens(text);
      const nonNumericHeader = tokens.length === cols + 1 && tokens.every((tok) => !/[0-9０-９]/.test(tok));
      if (nonNumericHeader) {
        headerIdx = i;
        headerTokens = tokens;
      }
    }
    if (headerIdx < 0) continue;

    // Collect short label lines contiguous just above/below the table.
    const aboveLabels: Array<{ idx: number; text: string }> = [];
    for (let i = tableIdx - 1; i > headerIdx; i--) {
      const text = normalizeFullWidthAscii(blocks[i].content).trim();
      if (!isPlainBlock(text) || !isShortLabel(text)) break;
      aboveLabels.push({ idx: i, text });
    }
    aboveLabels.reverse();

    const belowLabels: Array<{ idx: number; text: string }> = [];
    for (let i = tableIdx + 1; i < blocks.length; i++) {
      const text = normalizeFullWidthAscii(blocks[i].content).trim();
      if (!isPlainBlock(text) || !isShortLabel(text)) break;
      belowLabels.push({ idx: i, text });
    }

    const labels = [...aboveLabels, ...belowLabels];
    if (labels.length !== logicalRows.length) continue;

    const normalizedLines: string[] = [];
    normalizedLines.push(`| ${headerTokens.join(" | ")} |`);
    normalizedLines.push(`| ${Array.from({ length: cols + 1 }, () => "---").join(" | ")} |`);
    for (let r = 0; r < logicalRows.length; r++) {
      normalizedLines.push(`| ${labels[r].text} | ${logicalRows[r].join(" | ")} |`);
    }

    replacements.set(tableIdx, normalizedLines.join("\n"));
    remove.add(headerIdx);
    for (const label of labels) remove.add(label.idx);
  }

  if (replacements.size === 0 && remove.size === 0) return blocks;

  const out: Array<{ topY: number; content: string }> = [];
  for (let i = 0; i < blocks.length; i++) {
    if (remove.has(i)) continue;
    const replaced = replacements.get(i);
    if (replaced) {
      out.push({ topY: blocks[i].topY, content: replaced });
    } else {
      out.push(blocks[i]);
    }
  }
  return out;
}

// Y tolerance for grouping text boxes onto the same visual line (pts)
const TEXT_LINE_Y_TOLERANCE = 3;

/**
 * Compute the modal (most frequent) font size among a list of text boxes.
 * Sizes are rounded to 1 decimal place to absorb tiny float differences.
 */
function modalFontSize(textBoxes: TextBox[]): number {
  const counts = new Map<number, number>();
  for (const tb of textBoxes) {
    const size = Math.round((tb.fontSize ?? 0) * 10) / 10;
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  let modal = 0;
  let maxCount = 0;
  for (const [size, count] of counts) {
    if (count > maxCount) { maxCount = count; modal = size; }
  }
  return modal;
}

/**
 * Group free text boxes into horizontal lines, sorted top-to-bottom.
 */
/**
 * Minimum X gap (in points) between adjacent text boxes on the same visual
 * line for the line to be considered "tabular" (i.e. column-header-like).
 * Such lines are not eligible for paragraph wrap-merging.
 */
const TABULAR_X_GAP = 30;

function groupFreeTextIntoLines(textBoxes: TextBox[]): Array<{ text: string; topY: number; fontSize: number; isBold: boolean; isTabular: boolean }> {
  if (textBoxes.length === 0) return [];

  const sorted = [...textBoxes].sort((a, b) => {
    const ya = (a.bounds.top + a.bounds.bottom) / 2;
    const yb = (b.bounds.top + b.bounds.bottom) / 2;
    const dy = yb - ya;
    if (Math.abs(dy) > TEXT_LINE_Y_TOLERANCE) return dy;
    return a.bounds.left - b.bounds.left;
  });

  const lines: Array<{ text: string; topY: number; fontSize: number; isBold: boolean; isTabular: boolean }> = [];
  let currentY = (sorted[0].bounds.top + sorted[0].bounds.bottom) / 2;
  let currentParts: string[] = [sorted[0].text];
  let currentBoxes: TextBox[] = [sorted[0]];
  let currentTopY = currentY;
  let currentFontSize = sorted[0].fontSize ?? 0;
  let currentIsBold = sorted[0].isBold ?? false;

  const finishLine = () => {
    // Detect tabular layout: any adjacent pair of boxes with X gap > TABULAR_X_GAP
    let isTabular = false;
    for (let j = 1; j < currentBoxes.length; j++) {
      const gap = currentBoxes[j].bounds.left - currentBoxes[j - 1].bounds.right;
      if (gap > TABULAR_X_GAP) { isTabular = true; break; }
    }
    lines.push({ text: currentParts.join(" "), topY: currentTopY, fontSize: currentFontSize, isBold: currentIsBold, isTabular });
  };

  for (let i = 1; i < sorted.length; i++) {
    const box = sorted[i];
    const cy = (box.bounds.top + box.bounds.bottom) / 2;
    if (Math.abs(cy - currentY) <= TEXT_LINE_Y_TOLERANCE) {
      currentParts.push(box.text);
      currentBoxes.push(box);
      currentFontSize = Math.max(currentFontSize, box.fontSize ?? 0);
      currentIsBold = currentIsBold || (box.isBold ?? false);
    } else {
      finishLine();
      currentParts = [box.text];
      currentBoxes = [box];
      currentY = cy;
      currentTopY = cy;
      currentFontSize = box.fontSize ?? 0;
      currentIsBold = box.isBold ?? false;
    }
  }
  finishLine();

  return lines;
}

/**
 * Run the plugin chain and return the first non-null prefix.
 * Falls back to "" (body text) if no plugin claims the line.
 */
function resolveHeadingPrefix(
  ctx: Parameters<TextLinePlugin["headingPrefix"]>[0],
  plugins: TextLinePlugin[]
): string {
  for (const plugin of plugins) {
    const result = plugin.headingPrefix(ctx);
    if (result !== null) return result;
  }
  return "";
}

/**
 * Merge consecutive blocks that share the same non-empty heading prefix,
 * but only when the Y gap between them is small (i.e. wrapped heading lines).
 * e.g. two adjacent "# " lines within one line-height become "# line1 line2".
 */
function mergeConsecutiveHeadings(
  blocks: Array<{ topY: number; content: string; isTabular?: boolean }>,
  bodyFontSize: number
): Array<{ topY: number; content: string; isTabular?: boolean }> {
  if (blocks.length === 0) return [];

  const HEADING_RE = /^(#{1,6} )/;
  // Only merge headings that are within ~3 body-text line heights of each other.
  const MAX_HEADING_GAP = Math.max(bodyFontSize * 3, 30);
  const merged: Array<{ topY: number; content: string; isTabular?: boolean }> = [];
  let current = { ...blocks[0] };

  for (let i = 1; i < blocks.length; i++) {
    const next = blocks[i];
    const curMatch = current.content.match(HEADING_RE);
    const nextMatch = next.content.match(HEADING_RE);
    const gap = current.topY - next.topY;

    if (curMatch && nextMatch && curMatch[1] === nextMatch[1] && gap <= MAX_HEADING_GAP) {
      // Same heading level and physically close — join text (strip the prefix from next block)
      current = {
        topY: current.topY,
        content: current.content + next.content.slice(nextMatch[1].length),
        isTabular: current.isTabular || next.isTabular,
      };
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

/**
 * Merge consecutive plain-text (non-heading) blocks that represent wrapped lines
 * of the same paragraph.
 *
 * Conditions for merging line A → line B (read top-to-bottom):
 *   1. Both blocks are plain text (no heading prefix, not a table row)
 *   2. Y gap ≤ LINE_WRAP_FACTOR × bodyFontSize  (within one line-height)
 *   3. Line A does NOT end with a sentence-closing mark (。！？…）」』)
 *   4. Line B starts with a hiragana character (typical mid-sentence continuation)
 */
const LINE_WRAP_FACTOR = 2.0;
/** Characters that definitively end a sentence and prevent wrapping. */
const SENTENCE_END_RE = /[。！？…」』\]]\s*$/;
/** Sentence-ending mark directly followed by closing paren — always a hard end. */
const SENTENCE_THEN_PAREN_RE = /[。！？…」』\]][）)]\s*$/;
/** Isolated closing paren at end — may or may not end a sentence. */
const CLOSE_PAREN_END_RE = /[）)]\s*$/;
/**
 * Characters that can start a wrapped continuation line.
 * Includes hiragana, katakana, CJK ideographs, and Latin characters/numbers
 * (all of which appear at the start of mid-sentence line breaks in Japanese body text).
 */
const CONTINUATION_LEAD_RE = /^[a-zA-Z0-9ａ-ｚＡ-Ｚ０-９ぁ-んァ-ン\u4e00-\u9fff\u3400-\u4dbf]/;
/**
 * Minimum length of the accumulated current block to be eligible for wrap-merge.
 * Short blocks (≤ this value) are typically standalone header/caption items
 * that should not be merged even if the next line looks like a continuation.
 */
const MIN_WRAP_LENGTH = 25;

function mergeParagraphWraps(
  blocks: Array<{ topY: number; content: string; isTabular?: boolean }>,
  bodyFontSize: number
): Array<{ topY: number; content: string }> {
  if (blocks.length === 0 || bodyFontSize <= 0) return blocks.map(({ topY, content }) => ({ topY, content }));

  const HEADING_RE = /^#{1,6} /;
  const maxGap = bodyFontSize * LINE_WRAP_FACTOR;

  // Extend blocks with lastTopY for accurate gap tracking across multi-line merges
  type WorkBlock = { topY: number; lastTopY: number; content: string; isTabular: boolean };
  const work: WorkBlock[] = blocks.map((b) => ({ ...b, lastTopY: b.topY, isTabular: b.isTabular ?? false }));
  const merged: WorkBlock[] = [];
  let current = { ...work[0] };

  for (let i = 1; i < work.length; i++) {
    const next = work[i];
    const curIsBody = !HEADING_RE.test(current.content) && !current.content.startsWith("|");
    const nextIsBody = !HEADING_RE.test(next.content) && !next.content.startsWith("|");
    // Use lastTopY of current (= most recently added line) vs topY of next
    const gap = current.lastTopY - next.topY;

    // A closing paren at end of line is a hard sentence end when:
    //   (a) a sentence-ending mark (。！？…) directly precedes the paren, OR
    //   (b) the next line does NOT start with a continuation character.
    // Otherwise (isolated paren, next line continues the sentence) we merge.
    const isHardEnd =
      SENTENCE_END_RE.test(current.content) ||
      SENTENCE_THEN_PAREN_RE.test(current.content) ||
      (CLOSE_PAREN_END_RE.test(current.content) && !CONTINUATION_LEAD_RE.test(next.content));

    const isWrap =
      curIsBody &&
      nextIsBody &&
      !current.isTabular &&   // don't merge FROM a tabular line (column headers etc.)
      !next.isTabular &&      // don't merge INTO a tabular line
      gap > 0 &&
      gap <= maxGap &&
      current.content.length > MIN_WRAP_LENGTH &&
      !isHardEnd &&
      CONTINUATION_LEAD_RE.test(next.content);

    if (isWrap) {
      current = {
        topY: current.topY,
        lastTopY: next.topY,
        content: current.content.trimEnd() + next.content.trimStart(),
        isTabular: false,
      };
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged.map(({ topY, content }) => ({ topY, content }));
}

/**
 * Render one page's content: free text and tables interleaved in top-to-bottom order.
 *
 * @param plugins - Ordered list of plugins applied to each free-text line.
 *                  The first plugin that returns a non-null prefix wins.
 */
export function renderPageContent(
  pageNumber: number,
  freeTextBoxes: TextBox[],
  tables: TableGrid[],
  plugins: TextLinePlugin[] = []
): string {
  type Block = { topY: number; content: string; isTabular?: boolean };
  const blocks: Block[] = [];

  const bodyFontSize = modalFontSize(freeTextBoxes);

  for (const { text, topY, fontSize, isBold, isTabular } of groupFreeTextIntoLines(freeTextBoxes)) {
    const normalizedText = normalizeFullWidthAscii(text);
    const prefix = resolveHeadingPrefix({ text: normalizedText, fontSize, bodyFontSize, topY, pageNumber, isBold }, plugins);
    blocks.push({ topY, content: prefix + normalizedText, isTabular: prefix === "" && isTabular });
  }

  for (const table of tables) {
    const md = table.isBorderless
      ? renderBorderlessTableToMarkdown(table)
      : renderTableGridToMarkdown(table);
    if (md.length > 0) {
      blocks.push({ topY: table.topY ?? 0, content: md });
    }
  }

  blocks.sort((a, b) => b.topY - a.topY);

  const afterHeadingMerge = mergeConsecutiveHeadings(blocks, bodyFontSize);
  const merged = mergeParagraphWraps(afterHeadingMerge, bodyFontSize);
  const normalized = normalizeDetachedFirstColumnTables(merged);
  const body = normalized.map((b) => b.content).join("\n\n");
  return `<!-- page:${pageNumber} -->\n${body}`.trim();
}

export function renderMultipleTablesToMarkdown(tables: TableGrid[]): string {
  return tables
    .map((table) => `<!-- page:${table.pageNumber} -->\n${renderTableGridToMarkdown(table)}`)
    .join("\n\n")
    .trim();
}
