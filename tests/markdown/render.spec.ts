import { describe, expect, it } from "vitest";

import { renderPageContent, renderTableGridToMarkdown } from "../../src/markdown/render.js";
import { tdnetHeadingPlugin } from "../../src/markdown/plugins/tdnetHeading.js";
import type { TextLinePlugin } from "../../src/markdown/plugins/types.js";
import type { TableGrid, TextBox } from "../../src/core/types.js";

// ---- helpers ----------------------------------------------------------------

let _id = 0;
function box(
  text: string,
  opts: { x?: number; y?: number; w?: number; h?: number; fontSize?: number; pageNumber?: number } = {}
): TextBox {
  const { x = 100, y = 500, w = 100, h = 10, fontSize = 10.5, pageNumber = 1 } = opts;
  return {
    id: `t${_id++}`,
    text,
    pageNumber,
    fontSize,
    bounds: { left: x, right: x + w, bottom: y, top: y + h }
  };
}

function grid(overrides: Partial<TableGrid> = {}): TableGrid {
  return {
    pageNumber: 1,
    rows: 2,
    cols: 2,
    topY: 300,
    warnings: [],
    cells: [
      { row: 0, col: 0, text: "氏名", rowSpan: 1, colSpan: 1 },
      { row: 0, col: 1, text: "役職", rowSpan: 1, colSpan: 1 },
      { row: 1, col: 0, text: "山田", rowSpan: 1, colSpan: 1 },
      { row: 1, col: 1, text: "社長", rowSpan: 1, colSpan: 1 }
    ],
    ...overrides
  };
}

// ---- renderTableGridToMarkdown ----------------------------------------------

describe("renderTableGridToMarkdown", () => {
  it("2×2 テーブルを正しくレンダリングする", () => {
    const md = renderTableGridToMarkdown(grid());
    expect(md).toBe("| 氏名 | 役職 |\n| --- | --- |\n| 山田 | 社長 |");
  });

  it("rows=0 → 空文字", () => {
    expect(renderTableGridToMarkdown(grid({ rows: 0, cells: [] }))).toBe("");
  });

  it("cols=0 → 空文字", () => {
    expect(renderTableGridToMarkdown(grid({ cols: 0, cells: [] }))).toBe("");
  });

  it("セル内の | はエスケープされる", () => {
    const g = grid({
      rows: 1,
      cols: 1,
      cells: [{ row: 0, col: 0, text: "A|B", rowSpan: 1, colSpan: 1 }]
    });
    expect(renderTableGridToMarkdown(g)).toContain("A\\|B");
  });
});

// ---- renderPageContent (プラグインなし) -------------------------------------

describe("renderPageContent (plugins=[])", () => {
  it("ページコメントヘッダが含まれる", () => {
    const result = renderPageContent(1, [box("テスト")], [], []);
    expect(result).toMatch(/^<!-- page:1 -->/);
  });

  it("フリーテキストがそのまま出力される", () => {
    const result = renderPageContent(1, [box("本文テキスト")], [], []);
    expect(result).toContain("本文テキスト");
  });

  it("テーブルが含まれる", () => {
    const result = renderPageContent(1, [], [grid()], []);
    expect(result).toContain("| 氏名 | 役職 |");
  });

  it("テキストボックスなし・テーブルなし → コメントのみ", () => {
    const result = renderPageContent(2, [], [], []);
    expect(result).toBe("<!-- page:2 -->");
  });

  it("同一Y座標の複数テキストボックスは1行に結合される", () => {
    const boxes = [
      box("前半", { x: 100, y: 500 }),
      box("後半", { x: 220, y: 501 }) // Y差=1 → 同一行
    ];
    const result = renderPageContent(1, boxes, [], []);
    expect(result).toContain("前半 後半");
  });

  it("テキストとテーブルがY座標順（上→下）に並ぶ", () => {
    const title = box("タイトル", { y: 700, fontSize: 12 }); // 上（Y大）
    const g = grid({ topY: 300 });                            // 下（Y小）
    const result = renderPageContent(1, [title], [g], []);

    const titlePos = result.indexOf("タイトル");
    const tablePos = result.indexOf("| 氏名 |");
    expect(titlePos).toBeLessThan(tablePos);
  });
});

// ---- renderPageContent (tdnetHeadingPlugin) ---------------------------------

describe("renderPageContent (tdnetHeadingPlugin)", () => {
  it("本文より大きいフォントの行が # 見出しになる", () => {
    const boxes = [
      box("本文です", { y: 600, fontSize: 10.5 }),
      box("大見出し", { y: 700, fontSize: 12 })
    ];
    const result = renderPageContent(1, boxes, [], [tdnetHeadingPlugin]);
    expect(result).toContain("# 大見出し");
    expect(result).not.toMatch(/^# 本文です/m);
  });

  it("本文と同サイズの行は見出しにならない", () => {
    const boxes = [box("普通テキスト", { fontSize: 10.5 })];
    const result = renderPageContent(1, boxes, [], [tdnetHeadingPlugin]);
    expect(result).not.toContain("# 普通テキスト");
    expect(result).toContain("普通テキスト");
  });
});

// ---- プラグインチェーン -----------------------------------------------------

describe("プラグインチェーン", () => {
  const alwaysH2: TextLinePlugin = {
    name: "always-h2",
    headingPrefix: () => "## "
  };

  const neverPlugin: TextLinePlugin = {
    name: "never",
    headingPrefix: () => null
  };

  it("最初に non-null を返したプラグインが勝つ", () => {
    const boxes = [box("テスト", { fontSize: 12, y: 700 })];
    // alwaysH2 が先 → ## になるはず（tdnetHeadingPlugin より優先）
    const result = renderPageContent(1, boxes, [], [alwaysH2, tdnetHeadingPlugin]);
    expect(result).toContain("## テスト");
    expect(result).not.toMatch(/^# テスト$/m);
  });

  it("全プラグインが null → 空プレフィックス（本文）", () => {
    const boxes = [box("テスト", { fontSize: 12, y: 700 })];
    const result = renderPageContent(1, boxes, [], [neverPlugin]);
    expect(result).toContain("テスト");
    expect(result).not.toMatch(/^#/m);
  });

  it("plugins=[] のとき見出しは生成されない", () => {
    const boxes = [box("大タイトル", { fontSize: 20, y: 700 })];
    const result = renderPageContent(1, boxes, [], []);
    expect(result).not.toMatch(/^#/m);
    expect(result).toContain("大タイトル");
  });

  it("カスタムプラグインで特定テキストのみ h1 にできる", () => {
    const keywordPlugin: TextLinePlugin = {
      name: "keyword-heading",
      headingPrefix: ({ text }) => text.includes("お知らせ") ? "# " : null
    };
    const boxes = [
      box("取締役人事に関するお知らせ", { y: 700, fontSize: 10.5 }),
      box("本文テキスト", { y: 600, fontSize: 10.5 })
    ];
    const result = renderPageContent(1, boxes, [], [keywordPlugin]);
    expect(result).toContain("# 取締役人事に関するお知らせ");
    expect(result).not.toContain("# 本文テキスト");
  });

  it("同じレベルの見出しが連続する場合は1行に結合される", () => {
    // PDFで1つのタイトルが複数テキストボックスに分割されるケース
    const alwaysH1: TextLinePlugin = {
      name: "always-h1",
      headingPrefix: () => "# "
    };
    const boxes = [
      box("通期業績予想の修正、", { y: 710 }),
      box("配当予想の修正及び株主優待制度の廃止に関するお知らせ", { y: 695 })
    ];
    const result = renderPageContent(1, boxes, [], [alwaysH1]);
    // 2行の "# " が結合されて1行になる
    expect(result).toContain("# 通期業績予想の修正、配当予想の修正及び株主優待制度の廃止に関するお知らせ");
    expect((result.match(/^# /gm) ?? []).length).toBe(1);
  });

  it("異なるレベルの見出しは結合されない", () => {
    const h1Plugin: TextLinePlugin = {
      name: "h1",
      headingPrefix: ({ text }) => text.includes("タイトル") ? "# " : null
    };
    const h2Plugin: TextLinePlugin = {
      name: "h2",
      headingPrefix: ({ text }) => text.includes("セクション") ? "## " : null
    };
    const boxes = [
      box("タイトル", { y: 700 }),
      box("セクション1", { y: 650 })
    ];
    const result = renderPageContent(1, boxes, [], [h1Plugin, h2Plugin]);
    expect(result).toContain("# タイトル");
    expect(result).toContain("## セクション1");
  });
});
