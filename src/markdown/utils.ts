export function normalizeFullWidthAscii(text: string): string {
  return text.replace(/[！-～]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
}

export function escapePipes(text: string): string {
  return normalizeFullWidthAscii(text)
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

export function parsePipeRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}
