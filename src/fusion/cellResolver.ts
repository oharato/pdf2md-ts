import type { TableCell, TableGrid, TextBox, Segment } from "../core/types.js";
import { castRaysForTextBox } from "../raycast/raycast.js";

function uniqueSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const result: number[] = [];
  for (const value of sorted) {
    if (result.length === 0 || Math.abs(result[result.length - 1] - value) > 1) {
      result.push(value);
    }
  }
  return result;
}

/**
 * Count distinct X positions of vertical segments that physically bridge the
 * gap between upperY (higher) and lowerY (lower).
 */
function countBridgingVLineCols(upperY: number, lowerY: number, verticalSegments: Segment[]): number {
  const EPS = 1.5;
  const xs = new Set<number>();
  for (const seg of verticalSegments) {
    const segMin = Math.min(seg.y1, seg.y2);
    const segMax = Math.max(seg.y1, seg.y2);
    if (segMin <= lowerY + EPS && segMax >= upperY - EPS) {
      xs.add(Math.round(seg.x1));
    }
  }
  return xs.size;
}

/**
 * Threshold: when the bridging column count was >= this value on the previous
 * gap but drops below it on the current gap, the two parts are treated as
 * separate tables (e.g. a fully-bordered table followed by a header-only table).
 */
const MIN_RICH_BRIDGING_COLS = 3;

/**
 * Split a sorted-descending list of Y line positions into groups that correspond
 * to individual tables.  Two consecutive Y lines belong to the same table only if
 * at least one vertical segment physically bridges the gap between them.
 *
 * Additionally, when the number of bridging column lines drops from "rich" (≥ 3)
 * to "sparse" (< 3), the groups are split even if bridging still occurs — this
 * separates a fully-bordered table from an adjacent header-only / border-only table
 * that merely shares the same outer vertical border.
 */
function splitYLinesIntoGroups(yLines: number[], verticalSegments: Segment[]): number[][] {
  if (yLines.length === 0) return [];

  // epsilon: allow small floating-point slop when comparing segment extents to grid lines
  const EPS = 1.5;

  const groups: number[][] = [];
  let currentGroup: number[] = [yLines[0]];
  // Track column-line count for the most recent gap in the current group
  let prevBridgingCols = -1;

  for (let i = 1; i < yLines.length; i++) {
    const upperY = yLines[i - 1]; // larger Y (higher on page in PDF coordinates)
    const lowerY = yLines[i];     // smaller Y

    // A vertical segment bridges [lowerY, upperY] when it reaches both boundaries
    const isBridged = verticalSegments.some((seg) => {
      const segMin = Math.min(seg.y1, seg.y2);
      const segMax = Math.max(seg.y1, seg.y2);
      return segMin <= lowerY + EPS && segMax >= upperY - EPS;
    });

    if (!isBridged) {
      // Physical gap — start a new group
      groups.push(currentGroup);
      currentGroup = [yLines[i]];
      prevBridgingCols = -1;
      continue;
    }

    const cols = countBridgingVLineCols(upperY, lowerY, verticalSegments);

    // Detect column-structure transition: rich → sparse
    // (e.g. multi-column table row followed by border-only rows)
    if (prevBridgingCols >= MIN_RICH_BRIDGING_COLS && cols < MIN_RICH_BRIDGING_COLS) {
      groups.push(currentGroup);
      currentGroup = [yLines[i - 1], yLines[i]];
      prevBridgingCols = cols;
      continue;
    }

    currentGroup.push(yLines[i]);
    prevBridgingCols = cols;
  }
  groups.push(currentGroup);
  return groups;
}

function buildCells(rows: number, cols: number): TableCell[] {
  const cells: TableCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({ row, col, text: "", rowSpan: 1, colSpan: 1 });
    }
  }
  return cells;
}

// Segments from thin-rect borders: x1==x2 means vertical, y1==y2 means horizontal
// Use a small epsilon to account for floating-point imprecision
const AXIS_EPSILON = 0.8;
// Margin around text bounding box when filtering out-of-range segments
const PAGE_MARGIN = 20;

/**
 * Build a single TableGrid from a specific set of yLines (sorted descending),
 * xLines (sorted ascending), the matching segments, and the textBoxes on this page.
 * Returns the grid and the set of text box IDs that were placed inside a cell.
 */
function buildTableGrid(
  pageNumber: number,
  yLines: number[],
  xLines: number[],
  filteredSegments: Segment[],
  textBoxes: TextBox[]
): { grid: TableGrid; consumedIds: string[] } {
  let rows = yLines.length - 1;
  const cols = xLines.length - 1;
  const cells = buildCells(rows, cols);
  const consumedIds: string[] = [];

  // Y extent of this table group (to restrict which text boxes belong here)
  const yMin = yLines[yLines.length - 1];
  const yMax = yLines[0];
  const xMin = xLines[0];
  const xMax = xLines[xLines.length - 1];

  // Look for header text boxes just above the grid
  const headerBoxes = textBoxes.filter((tb) => {
    const centerY = (tb.bounds.top + tb.bounds.bottom) / 2;
    const centerX = (tb.bounds.left + tb.bounds.right) / 2;
    return centerY > yMax && centerY <= yMax + 20 && centerX >= xMin && centerX <= xMax;
  });

  if (headerBoxes.length > 0) {
    // Add a new row at the top
    rows += 1;
    // Shift existing cells down
    for (const cell of cells) {
      cell.row += 1;
    }
    // Add header cells
    for (let col = 0; col < cols; col += 1) {
      cells.push({ row: 0, col, text: "", rowSpan: 1, colSpan: 1 });
    }
    // Place header boxes
    for (const tb of headerBoxes) {
      const centerX = (tb.bounds.left + tb.bounds.right) / 2;
      const col = xLines.findIndex((lineX, index) => {
        const next = xLines[index + 1];
        return typeof next === "number" && centerX >= lineX && centerX <= next;
      });
      if (col >= 0 && col < cols) {
        const cell = cells.find((c) => c.row === 0 && c.col === col);
        if (cell) {
          cell.text = cell.text.length === 0 ? tb.text : `${cell.text} ${tb.text}`;
          consumedIds.push(tb.id);
        }
      }
    }
  }

  const cellBoxes = new Map<TableCell, TextBox[]>();

  for (const textBox of textBoxes) {
    const centerX = (textBox.bounds.left + textBox.bounds.right) / 2;
    const centerY = (textBox.bounds.top + textBox.bounds.bottom) / 2;

    // Only consider text boxes within this table's bounding box
    if (centerY < yMin || centerY > yMax || centerX < xMin || centerX > xMax) {
      continue;
    }

    // Use raycasting as a confidence boost but don't gate on it when we have a clear grid
    const rays = castRaysForTextBox(textBox, filteredSegments);
    const rayConfidence = rays.filter((ray) => ray.segmentId !== null).length;

    let row = yLines.findIndex((lineY, index) => {
      const next = yLines[index + 1];
      return typeof next === "number" && centerY <= lineY && centerY >= next;
    });

    if (row < 0 || row >= (headerBoxes.length > 0 ? rows - 1 : rows)) {
      continue;
    }

    if (headerBoxes.length > 0) {
      row += 1;
    }

    const col = xLines.findIndex((lineX, index) => {
      const next = xLines[index + 1];
      return typeof next === "number" && centerX >= lineX && centerX <= next;
    });

    if (col < 0 || col >= cols) {
      continue;
    }

    // Require at least 1 ray boundary hit to avoid placing text that is clearly outside all borders
    if (rayConfidence === 0) {
      continue;
    }

    const cell = cells.find((candidate) => candidate.row === row && candidate.col === col);
    if (!cell) {
      continue;
    }

    let boxes = cellBoxes.get(cell);
    if (!boxes) {
      boxes = [];
      cellBoxes.set(cell, boxes);
    }
    boxes.push(textBox);
    consumedIds.push(textBox.id);
  }

  for (const [cell, boxes] of cellBoxes.entries()) {
    boxes.sort((a, b) => b.bounds.top - a.bounds.top); // Sort descending by Y
    const lines: string[] = [];
    let currentLine: string[] = [];
    let currentY = boxes[0].bounds.top;

    for (const box of boxes) {
      if (Math.abs(box.bounds.top - currentY) > 5) {
        lines.push(currentLine.join(" "));
        currentLine = [box.text];
        currentY = box.bounds.top;
      } else {
        currentLine.push(box.text);
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine.join(" "));
    }
    cell.text = lines.join("<br>");
    cell.bounds = boxes[0].bounds; // Approximation
  }

  const grid = pruneEmptyRowsAndCols({ pageNumber, rows, cols, cells, warnings: [], topY: yLines[0] });
  return { grid, consumedIds };
}

export type ResolvedPage = {
  grids: TableGrid[];
  consumedIds: string[];
};

// ---------------------------------------------------------------------------
// H-line-only table: column structure inferred from text box X positions
// ---------------------------------------------------------------------------

/**
 * Minimum gap (in points) between consecutive text-box center-X values
 * to be recognized as a column boundary.
 */
const COL_GAP_THRESHOLD = 20;

/**
 * Maximum Y gap allowed between consecutive visual rows when extending the table
 * below the vector-defined yMin boundary.
 */
const HONLY_ROW_GAP = 30;

/**
 * Vertical row clustering tolerance (same row if mid-Y values differ by ≤ this).
 */
const HONLY_ROW_TOLERANCE = 8;

/**
 * Minimum Y-span (in points) required to treat a H-line group as a real table.
 * Thin stripes (H-lines very close together) are decorative borders, not tables.
 */
const MIN_TABLE_HEIGHT = 24;

/**
 * Minimum spread (in points) of text-box left edges required to confirm
 * a multi-column layout. Groups where all boxes start at the same left margin
 * are treated as paragraph text inside a decorative border, not real tables.
 */
const MIN_LEFT_SPREAD = 50;

/**
 * Infer column boundary X positions from a set of text boxes using gap detection.
 * Returns a sorted ascending list of boundary X values (at least [xMin, xMax]).
 */
function inferXLinesFromBoxes(textBoxes: TextBox[], xMin: number, xMax: number): number[] {
  const centers = textBoxes
    .map((tb) => (tb.bounds.left + tb.bounds.right) / 2)
    .sort((a, b) => a - b);

  if (centers.length === 0) return [xMin, xMax];

  const boundaries: number[] = [xMin];
  for (let i = 1; i < centers.length; i++) {
    const gap = centers[i] - centers[i - 1];
    if (gap >= COL_GAP_THRESHOLD) {
      boundaries.push((centers[i - 1] + centers[i]) / 2);
    }
  }
  boundaries.push(xMax);
  return boundaries;
}

/**
 * Build a TableGrid for a "header-line-only" table: one where horizontal vector
 * lines define row boundaries but there are no interior vertical column lines.
 * Column boundaries are inferred from the X distribution of text boxes.
 *
 * The table is also extended downward below `yMin` to capture data rows whose
 * vector horizontal lines may be missing in the PDF.
 *
 * @param alreadyConsumed - IDs of text boxes already placed in earlier grids
 */
function buildHLineOnlyTable(
  pageNumber: number,
  yLines: number[],  // sorted descending
  xMin: number,
  xMax: number,
  textBoxes: TextBox[],
  alreadyConsumed: Set<string>
): { grid: TableGrid; consumedIds: string[] } | null {
  const yMax = yLines[0];
  const yMin = yLines[yLines.length - 1];

  const candidates = textBoxes.filter((tb) => !alreadyConsumed.has(tb.id));

  // Collect boxes within the vector-defined Y range.
  // Use the left edge (not center) for the X-min check so that paragraph text
  // that starts to the LEFT of the table border (xMin) is not captured.
  // Paragraph text typically starts at page margin (x≈65), while actual table
  // labels start just inside the H-line border (x≈84+). A tolerance of 30pt
  // lets table-row labels through while excluding full-width paragraphs.
  const BOX_LEFT_TOLERANCE = 30;
  const inRange = candidates.filter((tb) => {
    const cy = (tb.bounds.top + tb.bounds.bottom) / 2;
    return tb.bounds.left >= xMin - BOX_LEFT_TOLERANCE && tb.bounds.right <= xMax + BOX_LEFT_TOLERANCE && cy >= yMin && cy <= yMax;
  });

  // Extend downward below yMin to capture data rows with missing H-lines
  const belowYMin = candidates
    .filter((tb) => {
      const cx = (tb.bounds.left + tb.bounds.right) / 2;
      const cy = (tb.bounds.top + tb.bounds.bottom) / 2;
      return cx >= xMin && cx <= xMax && cy < yMin;
    })
    .sort((a, b) => ((b.bounds.top + b.bounds.bottom) / 2) - ((a.bounds.top + a.bounds.bottom) / 2));

  const extensionBoxes: TextBox[] = [];
  let lastY = yMin;
  for (const tb of belowYMin) {
    const cy = (tb.bounds.top + tb.bounds.bottom) / 2;
    if (lastY - cy > HONLY_ROW_GAP) break; // large gap → stop extending
    extensionBoxes.push(tb);
    lastY = cy;
  }

  const allBoxes = [...inRange, ...extensionBoxes];
  if (allBoxes.length === 0) return null;

  // If all text boxes share nearly the same left edge, this is paragraph text
  // flowing inside a decorative border — not a real columnar table.
  const leftEdges = allBoxes.map((tb) => tb.bounds.left);
  const leftSpread = Math.max(...leftEdges) - Math.min(...leftEdges);
  if (leftSpread < MIN_LEFT_SPREAD) return null;

  // Infer column boundaries from the combined set of text boxes
  const xLines = inferXLinesFromBoxes(allBoxes, xMin, xMax);
  if (xLines.length < 2) return null;
  const cols = xLines.length - 1;

  // Group all boxes into visual rows by mid-Y proximity (descending Y)
  type VisualRow = { midY: number; boxes: TextBox[] };
  const visualRows: VisualRow[] = [];
  const sortedBoxes = [...allBoxes].sort((a, b) => {
    const ya = (a.bounds.top + a.bounds.bottom) / 2;
    const yb = (b.bounds.top + b.bounds.bottom) / 2;
    if (Math.abs(ya - yb) > 0.5) return yb - ya; // descending Y
    return (a.bounds.left - b.bounds.left); // left to right within same row
  });

  for (const box of sortedBoxes) {
    const cy = (box.bounds.top + box.bounds.bottom) / 2;
    const last = visualRows[visualRows.length - 1];
    if (last && Math.abs(last.midY - cy) <= HONLY_ROW_TOLERANCE) {
      last.boxes.push(box);
    } else {
      visualRows.push({ midY: cy, boxes: [box] });
    }
  }

  if (visualRows.length === 0) return null;

  // Build cells
  const cells: TableCell[] = [];
  const consumedIds: string[] = [];

  for (let rowIdx = 0; rowIdx < visualRows.length; rowIdx++) {
    const vrow = visualRows[rowIdx];
    const colBoxes = new Map<number, TextBox[]>();

    for (const box of vrow.boxes) {
      const cx = (box.bounds.left + box.bounds.right) / 2;
      const col = xLines.findIndex((lineX, idx) => {
        const next = xLines[idx + 1];
        return typeof next === "number" && cx >= lineX && cx <= next;
      });
      if (col >= 0 && col < cols) {
        if (!colBoxes.has(col)) colBoxes.set(col, []);
        colBoxes.get(col)!.push(box);
      }
    }

    for (let c = 0; c < cols; c++) {
      const cbs = (colBoxes.get(c) ?? []).sort(
        (a, b) => (b.bounds.left + b.bounds.right) / 2 - (a.bounds.left + a.bounds.right) / 2
      );
      cells.push({ row: rowIdx, col: c, text: cbs.map((b) => b.text).join(" "), rowSpan: 1, colSpan: 1 });
      consumedIds.push(...cbs.map((b) => b.id));
    }
  }

  const rows = visualRows.length;
  // Use the first visual row's Y as topY so that the table is sorted after any
  // headings or free text that appear above the first actual data row.
  const contentTopY = visualRows.length > 0 ? visualRows[0].midY : yMax;
  const grid = pruneEmptyRowsAndCols({
    pageNumber,
    rows,
    cols,
    cells,
    warnings: [],
    topY: contentTopY,
    isBorderless: false,
  });
  return { grid, consumedIds };
}

// ---------------------------------------------------------------------------
// Borderless two-column table detection
// ---------------------------------------------------------------------------

/**
 * X threshold that separates the "label" column from the "value" column
 * in a borderless two-column layout (e.g. company profile tables in TDnet PDFs).
 * Boxes whose `left` < BORDERLESS_SPLIT_X are treated as label cells;
 * those with `left` >= BORDERLESS_SPLIT_X are treated as value cells on the
 * same row or continuation lines of the previous value cell.
 */
const BORDERLESS_SPLIT_X = 185;

/**
 * Minimum number of rows that must be detected before we consider the cluster
 * to be a genuine table (not just a few indented lines).
 */
const BORDERLESS_MIN_ROWS = 4;

/**
 * Two text-box mid-Y values are considered on the "same row" when they are
 * within this many points vertically.
 */
const BORDERLESS_ROW_TOLERANCE = 8;

/**
 * Try to detect a borderless two-column table in a set of text boxes.
 *
 * Algorithm:
 *  1. Group every text box into a "visual row" by clustering mid-Y values.
 *  2. A visual row is a "label row" if at least one box starts left of BORDERLESS_SPLIT_X.
 *  3. Find the longest run of consecutive rows (by Y proximity) that are label rows.
 *  4. If the run is at least BORDERLESS_MIN_ROWS tall, emit a 2-col TableGrid.
 *
 * Within each visual row:
 *  - Boxes with left < BORDERLESS_SPLIT_X → concatenated as the label cell.
 *  - Boxes with left >= BORDERLESS_SPLIT_X → concatenated (left-to-right) as the value cell.
 *
 * "Continuation" rows (rows that have no label-column box and whose value box
 * starts at x >= BORDERLESS_SPLIT_X) are appended to the previous row's value cell.
 */
function detectBorderlessTable(
  pageNumber: number,
  textBoxes: TextBox[],
  alreadyConsumed: Set<string>
): { grid: TableGrid; consumedIds: string[] } | null {
  // Only consider boxes not already placed in a vector-based table
  const candidates = textBoxes.filter((tb) => !alreadyConsumed.has(tb.id));
  if (candidates.length === 0) return null;

  // Step 1: sort by mid-Y descending (top of page first), then left ascending
  const sorted = [...candidates].sort((a, b) => {
    const ya = (a.bounds.top + a.bounds.bottom) / 2;
    const yb = (b.bounds.top + b.bounds.bottom) / 2;
    const dy = yb - ya;
    if (Math.abs(dy) > 0.5) return dy;
    return a.bounds.left - b.bounds.left;
  });

  // Step 2: group into visual rows
  type VisualRow = { midY: number; boxes: TextBox[] };
  const visualRows: VisualRow[] = [];
  for (const box of sorted) {
    const midY = (box.bounds.top + box.bounds.bottom) / 2;
    const last = visualRows[visualRows.length - 1];
    if (last && Math.abs(last.midY - midY) <= BORDERLESS_ROW_TOLERANCE) {
      last.boxes.push(box);
    } else {
      visualRows.push({ midY, boxes: [box] });
    }
  }

  // Step 3: classify rows and find longest qualifying run
  // A row qualifies as a "label row" if it has at least one box left of BORDERLESS_SPLIT_X.
  function hasLabelBox(row: VisualRow): boolean {
    return row.boxes.some((b) => b.bounds.left < BORDERLESS_SPLIT_X);
  }

  // Also track "continuation rows" (only value-column boxes, no label box) — they
  // extend the previous label row's value cell.
  function hasContinuationOnly(row: VisualRow): boolean {
    return !hasLabelBox(row) && row.boxes.some((b) => b.bounds.left >= BORDERLESS_SPLIT_X);
  }

  /** A row is "dual" when it has BOTH a label-column box AND a value-column box. */
  function isDualRow(row: VisualRow): boolean {
    return hasLabelBox(row) && row.boxes.some((b) => b.bounds.left >= BORDERLESS_SPLIT_X);
  }

/**
 * Maximum Y gap (in points) between consecutive visual rows within the same
 * borderless table group.  A gap larger than this breaks the group.
 * Typical body line height in TDnet PDFs is ~15 pts; allow up to ~2× that.
 */
const BORDERLESS_MAX_ROW_GAP = 30;

  // Find contiguous groups that start with a label row and may include continuation rows
  type RowGroup = { startIdx: number; endIdx: number };
  const groups: RowGroup[] = [];
  let i = 0;
  while (i < visualRows.length) {
    if (hasLabelBox(visualRows[i])) {
      const start = i;
      let end = i;
      // Absorb following continuation rows
      let j = i + 1;
      while (j < visualRows.length) {
        // Check Y gap — a large gap breaks the table group
        const prevMidY = visualRows[j - 1].midY;
        const nextMidY = visualRows[j].midY;
        const gap = prevMidY - nextMidY; // positive (descending Y)
        if (gap > BORDERLESS_MAX_ROW_GAP) break;

        if (hasLabelBox(visualRows[j])) {
          // Another label row — absorb it
          end = j;
          j++;
        } else if (hasContinuationOnly(visualRows[j])) {
          // Continuation of previous label row's value
          end = j;
          j++;
        } else {
          // Plain body text row: break the group
          break;
        }
      }
      groups.push({ startIdx: start, endIdx: end });
      i = j;
    } else {
      i++;
    }
  }

  if (groups.length === 0) return null;

  // Pick the largest group (most dual rows)
  const best = groups.reduce((a, b) => {
    const aCount = visualRows.slice(a.startIdx, a.endIdx + 1).filter(isDualRow).length;
    const bCount = visualRows.slice(b.startIdx, b.endIdx + 1).filter(isDualRow).length;
    return bCount > aCount ? b : a;
  });

  const dualRowCount = visualRows.slice(best.startIdx, best.endIdx + 1).filter(isDualRow).length;
  if (dualRowCount < BORDERLESS_MIN_ROWS) return null;

  // Step 4: build 2-col grid
  // Trim any leading/trailing label-only rows (those without a value-column box)
  // so that the table starts and ends on a dual row.
  const tableRows = visualRows.slice(best.startIdx, best.endIdx + 1);
  let firstDual = tableRows.findIndex(isDualRow);
  if (firstDual < 0) return null; // no dual rows at all (shouldn't happen, checked above)
  // Keep continuation rows before the first dual row? No — skip them.
  const trimmedRows = tableRows.slice(firstDual);
  const consumedIds: string[] = [];

  /**
   * X threshold beyond which value boxes are considered "clean" values with no
   * label overflow.  Boxes whose `left` is between BORDERLESS_SPLIT_X and this
   * value may start with 1–3 CJK characters that are actually the tail end of
   * the label (justified spacing pushed them into the value column).
   */
  const LABEL_OVERFLOW_NEAR_X = BORDERLESS_SPLIT_X + 30; // 215
  /** Matches 1–3 CJK characters followed by whitespace and remaining content. */
  const LABEL_OVERFLOW_MIXED_RE = /^([\u4e00-\u9fff\u3400-\u4dbf]{1,3})\s+([\s\S]+)$/;
  /** Matches a box that contains ONLY 1–3 CJK characters (no value content). */
  const LABEL_OVERFLOW_SOLO_RE = /^[\u4e00-\u9fff\u3400-\u4dbf]{1,3}$/;

  // Merge consecutive runs: label rows produce a table row; continuation rows
  // append their value text to the nearest preceding label row.
  type TableRow = { label: string; value: string };
  const tableData: TableRow[] = [];

  for (const vRow of trimmedRows) {
    const labelBoxes = vRow.boxes
      .filter((b) => b.bounds.left < BORDERLESS_SPLIT_X)
      .sort((a, b) => a.bounds.left - b.bounds.left);
    const valueBoxes = vRow.boxes
      .filter((b) => b.bounds.left >= BORDERLESS_SPLIT_X)
      .sort((a, b) => a.bounds.left - b.bounds.left);

    // Build label parts, absorbing label-overflow characters from near-boundary
    // value boxes (caused by PDF justified spacing pushing label chars rightward).
    const labelParts: string[] = labelBoxes.map((b) => b.text);
    const valueParts: string[] = [];

    for (const vBox of valueBoxes) {
      const text = vBox.text.trim();
      if (vBox.bounds.left < LABEL_OVERFLOW_NEAR_X) {
        const mixed = text.match(LABEL_OVERFLOW_MIXED_RE);
        if (mixed) {
          // e.g. "称 株式会社 LLL" → label+="称", value="株式会社 LLL"
          labelParts.push(mixed[1]);
          valueParts.push(mixed[2]);
        } else if (LABEL_OVERFLOW_SOLO_RE.test(text)) {
          // e.g. standalone "地" box → all label overflow, no value content
          labelParts.push(text);
        } else {
          valueParts.push(text);
        }
      } else {
        valueParts.push(text);
      }
    }

    const labelText = labelParts.join(" ").replace(/\s+/g, " ").trim();
    const valueText = valueParts.join(" ").replace(/\s+/g, " ").trim();

    if (labelText.length > 0) {
      // New table row
      tableData.push({ label: labelText, value: valueText });
    } else if (valueText.length > 0 && tableData.length > 0) {
      // Continuation: append value to the last row
      const prev = tableData[tableData.length - 1];
      prev.value = prev.value.length > 0 ? `${prev.value} ${valueText}` : valueText;
    }

    consumedIds.push(...vRow.boxes.map((b) => b.id));
  }

  // Build TableGrid (2 cols: label, value)
  const rows = tableData.length;
  const cols = 2;
  const cells: import("../core/types.js").TableCell[] = [];
  for (let r = 0; r < rows; r++) {
    cells.push({ row: r, col: 0, text: tableData[r].label, rowSpan: 1, colSpan: 1 });
    cells.push({ row: r, col: 1, text: tableData[r].value, rowSpan: 1, colSpan: 1 });
  }

  const topY = visualRows[best.startIdx].midY;
  const grid: TableGrid = { pageNumber, rows, cols, cells, warnings: [], topY, isBorderless: true };
  return { grid, consumedIds };
}

export function resolveTableGrids(pageNumber: number, textBoxes: TextBox[], segments: Segment[]): ResolvedPage {
  const vertical = segments.filter((s) => Math.abs(s.x1 - s.x2) <= AXIS_EPSILON);
  const horizontal = segments.filter((s) => Math.abs(s.y1 - s.y2) <= AXIS_EPSILON);

  // Derive the text Y range so we can discard segments that lie outside the page's
  // visible area (some PDFs embed table borders above/below the MediaBox).
  const textYValues = textBoxes.flatMap((t) => [t.bounds.bottom, t.bounds.top]);
  const textYMin = textYValues.length > 0 ? Math.min(...textYValues) - PAGE_MARGIN : -Infinity;
  const textYMax = textYValues.length > 0 ? Math.max(...textYValues) + PAGE_MARGIN : Infinity;

  const textXValues = textBoxes.flatMap((t) => [t.bounds.left, t.bounds.right]);
  const textXMin = textXValues.length > 0 ? Math.min(...textXValues) - 100 : -Infinity;
  const textXMax = textXValues.length > 0 ? Math.max(...textXValues) + 100 : Infinity;

  const filteredHorizontal = horizontal.filter((s) => s.y1 >= textYMin && s.y1 <= textYMax && s.x1 <= textXMax && s.x2 >= textXMin);

  // For vertical segments, use the horizontal extent of the detected H-lines (not
  // just the text bounding box) so that outer border lines beyond the text area
  // (e.g. a right table border at x=744 when text only reaches x=530) are included.
  const hMaxX2 = filteredHorizontal.length > 0
    ? Math.max(...filteredHorizontal.map((s) => s.x2))
    : textXMax;
  const vSegXMax = Math.max(textXMax, hMaxX2 + PAGE_MARGIN);

  const filteredVertical = vertical.filter((s) => {
    const segMin = Math.min(s.y1, s.y2);
    const segMax = Math.max(s.y1, s.y2);
    return segMax >= textYMin && segMin <= textYMax && s.x1 >= textXMin && s.x1 <= vSegXMax;
  });

  const allYLines = uniqueSorted(filteredHorizontal.flatMap((segment) => [segment.y1, segment.y2])).sort((a, b) => b - a);

  if (allYLines.length < 2) {
    // No vector grid detected: try borderless two-column table detection
    const borderless = detectBorderlessTable(pageNumber, textBoxes, new Set());
    if (borderless) {
      return { grids: [borderless.grid], consumedIds: borderless.consumedIds };
    }
    return { grids: [], consumedIds: [] };
  }

  const filteredSegments = [...filteredHorizontal, ...filteredVertical];

  // Split Y lines into groups separated by vertical-segment gaps.
  // Each group corresponds to one independent table on the page.
  const yGroups = splitYLinesIntoGroups(allYLines, filteredVertical);

  const grids: TableGrid[] = [];
  const consumedIds: string[] = [];

  for (const yLines of yGroups) {
    if (yLines.length < 2) continue;

    const yMin = yLines[yLines.length - 1];
    const yMax = yLines[0];
    // Only include vertical segments whose extent meaningfully passes through
    // the interior of this group (not just touching the boundary from outside).
    const groupVerticals = filteredVertical.filter((s) => {
      const segMin = Math.min(s.y1, s.y2);
      const segMax = Math.max(s.y1, s.y2);
      return segMin < yMax - 1.5 && segMax > yMin + 1.5;
    });
    const groupXLines = uniqueSorted(groupVerticals.flatMap((segment) => [segment.x1, segment.x2]));

    if (groupXLines.length < 2) {
      // No interior column lines — try to infer columns from text box positions.
      // Skip thin decorative stripes with insufficient height.
      if (yMax - yMin < MIN_TABLE_HEIGHT) continue;
      // Derive xMin/xMax from the horizontal segments defining this group's rows.
      const groupHoriz = filteredHorizontal.filter((s) => s.y1 >= yMin - 1.5 && s.y1 <= yMax + 1.5);
      if (groupHoriz.length === 0) continue;
      const hxMin = Math.min(...groupHoriz.map((s) => s.x1));
      const hxMax = Math.max(...groupHoriz.map((s) => s.x2));
      const result = buildHLineOnlyTable(
        pageNumber,
        yLines,
        hxMin,
        hxMax,
        textBoxes,
        new Set(consumedIds)
      );
      if (result) {
        grids.push(result.grid);
        consumedIds.push(...result.consumedIds);
      }
      continue;
    }

    // Skip groups where the Y-span is too small to be a real table.
    // Thin stripes (span < MIN_TABLE_HEIGHT) are decorative PDF borders.
    if (yMax - yMin < MIN_TABLE_HEIGHT) continue;

    const result = buildTableGrid(pageNumber, yLines, groupXLines, filteredSegments, textBoxes);
    grids.push(result.grid);
    consumedIds.push(...result.consumedIds);
  }

  // After vector-based tables, check for any remaining text boxes that form
  // a borderless two-column table (e.g. company profile sections).
  const consumedSet = new Set(consumedIds);
  const borderless = detectBorderlessTable(pageNumber, textBoxes, consumedSet);
  if (borderless) {
    grids.push(borderless.grid);
    consumedIds.push(...borderless.consumedIds);
  }

  return { grids, consumedIds };
}

/** @deprecated Use resolveTableGrids (plural) instead */
export function resolveTableGrid(pageNumber: number, textBoxes: TextBox[], segments: Segment[]): TableGrid {
  const { grids } = resolveTableGrids(pageNumber, textBoxes, segments);
  return grids[0] ?? { pageNumber, rows: 0, cols: 0, cells: [], warnings: [] };
}

function pruneEmptyRowsAndCols(table: TableGrid): TableGrid {
  const occupiedRows = new Set(table.cells.filter((c) => c.text.trim().length > 0).map((c) => c.row));
  const occupiedCols = new Set(table.cells.filter((c) => c.text.trim().length > 0).map((c) => c.col));

  if (occupiedRows.size === 0) return table;

  const rowMap = new Map<number, number>();
  let newRow = 0;
  for (let r = 0; r < table.rows; r++) {
    if (occupiedRows.has(r)) {
      rowMap.set(r, newRow);
      newRow++;
    }
  }

  const colMap = new Map<number, number>();
  let newCol = 0;
  for (let c = 0; c < table.cols; c++) {
    if (occupiedCols.has(c)) {
      colMap.set(c, newCol);
      newCol++;
    }
  }

  const prunedCells = table.cells
    .filter((c) => occupiedRows.has(c.row) && occupiedCols.has(c.col))
    .map((c) => ({ ...c, row: rowMap.get(c.row) ?? c.row, col: colMap.get(c.col) ?? c.col }));

  return { ...table, rows: newRow, cols: newCol, cells: prunedCells };
}
