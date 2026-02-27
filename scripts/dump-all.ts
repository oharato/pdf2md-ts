/**
 * Dump all text boxes and segments for a page.
 * Usage: npx tsx scripts/dump-all.ts pdf/xxx.pdf [pageNumber=1]
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

  console.log(`\nText boxes (${textBoxes.length} total):`);
  for (const t of textBoxes) {
    const box = t.bounds;
    console.log(`  "${t.text}" x=[${box.left.toFixed(1)},${box.right.toFixed(1)}] y=[${box.bottom.toFixed(1)},${box.top.toFixed(1)}]`);
  }

  const horiz = segments.filter((s) => Math.abs(s.y1 - s.y2) <= 0.8);
  const vert = segments.filter((s) => Math.abs(s.x1 - s.x2) <= 0.8);
  console.log(`\nSegments: ${segments.length} total (H:${horiz.length} V:${vert.length})`);
  for (const s of segments) {
    const type = Math.abs(s.y1 - s.y2) <= 0.8 ? "H" : "V";
    console.log(`  ${type}: x=[${s.x1.toFixed(1)},${s.x2.toFixed(1)}] y=[${s.y1.toFixed(1)},${s.y2.toFixed(1)}]`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
