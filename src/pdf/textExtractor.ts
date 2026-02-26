import type { TextBox } from "../core/types.js";

type PdfTextItem = {
  str: string;
  width: number;
  height: number;
  transform: [number, number, number, number, number, number];
  hasEOL?: boolean;
};

// Two items are on the same line if their Y positions are within this tolerance
const SAME_LINE_Y_TOLERANCE = 2;
// Maximum horizontal gap to still merge two items as one word.
// 14pt covers the inter-character spacing in CJK fonts at typical document sizes.
const MAX_MERGE_GAP = 14;

type RawBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Merge horizontally adjacent raw boxes on the same line into words/phrases */
function mergeIntoWords(raws: RawBox[]): RawBox[] {
  if (raws.length === 0) return [];

  // Sort by y descending (top-first) then x ascending
  const sorted = [...raws].sort((a, b) => {
    const dy = b.y - a.y;
    return Math.abs(dy) > SAME_LINE_Y_TOLERANCE ? dy : a.x - b.x;
  });

  const merged: RawBox[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const sameY = Math.abs(next.y - current.y) <= SAME_LINE_Y_TOLERANCE;
    const close = next.x <= current.x + current.width + MAX_MERGE_GAP;

    if (sameY && close) {
      // Merge: extend current box
      const gap = next.x - (current.x + current.width);
      const separator = gap > 1 ? " " : "";
      current.text += separator + next.text;
      current.width = next.x + next.width - current.x;
      current.height = Math.max(current.height, next.height);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

export async function extractTextBoxes(page: unknown, pageNumber: number): Promise<TextBox[]> {
  const anyPage = page as {
    getTextContent: () => Promise<{ items: unknown[] }>;
  };

  const textContent = await anyPage.getTextContent();
  const raws: RawBox[] = [];

  for (const item of textContent.items) {
    const t = item as PdfTextItem;
    if (!t?.str || t.str.trim().length === 0) continue;

    const x = t.transform[4];
    const y = t.transform[5];
    const width = Math.max(t.width, 0.01);
    const height = Math.max(t.height, 1);
    raws.push({ text: t.str, x, y, width, height });
  }

  const words = mergeIntoWords(raws);

  return words.map((w, index) => ({
    id: `p${pageNumber}-t${index}`,
    text: w.text.trim(),
    pageNumber,
    bounds: {
      left: w.x,
      right: w.x + w.width,
      bottom: w.y,
      top: w.y + w.height
    }
  })).filter((b) => b.text.length > 0);
}
