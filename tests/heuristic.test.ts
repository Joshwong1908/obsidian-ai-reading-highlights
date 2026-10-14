import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitBlocks } from "../src/blocks";
import { heuristicSpans } from "../src/heuristic";

const sample = readFileSync(join(import.meta.dir, "../docs/sample-note.md"), "utf8");

describe("heuristicSpans on the real sample note", () => {
  test("returns nothing on a note without bold or quoted runs", () => {
    expect(heuristicSpans(splitBlocks(sample).blocks)).toEqual([]);
  });
});

describe("heuristicSpans on synthetic blocks", () => {
  test("bold runs become keypoints, capped at two per block", () => {
    const doc = "- **一** and **二** and **三**\n";
    const out = heuristicSpans(splitBlocks(doc).blocks);
    const kp = out[0]?.spans.filter((s) => s.role === "kp") ?? [];
    expect(kp.length).toBe(2);
  });

  test("quoted phrases become terms", () => {
    const doc = "常见“8 种 loop pattern”不在同一维度。\n";
    const out = heuristicSpans(splitBlocks(doc).blocks);
    expect(out[0]?.spans).toContainEqual({ quote: "8 种 loop pattern", role: "term" });
  });

  test("plain text yields nothing", () => {
    const doc = "今天整理了桌面。\n";
    expect(heuristicSpans(splitBlocks(doc).blocks).length).toBe(0);
  });
});
