/** Document model of the reader: enough structure to render, nothing more. */

/** One list entry, with `checked` set only for a `- [ ]` / `- [x]` task line. */
export interface ListItem {
  text: string;
  checked: boolean | null;
}

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; language: string | null; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "rule" };

const FENCE_OPEN = /^\s*(```|~~~)\s*([^\s`]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;
const BULLET = /^\s*[-*+]\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const BULLET_ITEM = /^\s*[-*+]\s+(.*)$/;
const TASK_ITEM = /^\[( |x|X)\]\s*(.*)$/;
const SEPARATOR_CELL = /^:?-{2,}:?$/;
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]*\]\([^)\s]+\))|(\*[^*\n]+\*)/;

/** Splits one table row into trimmed cells, with the outer pipes removed. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

type BlockStart =
  | { kind: "fence"; marker: string; language: string | null }
  | { kind: "heading"; level: number; text: string }
  | { kind: "rule" }
  | { kind: "quote" }
  | { kind: "table" }
  | { kind: "list"; ordered: boolean }
  | { kind: "paragraph" };

/**
 * What the line at `index` starts. The parser and the paragraph collector both
 * go through this, so a paragraph can never swallow a line another branch owns.
 */
function classify(lines: string[], index: number): BlockStart {
  const line = lines[index];
  const fence = FENCE_OPEN.exec(line);
  if (fence) return { kind: "fence", marker: fence[1], language: fence[2] || null };
  const heading = HEADING.exec(line);
  if (heading) return { kind: "heading", level: heading[1].length, text: heading[2].trim() };
  if (RULE.test(line)) return { kind: "rule" };
  if (QUOTE.test(line)) return { kind: "quote" };
  const next = lines[index + 1];
  if (
    line.includes("|") &&
    next !== undefined &&
    splitRow(next).every((cell) => SEPARATOR_CELL.test(cell))
  ) {
    return { kind: "table" };
  }
  if (ORDERED.test(line)) return { kind: "list", ordered: true };
  if (BULLET.test(line)) return { kind: "list", ordered: false };
  return { kind: "paragraph" };
}

/**
 * Deliberately conservative Markdown: headings, paragraphs, lists and task
 * lists, quotes, fenced code, rules, and pipe tables. Anything else stays
 * literal text, which is the right failure mode for a reader.
 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].trim().length === 0) {
      index += 1;
      continue;
    }
    const start = classify(lines, index);
    switch (start.kind) {
      case "fence": {
        const closing = new RegExp(`^\\s*${start.marker}\\s*$`);
        const body: string[] = [];
        index += 1;
        while (index < lines.length && !closing.test(lines[index])) {
          body.push(lines[index]);
          index += 1;
        }
        index += 1;
        blocks.push({ kind: "code", language: start.language, text: body.join("\n") });
        break;
      }
      case "heading": {
        blocks.push({ kind: "heading", level: start.level, text: start.text });
        index += 1;
        break;
      }
      case "rule": {
        blocks.push({ kind: "rule" });
        index += 1;
        break;
      }
      case "quote": {
        const parts: string[] = [];
        while (index < lines.length && QUOTE.test(lines[index])) {
          parts.push(lines[index].replace(QUOTE, ""));
          index += 1;
        }
        blocks.push({ kind: "quote", text: parts.join("\n") });
        break;
      }
      case "table": {
        const header = splitRow(lines[index]);
        const rows: string[][] = [];
        index += 2;
        while (index < lines.length && lines[index].includes("|") && lines[index].trim().length > 0) {
          rows.push(splitRow(lines[index]));
          index += 1;
        }
        blocks.push({ kind: "table", header, rows });
        break;
      }
      case "list": {
        const pattern = start.ordered ? ORDERED_ITEM : BULLET_ITEM;
        const items: ListItem[] = [];
        while (index < lines.length) {
          const match = pattern.exec(lines[index]);
          if (!match) break;
          const task = TASK_ITEM.exec(match[1].trim());
          items.push(
            task
              ? { text: task[2].trim(), checked: task[1].toLowerCase() === "x" }
              : { text: match[1].trim(), checked: null },
          );
          index += 1;
        }
        blocks.push({ kind: "list", ordered: start.ordered, items });
        break;
      }
      case "paragraph": {
        const paragraph: string[] = [];
        while (
          index < lines.length &&
          lines[index].trim().length > 0 &&
          classify(lines, index).kind === "paragraph"
        ) {
          paragraph.push(lines[index].trim());
          index += 1;
        }
        blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
        break;
      }
    }
  }
  return blocks;
}

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; text: string };

/** Splits one run of prose into styled runs. Code, bold, links, then italics. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = new RegExp(INLINE.source, "g");
  let last = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    if (match.index > last) tokens.push({ kind: "text", text: text.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith("`")) tokens.push({ kind: "code", text: token.slice(1, -1) });
    else if (token.startsWith("**")) tokens.push({ kind: "bold", text: token.slice(2, -2) });
    else if (token.startsWith("["))
      tokens.push({ kind: "link", text: token.slice(1, token.indexOf("]")) });
    else tokens.push({ kind: "italic", text: token.slice(1, -1) });
    last = match.index + token.length;
    match = pattern.exec(text);
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}
