import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function loadPdfDocument(filePath: string) {
  return getDocument(filePath).promise;
}
