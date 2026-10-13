# Candidate B — lazy, viewport-prioritized classification

## Problem

Color dense notes by semantic role at render time without ever touching note files, against two opposing costs. Eager whole-note classification pays API cost proportional to note length even though a reader looks at a fraction of a 300-line note, and any one-line edit invalidates a whole-note hash and re-pays it. Fully lazy per-block classification paints the viewport fast and pays only for what is read, but it introduces the hard problems this design must settle: one block must carry the same identity in three representations (source text, reading-view DOM, CM6 doc), requests must be coalesced so "lazy" does not become "N round-trips per scroll", and an edit landing mid-flight must not paint a stale role. Grounded constraints honored from the brief and the traced `keyword-highlighter` subsystem: `registerMarkdownPostProcessor(el, ctx)` per rendered section, CM6 `ViewPlugin` + `Decoration` for live preview, `Plugin.loadData/saveData` for persistence, user-configured OpenAI-compatible chat endpoint, a pure heuristic fallback, and no `vault.modify` on notes — ever.

## Usage (caller's view)

The consumer is the plugin author wiring one composition root. Every module below is reached from `plugin.ts`; nothing else imports another module's internals.

**Settings tab user flow.** User opens Settings → Semantic Reading, pastes `baseUrl` / `apiKey` / `model`, clicks *Test connection*, sees either `ok: model "…" reachable` or a one-line failure, enables roles (all five on by default), and closes the tab. Config changes take effect on next render; the annotation cache is untouched by config edits.

```ts
// settings.ts — the only module that knows users
new Setting(containerEl)
  .setName('API endpoint')
  .addText(t => t.setValue(cfg.api.baseUrl)
    .onChange(v => configStore.patch({ api: { ...cfg.api, baseUrl: v.trim() } })));

new Setting(containerEl)
  .setName('Test connection')
  .addButton(b => b.setButtonText('Test')
    .onClick(async () => {
      const r = await probeApi(cfg.api);           // domain type out, JSON parsed inside
      setMessage(r.ok ? `ok: model “${r.model}” reachable` : `failed: ${r.failure.reason}`);
    }));
```

**Render-path call site 1 — reading view.**

```ts
// plugin.ts
const deps: RenderDeps = { store, scheduler, roleClass };   // three fields, nothing else
this.registerMarkdownPostProcessor(createReadingViewAdapter(deps));
```

Inside the adapter, per rendered section: `ctx.getSectionInfo(el)` → source lines → block hashes → store hit ⇒ decorate now; miss ⇒ watch the element, `scheduler.request(refs, 'visible')`. The adapter never sees the API, the prompt, or the queue.

**Render-path call site 2 — live preview.**

```ts
this.registerEditorExtension(createLivePreviewExtension(deps));
```

The CM6 ViewPlugin, on viewport or doc change: find blocks intersecting `view.viewport`, store hit ⇒ `Decoration.line`, miss ⇒ enqueue. Same roles, same `roleClass` names, same CSS.

**Manual command.**

```ts
this.addCommand({
  id: 'reclassify-note', name: 'Reclassify current note',
  callback: () => {
    const doc = currentDoc(this.app);            // active MarkdownView source
    const index = splitBlocks(doc);
    store.delete(index.blocks.map(b => b.hash)); // drop stale roles for this content
    scheduler.request(index.blocks, 'visible');  // viewport re-prioritizes inside
  },
});
```

Everything else — batching, debounce, retry, heuristic fallback, eviction, repaint fan-out — is behind `request` and `store.onUpdate`.

## Shape

### Identity first: the block is the unit of everything

One pure module (`blocks.ts`) owns the answer to "what is a block and what is its name".

- **Granularity verdict**: block-level only, where a block is a *paragraph, one list item (with its continuation lines), one quote line, or one whole table*. Not sentences — in the sample note, roles distribute per paragraph and per numbered judgment, not per sentence, and sentence-level inline marks would require wrapping text nodes inside already-rendered markdown (`**bold**`, links), which is exactly where reading-view decoration breaks. Headings are split out as `kind: 'heading'` and used as *context*, never decorated. Code blocks and frontmatter are split out as `kind: 'code' | 'frontmatter'` and skipped. `keyterm` is deferred (see Open questions).
- **Identity** = `BlockHash = sha256(normalized block source)`, first 16 hex chars. Content-addressed, so it is stable across the three representations, across note moves, and across the two views showing the same note at once.
- **Normalization rules** (owned here, nowhere else): NFC Unicode normalization (protects against composed-form drift on CJK and combining marks); strip trailing whitespace per line; strip leading/trailing blank lines of the block; join with `\n`; keep interior content verbatim — markdown syntax (`**…**`, `> `, `- `) is part of meaning and stays in both hash and prompt; **no** full-width/half-width folding (`：` ≠ `:`), no whitespace collapsing inside lines (CJK meaning does not depend on spaces and code-adjacent text must not be mangled).
- **Reading-view mapping**: `ctx.getSectionInfo(el)` returns the section's source lines; the splitter runs on that section text, so DOM elements and CM6 lines derive from the *same* splitting code. For `ul/ol`, list-item blocks align to `li` children by ordinal; if counts mismatch (nested lists), the adapter coarsens to one merged block hashed from the whole section text — adapters may merge, never mismatch. Sections with no section info (embeds) are skipped entirely: decorating an embed via the host note's cache would be wrong by definition.

### Data shapes

```ts
// blocks.ts
export type BlockHash = string & { readonly __blockHash: true }; // 16-hex
export type BlockKind = 'paragraph' | 'listItem' | 'quoteLine' | 'table'
                      | 'heading' | 'code' | 'frontmatter';

export interface BlockRef {
  readonly hash: BlockHash;
  readonly kind: BlockKind;        // heading/code/frontmatter: context or skip
  readonly fromLine: number;       // 0-based inclusive
  readonly toLine: number;         // inclusive
  readonly text: string;           // normalized source: hashed and prompted verbatim
}

export interface BlockIndex {
  readonly blocks: readonly BlockRef[];
  blockAt(line: number): BlockRef | null;   // binary search, used by CM6 viewport math
}

export function splitBlocks(source: string): BlockIndex;
export function hashBlock(normalizedText: string): BlockHash;
```

```ts
// store.ts — durable results only; no pending state lives here
export type AnnotationSource =
  | { source: 'api'; model: string }        // heuristic records cannot carry a model:
  | { source: 'heuristic' };                // illegal pair unrepresentable

export interface AnnotationRecord {
  readonly hash: BlockHash;
  readonly role: BlockRole;
  readonly meta: AnnotationSource;
  readonly at: number;                      // epoch ms, LRU eviction key
}

export interface AnnotationStore {
  get(hash: BlockHash): AnnotationRecord | null;
  put(records: readonly AnnotationRecord[]): void;   // atomic write + LRU bump + debounced flush
  delete(hashes: readonly BlockHash[]): void;        // manual reclassify
  onUpdate(cb: (changed: readonly BlockHash[]) => void): () => void;  // returns unsubscriber
  flush(): Promise<void>;
}
```

The store is a single global `Record<BlockHash, AnnotationRecord>` in a plugin-dir `cache.json` (`{ version: 1; entries }`, migration owned inside). Global-by-hash beats per-note maps: an edit to note A never invalidates note B, identical blocks (templates, repeated citations) hit across notes, and the bound is one policy in one place — `MAX_ENTRIES = 5000` (≈1 MB JSON), evict oldest `at` on overflow.

```ts
// classifier.ts — one interface, two implementations; callers cannot tell which
export type BlockRole = 'claim' | 'evidence' | 'caveat' | 'question' | 'definition';

export interface ClassifyBatchItem { readonly hash: BlockHash; readonly text: string; readonly kind: BlockKind; }
export interface ClassifyBatch {
  readonly items: readonly ClassifyBatchItem[];       // same note, near-contiguous
  readonly context: readonly string[];                // nearest preceding headings, verbatim
}

export type ClassifyFailure = { reason: 'http' | 'parse' | 'quota' | 'aborted'; detail?: string };
export type ClassifyResult =
  | { ok: true; items: readonly { hash: BlockHash; role: BlockRole }[] }
  | { ok: false; failure: ClassifyFailure };

export interface Classifier {
  readonly id: 'api' | 'heuristic';
  classify(batch: ClassifyBatch, signal: AbortSignal): Promise<ClassifyResult>;
}

export function probeApi(api: ApiConfig): Promise<{ ok: true; model: string } | { ok: false; failure: ClassifyFailure }>;
```

`ClassifyResult` never throws across the boundary; failures are values. The API implementation owns the **single external-JSON boundary**: `parseClassifyResponse(raw: unknown)` turns whatever the endpoint returned into `ClassifyResult`, so wire shapes (`choices[0].message.content`, fenced JSON, role enums) appear in exactly one file. The heuristic implementation is pure regex/cue-word over both languages (由此/因此/结论 → claim; 来源/实验/％/et al/（20xx） → evidence; 边界/推翻/除非 → caveat; ？/待验证 → question; 定义/指的是 → definition) and always returns `ok`.

### Request scheduler: a state machine, not booleans

```ts
// scheduler.ts
export type Priority = 'visible' | 'background';

export interface ClassifyScheduler {
  request(refs: readonly BlockRef[], priority: Priority): void;  // dedup + promote, never double-call
  cancelNotIn(live: ReadonlySet<BlockHash>): void;               // edit / view-switch pruning
  dispose(): void;
}

// private, but load-bearing — states as a discriminated union:
type RequestState =
  | { state: 'queued'; priority: Priority; since: number }        // priority mutable on intersect changes
  | { state: 'inflight'; batchId: BatchId; since: number }
  | { state: 'retrying'; failure: ClassifyFailure; attempt: 1; nextAt: number }
  | { state: 'fallen-back'; failure: ClassifyFailure };           // transient: heuristic put in flight
// 'done' is not a state: success → store.put → entry removed. Absence + store hit IS done.
// Transitions (enforced in one transition() function):
//   ∅ →queued  request()               queued →inflight seal
//   inflight →∅ ok (store.put)         inflight →retrying failure, attempt 1
//   retrying →inflight nextAt elapsed  retrying →fallen-back second failure
//   fallen-back →∅ heuristic put       queued →∅ cancelNotIn
//   queued{background} ⇄ queued{visible}  intersect/un-intersect, visible wins
// Batch lifecycle, same discipline:
type BatchState = 'open' | 'sealed' | 'inflight' | 'settled';
```

A block cannot be queued and in-flight simultaneously because the union has one tag per entry in `Map<BlockHash, RequestState>`; `request()` on an existing hash is a no-op or a priority promotion, never a second call.

### Coalescing policy: cost vs latency, all numbers in one module

Constants (not settings — settings sprawl hides cost policy from its owner): `DEBOUNCE_MS = 250`, `BATCH_BLOCKS = 12`, `BATCH_CHARS = 6000`, `MAX_CONCURRENT_BATCHES = 2`, `RETRY = 1 × 2s`, `TRUNCATE_ITEM = 4000` chars (prompt-only; hash uses full text, marked `…[truncated]`).

- **Batching**: when the debounce closes, queued blocks of the same note are packed nearest-first while gaps ≤ 2 blocks (in-between undecorated blocks ride along free — anticipation) into batches capped by blocks and chars. 6,000 CJK-heavy chars ≈ 4–6k tokens: safely inside any chat model's window; long notes never produce a whole-note call because the *viewport*, not the note, sizes the batch — a screen of 10–30 blocks is one or two calls.
- **Priority**: `visible` (IntersectionObserver intersection in reading view; `view.viewport` in CM6) outranks `background` (manual command, anticipation riders). In-flight batches are never preempted; two run concurrently, the rest wait sealed.
- **Failure**: batch fails once → retry after 2s → fails again → heuristic classifier classifies that batch immediately and records land with `{ source: 'heuristic' }`, which renderers mark with an `sr-heur` modifier class (visibly honest, no status-bar API needed). Worst-case decoration latency is bounded at ~2 round-trips + 2s.
- **Latency profile**: first paint of a freshly opened note ≈ 250 ms debounce + one round trip; revisits are 0 ms and 0 calls (store hit before enqueue).

### Trigger lifecycle

| Event | Reading view | Live preview |
|---|---|---|
| Becomes visible | post-processor fires per section → `getSectionInfo` → store hit ? decorate : IO-watch + `request(…, 'visible')` | `update(u)` with `viewportChanged` → blocks in `view.viewport` → hit ? `Decoration.line` : `request(…, 'visible')` |
| Scroll | IO intersect/un-intersect flips priority; un-intersected queued blocks stay at `background` | viewport change re-runs the same path |
| Edit | n/a (reading view doesn't edit; re-render restarts the flow) | `docChanged` → `cancelNotIn(newLiveHashes)`; changed blocks get new hashes ⇒ they are simply new misses. In-flight batches are *not* aborted on edit: results land under stale hashes, which no live block will ever look up — harmless, eventually evicted |
| Note switched / leaf closed | adapter registry dropped | `cancelNotIn` prunes queue; in-flight batches aborted via their `AbortSignal` |
| Manual command | recompute index, `store.delete`, `request(blocks, 'visible')` — also the only path that upgrades heuristic records to API records | same |
| Both views on one note | hash-keyed dedup in the scheduler means one call paints both; each adapter repaints from `store.onUpdate` | same |

### Failure modes, settled

1. **API down mid-stream** — per-batch retry once, then heuristic fallback for that batch only; other batches unaffected; degraded state is visible per-block via `sr-heur`, upgraded only by the manual command (no auto-retry loop).
2. **Oversized note** — lazy pipeline makes note size irrelevant to cost: only visible blocks enqueue. A single oversized block is truncated in the prompt, hashed in full. Splitter hard-caps at 5,000 blocks and logs once.
3. **Rapid scrolling (request storms)** — enqueue is deduped by hash (Map key); off-screen queued blocks are demoted, not multiplied; `MAX_CONCURRENT_BATCHES = 2` bounds outstanding HTTP; results for scrolled-past blocks are cache hits when the user returns, so the "wasted" work is banked, not lost.
4. **Cache bound** — 5,000-entry LRU by `at`, debounced flush; store file is versioned with migration inside `store.ts`.
5. **Edit vs in-flight race** — content-addressed identity makes the race benign by construction: decorations are *never* held by renderers; both paths look up the store by current-hash at paint time, and a stale result writes a dead hash nothing reads.

### Module map

| Module | Owns (body of knowledge) | Public surface | Node-testable |
|---|---|---|---|
| `blocks.ts` | splitting, normalization, hashing — block identity | `splitBlocks`, `hashBlock`, `BlockRef`, `BlockIndex` | pure — yes |
| `classifier/heuristic.ts` | zh/en cue-word role rules | `classify` | pure — yes |
| `classifier/api.ts` | transport, auth, prompt build, **the only external-JSON parse**, truncation | `classify`, `probeApi` | parse pure; fetch mocked |
| `store.ts` | durable format + versioning, LRU bound, record lifecycle, change events | `get/put/delete/onUpdate/flush` | temp dir — yes |
| `scheduler.ts` | queue state machine, batching/coalescing, debounce, priority, retry + fallback, concurrency | `request`, `cancelNotIn`, `dispose` | injected classifier + fake timers — yes |
| `reading-view.ts` | el↔source mapping, el registry, IntersectionObserver wiring, coarse alignment, DOM class application | `createReadingViewAdapter(deps)` | browser harness |
| `live-preview.ts` | CM6 viewport math, Decoration building, docChanged invalidation, external-repaint dispatch | `createLivePreviewExtension(deps)` | browser harness |
| `palette.ts` + `styles.css` | role→class vocabulary, light/dark hour-long comfort | `ROLE_CLASS: Record<BlockRole, string>`, `sr-heur` | harness (visual surface) |
| `settings.ts` | config shape, tab UX, probe UX | `SemanticReadingSettingTab`, `ConfigStore` | manual |
| `plugin.ts` | composition root: registration, manual command | none (entry point) | smoke on vault |

`RenderDeps = { store; scheduler; roleClass }` is the whole vocabulary shared by both render adapters; the API client, prompt, queue, and persistence file never cross that line.

### Red-flag screen (explicit)

- **Shallow module**: every module except `plugin.ts` hides substantial policy behind ≤ 5 exports (`scheduler` hides batching, timing, retry, and fallback behind two methods; `store` hides format, versioning, and eviction behind four). `plugin.ts` is a composition root, not a shallow module — it owns wiring policy only, and composition roots are where wiring belongs.
- **Information leakage**: the chat-completion wire shape is parsed in `classifier/api.ts` and never exported (`parseClassifyResponse(raw: unknown)`); the cache file schema lives only in `store.ts`; the one shared vocabulary is `ROLE_CLASS`, a deliberate five-name design contract owned by `palette.ts`, not a policy copy. Normalization rules exist in `blocks.ts` alone — reading view derives its hashes by *running* the splitter on section text, not by re-implementing rules.
- **Temporal decomposition**: rejected by ownership — the store owns load *and* save *and* evict; the scheduler owns enqueue *and* batch *and* retry *and* fallback (the whole request lifecycle at all times); the splitter owns both parsing and identity. No load/validate/transform/save stage-modules.
- **Pass-through method**: checked each edge. Render adapters do not forward to a shared "decorator" — each applies results in its own idiom (DOM class vs `Decoration.line`) and adds real policy (when to repaint, how to clean up, alignment fallback). The manual command adds policy (which blocks, force semantics), not forwarding. No interface in the map mirrors another's shape.

## Synthesis decision

*(filled by arena)*

## Tradeoffs accepted

- We accept content-addressed (rather than note-scoped) identity, meaning the same sentence in two roles in two notes gets one role, in exchange for free invalidation semantics, edit-proof races by construction, and cross-note cache hits.
- We accept heuristic results persisting after an API outage (until manual reclassify) in exchange for bounded decoration latency and an always-painted UI; the visible `sr-heur` marker keeps this honest.
- We accept a 250 ms debounce tax on first paint in exchange for one-call batching during scroll.
- We accept full `BlockIndex` recompute on every `docChanged` (O(note); <1 ms at 300 lines, capped at 5,000 blocks) instead of incremental re-parsing — the splitter is pure and testable precisely because it is whole-input.
- We accept a rare double-classification when reading-view list alignment falls back to merged-section hashing (same content, two hashes) in exchange for never mismatching an `li` to a wrong item.
- We accept deferring `keyterm` entirely rather than shipping inline marks half-designed.
- We accept that queue state is memory-only: a crash loses in-flight work, never banked work.

## Alternatives considered

- **Eager whole-note classification on open** (one call per note): simplest store and no scheduler, but cost scales with note length instead of reading, context limits force splitting anyway above ~40 blocks (reintroducing this scheduler), and any edit under a whole-note hash re-pays everything. Lost on the brief's own constraint 3 economics.
- **Store keyed per note path + whole-note content hash** (the brief's literal reading): one edited line invalidates every block in the note. Content-addressed per-block hashes strictly dominate it on hit rate; rejected.
- **Sentence-level classification**: finer-grained signal, but 3–5× items per batch, index-alignment fragility in responses, and inline decoration inside rendered markdown (`**bold**`, links, CJK-adjacent code) is where reading-view DOM work breaks. Deferred, not rejected — an additive store migration if block-level proves too coarse.
- **Per-block calls, no coalescing**: kills the scheduler's batching logic but pays per-call overhead and rate-limit pressure N times per screen and loses free local context from neighbors. The coalescing lives behind the same two-method surface anyway.

## Open questions and risks

- Does the installed Obsidian version invoke reading-view post-processors lazily on scroll, or eagerly for the whole note? The IntersectionObserver layer makes correctness independent of the answer, but eager invocation makes it the actual visibility gate — verify in the harness before treating IO as belt-and-suspenders.
- Is `BATCH_CHARS = 6000` right for the user's model and pricing? Constants centralize the change, but is a settings exposure warranted?
- Palette direction — left-border markers vs full background tint for hour-long reading comfort — is a browser-harness decision, not an architecture one; `ROLE_CLASS` is stable either way.
- Should heuristic-upgrade to API results happen opportunistically on the next visit after recovery, or stay manual-only (current choice)?
- Nested-list `li` ↔ item alignment is asserted for standard lists and untested against exotic nesting; the merged-section fallback covers it, at the known double-classification cost.
- `getSectionInfo` returning `null` for embeds means embedded content is never classified — intended, but worth confirming it matches user expectation.

## Next implementation step

Build `blocks.ts` — splitter, normalization, hashing — with unit tests against `docs/sample-note.md` (block counts, kinds, stable hashes under trailing-whitespace and NFC perturbations), since every other module consumes `BlockRef` and it is pure Node-testable on day one.
