import { describe, expect, it } from "vitest";

import { renderTableGridToMarkdown } from "../src/markdown/render.js";

describe("renderTableGridToMarkdown", () => {
  it("renders a 2x2 table", () => {
    const markdown = renderTableGridToMarkdown({
      pageNumber: 1,
      rows: 2,
      cols: 2,
      warnings: [],
      cells: [
        { row: 0, col: 0, text: "A", rowSpan: 1, colSpan: 1 },
        { row: 0, col: 1, text: "B", rowSpan: 1, colSpan: 1 },
        { row: 1, col: 0, text: "C", rowSpan: 1, colSpan: 1 },
        { row: 1, col: 1, text: "D", rowSpan: 1, colSpan: 1 }
      ]
    });

    expect(markdown).toContain("| A | B |");
    expect(markdown).toContain("| C | D |");
  });
});
