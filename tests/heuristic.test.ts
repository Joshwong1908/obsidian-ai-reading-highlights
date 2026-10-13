import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitBlocks } from "../src/blocks";
import { heuristicSpans } from "../src/heuristic";

const sample = readFileSync(join(import.meta.dir, "../docs/sample-note.md"), "utf8");

describe("heuristicSpans", () => {
  test("extracts bold keypoint spans from the real note", () => {
    const out = heuristicSpans(splitBlocks(sample).blocks);
    const kp = out.flatMap((b) => b.spans.filter((s) => s.role === "kp"));
    expect(kp.length).toBeGreaterThanOrEqual(10);
    expect(kp.some((s) => s.quote.includes("没有外部信号"))).toBe(true);
  });

  test("extracts quoted terms", () => {
    const out = heuristicSpans(splitBlocks(sample).blocks);
    const terms = out.flatMap((b) => b.spans.filter((s) => s.role === "term"));
    expect(terms.some((s) => s.quote.includes("8 种 loop pattern"))).toBe(true);
  });

  test("caps bold spans at two per block", () => {
    const doc = "- **一** and **二** and **三**\n";
    const out = heuristicSpans(splitBlocks(doc).blocks);
    const kp = out[0]?.spans.filter((s) => s.role === "kp") ?? [];
    expect(kp.length).toBe(2);
  });

  test("plain text yields nothing", () => {
    const doc = "今天整理了桌面。\n";
    expect(heuristicSpans(splitBlocks(doc).blocks).length).toBe(0);
  });
});
