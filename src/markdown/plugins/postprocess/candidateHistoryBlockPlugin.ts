import { escapePipes, normalizeFullWidthAscii, parsePipeRow } from "../../utils.js";
import type { PageBlock, PageBlockPlugin } from "../types.js";

export const candidateHistoryBlockPlugin: PageBlockPlugin = {
  name: "candidate-history-block",

  transform(blocks: PageBlock[]): PageBlock[] {
    const HEADING_RE = /^#{1,6}\s/;
    const TABLE_RE = /^\s*\|/;
    const isHeading = (text: string): boolean => HEADING_RE.test(text.trim());
    const isTable = (text: string): boolean => TABLE_RE.test(text.trim());
    const isPageMarker = (text: string): boolean => /^<!--\s*page:\d+\s*-->$/.test(text.trim());
    const isSectionDivider = (text: string): boolean => /^【.+】$/.test(text.trim()) || (text.includes("略歴") && !isTable(text));

    const isReasonTable = (text: string): boolean => isTable(text) && text.includes("(選任理由)");
    const squeeze = (text: string): string => text.replace(/\s+/g, " ").trim();

    function tableDataToText(md: string): string {
      const lines = md.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("|"));
      const rows = lines
        .filter((line) => !/^\|\s*[-: ]+\|/.test(line))
        .map(parsePipeRow)
        .filter((cells) => cells.length > 0);
      return rows.flat().map((c) => c.replace(/<br>/g, " ").trim()).filter(Boolean).join(" ");
    }

    function extractReason(md: string): string {
      const lines = md.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("|"));
      const rows = lines
        .filter((line) => !/^\|\s*[-: ]+\|/.test(line))
        .map(parsePipeRow)
        .filter((cells) => cells.length > 0);
      const reasonRow = rows.find((cells) => cells.some((c) => c.includes("(選任理由)")));
      if (!reasonRow) return "";
      return squeeze(reasonRow.join(" ").replace(/<br>/g, " "));
    }

    function extractStock(text: string): string {
      const m = text.match(/(?:―|[0-9,]+)\s*株/);
      return m ? m[0].replace(/\s+/g, "") : "";
    }

    function extractName(text: string): string {
      const s = normalizeFullWidthAscii(text);
      const nameLike = [...s.matchAll(/([\u4e00-\u9fff\u3400-\u4dbfァ-ヴー・]{1,24}\s+[\u4e00-\u9fff\u3400-\u4dbfァ-ヴー・]{1,24})/g)]
        .map((m) => m[1])
        .filter((v) => !v.includes("年") && !v.includes("月") && !v.includes("入社") && !v.includes("取締役") && !v.includes("社外"));
      if (nameLike.length === 0) return "";
      return squeeze(nameLike[nameLike.length - 1]);
    }

    const out: PageBlock[] = [];
    let chunkStart = 0;

    const pushRangeAsIs = (start: number, end: number) => {
      for (let k = start; k <= end; k++) {
        if (k >= 0 && k < blocks.length) out.push(blocks[k]);
      }
    };

    const flushCandidateChunk = (endIdx: number) => {
      if (chunkStart < 0 || endIdx < chunkStart) return;

      const context = blocks.slice(chunkStart, endIdx + 1);
      const reasonBlock = context.find((b) => isReasonTable(b.content));
      if (!reasonBlock) {
        for (const b of context) out.push(b);
        return;
      }

      const hasProfileHeader = context.some((b) => {
        const t = normalizeFullWidthAscii(b.content).trim();
        if (isTable(t)) return t.includes("氏 名") && t.includes("所有株式数");
        return /氏\s*名/.test(t) && t.includes("略") && t.includes("株");
      });
      if (!hasProfileHeader) {
        for (const b of context) out.push(b);
        return;
      }

      // Keep already-formed candidate history table untouched.
      if (context.length === 1 && context[0] === reasonBlock) {
        const t = normalizeFullWidthAscii(reasonBlock.content).trim();
        if (t.includes("氏 名") && t.includes("所有株式数")) {
          out.push(reasonBlock);
          return;
        }
      }

      const reason = extractReason(reasonBlock.content);
      const contextText = squeeze(
        context
          .filter((b) => !isReasonTable(b.content))
          .map((b) => {
            const t = normalizeFullWidthAscii(b.content).trim();
            if (t === "氏 名 略 歴 所有株式数" || t === "項目 内容") return "";
            return isTable(t) ? tableDataToText(t) : t;
          })
          .filter(Boolean)
          .join(" ")
      );

      const stock = extractStock(contextText);
      const name = extractName(contextText);
      let history = contextText;
      if (name.length > 0) history = history.replace(name, " ");
      if (stock.length > 0) history = history.replace(stock, " ");
      history = squeeze(history);

      const table = [
        "| 氏名 | 略歴 | 所有株式数 |",
        "| --- | --- | --- |",
        `| ${escapePipes(name)} | ${escapePipes(history)} | ${escapePipes(stock)} |`,
        `| ${escapePipes(reason)} |  |  |`,
      ].join("\n");

      out.push({ topY: blocks[chunkStart].topY, content: table });
    };

    for (let i = 0; i < blocks.length; i++) {
      const text = normalizeFullWidthAscii(blocks[i].content).trim();

      if (isHeading(text) || isPageMarker(text) || isSectionDivider(text)) {
        if (i - 1 >= chunkStart) pushRangeAsIs(chunkStart, i - 1);
        out.push(blocks[i]);
        chunkStart = i + 1;
        continue;
      }

      if (isReasonTable(text)) {
        flushCandidateChunk(i);
        chunkStart = i + 1;
      }
    }

    if (chunkStart < blocks.length) pushRangeAsIs(chunkStart, blocks.length - 1);
    return out;
  },
};
