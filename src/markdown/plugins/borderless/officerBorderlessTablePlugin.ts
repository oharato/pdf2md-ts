import type { TableGrid } from "../../../core/types.js";
import { escapePipes } from "../../utils.js";
import type { BorderlessTablePlugin } from "../types.js";

export const officerBorderlessTablePlugin: BorderlessTablePlugin = {
  name: "officer-borderless-table",

  render(table: TableGrid): string | null {
    if (table.cols !== 2 || table.rows < 5) return null;

    type OfficerRow = { name: string; newRole: string; currentRole: string; status: string };
    const parsed: OfficerRow[] = [];
    const pendingNameParts: string[] = [];

    const joinParts = (parts: string[]): string => parts.join(" ").replace(/\s+/g, " ").trim();
    const hasKanji = (s: string): boolean => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s);
    const hasKanaLatin = (s: string): boolean => /[ァ-ヶーぁ-ゖA-Za-z]/.test(s);

    for (let r = 1; r < table.rows; r++) {
      const label = table.cells.find((c) => c.row === r && c.col === 0)?.text.trim() ?? "";
      const value = table.cells.find((c) => c.row === r && c.col === 1)?.text.trim() ?? "";
      if (label.length === 0 && value.length === 0) continue;

      if (value.length === 0) {
        const nextValue = table.cells.find((c) => c.row === r + 1 && c.col === 1)?.text.trim() ?? "";
        const prevName = parsed.length > 0 ? parsed[parsed.length - 1].name : "";
        const sameScriptAsPrev = prevName.length > 0 && (
          (hasKanji(prevName) && hasKanji(label)) ||
          (hasKanaLatin(prevName) && hasKanaLatin(label))
        );
        if (nextValue.length > 0) {
          if (sameScriptAsPrev && parsed.length > 0) {
            parsed[parsed.length - 1].name = joinParts([parsed[parsed.length - 1].name, label]);
          } else if (label.length > 0) {
            pendingNameParts.push(label);
          }
        } else if (parsed.length > 0) {
          parsed[parsed.length - 1].name = joinParts([parsed[parsed.length - 1].name, label]);
        } else if (label.length > 0) {
          pendingNameParts.push(label);
        }
        continue;
      }

      const labelTokens = label.split(/\s+/).filter(Boolean);
      const valueTokens = value.split(/\s+/).filter(Boolean);

      let status = "";
      if (valueTokens.length >= 2) {
        const tail = valueTokens.slice(-2).join(" ");
        if (tail === "重 任" || tail === "新 任") {
          status = tail;
          valueTokens.splice(-2, 2);
        }
      }

      let currentRole = "";
      if (valueTokens.length >= 2 && valueTokens.slice(-2).join(" ") === "同 左") {
        currentRole = "同 左";
        valueTokens.splice(-2, 2);
      } else if (valueTokens.length >= 1 && valueTokens[valueTokens.length - 1] === "―") {
        currentRole = "―";
        valueTokens.splice(-1, 1);
      }

      let prefix = "";
      if (labelTokens.length > 0 && /^[\u4e00-\u9fff\u3400-\u4dbf]$/.test(labelTokens[labelTokens.length - 1])) {
        prefix = labelTokens.pop() ?? "";
      }

      const name = joinParts([...pendingNameParts, ...labelTokens]);
      pendingNameParts.length = 0;
      const newRole = joinParts([prefix, ...valueTokens]);

      parsed.push({ name, newRole, currentRole, status });
    }

    const statusFilled = parsed.filter((row) => row.status.length > 0).length;
    const currentFilled = parsed.filter((row) => row.currentRole.length > 0).length;
    const minStructuredRows = Math.ceil(parsed.length * 0.6);

    if (parsed.length >= 4 && statusFilled >= minStructuredRows && currentFilled >= minStructuredRows) {
      return [
        "| 氏名 | 新役職 | 現役職 | 新任・重任 |",
        "| --- | --- | --- | --- |",
        ...parsed.map((row) => `| ${escapePipes(row.name)} | ${escapePipes(row.newRole)} | ${escapePipes(row.currentRole)} | ${escapePipes(row.status)} |`),
      ].join("\n");
    }

    return null;
  },
};
