/**
 * Diagnostic: check text rendering mode via operator list.
 * Usage: npx tsx scripts/dump-fonts.ts pdf/xxx.pdf [pageNumber=1]
 */
import { join } from "node:path";

import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

async function main() {
  const [, , pdfPath = "pdf/140120260113532690.pdf", pageStr = "1"] = process.argv;
  const pageNum = Number(pageStr);

  const pdf = await getDocument(join(process.cwd(), pdfPath)).promise;
  const page = await pdf.getPage(pageNum);
  const opList = await page.getOperatorList();

  const { fnArray, argsArray } = opList;
  console.log("OPS.setFont =", OPS.setFont, "  OPS.setTextRenderingMode =", OPS.setTextRenderingMode);
  console.log("OPS.showText =", OPS.showText, "  OPS.showSpacedText =", OPS.showSpacedText);
  console.log("");

  // Walk operators and track current font & render mode
  let currentFont = "";
  let currentRenderMode = 0;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    if (fn === OPS.setFont) {
      currentFont = args[0] as string;
    } else if (fn === OPS.setTextRenderingMode) {
      currentRenderMode = args[0] as number;
    } else if (fn === OPS.showText || fn === OPS.showSpacedText) {
      // showText: args[0] is array of glyph objects
      const pieces = (args[0] as any[])
        .filter((g) => g?.unicode)
        .map((g) => g.unicode)
        .join("");
      if (pieces.trim()) {
        console.log(`font=${currentFont} renderMode=${currentRenderMode} | ${pieces}`);
      }
    }
  }
}

main().catch(console.error);
