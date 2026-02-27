import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { resolveTableGrids } from "../src/fusion/cellResolver.js";
import { extractVectorSegments } from "../src/pdf/operatorExtractor.js";
import { extractTextBoxes } from "../src/pdf/textExtractor.js";

async function main() {
  const pdf = await getDocument(join(process.cwd(), "pdf/140120260113532690.pdf")).promise;
  const page = await pdf.getPage(3);
  const textBoxes = await extractTextBoxes(page, 3);
  const segments = await extractVectorSegments(page, 3);
  const { grids } = resolveTableGrids(3, textBoxes, segments);
  const table = [...grids].sort((a, b) => (b.topY ?? 0) - (a.topY ?? 0))[0];

  console.log(`rows=${table.rows} cols=${table.cols}`);
  for (const cell of table.cells) {
    if (cell.text.length === 0) continue;
    const visible = cell.text.replace(/\u00A0/g, "[NBSP]").replace(/\u200B/g, "[ZWSP]");
    console.log(`r${cell.row} c${cell.col} trim=${cell.text.trim().length} text=${JSON.stringify(visible)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
