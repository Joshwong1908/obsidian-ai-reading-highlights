export type BlockHash = string & { readonly __blockHash: true };

export type BlockKind =
  | "paragraph"
  | "listItem"
  | "quoteLine"
  | "table"
  | "heading"
  | "code"
  | "frontmatter";

const CLASSIFIABLE: Readonly<Record<BlockKind, boolean>> = {
  paragraph: true,
  listItem: true,
  quoteLine: true,
  table: true,
  heading: false,
  code: false,
  frontmatter: false,
};

export function isClassifiable(kind: BlockKind): boolean {
  return CLASSIFIABLE[kind] === true;
}

export interface BlockRef {
  readonly hash: BlockHash;
  readonly kind: BlockKind;
  readonly fromLine: number;
  readonly toLine: number;
  readonly text: string;
}

export interface BlockIndex {
  readonly blocks: readonly BlockRef[];
  blockAt(line: number): BlockRef | null;
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
const HR_RE = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
const TABLE_RE = /^\s*\|/;
const QUOTE_RE = /^\s{0,3}>/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

function isConstructStart(line: string): boolean {
  return (
    HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    HR_RE.test(line) ||
    TABLE_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line)
  );
}

export function normalizeBlock(lines: readonly string[]): string {
  const trimmed = lines.map((l) => l.normalize("NFC").replace(/[ \t]+$/, ""));
  let start = 0;
  let end = trimmed.length;
  while (start < end && trimmed[start] === "") start++;
  while (end > start && trimmed[end - 1] === "") end--;
  return trimmed.slice(start, end).join("\n");
}

function fnv32(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hashBlock(normalized: string): BlockHash {
  const a = fnv32(normalized, 0x811c9dc5);
  const b = fnv32(normalized, 0x9dc5811c);
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")) as BlockHash;
}

function makeBlock(kind: BlockKind, fromLine: number, lines: readonly string[]): BlockRef {
  const text = normalizeBlock(lines);
  return { hash: hashBlock(text), kind, fromLine, toLine: fromLine + lines.length - 1, text };
}

export function splitBlocks(source: string): BlockIndex {
  const lines = source.split("\n");
  const blocks: BlockRef[] = [];
  let i = 0;

  if (lines[0] !== undefined && lines[0].trim() === "---") {
    let close = 1;
    while (close < lines.length && lines[close]!.trim() !== "---") close++;
    if (close < lines.length) {
      blocks.push(makeBlock("frontmatter", 0, lines.slice(0, close + 1)));
      i = close + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      i++;
      continue;
    }
    if (FENCE_RE.test(line)) {
      const marker = line.trimStart().slice(0, 3);
      const start = i;
      i++;
      let closed = false;
      while (i < lines.length) {
        const cur = lines[i]!;
        if (FENCE_RE.test(cur) && cur.trimStart().startsWith(marker)) {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      const innerEnd = closed ? i - 1 : i;
      const inner = lines.slice(start + 1, innerEnd);
      const text = normalizeBlock(inner);
      blocks.push({
        hash: hashBlock(text),
        kind: "code",
        fromLine: start,
        toLine: i - 1,
        text,
      });
      continue;
    }
    if (HEADING_RE.test(line)) {
      blocks.push(makeBlock("heading", i, [line]));
      i++;
      continue;
    }
    if (TABLE_RE.test(line)) {
      const start = i;
      const next = lines[i + 1] ?? "";
      if (TABLE_SEP_RE.test(next)) {
        while (i < lines.length && TABLE_RE.test(lines[i]!)) i++;
        blocks.push(makeBlock("table", start, lines.slice(start, i)));
        continue;
      }
    }
    if (QUOTE_RE.test(line)) {
      const start = i;
      while (i < lines.length && QUOTE_RE.test(lines[i]!)) i++;
      blocks.push(makeBlock("quoteLine", start, lines.slice(start, i)));
      continue;
    }
    const listMatch = LIST_RE.exec(line);
    if (listMatch) {
      const itemIndent = listMatch[1]!.length;
      const start = i;
      i++;
      while (i < lines.length) {
        const cur = lines[i]!;
        if (cur.trim() === "") break;
        if (isConstructStart(cur)) {
          const nested = LIST_RE.exec(cur);
          if (nested && nested[1]!.length > itemIndent) break;
          if (!nested) {
            if (cur.length - cur.trimStart().length > itemIndent) {
              i++;
              continue;
            }
            break;
          }
          break;
        }
        i++;
      }
      blocks.push(makeBlock("listItem", start, lines.slice(start, i)));
      continue;
    }
    const start = i;
    while (i < lines.length && lines[i]!.trim() !== "" && !isConstructStart(lines[i]!)) i++;
    blocks.push(makeBlock("paragraph", start, lines.slice(start, i)));
    if (i === start) i++;
  }

  return {
    blocks,
    blockAt(line: number): BlockRef | null {
      let lo = 0;
      let hi = blocks.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const b = blocks[mid]!;
        if (line < b.fromLine) hi = mid - 1;
        else if (line > b.toLine) lo = mid + 1;
        else return b;
      }
      return null;
    },
  };
}
