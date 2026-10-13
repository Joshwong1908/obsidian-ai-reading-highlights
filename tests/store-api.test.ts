import { describe, expect, test } from "bun:test";
import { createAnnotationStore, parseStoreFile, AnnotationRecord, StorableRecord } from "../src/store";
import { hashBlock, normalizeBlock } from "../src/blocks";
import { parseClassifyResponse, buildClassifyBody, ClassifyItem } from "../src/api";

const h1 = hashBlock(normalizeBlock(["结论一"]));
const h2 = hashBlock(normalizeBlock(["证据二"]));

const rec = (hash: string, spans: StorableRecord["spans"], source: "api" | "heuristic" = "heuristic"): AnnotationRecord => ({
  hash: hash as AnnotationRecord["hash"],
  spans,
  meta: source === "api" ? { source: "api", model: "m" } : { source: "heuristic" },
  at: 1,
});

describe("annotation store", () => {
  test("round-trips version-2 span records", () => {
    const records = [
      rec(h1, [{ quote: "结论一", role: "kp" }], "api"),
      rec(h2, [{ quote: "证据", role: "term" }]),
    ];
    expect(parseStoreFile({ version: 2, entries: records })).toEqual(records);
  });

  test("accepts legacy version-1 files that already carry span entries", () => {
    const legacy = parseStoreFile({
      version: 1,
      entries: [rec(h1, [{ quote: "结论", role: "kp" }])],
    });
    expect(legacy.length).toBe(1);
  });

  test("rejects old role-shaped entries so those notes re-classify", () => {
    expect(parseStoreFile({ version: 1, entries: [{ hash: "aaaaaaaaaaaaaaaa", role: "claim", meta: { source: "heuristic" }, at: 1 }] })).toEqual([]);
  });

  test("drops malformed entries instead of failing the file", () => {
    const revived = parseStoreFile({
      version: 2,
      entries: [
        { hash: "not-hex!", spans: [{ quote: "x", role: "kp" }], meta: { source: "heuristic" }, at: 1 },
        { hash: "aaaaaaaaaaaaaaaa", spans: [{ quote: "x", role: "nonsense" }], meta: { source: "heuristic" }, at: 2 },
        { hash: "aaaaaaaaaaaaaaaa", spans: [], meta: { source: "api", model: "m" }, at: 3 },
        { hash: "aaaaaaaaaaaaaaaa", spans: [{ quote: "y", role: "concept" }], meta: { source: "heuristic" }, at: 4 },
      ],
    });
    expect(revived.length).toBe(1);
    expect(revived[0]!.spans[0]!.quote).toBe("y");
  });

  test("evicts least-recently-used beyond capacity", () => {
    const store = createAnnotationStore(
      { capacity: 2, persist: async () => {}, schedule: (fn) => fn, now: () => 1 },
      [],
    );
    store.put([rec(h1, [{ quote: "a", role: "kp" }])]);
    store.put([rec(h2, [{ quote: "b", role: "kp" }])]);
    expect(store.get(h1)?.spans.length).toBe(1);
    const h3 = hashBlock(normalizeBlock(["第三块"]));
    store.put([rec(h3, [{ quote: "c", role: "kp" }])]);
    expect(store.size()).toBe(2);
    expect(store.get(h2)).toBeNull();
    expect(store.get(h1)?.spans[0]!.quote).toBe("a");
  });
});

describe("parseClassifyResponse", () => {
  const items: ClassifyItem[] = [
    { hash: h1, kind: "paragraph", text: "因此这个方案成立，关键在于验证器。", context: [] },
    { hash: h2, kind: "paragraph", text: "Huang 等人（2023）发现自我纠错不提升。", context: [] },
  ];

  test("parses span blocks and keeps verbatim quotes", () => {
    const res = parseClassifyResponse(
      {
        choices: [
          {
            message: {
              content: JSON.stringify({
                blocks: [
                  { i: 1, spans: [{ quote: "关键在于验证器", role: "kp" }, { quote: "验证器", role: "term" }] },
                  { i: 2, spans: [{ quote: "自我纠错不提升", role: "kp" }] },
                ],
              }),
            },
          },
        ],
      },
      items,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items.length).toBe(2);
    expect(res.items[0]!.spans).toEqual([
      { quote: "关键在于验证器", role: "kp" },
      { quote: "验证器", role: "term" },
    ]);
  });

  test("drops junk indices, unknown roles, and empty quotes", () => {
    const res = parseClassifyResponse(
      { choices: [{ message: { content: JSON.stringify({ blocks: [{ i: 9, spans: [{ quote: "x", role: "kp" }] }, { i: 1, spans: [{ quote: "  ", role: "kp" }, { quote: "方案", role: "weird" }, { quote: "成立", role: "concept" }] }] }) } }] },
      items,
    );
    expect(res.ok && res.items.length).toBe(1);
    expect(res.ok && res.items[0]!.spans).toEqual([{ quote: "成立", role: "concept" }]);
  });

  test("caps spans per block at eight", () => {
    const spans = Array.from({ length: 12 }, (_, n) => ({ quote: `词${n}`, role: "term" }));
    const res = parseClassifyResponse({ choices: [{ message: { content: JSON.stringify({ blocks: [{ i: 1, spans }] }) } }] }, items);
    expect(res.ok && res.items[0]!.spans.length).toBe(8);
  });

  test("fails as a value on unparseable content", () => {
    const res = parseClassifyResponse({ choices: [{ message: { content: "考え中…" } }] }, items);
    expect(!res.ok && res.failure.reason).toBe("parse");
  });
});

describe("buildClassifyBody thinking flag", () => {
  const items: ClassifyItem[] = [{ hash: h1, kind: "paragraph", text: "结论一", context: [] }];

  test("omits thinking by default and includes it when requested", () => {
    const off = JSON.parse(buildClassifyBody({ baseUrl: "http://x", apiKey: "k", model: "m" }, items)) as Record<string, unknown>;
    expect("thinking" in off).toBe(false);
    const on = JSON.parse(buildClassifyBody({ baseUrl: "http://x", apiKey: "k", model: "m", disableThinking: true }, items)) as Record<string, unknown>;
    expect(on.thinking).toEqual({ type: "disabled" });
  });
});
