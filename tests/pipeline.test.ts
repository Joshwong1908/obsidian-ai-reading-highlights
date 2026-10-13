import { describe, expect, test } from "bun:test";
import { createAnnotationStore, AnnotationRecord, AnnotationStore } from "../src/store";
import { createPipeline, Pipeline, PipelineSettings } from "../src/pipeline";
import { splitBlocks, BlockHash } from "../src/blocks";
import { HttpTransport } from "../src/api";

const DOC_A = "# 结论\n\n因此这个方案成立。\n";

function hashOf(markdown: string, excerpt: string): BlockHash {
  const block = splitBlocks(markdown).blocks.find((b) => b.text.includes(excerpt));
  if (block === undefined) throw new Error(`no block with ${excerpt}`);
  return block.hash;
}

interface Harness {
  reads: string[];
  transports: string[];
  events: string[];
  settings: PipelineSettings;
  clock: { advance: (ms: number) => void };
  persist: AnnotationRecord[][];
  store: AnnotationStore;
  pipeline: Pipeline;
}

function makeHarness(doc: string, transport: HttpTransport, settings?: Partial<PipelineSettings>): Harness {
  const reads: string[] = [];
  const transports: string[] = [];
  const events: string[] = [];
  const persist: AnnotationRecord[][] = [];
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  let clockNow = 0;
  const mutable: PipelineSettings = {
    api: { baseUrl: "http://x", apiKey: "k", model: "m" },
    charBudget: 16000,
    debounceMs: 1500,
    ...settings,
  };
  const store = createAnnotationStore(
    {
      capacity: 100,
      persist: async (records) => {
        persist.push([...records]);
      },
      schedule: (fn, ms) => {
        const rec = { at: clockNow + ms, fn, cancelled: false };
        timers.push(rec);
        return () => {
          rec.cancelled = true;
        };
      },
      now: () => clockNow,
    },
    [],
  );
  store.onUpdate((hashes) => events.push(hashes.join(",")));
  const pipeline = createPipeline({
    store,
    read: async (path) => {
      reads.push(path);
      return doc;
    },
    settings: () => mutable,
    transport: async (req) => {
      transports.push(req.url);
      return transport(req);
    },
    notify: () => {},
    schedule: (fn, ms) => {
      const rec = { at: clockNow + ms, fn, cancelled: false };
      timers.push(rec);
      return () => {
        rec.cancelled = true;
      };
    },
    now: () => clockNow,
  });
  return {
    reads,
    transports,
    events,
    settings: mutable,
    clock: {
      advance(ms) {
        clockNow += ms;
        for (const t of [...timers]) {
          if (!t.cancelled && t.at <= clockNow) {
            t.fn();
            timers.splice(timers.indexOf(t), 1);
          }
        }
      },
    },
    persist,
    store,
    pipeline,
  };
}

const okTransport: HttpTransport = async (req) => {
  const body = JSON.parse(req.body) as { messages: { content: string }[] };
  const user = body.messages[1]!.content;
  const blockCount = (user.match(/^\[\d+\]/gm) ?? []).length;
  const labels = Array.from({ length: blockCount }, (_, i) => ({ i: i + 1, role: "claim" }));
  return {
    status: 200,
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ labels }) } }] }),
  };
};

describe("pipeline lifecycle", () => {
  test("heuristic lands instantly, api refines to the same role source", async () => {
    const h = makeHarness(DOC_A, okTransport);
    h.pipeline.fileOpened("a.md");
    await h.pipeline.idle();
    const hash = hashOf(DOC_A, "因此这个方案成立");
    expect(h.events.length).toBeGreaterThan(0);
    expect(h.transports.length).toBe(1);
    expect(h.store.get(hash)?.meta.source).toBe("api");
  });

  test("re-open with everything cached makes no api call", async () => {
    const h = makeHarness(DOC_A, okTransport);
    h.pipeline.fileOpened("a.md");
    await h.pipeline.idle();
    const calls = h.transports.length;
    h.pipeline.fileOpened("a.md");
    await h.pipeline.idle();
    expect(h.transports.length).toBe(calls);
  });

  test("rapid edits collapse into one debounced run", async () => {
    const h = makeHarness(DOC_A, okTransport);
    h.pipeline.fileEdited("a.md");
    h.pipeline.fileEdited("a.md");
    h.pipeline.fileEdited("a.md");
    expect(h.reads.length).toBe(0);
    h.clock.advance(1500);
    await h.pipeline.idle();
    expect(h.reads.length).toBe(1);
  });

  test("api failure keeps heuristic colors and cools down", async () => {
    const failing: HttpTransport = async () => ({ status: 500, body: "boom" });
    const h = makeHarness(DOC_A, failing);
    h.pipeline.fileOpened("a.md");
    await h.pipeline.idle();
    const hash = hashOf(DOC_A, "因此这个方案成立");
    expect(h.store.get(hash)?.meta.source).toBe("heuristic");
    h.pipeline.fileOpened("a.md");
    await h.pipeline.idle();
    expect(h.transports.length).toBe(1);
    h.pipeline.reclassifyNow("a.md");
    await h.pipeline.idle();
    expect(h.transports.length).toBe(2);
  });

  test("superseded run is dropped", async () => {
    let releaseFirst: (() => void) | null = null;
    const slow: HttpTransport = (req) => {
      const { promise, resolve } = Promise.withResolvers<{ status: number; body: string }>();
      releaseFirst = () => resolve(okTransport(req));
      return promise;
    };
    const h = makeHarness(DOC_A, slow);
    const microtasks = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    h.pipeline.fileOpened("a.md");
    await microtasks();
    expect(releaseFirst).not.toBeNull();
    h.settings.api = null;
    h.pipeline.fileOpened("a.md");
    await microtasks();
    releaseFirst!();
    await h.pipeline.idle();
    const hash = hashOf(DOC_A, "因此这个方案成立");
    expect(h.store.get(hash)?.meta.source).toBe("heuristic");
  });
});
