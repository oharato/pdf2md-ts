import { join } from "node:path";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { extractTextBoxes } from "../src/pdf/textExtractor.js";

async function main() {
  const [, , pdfPath = "pdf/140120260113532690.pdf", pageStr = "1", filterStr = ""] = process.argv;
  const pageNum = Number(pageStr);

  const pdf = await getDocument(join(process.cwd(), pdfPath)).promise;
  const page = await pdf.getPage(pageNum);
  const boxes = await extractTextBoxes(page, pageNum);

  boxes
    .filter((b) => !filterStr || b.text.includes(filterStr))
    .forEach((b) => console.log(`[${b.fontSize?.toFixed(2)}] ${b.text}`));
}

main().catch(console.error);
