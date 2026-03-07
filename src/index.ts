import { loadPdfDocument } from "./pdf/pageModel.js";
import { extractTextBoxes } from "./pdf/textExtractor.js";
import { extractVectorSegments } from "./pdf/operatorExtractor.js";
import { resolveTableGrids } from "./fusion/cellResolver.js";
import { renderPageContent } from "./markdown/render.js";
import { tdnetHeadingPlugin } from "./markdown/plugins/tdnetHeading.js";
import type { ExtractOptions, ExtractResult, TableGrid } from "./core/types.js";

export async function extractTablesFromPdf(filePath: string, options: ExtractOptions = {}): Promise<ExtractResult> {
  const pdf = await loadPdfDocument(filePath);
  const pages = options.pages ?? Array.from({ length: pdf.numPages }, (_, index) => index + 1);
  const plugins = options.plugins ?? [tdnetHeadingPlugin];
  const postProcessPlugins = options.postProcessPlugins;
  const borderlessTablePlugins = options.borderlessTablePlugins;

  const tables: TableGrid[] = [];
  const warnings: string[] = [];
  const pageMarkdowns: string[] = [];

  for (const pageNumber of pages) {
    const page = await pdf.getPage(pageNumber);
    const textBoxes = await extractTextBoxes(page, pageNumber);
    const segments = await extractVectorSegments(page, pageNumber);
    const { grids, consumedIds } = resolveTableGrids(pageNumber, textBoxes, segments);

    for (const grid of grids) {
      tables.push(grid);
      warnings.push(...grid.warnings.map((warning) => `p${pageNumber}: ${warning}`));
    }

    const consumedSet = new Set(consumedIds);
    const freeTextBoxes = textBoxes.filter((tb) => !consumedSet.has(tb.id));

    pageMarkdowns.push(
      renderPageContent(
        pageNumber,
        freeTextBoxes,
        grids,
        plugins,
        postProcessPlugins,
        borderlessTablePlugins,
      )
    );
  }

  const markdown = pageMarkdowns.join("\n\n");
  return { tables, markdown, warnings };
}

export type { ExtractOptions, ExtractResult, TableGrid } from "./core/types.js";
export type {
  BorderlessTablePlugin,
  PageBlock,
  PageBlockPlugin,
  TextLinePlugin,
  TextLineContext,
} from "./markdown/plugins/types.js";
export { tdnetHeadingPlugin } from "./markdown/plugins/tdnetHeading.js";
export { defaultBorderlessTablePlugins } from "./markdown/plugins/borderlessTablePlugins.js";
export { defaultPageBlockPlugins } from "./markdown/plugins/pageBlockPlugins.js";
