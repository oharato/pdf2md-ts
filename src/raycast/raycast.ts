import type { RayHit, Segment, TextBox } from "../core/types.js";

function intersectsX(segment: Segment, x: number): boolean {
  const minX = Math.min(segment.x1, segment.x2);
  const maxX = Math.max(segment.x1, segment.x2);
  return x >= minX && x <= maxX;
}

function intersectsY(segment: Segment, y: number): boolean {
  const minY = Math.min(segment.y1, segment.y2);
  const maxY = Math.max(segment.y1, segment.y2);
  return y >= minY && y <= maxY;
}

export function castRaysForTextBox(textBox: TextBox, segments: Segment[]): RayHit[] {
  const centerX = (textBox.bounds.left + textBox.bounds.right) / 2;
  const centerY = (textBox.bounds.top + textBox.bounds.bottom) / 2;

  let up: RayHit = { direction: "up", segmentId: null, distance: Number.POSITIVE_INFINITY };
  let down: RayHit = { direction: "down", segmentId: null, distance: Number.POSITIVE_INFINITY };
  let left: RayHit = { direction: "left", segmentId: null, distance: Number.POSITIVE_INFINITY };
  let right: RayHit = { direction: "right", segmentId: null, distance: Number.POSITIVE_INFINITY };

  for (const segment of segments) {
    const isHorizontal = Math.abs(segment.y1 - segment.y2) < 0.5;
    const isVertical = Math.abs(segment.x1 - segment.x2) < 0.5;

    if (isHorizontal && intersectsX(segment, centerX)) {
      const distance = segment.y1 - centerY;
      if (distance >= 0 && distance < up.distance) {
        up = { direction: "up", segmentId: segment.id, distance };
      }
      const downDistance = centerY - segment.y1;
      if (downDistance >= 0 && downDistance < down.distance) {
        down = { direction: "down", segmentId: segment.id, distance: downDistance };
      }
    }

    if (isVertical && intersectsY(segment, centerY)) {
      const distance = centerX - segment.x1;
      if (distance >= 0 && distance < left.distance) {
        left = { direction: "left", segmentId: segment.id, distance };
      }
      const rightDistance = segment.x1 - centerX;
      if (rightDistance >= 0 && rightDistance < right.distance) {
        right = { direction: "right", segmentId: segment.id, distance: rightDistance };
      }
    }
  }

  return [up, down, left, right];
}
