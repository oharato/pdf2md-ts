/**
 * Diagnostic: dump extracted segments and text boxes for a page.
 * Usage: npx tsx scripts/dump-segments.ts pdf/xxx.pdf [pageNumber=1]
 */
import { join } from "node:path";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { extractVectorSegments } from "../src/pdf/operatorExtractor.js";
import { extractTextBoxes } from "../src/pdf/textExtractor.js";

async function main() {
  const [, , pdfPath = "pdf/140120260113532690.pdf", pageStr = "1"] = process.argv;
  const pageNum = Number(pageStr);

  const pdf = await getDocument(join(process.cwd(), pdfPath)).promise;
  const page = await pdf.getPage(pageNum);

  const segments = await extractVectorSegments(page, pageNum);
  const textBoxes = await extractTextBoxes(page, pageNum);

  const horiz = segments.filter((s) => Math.abs(s.y1 - s.y2) <= 0.8);
  const vert = segments.filter((s) => Math.abs(s.x1 - s.x2) <= 0.8);

  console.log(`\nSegments: ${segments.length} total (${horiz.length} horizontal, ${vert.length} vertical)`);

  const uniqueY = [...new Set(horiz.map((s) => Math.round(s.y1 * 10) / 10))].sort((a, b) => b - a);
  const uniqueX = [...new Set(vert.map((s) => Math.round(s.x1 * 10) / 10))].sort((a, b) => a - b);

  console.log(`\nUnique Y lines (${uniqueY.length}): ${JSON.stringify(uniqueY)}`);
  console.log(`\nUnique X lines (${uniqueX.length}): ${JSON.stringify(uniqueX)}`);

  console.log(`\nText boxes: ${textBoxes.length}`);
  for (const t of textBoxes.slice(0, 20)) {
    const box = t.bounds;
    console.log(`  "${t.text}" x=[${box.left.toFixed(1)},${box.right.toFixed(1)}] y=[${box.bottom.toFixed(1)},${box.top.toFixed(1)}]`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
