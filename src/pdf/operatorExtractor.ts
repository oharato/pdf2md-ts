import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { Segment } from "../core/types.js";

type OperatorList = {
  fnArray: number[];
  argsArray: unknown[];
};

// Minimum aspect ratio to consider a filled rectangle a line segment
const LINE_ASPECT_THRESHOLD = 6;
// Minimum length (pts) to consider a segment a real border line
const MIN_LENGTH = 2;
// Maximum thickness (pts) of a valid border line (filter out filled areas)
const MAX_THICKNESS = 3;

/**
 * Convert a thin filled rectangle to a Segment.
 * constructPath [[19], [x,y,w,h], [x1,y1,x2,y2]] → eoFill
 * Horizontal line: h << w  =>  Segment from (x,cy) to (x+w,cy)
 * Vertical line:   w << h  =>  Segment from (cx,y) to (cx,y+h)
 */
function thinRectToSegment(id: string, x: number, y: number, w: number, h: number): Segment | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return null;
  }
  const aw = Math.abs(w);
  const ah = Math.abs(h);

  if (aw > ah * LINE_ASPECT_THRESHOLD && aw >= MIN_LENGTH && ah <= MAX_THICKNESS) {
    // Horizontal
    const cy = y + ah / 2;
    return { id, x1: x, y1: cy, x2: x + aw, y2: cy };
  }

  if (ah > aw * LINE_ASPECT_THRESHOLD && ah >= MIN_LENGTH && aw <= MAX_THICKNESS) {
    // Vertical
    const cx = x + aw / 2;
    return { id, x1: cx, y1: y, x2: cx, y2: y + ah };
  }

  return null;
}

/**
 * Emit up to 4 edge segments from a stroked rectangle (x, y, w, h).
 * A stroked rectangle draws its outline with thin lines, so each edge
 * is a valid table border segment regardless of the rectangle's aspect ratio.
 */
function pushStrokedRectEdges(pageNumber: number, segments: Segment[], x: number, y: number, w: number, h: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return;
  const aw = Math.abs(w);
  const ah = Math.abs(h);
  if (aw >= MIN_LENGTH) {
    // Bottom horizontal edge
    segments.push({ id: `p${pageNumber}-s${segments.length}`, x1: x, y1: y, x2: x + aw, y2: y });
    // Top horizontal edge
    segments.push({ id: `p${pageNumber}-s${segments.length}`, x1: x, y1: y + ah, x2: x + aw, y2: y + ah });
  }
  if (ah >= MIN_LENGTH) {
    // Left vertical edge
    segments.push({ id: `p${pageNumber}-s${segments.length}`, x1: x, y1: y, x2: x, y2: y + ah });
    // Right vertical edge
    segments.push({ id: `p${pageNumber}-s${segments.length}`, x1: x + aw, y1: y, x2: x + aw, y2: y + ah });
  }
}

export async function extractVectorSegments(page: unknown, pageNumber: number): Promise<Segment[]> {
  const anyPage = page as {
    getOperatorList: () => Promise<OperatorList>;
  };

  const operatorList = await anyPage.getOperatorList();
  const segments: Segment[] = [];
  // Track the current stroke width (updated by setLineWidth; reset by save/restore via stack).
  const strokeWidthStack: number[] = [];
  let strokeWidth = 1.0;

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] as unknown[] | undefined;

    // Maintain a stroke-width stack so save/restore correctly reverts the width.
    if (fn === OPS.save) {
      strokeWidthStack.push(strokeWidth);
      continue;
    }
    if (fn === OPS.restore) {
      strokeWidth = strokeWidthStack.pop() ?? strokeWidth;
      continue;
    }
    if (fn === OPS.setLineWidth && Array.isArray(args) && args.length >= 1) {
      strokeWidth = (args[0] as number) ?? strokeWidth;
      continue;
    }

    // constructPath followed by fill/stroke = border shape
    // pdfjs always appends the path bounding box as the last arg: [x1,y1,x2,y2]
    if (fn === OPS.constructPath && Array.isArray(args) && args.length >= 2) {
      const nextFn = operatorList.fnArray[index + 1];
      const isFilled = nextFn === OPS.eoFill || nextFn === OPS.fill || nextFn === OPS.fillStroke || nextFn === OPS.eoFillStroke;
      const isStroked = nextFn === OPS.stroke || nextFn === OPS.closeStroke;

      if (isFilled) {
        // Try rect sub-op path first: args[1] = [x,y,w,h]
        const subOps = args[0];
        const hasRectOp = Array.isArray(subOps) && subOps.includes(OPS.rectangle);
        if (hasRectOp) {
          const coords = args[1];
          if (Array.isArray(coords) && coords.length >= 4) {
            const [rx, ry, rw, rh] = coords as number[];
            const seg = thinRectToSegment(`p${pageNumber}-s${segments.length}`, rx, ry, rw, rh);
            if (seg) segments.push(seg);
          }
        } else {
          // General moveTo/lineTo path: last arg is always the bbox [x1,y1,x2,y2]
          const bbox = args.at(-1);
          if (Array.isArray(bbox) && bbox.length >= 4) {
            const [bx1, by1, bx2, by2] = bbox as number[];
            const seg = thinRectToSegment(
              `p${pageNumber}-s${segments.length}`,
              bx1, by1,
              bx2 - bx1,
              by2 - by1
            );
            if (seg) segments.push(seg);
          }
        }
      } else if (isStroked && strokeWidth <= MAX_THICKNESS) {
        // Stroked path with a thin stroke width — treat as table border.
        const subOps = args[0];
        const hasRectOp = Array.isArray(subOps) && subOps.includes(OPS.rectangle);
        if (hasRectOp) {
          // Stroked rectangle: the outline forms 4 border edges.
          const coords = args[1];
          if (Array.isArray(coords) && coords.length >= 4) {
            const [rx, ry, rw, rh] = coords as number[];
            pushStrokedRectEdges(pageNumber, segments, rx, ry, rw, rh);
          }
        } else {
          // General moveTo/lineTo stroked path.
          // Use the bounding box: if it is thin (line-like) treat as a single segment;
          // otherwise assume it outlines a rectangle and emit 4 edges.
          const bbox = args.at(-1);
          if (Array.isArray(bbox) && bbox.length >= 4) {
            const [bx1, by1, bx2, by2] = bbox as number[];
            const bw = bx2 - bx1;
            const bh = by2 - by1;
            const seg = thinRectToSegment(`p${pageNumber}-s${segments.length}`, bx1, by1, bw, bh);
            if (seg) {
              segments.push(seg);
            } else if (Math.abs(bw) >= MIN_LENGTH && Math.abs(bh) >= MIN_LENGTH) {
              // Non-thin bbox — likely a rectangular path outline.
              pushStrokedRectEdges(pageNumber, segments, bx1, by1, bw, bh);
            }
          }
        }
      }
      continue;
    }

    // Fallback: plain rectangle op followed by fill or stroke
    if (fn === OPS.rectangle && Array.isArray(args) && args.length >= 4) {
      const nextFn = operatorList.fnArray[index + 1];
      const isFilled = nextFn === OPS.eoFill || nextFn === OPS.fill || nextFn === OPS.fillStroke;
      const isStroked = nextFn === OPS.stroke || nextFn === OPS.closeStroke;
      const [rx, ry, rw, rh] = args as number[];
      if (isFilled) {
        const seg = thinRectToSegment(`p${pageNumber}-s${segments.length}`, rx, ry, rw, rh);
        if (seg) segments.push(seg);
      } else if (isStroked && strokeWidth <= MAX_THICKNESS) {
        pushStrokedRectEdges(pageNumber, segments, rx, ry, rw, rh);
      }
    }
  }

  return segments;
}
