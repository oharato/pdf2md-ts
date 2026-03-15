import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";

export async function loadPdfDocument(filePath: string): Promise<PDFDocumentProxy> {
  return getDocument(filePath).promise;
}
