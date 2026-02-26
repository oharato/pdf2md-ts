import type { TableGrid, TextBox } from "../core/types.js";

function escapePipes(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", "<br>");
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

  const header = `| ${matrix[0].join(" | ")} |`;
  const divider = `| ${Array.from({ length: table.cols }, () => "---").join(" | ")} |`;
  const body = matrix
    .slice(1)
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");

  return [header, divider, body].filter((line) => line.length > 0).join("\n");
}

// Y tolerance for grouping text boxes onto the same visual line (pts)
const TEXT_LINE_Y_TOLERANCE = 3;

/**
 * Group free text boxes into horizontal lines, sorted top-to-bottom.
 * Returns each line as `{ text: string; topY: number }`.
 */
function groupFreeTextIntoLines(textBoxes: TextBox[]): Array<{ text: string; topY: number }> {
  if (textBoxes.length === 0) return [];

  // Sort top-to-bottom (descending Y), then left-to-right
  const sorted = [...textBoxes].sort((a, b) => {
    const ya = (a.bounds.top + a.bounds.bottom) / 2;
    const yb = (b.bounds.top + b.bounds.bottom) / 2;
    const dy = yb - ya;
    if (Math.abs(dy) > TEXT_LINE_Y_TOLERANCE) return dy;
    return a.bounds.left - b.bounds.left;
  });

  const lines: Array<{ text: string; topY: number }> = [];
  let currentY = (sorted[0].bounds.top + sorted[0].bounds.bottom) / 2;
  let currentParts: string[] = [sorted[0].text];
  let currentTopY = currentY;

  for (let i = 1; i < sorted.length; i++) {
    const box = sorted[i];
    const cy = (box.bounds.top + box.bounds.bottom) / 2;
    if (Math.abs(cy - currentY) <= TEXT_LINE_Y_TOLERANCE) {
      currentParts.push(box.text);
    } else {
      lines.push({ text: currentParts.join(" "), topY: currentTopY });
      currentParts = [box.text];
      currentY = cy;
      currentTopY = cy;
    }
  }
  lines.push({ text: currentParts.join(" "), topY: currentTopY });

  return lines;
}

/**
 * Render one page's content: free text and tables interleaved in top-to-bottom order.
 */
export function renderPageContent(pageNumber: number, freeTextBoxes: TextBox[], tables: TableGrid[]): string {
  type Block = { topY: number; content: string };
  const blocks: Block[] = [];

  for (const { text, topY } of groupFreeTextIntoLines(freeTextBoxes)) {
    blocks.push({ topY, content: text });
  }

  for (const table of tables) {
    const md = renderTableGridToMarkdown(table);
    if (md.length > 0) {
      blocks.push({ topY: table.topY ?? 0, content: md });
    }
  }

  // Sort top-to-bottom (descending Y = higher on page first)
  blocks.sort((a, b) => b.topY - a.topY);

  const body = blocks.map((b) => b.content).join("\n\n");
  return `<!-- page:${pageNumber} -->\n${body}`.trim();
}

export function renderMultipleTablesToMarkdown(tables: TableGrid[]): string {
  return tables
    .map((table) => `<!-- page:${table.pageNumber} -->\n${renderTableGridToMarkdown(table)}`)
    .join("\n\n")
    .trim();
}
