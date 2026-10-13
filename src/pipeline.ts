import { BlockHash, BlockRef, isClassifiable, splitBlocks } from "./blocks";
import { heuristicSpans } from "./heuristic";
import { ApiConfig, ClassifyItem, HttpTransport, classifyViaApi } from "./api";
import { Span } from "./spans";
import { AnnotationStore, StorableRecord } from "./store";

export interface PipelineSettings {
  readonly api: ApiConfig | null;
  readonly charBudget: number;
  readonly debounceMs: number;
}

export interface PipelineDeps {
  readonly store: AnnotationStore;
  readonly read: (path: string) => Promise<string>;
  readonly settings: () => PipelineSettings;
  readonly transport: HttpTransport;
  readonly notify: (msg: string) => void;
  readonly schedule: (fn: () => void, ms: number) => () => void;
  readonly onNoteSpans?: (path: string, spans: readonly Span[]) => void;
  readonly now?: () => number;
}

export interface Pipeline {
  fileOpened(path: string): void;
  fileEdited(path: string): void;
  reclassifyNow(path: string): void;
  idle(): Promise<void>;
  dispose(): Promise<void>;
}

const API_COOLDOWN_MS = 60_000;

export function createPipeline(deps: PipelineDeps): Pipeline {
  const now = deps.now ?? (() => Date.now());
  const versions = new Map<string, number>();
  const controllers = new Map<string, AbortController>();
  const debounces = new Map<string, () => void>();
  const active = new Set<Promise<void>>();
  let apiCooldownUntil = 0;
  let failureNotified = false;

  const bump = (path: string): number => {
    const v = (versions.get(path) ?? 0) + 1;
    versions.set(path, v);
    return v;
  };

  const buildItems = (blocks: readonly BlockRef[]): ClassifyItem[] => {
    const items: ClassifyItem[] = [];
    const headings: string[] = [];
    for (const b of blocks) {
      if (b.kind === "heading") {
        headings.push(b.text.replace(/^#+\s*/, ""));
        if (headings.length > 2) headings.shift();
        continue;
      }
      if (isClassifiable(b.kind)) items.push({ hash: b.hash, kind: b.kind, text: b.text, context: [...headings] });
    }
    return items;
  };

  const chunkByBudget = (items: readonly ClassifyItem[], budget: number): ClassifyItem[][] => {
    const chunks: ClassifyItem[][] = [];
    let cur: ClassifyItem[] = [];
    let chars = 0;
    for (const item of items) {
      if (cur.length > 0 && chars + item.text.length > budget) {
        chunks.push(cur);
        cur = [];
        chars = 0;
      }
      cur.push(item);
      chars += item.text.length;
    }
    if (cur.length > 0) chunks.push(cur);
    return chunks;
  };

  const run = async (path: string, force: boolean): Promise<void> => {
    const version = bump(path);
    controllers.get(path)?.abort();
    controllers.delete(path);
    let markdown: string;
    try {
      markdown = await deps.read(path);
    } catch {
      return;
    }
    if ((versions.get(path) ?? 0) !== version) return;
    const index = splitBlocks(markdown);
    const items = buildItems(index.blocks);
    if (items.length === 0) return;

    const apiEnabled = deps.settings().api !== null;
    const stale: ClassifyItem[] = [];
    const upgrade: ClassifyItem[] = [];
    for (const item of items) {
      const hit = deps.store.get(item.hash);
      if (hit === null || force) stale.push(item);
      else if (apiEnabled && hit.meta.source === "heuristic") upgrade.push(item);
    }

    const emitSpans = () => {
      if (deps.onNoteSpans === undefined) return;
      const spans: Span[] = [];
      for (const item of items) {
        const rec = deps.store.get(item.hash);
        if (rec !== null) for (const s of rec.spans) spans.push(s);
      }
      deps.onNoteSpans(path, spans);
    };
    const missHashes = new Set<BlockHash>(stale.map((i) => i.hash));
    const guesses = heuristicSpans(index.blocks).filter((g) => missHashes.has(g.hash));
    if (guesses.length > 0) {
      deps.store.put(guesses.map((g) => ({ hash: g.hash, spans: g.spans, meta: { source: "heuristic" as const } })));
    }

    const api = deps.settings().api;
    const wantsApi = api !== null && (stale.length > 0 || upgrade.length > 0);
    const cooledDown = now() < apiCooldownUntil;
    if (api === null || !wantsApi || (cooledDown && !force)) {
      emitSpans();
      return;
    }

    const batch = [...stale, ...upgrade];
    for (const chunk of chunkByBudget(batch, deps.settings().charBudget)) {
      if ((versions.get(path) ?? 0) !== version) return;
      const controller = new AbortController();
      controllers.set(path, controller);
      const res = await classifyViaApi(api, chunk, controller.signal, deps.transport);
      if ((versions.get(path) ?? 0) !== version) return;
      controllers.delete(path);
      if (res.ok) {
        const records: StorableRecord[] = res.items.map((i) => ({
          hash: i.hash,
          spans: i.spans,
          meta: { source: "api" as const, model: api.model },
        }));
        if (records.length > 0) deps.store.put(records);
        failureNotified = false;
      } else if (res.failure.reason === "http" || res.failure.reason === "parse") {
        apiCooldownUntil = now() + API_COOLDOWN_MS;
        if (!failureNotified) {
          failureNotified = true;
          deps.notify(`Semantic Reading: API failed (${res.failure.detail ?? res.failure.reason}), heuristic colors kept.`);
        }
      }
    }
    emitSpans();
  };

  const tracked = (path: string, force: boolean): void => {
    const p = run(path, force).finally(() => active.delete(p));
    active.add(p);
  };

  return {
    fileOpened(path) {
      debounces.get(path)?.();
      debounces.delete(path);
      tracked(path, false);
    },
    fileEdited(path) {
      debounces.get(path)?.();
      const cancel = deps.schedule(() => {
        debounces.delete(path);
        tracked(path, false);
      }, deps.settings().debounceMs);
      debounces.set(path, cancel);
    },
    reclassifyNow(path) {
      debounces.get(path)?.();
      debounces.delete(path);
      tracked(path, true);
    },
    async idle() {
      while (active.size > 0) await Promise.all([...active]);
    },
    async dispose() {
      for (const c of controllers.values()) c.abort();
      controllers.clear();
      for (const cancel of debounces.values()) cancel();
      debounces.clear();
      await this.idle();
      await deps.store.flush();
    },
  };
}
