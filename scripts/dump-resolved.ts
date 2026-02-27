/**
 * Diagnostic: dump what gets consumed by resolveTableGrids vs what remains.
 * Usage: npx tsx scripts/dump-resolved.ts pdf/xxx.pdf [pageNumber=2]
 */
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractVectorSegments } from "../src/pdf/operatorExtractor.js";
import { extractTextBoxes } from "../src/pdf/textExtractor.js";
import { resolveTableGrids } from "../src/fusion/cellResolver.js";

async function main() {
  const [, , pdfPath = "pdf/140120260113532690.pdf", pageStr = "2"] = process.argv;
  const pageNum = Number(pageStr);

  const pdf = await getDocument(join(process.cwd(), pdfPath)).promise;
  const page = await pdf.getPage(pageNum);

  const textBoxes = await extractTextBoxes(page, pageNum);
  const segments = await extractVectorSegments(page, pageNum);
  const { grids, consumedIds } = resolveTableGrids(pageNum, textBoxes, segments);

  const consumedSet = new Set(consumedIds);
  const freeBoxes = textBoxes.filter((tb) => !consumedSet.has(tb.id));

  console.log(`\nGrids detected: ${grids.length}`);
  for (const g of grids) {
    console.log(`  Grid: rows=${g.rows} cols=${g.cols} topY=${g.topY}`);
    for (const cell of g.cells) {
      console.log(`    [${cell.row},${cell.col}]: "${cell.text.slice(0, 60)}"`);
    }
  }
  console.log(`\nConsumed: ${consumedIds.length} boxes`);
  console.log(`\nFree text boxes (${freeBoxes.length} total):`);
  for (const t of freeBoxes) {
    const box = t.bounds;
    console.log(`  "${t.text}" x=[${box.left.toFixed(1)},${box.right.toFixed(1)}] y=[${box.bottom.toFixed(1)},${box.top.toFixed(1)}]`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
