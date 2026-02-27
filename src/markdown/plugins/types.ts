/**
 * Context passed to each plugin for a single free-text line.
 */
export type TextLineContext = {
  /** The full text of the line (already merged from adjacent text boxes). */
  text: string;
  /** Dominant font size (pts) of this line. */
  fontSize: number;
  /** Modal font size of all free-text lines on the page (i.e. body size). */
  bodyFontSize: number;
  /** Y coordinate of the line's top (PDF coordinate: larger = higher on page). */
  topY: number;
  /** 1-based page number. */
  pageNumber: number;
  /**
   * True when any text box in this line was rendered with PDF text rendering
   * mode 2 (fill + stroke), which gives a visually bold appearance.
   */
  isBold: boolean;
};

/**
 * A plugin that can transform a free-text line into a Markdown heading.
 *
 * Plugins form a chain: the first plugin that returns a non-null prefix wins.
 * Return `null` to pass control to the next plugin.
 * Return `""` (empty string) to explicitly mark the line as body text.
 */
export type TextLinePlugin = {
  /** Unique identifier shown in debug output. */
  name: string;
  /**
   * Inspect the line context and optionally return a Markdown prefix
   * such as `"# "`, `"## "`, or `""`.
   * Return `null` to defer to the next plugin in the chain.
   */
  headingPrefix(ctx: TextLineContext): string | null;
};
