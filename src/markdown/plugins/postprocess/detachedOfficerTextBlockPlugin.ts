import { escapePipes, normalizeFullWidthAscii } from "../../utils.js";
import type { PageBlock, PageBlockPlugin } from "../types.js";

export const detachedOfficerTextBlockPlugin: PageBlockPlugin = {
  name: "detached-officer-text-block",

  transform(blocks: PageBlock[]): PageBlock[] {
    const HEADING_RE = /^#{1,6}\s/;
    const TABLE_RE = /^\s*\|/;
    const STATUS_TAIL_RE = /(重\s*任|新\s*任)\s*$/;
    const CURRENT_ROLE_RE = /(同\s*左|―)\s*(重\s*任|新\s*任)\s*$/;
    const ROLE_HINT_RE = /^(社|外|取|締|役|代|表|監|査|等|委|員|会|長)$/;

    const isPlain = (text: string): boolean => !HEADING_RE.test(text) && !TABLE_RE.test(text);
    const splitTokens = (text: string): string[] => text.trim().split(/[ \t　]+/).filter(Boolean);

    function parseOfficerRow(text: string): { name: string; newRole: string; currentRole: string; status: string } | null {
      const normalized = normalizeFullWidthAscii(text).trim();
      if (!STATUS_TAIL_RE.test(normalized) || !CURRENT_ROLE_RE.test(normalized)) return null;

      const tokens = splitTokens(normalized);
      if (tokens.length < 7) return null;

      const status = tokens.slice(-2).join(" ");
      if (!(status === "重 任" || status === "新 任")) return null;
      tokens.splice(-2, 2);

      let currentRole = "";
      if (tokens.length >= 2 && tokens.slice(-2).join(" ") === "同 左") {
        currentRole = "同 左";
        tokens.splice(-2, 2);
      } else if (tokens.length >= 1 && tokens[tokens.length - 1] === "―") {
        currentRole = "―";
        tokens.splice(-1, 1);
      } else {
        return null;
      }

      const roleStart = tokens.findIndex((t) => ROLE_HINT_RE.test(t));
      if (roleStart < 2) return null;

      const name = tokens.slice(0, roleStart).join(" ").trim();
      const newRole = tokens.slice(roleStart).join(" ").trim();
      if (name.length === 0 || newRole.length === 0) return null;

      return { name, newRole, currentRole, status };
    }

    function parseRetiredRow(text: string): { name: string; currentRole: string } | null {
      const normalized = normalizeFullWidthAscii(text).trim();
      const tokens = splitTokens(normalized);
      if (tokens.length < 4) return null;

      const roleStart = tokens.findIndex((t) => ROLE_HINT_RE.test(t));
      if (roleStart < 2) return null;

      const name = tokens.slice(0, roleStart).join(" ").trim();
      const currentRole = tokens.slice(roleStart).join(" ").trim();
      if (name.length === 0 || currentRole.length === 0) return null;
      return { name, currentRole };
    }

    const out: PageBlock[] = [];
    let i = 0;
    while (i < blocks.length) {
      const current = blocks[i];
      const currentText = normalizeFullWidthAscii(current.content).trim();

      const headerLike4 =
        isPlain(current.content) &&
        currentText.includes("氏") &&
        currentText.includes("名") &&
        currentText.includes("役") &&
        currentText.includes("職") &&
        currentText.includes("新") &&
        currentText.includes("任");

      const headerLike2 =
        isPlain(current.content) &&
        currentText.includes("氏") &&
        currentText.includes("名") &&
        currentText.includes("役") &&
        currentText.includes("職") &&
        !currentText.includes("新") &&
        !currentText.includes("任");

      if (!headerLike4 && !headerLike2) {
        out.push(current);
        i++;
        continue;
      }

      if (headerLike4) {
        const parsedRows: Array<{ name: string; newRole: string; currentRole: string; status: string }> = [];
        let j = i + 1;
        while (j < blocks.length) {
          const text = blocks[j].content;
          if (!isPlain(text)) break;
          const parsed = parseOfficerRow(text);
          if (!parsed) break;
          parsedRows.push(parsed);
          j++;
        }

        if (parsedRows.length >= 3) {
          const table = [
            "| 氏名 | 新役職 | 現役職 | 新任・重任 |",
            "| --- | --- | --- | --- |",
            ...parsedRows.map((r) => `| ${escapePipes(r.name)} | ${escapePipes(r.newRole)} | ${escapePipes(r.currentRole)} | ${escapePipes(r.status)} |`),
          ].join("\n");
          out.push({ topY: current.topY, content: table });
          i = j;
          continue;
        }
      }

      if (headerLike2) {
        const parsedRows: Array<{ name: string; currentRole: string }> = [];
        let j = i + 1;
        while (j < blocks.length) {
          const text = blocks[j].content;
          if (!isPlain(text)) break;
          const parsed = parseRetiredRow(text);
          if (!parsed) break;
          parsedRows.push(parsed);
          j++;
        }

        if (parsedRows.length >= 2) {
          const table = [
            "| 氏名 | 現役職 |",
            "| --- | --- |",
            ...parsedRows.map((r) => `| ${escapePipes(r.name)} | ${escapePipes(r.currentRole)} |`),
          ].join("\n");
          out.push({ topY: current.topY, content: table });
          i = j;
          continue;
        }
      }

      out.push(current);
      i++;
    }

    return out;
  },
};
