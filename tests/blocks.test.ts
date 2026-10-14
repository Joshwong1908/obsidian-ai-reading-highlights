import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BlockKind, hashBlock, normalizeBlock, splitBlocks } from "../src/blocks";

const sample = readFileSync(join(import.meta.dir, "../docs/sample-note.md"), "utf8");

describe("splitBlocks on the real sample note", () => {
  const index = splitBlocks(sample);
  const kinds = (kind: BlockKind) => index.blocks.filter((b) => b.kind === kind);

  test("covers every line with sorted, non-overlapping blocks", () => {
    let prevEnd = -1;
    for (const b of index.blocks) {
      expect(b.fromLine).toBeGreaterThan(prevEnd);
      expect(b.toLine).toBeGreaterThanOrEqual(b.fromLine);
      prevEnd = b.toLine;
    }
  });

  test("finds the structural shapes the note actually has", () => {
    expect(kinds("heading").length).toBe(1);
    expect(kinds("listItem").length).toBe(7);
    expect(kinds("paragraph").length).toBe(0);
    expect(kinds("table").length).toBe(0);
  });

  test("keeps list markers in block text", () => {
    const first = kinds("listItem")[0]!;
    expect(first.text.startsWith("1. ")).toBe(true);
  });

  test("blockAt resolves every block start and misses blank gaps", () => {
    for (const b of index.blocks) expect(index.blockAt(b.fromLine)).toBe(b);
    expect(index.blockAt(1)).toBeNull();
  });
});

describe("identity", () => {
  test("hash is stable under trailing whitespace and NFC recomposition", () => {
    const base = "State is the source of truth; context is a view.";
    const padded = "State is the source of truth; context is a view.  ";
    const nfd = base.normalize("NFD");
    expect(hashBlock(normalizeBlock([padded]))).toBe(hashBlock(normalizeBlock([base])));
    expect(hashBlock(normalizeBlock([nfd]))).toBe(hashBlock(normalizeBlock([base])));
  });

  test("distinct texts get distinct hashes", () => {
    const a = hashBlock(normalizeBlock(["point A"]));
    const b = hashBlock(normalizeBlock(["point B"]));
    expect(a).not.toBe(b);
  });
});

describe("synthetic documents", () => {
  test("frontmatter is one block and never classified", () => {
    const doc = "---\ntitle: x\n---\n\n# H\n\ntext\n";
    const blocks = splitBlocks(doc).blocks;
    expect(blocks[0]!.kind).toBe("frontmatter");
    expect(blocks[0]!.text).toContain("title");
  });

  test("nested list items each get their own block", () => {
    const doc = "- a\n  - b\n- c\n";
    const items = splitBlocks(doc).blocks.filter((b) => b.kind === "listItem");
    expect(items.map((b) => b.text)).toEqual(["- a", "  - b", "- c"]);
  });

  test("tables form one whole block with pipes kept", () => {
    const doc = "| h1 | h2 |\n| --- | --- |\n| a | b |\n";
    const blocks = splitBlocks(doc).blocks;
    expect(blocks[0]!.kind).toBe("table");
    expect(blocks[0]!.text).toContain("| h1 |");
  });

  test("code fences form one block without the fence lines", () => {
    const doc = "```text\ninner line\nsecond line\n```\n";
    const blocks = splitBlocks(doc).blocks;
    expect(blocks[0]!.kind).toBe("code");
    expect(blocks[0]!.text).toBe("inner line\nsecond line");
  });

  test("loose list with wrapped continuation keeps the wrap inside the item", () => {
    const doc = "1. first\nwrapped tail\n\n2. second\n";
    const items = splitBlocks(doc).blocks.filter((b) => b.kind === "listItem");
    expect(items.length).toBe(2);
    expect(items[0]!.text).toBe("1. first\nwrapped tail");
  });

  test("blockquote group is one quoteLine block", () => {
    const doc = "> a\n> b\n\npara\n";
    const blocks = splitBlocks(doc).blocks;
    expect(blocks[0]!.kind).toBe("quoteLine");
    expect(blocks[1]!.kind).toBe("paragraph");
  });

  test("horizontal rules produce no block", () => {
    const doc = "a\n\n---\n\nb\n";
    const blocks = splitBlocks(doc).blocks.filter((b) => b.kind !== "paragraph");
    expect(blocks.length).toBe(0);
  });
});
