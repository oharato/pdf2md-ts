import { describe, expect, it } from "vitest";

import { resolveTableGrids } from "../../src/fusion/cellResolver.js";
import type { Segment, TextBox } from "../../src/core/types.js";

// ---- helpers ----------------------------------------------------------------

let _sid = 0;
let _tid = 0;

function hSeg(y: number, x1: number, x2: number): Segment {
  return { id: `h${_sid++}`, x1, y1: y, x2, y2: y };
}

function vSeg(x: number, y1: number, y2: number): Segment {
  return { id: `v${_sid++}`, x1: x, y1, x2: x, y2 };
}

function tb(text: string, cx: number, cy: number, pageNumber = 1): TextBox {
  return {
    id: `t${_tid++}`,
    text,
    pageNumber,
    bounds: { left: cx - 10, right: cx + 10, bottom: cy - 5, top: cy + 5 }
  };
}

/**
 * Build a minimal rectangular grid of segments.
 * xLines / yLines are the border coordinates.
 * Vertical segments span the full Y range of the table.
 * Horizontal segments span the full X range of the table.
 */
function tableSegs(xLines: number[], yLines: number[]): Segment[] {
  const segs: Segment[] = [];
  const yMin = Math.min(...yLines);
  const yMax = Math.max(...yLines);
  const xMin = Math.min(...xLines);
  const xMax = Math.max(...xLines);
  for (const x of xLines) segs.push(vSeg(x, yMin, yMax));
  for (const y of yLines) segs.push(hSeg(y, xMin, xMax));
  return segs;
}

// ---- resolveTableGrids: グリッドなし -----------------------------------------

describe("resolveTableGrids: グリッドなし", () => {
  it("セグメントが空 → grids=[], consumedIds=[]", () => {
    const result = resolveTableGrids(1, [tb("テキスト", 200, 500)], []);
    expect(result.grids).toHaveLength(0);
    expect(result.consumedIds).toHaveLength(0);
  });

  it("水平線のみ（垂直線なし）→ グリッド未検出", () => {
    const segs = [hSeg(400, 100, 500), hSeg(350, 100, 500)];
    const result = resolveTableGrids(1, [tb("A", 200, 375)], segs);
    expect(result.grids).toHaveLength(0);
  });
});

// ---- resolveTableGrids: 1テーブル -------------------------------------------

describe("resolveTableGrids: 1テーブル", () => {
  //   x: 100 ─── 300 ─── 500
  //   y: 400 ─ [header] ─ 350 ─ [row1] ─ 300
  const xLines = [100, 300, 500];
  const yLines = [400, 350, 300];
  const segs = tableSegs(xLines, yLines);

  it("1つのグリッドが返る", () => {
    const boxes = [
      tb("氏名", 200, 375),
      tb("役職", 400, 375),
      tb("山田", 200, 325),
      tb("社長", 400, 325)
    ];
    const { grids, consumedIds } = resolveTableGrids(1, boxes, segs);
    expect(grids).toHaveLength(1);
    expect(consumedIds).toHaveLength(4);
  });

  it("グリッドに topY がセットされる", () => {
    const boxes = [tb("A", 200, 375)];
    const { grids } = resolveTableGrids(1, boxes, segs);
    expect(grids[0].topY).toBeCloseTo(400, 0);
  });

  it("テーブル外のテキストボックスは consumedIds に含まれない", () => {
    const inside = tb("内側", 200, 375);
    const outside = tb("外側", 600, 375); // x=600 はグリッド外
    const { consumedIds } = resolveTableGrids(1, [inside, outside], segs);
    expect(consumedIds).toContain(inside.id);
    expect(consumedIds).not.toContain(outside.id);
  });
});

// ---- resolveTableGrids: 2テーブル（本番ユースケース） -----------------------

describe("resolveTableGrids: 2テーブル（垂直線が間を繋がない）", () => {
  /**
   * Table-A: y=400~350,  Table-B: y=250~200
   * 垂直線はそれぞれの範囲内のみ → Gap(250~350)を橋渡しする垂直線はない
   */
  const xLines = [100, 300, 500];
  const segsA = tableSegs(xLines, [400, 350]); // Table-A: 1行
  const segsB = tableSegs(xLines, [250, 200]); // Table-B: 1行
  const allSegs = [...segsA, ...segsB];

  it("2つのグリッドが返る", () => {
    const boxes = [
      tb("A-氏名", 200, 375),
      tb("B-氏名", 200, 225)
    ];
    const { grids } = resolveTableGrids(1, boxes, allSegs);
    expect(grids).toHaveLength(2);
  });

  it("Table-A は上側（topY が大きい）", () => {
    const boxes = [tb("A-氏名", 200, 375), tb("B-氏名", 200, 225)];
    const { grids } = resolveTableGrids(1, boxes, allSegs);
    const sorted = [...grids].sort((a, b) => (b.topY ?? 0) - (a.topY ?? 0));
    expect(sorted[0].topY).toBeCloseTo(400, 0);
    expect(sorted[1].topY).toBeCloseTo(250, 0);
  });

  it("各テキストボックスは対応するテーブルのみに収まる", () => {
    const boxA = tb("A行", 200, 375);
    const boxB = tb("B行", 200, 225);
    const { grids } = resolveTableGrids(1, [boxA, boxB], allSegs);
    const sorted = [...grids].sort((a, b) => (b.topY ?? 0) - (a.topY ?? 0));

    const textInA = sorted[0].cells.map((c) => c.text).filter(Boolean);
    const textInB = sorted[1].cells.map((c) => c.text).filter(Boolean);
    expect(textInA).toContain("A行");
    expect(textInA).not.toContain("B行");
    expect(textInB).toContain("B行");
    expect(textInB).not.toContain("A行");
  });

  it("両テーブルの消費IDを合算するとすべてのボックスが含まれる", () => {
    const boxA = tb("A行", 200, 375);
    const boxB = tb("B行", 200, 225);
    const { consumedIds } = resolveTableGrids(1, [boxA, boxB], allSegs);
    expect(consumedIds).toContain(boxA.id);
    expect(consumedIds).toContain(boxB.id);
  });
});

// ---- resolveTableGrids: 垂直線が連続している場合は分割しない ----------------

describe("resolveTableGrids: 垂直線が全行を連続して覆う場合は1テーブル", () => {
  const xLines = [100, 300, 500];
  // 縦線が y=200〜400 を全て橋渡しする → 1テーブル
  const segs = tableSegs(xLines, [400, 350, 300, 250, 200]);

  it("1つのグリッドが返る", () => {
    const boxes = [
      tb("R0", 200, 375),
      tb("R1", 200, 325),
      tb("R2", 200, 275),
      tb("R3", 200, 225)
    ];
    const { grids } = resolveTableGrids(1, boxes, segs);
    expect(grids).toHaveLength(1);
  });
});
