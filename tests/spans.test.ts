import { describe, expect, test } from "bun:test";
import { dedupe, locate, locateSpans, Loc } from "../src/spans";

describe("locate across markdown and DOM text", () => {
  test("finds a quote through bold markers and whitespace", () => {
    const source = "**因为没有外部信号**，模型 改不好自己。";
    const loc = locate(source, "因为没有外部信号，模型改不好自己", "kp");
    expect(loc).not.toBeNull();
    expect(source.slice(loc!.from, loc!.to)).toBe("因为没有外部信号**，模型 改不好自己");
  });

  test("matches case and fullwidth folding", () => {
    const loc = locate("Flash Ａttention 的开销", "flash attention", "term");
    expect(loc).not.toBeNull();
  });

  test("misses a hallucinated quote", () => {
    expect(locate("完全不同的内容", "这句话根本不存在", "kp")).toBeNull();
  });

  test("empty or whitespace-only quotes never match", () => {
    expect(locate("任意文本", "  ", "term")).toBeNull();
    expect(locate("任意文本", "", "term")).toBeNull();
  });
});

describe("dedupe", () => {
  const loc = (from: number, to: number, role: Loc["role"]): Loc => ({ from, to, role });

  test("higher priority wins on overlap", () => {
    const kept = dedupe([loc(0, 20, "term"), loc(5, 15, "kp"), loc(30, 35, "concept")]);
    expect(kept.map((l) => l.role)).toEqual(["kp", "concept"]);
  });

  test("non-overlapping spans all survive, sorted by from", () => {
    const kept = dedupe([loc(10, 12, "term"), loc(0, 5, "kp"), loc(20, 22, "concept")]);
    expect(kept.map((l) => l.from)).toEqual([0, 10, 20]);
  });

  test("identical ranges keep one", () => {
    const kept = dedupe([loc(3, 9, "concept"), loc(3, 9, "term")]);
    expect(kept.length).toBe(1);
    expect(kept[0]!.role).toBe("term");
  });
});

describe("locateSpans end to end on a real-shaped block", () => {
  const block = "1. **常见的“8 种 loop pattern”不在同一个维度上。** Goal、Evaluator 只是判官硬度不同；";

  test("locates bold keypoint and quoted term together", () => {
    const locs = locateSpans(block, [
      { quote: "常见的“8 种 loop pattern”不在同一个维度上", role: "kp" },
      { quote: "判官硬度", role: "term" },
    ]);
    expect(locs.length).toBe(2);
    expect(locs[0]!.role).toBe("kp");
    expect(block.slice(locs[1]!.from, locs[1]!.to)).toContain("判官硬度");
  });

  test("drops the unlocatable span and keeps the rest", () => {
    const locs = locateSpans(block, [
      { quote: "不存在的引句", role: "kp" },
      { quote: "Goal", role: "term" },
    ]);
    expect(locs.length).toBe(1);
    expect(locs[0]!.role).toBe("term");
  });
});
