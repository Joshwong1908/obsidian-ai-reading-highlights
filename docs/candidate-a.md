# Candidate A — batch-classify, cache-first

Pipeline shape: the whole note is classified once per settled content version (API with heuristic fallback), the result is stored keyed by content hash, and both render paths are pure cache lookups that join rendered blocks to stored roles by text fingerprint. Nothing that renders ever talks to the network.

## Problem

Color dense Chinese/English notes by semantic role at render time without ever writing note content. Four constraints make the shape non-obvious. (1) Two render surfaces see different text: the reading-view post-processor gets rendered DOM (`**bold**` is gone, list markers are markup), while the CM6 ViewPlugin sees raw markdown lines — a block identity scheme must survive that difference. (2) Re-render must never re-call the API (constraint 3), yet live preview re-renders on every keystroke, so classification and rendering must be decoupled by a store. (3) The API is user-configured and fallible; an offline heuristic must produce the same domain types, so "classification failed" cannot be an exceptional control-flow path. (4) Publishable quality with no `any` and boundary-parsed external JSON, on Obsidian's `registerMarkdownPostProcessor` / `registerEditorExtension` / `loadData`/`saveData` substrate.

## Usage (caller's view)

The consumer is the composition root (`main.ts`), the settings tab, and the reader. Reader flow: install → paste API key in settings → open a note → colors appear instantly (heuristic pass), refine a few seconds later (API pass); a status line in settings shows which engine produced the current colors. Misconfigure the API and the note simply stays heuristic-colored.

```ts
// settings-tab.ts (excerpt) — user flow: API section, roles, cache
new Setting(containerEl).setName('API base URL').addText(t =>
  t.setValue(cfg.baseUrl).onChange(v => update({ baseUrl: v.trim() })));
for (const role of ALL_ROLES)
  new Setting(containerEl).setName(`Highlight ${role}`).addToggle(t =>
    t.setValue(cfg.roles.includes(role))
     .onChange(on => update({ roles: toggleRole(cfg.roles, role, on) })));
new Setting(containerEl).setName('Cached notes').addExtraButton(b =>
  b.setIcon('trash').setTooltip('Clear cached colors').onClick(() => store.clear()));
renderStatus(containerEl, store.get(activeNotePath(app))); // "API · refreshed 12:03 · full note"
```

```ts
// main.ts (excerpt) — the two render-path call sites, plus the lifecycle
async onload(): Promise<void> {
  const data = await loadPluginData(this);              // one data.json: settings + annotations
  const settings = settingsSource(data.settings);       // hot-reloadable reader, owned by settings.ts

  this.store = createAnnotationStore(settings.snapshot().cacheMaxNotes, persistSink(this));

  // Render path 1 — reading view: decorate from cache, re-apply when a classification lands
  this.registerMarkdownPostProcessor(
    createReadingViewDecorator({ store: this.store, enabled: () => settings.snapshot().enabled }));

  // Render path 2 — live preview: CM6 line decorations from the same cache
  this.registerEditorExtension(
    buildLivePreviewExtension({ store: this.store, enabled: () => settings.snapshot().enabled,
                                onDocSettled: path => this.pipeline.fileEdited({ path }) }));

  this.pipeline = createPipeline({
    store: this.store, classify: classifyNote,
    read: f => this.app.vault.cachedRead(f as TFile),
    settings: () => settings.snapshot(), log: msg => new Notice(msg, 4000),
  });
  this.registerEvent(this.app.workspace.on('active-leaf-change',
    leaf => { const f = noteFileOf(leaf); if (f) this.pipeline.fileOpened(f); }));
  this.registerEvent(this.app.vault.on('delete', f => this.store.forget(f.path)));
  this.registerEvent(this.app.vault.on('rename',
    (f, oldPath) => { const a = this.store.get(oldPath);
                      if (a) { this.store.put(f.path, a); this.store.forget(oldPath); } }));

  this.addCommand({ id: 'reclassify', name: 'Reclassify this note now',
    callback: () => { const f = activeNoteFile(this.app); if (f) this.pipeline.reclassifyNow(f); } });
}
onunload(): void { this.pipeline.dispose(); }
```

What the decorators get back: nothing. They read `store.get(path)` and write CSS classes (`sr-claim`, …) or `Decoration.line` spans; they subscribe to the store and re-apply when an annotation lands. The caller never sees segments, prompts, fingerprints, or wire JSON.

## Shape

**Data structures first.** The annotation is the model everything derives from:

```ts
// roles.ts — shared vocabulary only
export type Role = 'claim' | 'evidence' | 'caveat' | 'question' | 'definition';
export const roleCssClass: Readonly<Record<Role, string>>;   // 'sr-claim' … used by BOTH renderers + styles.css

// text-id.ts — owns every text-identity rule
export type Fingerprint = string & { readonly brand: unique symbol };
export type NoteHash    = string & { readonly brand: unique symbol };
export function fingerprint(blockText: string): Fingerprint;
export function hashNote(markdown: string): NoteHash;
export interface KeytermHit { term: string; index: number; length: number } // indices into `text`
export function findKeyterms(text: string, terms: readonly string[]): readonly KeytermHit[];

// segment.ts — owns markdown block structure
export type SourceBlock =
  | { kind: 'classified'; text: string; fingerprint: Fingerprint;
      fromLine: number; toLine: number }                    // paragraph, list item, whole table
  | { kind: 'structural'; fromLine: number; toLine: number }; // heading, code fence, frontmatter:
                                                             // never classified, never decorated
export function segmentBlocks(markdown: string): readonly SourceBlock[];

// store.ts — owns retention, persistence, change notification
export interface NoteAnnotation {
  readonly noteHash: NoteHash;                    // content this annotation describes
  readonly provenance: 'api' | 'heuristic';
  readonly truncated: boolean;                    // true ⇒ blocks cover the head of the note only
  readonly blocks: ReadonlyMap<Fingerprint, Role>;
  readonly keyterms: readonly string[];           // [] when the feature is off
  readonly classifiedAt: number;
}
export interface AnnotationStore {
  get(path: string): NoteAnnotation | undefined;  // latest annotation for the file, any hash
  put(path: string, a: NoteAnnotation): void;     // replaces; LRU-evicts beyond capacity
  forget(path: string): void;
  subscribe(path: string | '*', onChange: (path: string) => void): () => void;
  clear(): void;
}
export interface PersistSink { flush(entries: readonly [string, NoteAnnotation][]): Promise<void> }
export function createAnnotationStore(capacity: number, persist: PersistSink): AnnotationStore;

// classify.ts — owns engines, prompt, wire parsing, fallback policy
export interface ClassifyConfig {
  api: { baseUrl: string; apiKey: string; model: string } | null;  // null ⇒ heuristic only
  charBudget: number; roles: readonly Role[]; keyterms: boolean;
}
export function classifyNote(markdown: string, cfg: ClassifyConfig,
                             signal: AbortSignal): Promise<NoteAnnotation>;
// Total: NEVER rejects for content reasons — API error or oversize ⇒ heuristic / truncated
// annotation. Rejects only on abort. Wire JSON parsed to domain types here, at this boundary.

// pipeline.ts — owns the trigger lifecycle
export interface NoteFile { readonly path: string }   // structural: TFile satisfies it; tests pass literals
export interface Pipeline {
  fileOpened(f: NoteFile): void;     // instant heuristic put, then queued API classify if stale
  fileEdited(f: NoteFile): void;     // restarts debounce (default 1.5 s); stale answers dropped on land
  reclassifyNow(f: NoteFile): void;  // force API regardless of freshness
  dispose(): void;                   // abort in-flight, flush store
}
export interface PipelineDeps {
  store: AnnotationStore; classify: typeof classifyNote;
  read: (f: NoteFile) => Promise<string>;
  settings: () => Readonly<Settings>; log: (msg: string) => void;
}
export function createPipeline(deps: PipelineDeps): Pipeline;

// decorate-dom.ts / decorate-cm6.ts — each owns one render surface
export interface DecoratorDeps { store: AnnotationStore; enabled: () => boolean }
export function createReadingViewDecorator(deps: DecoratorDeps): MarkdownPostProcessor;
export function buildLivePreviewExtension(deps: DecoratorDeps & {
  onDocSettled: (path: string) => void }): Extension[];
```

**Load-bearing decisions.**

*Block identity is a normalized-text fingerprint, and it is the join key for everything.* `fingerprint` = NFKC → case-fold → delete all whitespace and all Unicode punctuation → truncated SHA-256. Deleting whitespace and punctuation is what makes one rule serve both surfaces: `<td>a</td><td>b</td>` renders `textContent` `"ab"`, and the source line `| a | b |` normalizes to `"ab"` too; bold markers, list markers, and smart-quote drift vanish identically on both sides. No renderer ever parses markdown; identity is pure text knowledge, owned by `text-id.ts` alone.

*Cache keying.* The store maps path → latest `NoteAnnotation`, and the annotation carries its own `NoteHash` (keyed by content hash per constraint 3): freshness is `annotation.noteHash === hashNote(currentMarkdown)`. Renderers do not check freshness — they consume whatever annotation exists and join by fingerprint, so blocks that survived an edit keep their colors through the debounce window, and only changed/new blocks run plain until reclassification lands.

*Granularity: block-level.* Leaf blocks are the paragraph, the individual list item, and the whole table; headings, code fences, and frontmatter are `structural` and excluded. The sample note yields ~45 classified blocks vs ~120 sentences. Sentence-level would triple output tokens per call, force offset bookkeeping that breaks on any upstream edit, and paint five colors inside single paragraphs (the sample's `## 为什么验证器决定上限` section is bolded-claim-lead + evidence-body per paragraph) — against a product goal of glanceable reading. Block-level mislabels genuinely mixed paragraphs; we accept that and prompt for the dominant role. `keyterm` is the only sub-block decoration: the classifier returns a note-level term list, and each renderer matches occurrences in its own coordinates via the shared `findKeyterms`.

*Lifecycle.* `fileOpened`: put a synchronous heuristic annotation immediately (instant color, zero network), then queue an API classify if stale — when it lands it replaces the heuristic entry and both renderers re-decorate from the store event. `fileEdited` (from the CM6 `onDocSettled` hook): restart the debounce; when it fires, hash the note; if unchanged since last classification, do nothing; else queue. Every request carries its `NoteHash`; a response that lands for a superseded hash is dropped (its heuristic-era annotation stands until the newer answer arrives). Queue: per-file dedupe, at most 2 requests in flight, manual `reclassifyNow` jumps the queue and bypasses freshness. Rename/delete rekey or forget via the existing store surface, wired in `main.ts`.

*Failure modes.* API down/timeout/misconfigured: the heuristic annotation is already on screen; one `Notice` per failure, retried on next trigger or manual command; renderers are unaffected because they never classify. Oversized note (> `charBudget`, default 20 000 chars, block-boundary truncation): classify the head, mark `truncated: true`, show "partial" in the settings status. Many files opened at once: queue + in-flight cap + heuristic instant pass means every pane has color immediately. Cache bound: LRU over `cacheMaxNotes` (default 256; ~1 KB per note ≈ 256 KB persisted), debounced flush through one `PersistSink` so `data.json` has a single writer chain.

*Invariants in types.* Branded `Fingerprint`/`NoteHash` mean both can only be produced by `text-id.ts`. `SourceBlock` is a discriminated union so "never classify structural blocks" is unrepresentable as data, not a runtime filter. `classifyNote` is total (never rejects for content reasons); `provenance` records which engine ran, so there is no error path that leaves the store empty. External API JSON is parsed exactly once, inside `classify.ts`, into `NoteAnnotation`; unknown roles or unfingerprintable blocks in the response are dropped and logged, never coerced.

*Interface depth.* `text-id` hides the entire normalization rule behind two functions; `segment` hides markdown structure behind one; `classify` hides transport, prompt format, response schema, retry, truncation, and fallback behind one total function; `store` hides LRU, serialization, and notification behind four methods; `pipeline` hides debounce, queueing, staleness, and abort behind three triggers. The decorators each hide a surface's entire decoration mechanics (DOM registry and re-apply, CM6 `DecorationSet` rebuild) behind one factory. No public option exposes an internal stage.

## Synthesis decision

*(left for arena)*

## Tradeoffs accepted

- We accept one full-note API call per settled edit session (whole-hash invalidation) in exchange for trivially correct freshness; fingerprint joins keep unchanged blocks colored through the window, so the cost is latency on changed blocks only.
- We accept a possible visual flip heuristic→API seconds after open in exchange for zero blank period and colors on machines with no API at all.
- We accept rare false-positive fingerprint matches (distinct blocks identical after whitespace/punctuation stripping — same text, plausibly same role) in exchange for one identity rule that works on DOM `textContent` and source lines without markdown parsing in renderers.
- We accept latest-per-file retention (no multi-version history: undo across a reclassification re-runs the API) in exchange for a one-entry-per-file LRU that is simple to bound and persist.
- We accept whole-table fingerprints (one edited cell uncolors the table until reclassify) in exchange for not inventing per-row identity that reading-view DOM would not honor anyway.
- We accept ambient keyterm matches (a term surfacing inside a caveat) in exchange for source-coordinate matches that CM6 decorations require and API-returned offsets could not reliably provide.
- We accept head-truncation of oversized notes rather than chunked continuation in exchange for bounded latency and cost per call.

## Alternatives considered

- **Sentence-level classification.** Hides nothing the block level doesn't; exposes 3× output tokens, offset bookkeeping, and five colors per paragraph. Lost on noise (the actual product goal) and cost, not implementation difficulty.
- **Render-side/on-scroll per-block classification.** Couples renderers to the network, multiplies API calls by block count, and makes "never re-call for unchanged content" a per-block bookkeeping problem. Interface depth actually worse: both decorators would need engine selection and failure policy duplicated. Rejected.
- **Source-offset annotations** (classifier returns line/char ranges; renderers apply positionally). Positions break on any edit above them, so both renderers need position remapping — the same problem fingerprints solve, kept alive permanently. The fingerprint join dominates it on every axis. Rejected.
- **Per-renderer ownership of classification** (each surface calls the API when it renders). Temporal decomposition by render occasion; duplicates fallback and cache policy in two places and risks double calls. Rejected in favor of pipeline→store→renderers one-way flow.

## Open questions and risks

- Palette: left-border accent vs background wash per role, and exact light/dark tokens — decided in the browser harness against the sample note, or does the user want a say?
- The reading-view element registry (for re-apply when classification lands) is pruned via `isConnected` on each store event; if a file never re-classifies, could entries pin detached DOM? Do we also prune on `active-leaf-change`?
- Prompt stability across OpenAI-compatible endpoints: does the few-shot Chinese/English role prompt hold on small local models, or should `charBudget` ship with a per-model prompt override?
- Heuristic cue-word lists for six roles in two languages need tuning against the sample note — data-driven tables in `heuristic.ts`, or user-editable?
- Multi-pane: the same file open in two live-preview panes both subscribe and rebuild independently — acceptable, but should the reading-view registry dedupe identical elements?
- Store capacity measured in notes, not bytes; pathological notes (hundreds of blocks) make entries large. Cap blocks per annotation and mark `truncated`?

## Red-flag screen (self-check against design-red-flags.md)

- *Shallow module:* none. Every module above hides a substantive body of policy (normalization rules, markdown structure, engine/fallback, retention, lifecycle, one render surface each) behind ≤4 public members; `roles.ts` is vocabulary, not a module. Callers never coordinate multiple methods to complete one operation (`fileOpened` is one call; decorating is one lookup).
- *Information leakage:* wire JSON exists only inside `classify.ts`; persistence format only inside `store.ts`; normalization rule only inside `text-id.ts`; the role→CSS-class map is a single shared constant, not a duplicated decision. No public re-exports of transport or storage types.
- *Temporal decomposition:* modules own knowledge, not pipeline stages. `classify` is internally sequential (segment→prompt→parse→fallback) but that sequence is invisible behind one total function; no stage's representation crosses a public boundary.
- *Pass-through:* `pipeline.fileEdited` → `classifyNote` is not a forward: it adds debounce, hash comparison, queueing, and staleness dropping. `onDocSettled` → `pipeline.fileEdited` is event adaptation at a real boundary (CM6 → domain), the only forwarding in the sketch and it exists to keep debounce owned by one module.

## Next implementation step

Build and unit-test `text-id.ts` + `segment.ts` + `heuristic.ts` in Node against the sample note — asserting that `fingerprint(el.textContent)` of a browser-harness-rendered block equals `fingerprint` of the corresponding `segmentBlocks` entry — because that cross-surface equality is the join the whole design stands on.
