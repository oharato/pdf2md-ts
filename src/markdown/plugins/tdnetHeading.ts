/**
 * TDnet heading plugin.
 *
 * TDnet (Tokyo Stock Exchange Timely Disclosure network) PDFs follow a
 * consistent typographic convention:
 *   - Body text:      ~10.5 pt
 *   - Document title: ~12 pt  (ratio ≈ 1.13 relative to body)
 *     or same size as body but ending with 「お知らせ」
 *
 * Strategy:
 *   1. Blocklist: certain fixed-form markers (e.g. 「記」) are never headings.
 *   2. fontSize >= body * H1_RATIO           →  `# `  (h1)
 *   3. line ends with 「お知らせ」             →  `# `  (h1)  [TDnet title pattern]
 *   4. line starts with numbered prefix       →  `## ` (h2)
 *      e.g. "1." / "２." / "１．" etc.
 */

import type { TextLinePlugin } from "./types.js";

/** Lines this many times larger than body font size become h1. */
const H1_RATIO = 1.1;

/**
 * These strings, when they appear alone on a line, are Japanese formal-document
 * fixed-form markers and must NOT be promoted to headings regardless of size.
 */
const HEADING_BLOCKLIST_RE = /^記$/;

/**
 * TDnet disclosure documents typically end their title with 「お知らせ」.
 * Detect these even when the font size equals the body size.
 */
const OSHIRE_TITLE_RE = /お知らせ$/;

/**
 * Matches lines that begin with a positive integer (half- or full-width, one or more digits)
 * followed by a period (half- or full-width).
 * Examples: "1. ", "２. ", "１．", "１０．"
 */
const NUMBERED_HEADING_RE = /^[1-9][0-9]*[.．]|^[１-９][０-９]*[.．]/;

export const tdnetHeadingPlugin: TextLinePlugin = {
  name: "tdnet-heading",

  headingPrefix({ fontSize, bodyFontSize, text, isBold }) {
    // 1. Blocklist — never a heading
    if (HEADING_BLOCKLIST_RE.test(text)) return null;

    // 2. Font-size based h1
    if (bodyFontSize > 0 && fontSize >= bodyFontSize * H1_RATIO) return "# ";

    // 3. Bold rendering (PDF text rendering mode 2 = fill+stroke)
    if (isBold) return "# ";

    // 4. TDnet title pattern ("〜に関するお知らせ" etc.) — fallback when bold info unavailable
    if (OSHIRE_TITLE_RE.test(text)) return "# ";

    // 5. Numbered section → h2
    if (NUMBERED_HEADING_RE.test(text)) return "## ";

    return null; // defer to next plugin / treat as body text
  },
};
