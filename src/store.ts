import { isRecord } from "./guard";
import { Span, parseSpanRole } from "./spans";
import { BlockHash } from "./blocks";

export type AnnotationSource = { source: "api"; model: string } | { source: "heuristic" };

export interface AnnotationRecord {
  readonly hash: BlockHash;
  readonly spans: readonly Span[];
  readonly meta: AnnotationSource;
  readonly at: number;
}

export type StorableRecord = Omit<AnnotationRecord, "at">;

export type StoreListener = (changed: readonly BlockHash[]) => void;

export interface AnnotationStore {
  get(hash: BlockHash): AnnotationRecord | null;
  put(records: readonly StorableRecord[]): void;
  delete(hashes: readonly BlockHash[]): void;
  onUpdate(listener: StoreListener): () => void;
  flush(): Promise<void>;
  clear(): void;
  size(): number;
}

export interface StoreDeps {
  capacity: number;
  persist: (records: readonly AnnotationRecord[]) => Promise<void>;
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
}

const HASH_RE = /^[0-9a-f]{16}$/;

function parseSpans(raw: unknown): Span[] | null {
  if (!Array.isArray(raw)) return null;
  const spans: Span[] = [];
  for (const s of raw) {
    if (!isRecord(s)) continue;
    const quote = typeof s.quote === "string" ? s.quote : "";
    const role = parseSpanRole(s.role);
    if (quote === "" || role === null) continue;
    spans.push({ quote, role });
  }
  return spans;
}

export function parseStoreFile(raw: unknown): readonly AnnotationRecord[] {
  if (!isRecord(raw)) return [];
  if ((raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.entries)) return [];
  const records: AnnotationRecord[] = [];
  for (const e of raw.entries) {
    if (!isRecord(e)) continue;
    if (typeof e.hash !== "string" || !HASH_RE.test(e.hash) || typeof e.at !== "number") continue;
    const spans = parseSpans(e.spans);
    if (spans === null || spans.length === 0) continue;
    let meta: AnnotationSource | null = null;
    if (isRecord(e.meta)) {
      if (e.meta.source === "heuristic") meta = { source: "heuristic" };
      else if (e.meta.source === "api" && typeof e.meta.model === "string") meta = { source: "api", model: e.meta.model };
    }
    if (meta === null) continue;
    records.push({ hash: e.hash as BlockHash, spans, meta, at: e.at });
  }
  return records;
}

export function createAnnotationStore(deps: StoreDeps, initial: readonly AnnotationRecord[] = []): AnnotationStore {
  const capacity = Math.max(1, deps.capacity);
  const now = deps.now ?? (() => Date.now());
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const t = window.setTimeout(fn, ms);
      return () => window.clearTimeout(t);
    });
  const map = new Map<string, AnnotationRecord>();
  const listeners = new Set<StoreListener>();
  let lastAt = 0;
  let cancelFlush: (() => void) | null = null;

  for (const r of initial) {
    map.set(r.hash, r);
    lastAt = Math.max(lastAt, r.at);
  }

  const evict = () => {
    while (map.size > capacity) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
  };

  const emit = (hashes: readonly BlockHash[]) => {
    for (const l of listeners) l(hashes);
  };

  const persistNow = async () => {
    cancelFlush?.();
    cancelFlush = null;
    await deps.persist([...map.values()]);
  };

  const scheduleFlush = () => {
    if (cancelFlush) return;
    cancelFlush = schedule(() => {
      cancelFlush = null;
      void persistNow();
    }, 2000);
  };

  evict();

  return {
    get(hash) {
      const hit = map.get(hash);
      if (hit === undefined) return null;
      map.delete(hash);
      map.set(hash, hit);
      return hit;
    },
    put(records) {
      if (records.length === 0) return;
      const stamp = now();
      lastAt = Math.max(lastAt, stamp);
      const changed: BlockHash[] = [];
      for (const r of records) {
        map.set(r.hash, { ...r, at: lastAt++ });
        changed.push(r.hash);
      }
      evict();
      scheduleFlush();
      emit(changed);
    },
    delete(hashes) {
      let touched = false;
      for (const h of hashes) {
        if (map.delete(h)) touched = true;
      }
      if (touched) scheduleFlush();
    },
    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: persistNow,
    clear() {
      map.clear();
      scheduleFlush();
      emit([]);
    },
    size() {
      return map.size;
    },
  };
}
