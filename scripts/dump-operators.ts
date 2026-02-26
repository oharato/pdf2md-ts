/**
 * Diagnostic: dump operator list for a PDF page to understand what drawing
 * commands are used for the table borders.
 * Usage: npx tsx scripts/dump-operators.ts pdf/xxx.pdf [pageNumber=1]
 */
import { join } from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

// Invert OPS enum so we can print readable names
const OPS_NAME: Record<number, string> = {};
for (const [key, value] of Object.entries(OPS as Record<string, number>)) {
  OPS_NAME[value] = key;
}

async function main() {
  const [, , pdfPath = "pdf/140120260106529570.pdf", pageStr = "1"] = process.argv;
  const pageNum = Number(pageStr);

  const pdf = await getDocument(join(process.cwd(), pdfPath)).promise;
  const page = await pdf.getPage(pageNum);
  const ops = await (page as any).getOperatorList();

  console.log(`\n=== Operator list for page ${pageNum} (${pdfPath}) ===`);
  console.log(`Total ops: ${ops.fnArray.length}\n`);

  // Count and sample each unique op
  const counts: Record<string, number> = {};
  for (const fn of ops.fnArray) {
    const name = OPS_NAME[fn] ?? `unknown(${fn})`;
    counts[name] = (counts[name] ?? 0) + 1;
  }

  console.log("=== Op frequency ===");
  for (const [name, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`);
  }

  // Print ops around each eoFill (context of 3 before and 1 after)
  const eoFillOp = OPS["eoFill" as keyof typeof OPS] as number;
  const fillOp = OPS["fill" as keyof typeof OPS] as number;
  const stroke = OPS["stroke" as keyof typeof OPS] as number;
  const fillStroke = OPS["fillStroke" as keyof typeof OPS] as number;
  const targetOps = new Set([eoFillOp, fillOp, stroke, fillStroke].filter(Boolean));

  console.log(`\n=== constructPath ops leading to fill/eoFill/stroke (contextual, max 40 hits) ===`);
  let hits = 0;
  for (let i = 0; i < ops.fnArray.length && hits < 40; i++) {
    if (targetOps.has(ops.fnArray[i])) {
      const start = Math.max(0, i - 4);
      for (let j = start; j <= Math.min(i + 1, ops.fnArray.length - 1); j++) {
        const fn = ops.fnArray[j];
        const name = OPS_NAME[fn] ?? `unknown(${fn})`;
        const args = (ops.argsArray[j] as unknown[] | undefined) ?? [];
        console.log(`  [${String(j).padStart(4)}] ${name.padEnd(24)} ${JSON.stringify(args).slice(0, 160)}`);
      }
      console.log("  ---");
      hits++;
    }
  }

  console.log("\n=== First 120 ops (index: name args) ===");
  for (let i = 0; i < Math.min(120, ops.fnArray.length); i++) {
    const fn = ops.fnArray[i];
    const name = OPS_NAME[fn] ?? `unknown(${fn})`;
    const args = (ops.argsArray[i] as unknown[] | undefined) ?? [];
    console.log(`  [${String(i).padStart(4)}] ${name.padEnd(24)} ${JSON.stringify(args).slice(0, 160)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
