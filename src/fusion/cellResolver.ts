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
 * Split a sorted-descending list of Y line positions into groups that correspond
 * to individual tables.  Two consecutive Y lines belong to the same table only if
 * at least one vertical segment physically bridges the gap between them.
 */
function splitYLinesIntoGroups(yLines: number[], verticalSegments: Segment[]): number[][] {
  if (yLines.length === 0) return [];

  // epsilon: allow small floating-point slop when comparing segment extents to grid lines
  const EPS = 1.5;

  const groups: number[][] = [];
  let currentGroup: number[] = [yLines[0]];

  for (let i = 1; i < yLines.length; i++) {
    const upperY = yLines[i - 1]; // larger Y (higher on page in PDF coordinates)
    const lowerY = yLines[i];     // smaller Y

    // A vertical segment bridges [lowerY, upperY] when it reaches both boundaries
    const isBridged = verticalSegments.some((seg) => {
      const segMin = Math.min(seg.y1, seg.y2);
      const segMax = Math.max(seg.y1, seg.y2);
      return segMin <= lowerY + EPS && segMax >= upperY - EPS;
    });

    if (isBridged) {
      currentGroup.push(yLines[i]);
    } else {
      // Gap detected: start a new table group
      groups.push(currentGroup);
      currentGroup = [yLines[i]];
    }
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
  const rows = yLines.length - 1;
  const cols = xLines.length - 1;
  const cells = buildCells(rows, cols);
  const consumedIds: string[] = [];

  // Y extent of this table group (to restrict which text boxes belong here)
  const yMin = yLines[yLines.length - 1];
  const yMax = yLines[0];
  const xMin = xLines[0];
  const xMax = xLines[xLines.length - 1];

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

    const row = yLines.findIndex((lineY, index) => {
      const next = yLines[index + 1];
      return typeof next === "number" && centerY <= lineY && centerY >= next;
    });

    const col = xLines.findIndex((lineX, index) => {
      const next = xLines[index + 1];
      return typeof next === "number" && centerX >= lineX && centerX <= next;
    });

    if (row < 0 || col < 0 || row >= rows || col >= cols) {
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

    cell.text = cell.text.length === 0 ? textBox.text : `${cell.text} ${textBox.text}`;
    cell.bounds = textBox.bounds;
    consumedIds.push(textBox.id);
  }

  const grid = pruneEmptyRows({ pageNumber, rows, cols, cells, warnings: [], topY: yLines[0] });
  return { grid, consumedIds };
}

export type ResolvedPage = {
  grids: TableGrid[];
  consumedIds: string[];
};

export function resolveTableGrids(pageNumber: number, textBoxes: TextBox[], segments: Segment[]): ResolvedPage {
  const vertical = segments.filter((s) => Math.abs(s.x1 - s.x2) <= AXIS_EPSILON);
  const horizontal = segments.filter((s) => Math.abs(s.y1 - s.y2) <= AXIS_EPSILON);

  // Derive the text Y range so we can discard segments that lie outside the page's
  // visible area (some PDFs embed table borders above/below the MediaBox).
  const textYValues = textBoxes.flatMap((t) => [t.bounds.bottom, t.bounds.top]);
  const textXValues = textBoxes.flatMap((t) => [t.bounds.left, t.bounds.right]);
  const textYMin = textYValues.length > 0 ? Math.min(...textYValues) - PAGE_MARGIN : -Infinity;
  const textYMax = textYValues.length > 0 ? Math.max(...textYValues) + PAGE_MARGIN : Infinity;
  const textXMin = textXValues.length > 0 ? Math.min(...textXValues) - PAGE_MARGIN : -Infinity;
  const textXMax = textXValues.length > 0 ? Math.max(...textXValues) + PAGE_MARGIN : Infinity;

  const filteredHorizontal = horizontal.filter((s) => s.y1 >= textYMin && s.y1 <= textYMax);
  const filteredVertical = vertical.filter((s) => {
    const xMid = (s.x1 + s.x2) / 2;
    return xMid >= textXMin && xMid <= textXMax;
  });

  const xLines = uniqueSorted(filteredVertical.flatMap((segment) => [segment.x1, segment.x2]));
  const allYLines = uniqueSorted(filteredHorizontal.flatMap((segment) => [segment.y1, segment.y2])).sort((a, b) => b - a);

  if (xLines.length < 2 || allYLines.length < 2) {
    // No vector grid detected: return empty (all text will be free text)
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
    const result = buildTableGrid(pageNumber, yLines, xLines, filteredSegments, textBoxes);
    grids.push(result.grid);
    consumedIds.push(...result.consumedIds);
  }

  return { grids, consumedIds };
}

/** @deprecated Use resolveTableGrids (plural) instead */
export function resolveTableGrid(pageNumber: number, textBoxes: TextBox[], segments: Segment[]): TableGrid {
  const { grids } = resolveTableGrids(pageNumber, textBoxes, segments);
  return grids[0] ?? { pageNumber, rows: 0, cols: 0, cells: [], warnings: [] };
}

function pruneEmptyRows(table: TableGrid): TableGrid {
  const occupiedRows = new Set(table.cells.filter((c) => c.text.length > 0).map((c) => c.row));
  if (occupiedRows.size === 0 || occupiedRows.size === table.rows) return table;

  const rowMap = new Map<number, number>();
  let newRow = 0;
  for (let r = 0; r < table.rows; r++) {
    if (occupiedRows.has(r)) {
      rowMap.set(r, newRow);
      newRow++;
    }
  }

  const prunedCells = table.cells
    .filter((c) => occupiedRows.has(c.row))
    .map((c) => ({ ...c, row: rowMap.get(c.row) ?? c.row }));

  return { ...table, rows: newRow, cells: prunedCells };
}
