import { describe, expect, it } from "vitest";

import { tdnetHeadingPlugin } from "../../src/markdown/plugins/tdnetHeading.js";
import type { TextLineContext } from "../../src/markdown/plugins/types.js";

function ctx(overrides: Partial<TextLineContext> = {}): TextLineContext {
  return {
    text: "サンプルテキスト",
    fontSize: 10.5,
    bodyFontSize: 10.5,
    topY: 500,
    pageNumber: 1,
    isBold: false,
    ...overrides
  };
}

describe("tdnetHeadingPlugin", () => {
  it("name は 'tdnet-heading'", () => {
    expect(tdnetHeadingPlugin.name).toBe("tdnet-heading");
  });

  describe("本文サイズと同じ → null（次のプラグインへ委譲）", () => {
    it("ratio = 1.0", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ fontSize: 10.5, bodyFontSize: 10.5 }))).toBeNull();
    });

    it("ratio が H1_RATIO(1.1) 未満", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ fontSize: 11.4, bodyFontSize: 10.5 }))).toBeNull();
    });
  });

  describe("本文より 10% 以上大きい → '# ' (h1)", () => {
    it("TDnet 典型値: body=10.56pt, title=12pt  (ratio≈1.136)", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ fontSize: 12, bodyFontSize: 10.56 }))).toBe("# ");
    });

    it("ちょうど H1_RATIO 倍 (1.1×10 = 11)", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ fontSize: 11, bodyFontSize: 10 }))).toBe("# ");
    });

    it("非常に大きいフォント", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ fontSize: 20, bodyFontSize: 10 }))).toBe("# ");
    });
  });

  describe("bodyFontSize が 0 以下 → null（判定不能）", () => {
    it("bodyFontSize = 0", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ fontSize: 12, bodyFontSize: 0 }))).toBeNull();
    });

    it("bodyFontSize = -1", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ fontSize: 12, bodyFontSize: -1 }))).toBeNull();
    });
  });

  it("テキスト内容やページ番号は判定に影響しない", () => {
    const large = ctx({ fontSize: 12, bodyFontSize: 10.56, text: "あいうえお", pageNumber: 5 });
    expect(tdnetHeadingPlugin.headingPrefix(large)).toBe("# ");
  });

  describe("isBold=true → '# ' (h1, PDFテキストレンダリングモード2検出)", () => {
    it("isBold=true のテキスト → h1", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ isBold: true, text: "取引先との取引停止に関するお知らせ" }))).toBe("# ");
    });

    it("isBold=true でもブロックリスト「記」 → null", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ isBold: true, text: "記" }))).toBeNull();
    });

    it("isBold=false かつサイズも同じ → null（通常本文）", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ isBold: false }))).toBeNull();
    });
  });

  describe("ブロックリスト — フォントサイズに関わらず null", () => {
    it("「記」単体はh1にならない（日本語公文書の固定フォーマットマーカー）", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "記", fontSize: 12, bodyFontSize: 10 }))).toBeNull();
    });

    it("「記」以外の文字が含まれる場合はブロックしない", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "記録", fontSize: 12, bodyFontSize: 10 }))).toBe("# ");
    });
  });

  describe("行末が「お知らせ」で終わる → '# ' (h1, TDnet タイトルパターン)", () => {
    it("標準的なTDnetタイトル末尾", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "取締役人事に関するお知らせ" }))).toBe("# ");
    });

    it("フォントサイズが本文と同じでも検出する", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "業績予想の修正に関するお知らせ", fontSize: 9.96, bodyFontSize: 9.96 }))).toBe("# ");
    });

    it("「お知らせ」が行末でない場合は対象外", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "お知らせがあります" }))).toBeNull();
    });
  });

  describe("行頭が番号付き形式 → '## ' (h2)", () => {
    it("半角数字 + 半角ピリオド: '1.'", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "1. 項目タイトル" }))).toBe("## ");
    });

    it("半角数字 + 全角ピリオド: '2．'", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "2．項目タイトル" }))).toBe("## ");
    });

    it("全角数字 + 半角ピリオド: '１.'", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "１. 項目タイトル" }))).toBe("## ");
    });

    it("全角数字 + 全角ピリオド: '１．'", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "１．項目タイトル" }))).toBe("## ");
    });

    it("9 (上限): '9.'", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "9. 最終項目" }))).toBe("## ");
    });

    it("フォントサイズが大きければ h1 が優先される", () => {
      // fontSize >= bodyFontSize * H1_RATIO なので h1
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "1. タイトル", fontSize: 12, bodyFontSize: 10.56 }))).toBe("# ");
    });
  });

  describe("番号付き形式に該当しない → null", () => {
    it("'0.' は対象外（1-9のみ）", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "0. ゼロ" }))).toBeNull();
    });

    it("数字が行頭でない", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "説明 1. 補足" }))).toBeNull();
    });

    it("ピリオドなし", () => {
      expect(tdnetHeadingPlugin.headingPrefix(ctx({ text: "1 項目" }))).toBeNull();
    });
  });
});
