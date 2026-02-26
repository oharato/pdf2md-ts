import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { extractTablesFromPdf } from "./index.js";

type CliArgs = {
  input: string;
  out?: string;
  page?: number;
  debugJson?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const input = args.find((arg) => !arg.startsWith("--"));
  if (!input) {
    throw new Error("Usage: npm run build && npm run cli -- <input.pdf> [--out output.md] [--page 1] [--debug-json out.json]");
  }

  const outIndex = args.indexOf("--out");
  const pageIndex = args.indexOf("--page");
  const debugIndex = args.indexOf("--debug-json");

  return {
    input,
    out: outIndex >= 0 ? args[outIndex + 1] : undefined,
    page: pageIndex >= 0 ? Number(args[pageIndex + 1]) : undefined,
    debugJson: debugIndex >= 0 ? args[debugIndex + 1] : undefined
  };
}

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const result = await extractTablesFromPdf(resolve(args.input), {
    pages: typeof args.page === "number" && Number.isFinite(args.page) ? [args.page] : undefined,
    debug: typeof args.debugJson === "string"
  });

  if (args.out) {
    const outPath = resolve(args.out);
    await ensureParentDir(outPath);
    await writeFile(outPath, `${result.markdown}\n`, "utf8");
    console.log(`Markdown written: ${outPath}`);
  } else {
    process.stdout.write(`${result.markdown}\n`);
  }

  if (args.debugJson) {
    const debugPath = resolve(args.debugJson);
    await ensureParentDir(debugPath);
    await writeFile(debugPath, JSON.stringify(result.tables, null, 2), "utf8");
    console.log(`Debug JSON written: ${debugPath}`);
  }

  if (result.warnings.length > 0) {
    console.warn(result.warnings.join("\n"));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
