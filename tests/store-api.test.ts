import { describe, expect, test } from "bun:test";
import { createAnnotationStore, parseStoreFile, AnnotationRecord } from "../src/store";
import { hashBlock, normalizeBlock } from "../src/blocks";
import { parseClassifyResponse, ClassifyItem } from "../src/api";

const h1 = hashBlock(normalizeBlock(["结论一"]));
const h2 = hashBlock(normalizeBlock(["证据二"]));

describe("annotation store", () => {
  test("round-trips through parseStoreFile", () => {
    const records: AnnotationRecord[] = [
      { hash: h1, role: "claim", meta: { source: "api", model: "gpt-x" }, at: 5 },
      { hash: h2, role: "evidence", meta: { source: "heuristic" }, at: 6 },
    ];
    const revived = parseStoreFile({ version: 1, entries: records });
    expect(revived).toEqual(records);
  });

  test("drops malformed entries instead of failing the file", () => {
    const revived = parseStoreFile({
      entries: [
        { hash: "not-hex!", role: "claim", meta: { source: "heuristic" }, at: 1 },
        { hash: "aaaaaaaaaaaaaaaa", role: "nonsense", meta: { source: "heuristic" }, at: 2 },
        { hash: "aaaaaaaaaaaaaaaa", role: "claim", meta: { source: "api" }, at: 3 },
        { hash: "aaaaaaaaaaaaaaaa", role: "claim", meta: { source: "heuristic" }, at: 4 },
        "junk",
      ],
    });
    expect(revived.length).toBe(1);
    expect(revived[0]!.hash).toBe("aaaaaaaaaaaaaaaa");
  });

  test("evicts least-recently-used beyond capacity and notifies on put", () => {
    const events: string[][] = [];
    let flushes = 0;
    const pending: { fn: () => void; cancelled: boolean }[] = [];
    const store = createAnnotationStore(
      {
        capacity: 2,
        persist: async () => {
          flushes++;
        },
        schedule: (fn) => {
          const rec = { fn, cancelled: false };
          pending.push(rec);
          return () => {
            rec.cancelled = true;
          };
        },
        now: () => 1,
      },
      [],
    );
    store.onUpdate((hashes) => events.push([...hashes]));
    store.put([{ hash: h1, role: "claim", meta: { source: "heuristic" } }]);
    store.put([{ hash: h2, role: "evidence", meta: { source: "heuristic" } }]);
    expect(store.get(h1)?.role).toBe("claim");
    const h3 = hashBlock(normalizeBlock(["第三块"]));
    store.put([{ hash: h3, role: "caveat", meta: { source: "heuristic" } }]);
    expect(store.size()).toBe(2);
    expect(store.get(h2)).toBeNull();
    expect(store.get(h1)?.role).toBe("claim");
    expect(events.length).toBe(3);
    expect(pending.length).toBe(1);
    const drain = pending.filter((p) => !p.cancelled).map((p) => p.fn());
    expect(drain.length).toBe(1);
    return store.flush().then(() => {
      expect(flushes).toBe(2);
    });
  });
});

describe("parseClassifyResponse", () => {
  const items: ClassifyItem[] = [
    { hash: h1, kind: "paragraph", text: "结论一", context: [] },
    { hash: h2, kind: "paragraph", text: "证据二", context: [] },
  ];

  test("parses the wrapped labels shape", () => {
    const res = parseClassifyResponse(
      { choices: [{ message: { content: '{"labels": [{"i": 1, "role": "claim"}, {"i": 2, "role": "evidence"}]}' } }] },
      items,
    );
    expect(res).toEqual({
      ok: true,
      items: [
        { hash: h1, role: "claim" },
        { hash: h2, role: "evidence" },
      ],
    });
  });

  test("parses fenced json and bare arrays, drops junk indices and unknown roles", () => {
    const fenced = parseClassifyResponse(
      { choices: [{ message: { content: '```json\n[{"i": 1, "role": "claim"}, {"i": 9, "role": "claim"}, {"i": 2, "role": "junk"}]\n```' } }] },
      items,
    );
    expect(fenced.ok && fenced.items).toEqual([{ hash: h1, role: "claim" }]);
    const bare = parseClassifyResponse({ choices: [{ message: { content: '[{"i": 2, "role": "question"}]' } }] }, items);
    expect(bare.ok && bare.items).toEqual([{ hash: h2, role: "question" }]);
  });

  test("fails as a value on unparseable content", () => {
    const res = parseClassifyResponse({ choices: [{ message: { content: "モデルの説明は…" } }] }, items);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.failure.reason).toBe("parse");
    expect(parseClassifyResponse({}, items).ok).toBe(false);
  });
});
