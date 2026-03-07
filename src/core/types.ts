export type Point = {
  x: number;
  y: number;
};

export type Bounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type Segment = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidth?: number;
};

export type TextBox = {
  id: string;
  text: string;
  bounds: Bounds;
  pageNumber: number;
  /** Dominant font size (pts) of the text items in this box. */
  fontSize?: number;
  /**
   * True when the text was rendered with PDF text rendering mode 2 (fill+stroke),
   * which makes it appear visually bold even if the underlying font is not bold.
   */
  isBold?: boolean;
};

export type RayHit = {
  direction: "up" | "down" | "left" | "right";
  segmentId: string | null;
  distance: number;
};

export type CellCandidate = {
  id: string;
  bounds: Bounds;
  source: "vector" | "raycast" | "hybrid";
  score: number;
};

export type TableCell = {
  row: number;
  col: number;
  text: string;
  rowSpan: number;
  colSpan: number;
  bounds?: Bounds;
};

export type TableGrid = {
  pageNumber: number;
  rows: number;
  cols: number;
  cells: TableCell[];
  warnings: string[];
  /** Top Y coordinate of the table on the page (PDF coordinate: larger = higher). */
  topY?: number;
  /**
   * True when this grid was detected as a borderless two-column layout
   * (no vector lines).  Rendered as a nested list instead of a Markdown table.
   */
  isBorderless?: boolean;
};

export type ExtractOptions = {
  pages?: number[];
  debug?: boolean;
  /**
   * Ordered list of text-line plugins applied during Markdown rendering.
   * The first plugin returning a non-null prefix wins.
   * Defaults to `[tdnetHeadingPlugin]` when not specified.
   */
  plugins?: import("../markdown/plugins/types.js").TextLinePlugin[];
  /**
   * Ordered list of block-level post-process plugins applied after generic
   * render normalization.
   * Defaults to `defaultPageBlockPlugins` when not specified.
   */
  postProcessPlugins?: import("../markdown/plugins/types.js").PageBlockPlugin[];
  /**
   * Ordered list of borderless-table render plugins.
   * Defaults to `defaultBorderlessTablePlugins` when not specified.
   */
  borderlessTablePlugins?: import("../markdown/plugins/types.js").BorderlessTablePlugin[];
};

export type ExtractResult = {
  tables: TableGrid[];
  markdown: string;
  warnings: string[];
};
