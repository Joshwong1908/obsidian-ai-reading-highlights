import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitBlocks } from "../src/blocks";
import { heuristicClassify } from "../src/heuristic";

const sample = readFileSync(join(import.meta.dir, "../docs/sample-note.md"), "utf8");

function rolesByExcerpt(excerpt: string): string[] {
  const index = splitBlocks(sample);
  return index.blocks
    .filter((b) => b.text.includes(excerpt))
    .map((b) => heuristicClassify(index.blocks).find((g) => g.hash === b.hash)?.role ?? "none");
}

describe("heuristicClassify on the real sample note", () => {
  test("marks the takeaway judgment as claim", () => {
    expect(rolesByExcerpt("唯一需要记住的判断")).toContain("claim");
  });

  test("marks sourced experiment paragraphs as evidence", () => {
    expect(rolesByExcerpt("Huang 等人（2023）发现")).toContain("evidence");
  });

  test("marks boundary-section bullets as caveat", () => {
    expect(rolesByExcerpt("判官分级")).toContain("caveat");
  });

  test("marks source links as evidence", () => {
    expect(rolesByExcerpt("arxiv.org")).toContain("evidence");
  });

  test("classifies at least 30 of the note's blocks", () => {
    expect(heuristicClassify(splitBlocks(sample).blocks).length).toBeGreaterThanOrEqual(30);
  });
});

describe("heuristicClassify on synthetic blocks", () => {
  test("question cue wins in a neutral zone", () => {
    const doc = "# 随记\n\n这个信号到底从哪来？\n";
    const guesses = heuristicClassify(splitBlocks(doc).blocks);
    expect(guesses[0]?.role).toBe("question");
  });

  test("definition cue is recognized", () => {
    const doc = "# 概念\n\n不变量是指状态写在 context 外面。\n";
    const guesses = heuristicClassify(splitBlocks(doc).blocks);
    expect(guesses[0]?.role).toBe("definition");
  });

  test("plain narrative text stays undecorated", () => {
    const doc = "# 日志\n\n今天整理了桌面。\n";
    expect(heuristicClassify(splitBlocks(doc).blocks).length).toBe(0);
  });
});
