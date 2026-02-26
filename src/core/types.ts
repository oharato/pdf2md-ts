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
};

export type ExtractOptions = {
  pages?: number[];
  debug?: boolean;
};

export type ExtractResult = {
  tables: TableGrid[];
  markdown: string;
  warnings: string[];
};
