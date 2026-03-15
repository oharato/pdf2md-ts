import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pdfjsPath = path.dirname(require.resolve("pdfjs-dist/package.json"));
const cMapUrl = path.join(pdfjsPath, "cmaps") + "/";
const standardFontDataUrl = path.join(pdfjsPath, "standard_fonts") + "/";

export async function loadPdfDocument(filePath: string): Promise<PDFDocumentProxy> {
  return getDocument({
    url: filePath,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    verbosity: 0
  }).promise;
}
