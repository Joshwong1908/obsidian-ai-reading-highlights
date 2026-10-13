# Semantic Reading, synthesized design

Base: candidate A's lifecycle. Grafted from candidate B: identity discipline, global content-addressed store, retry-to-heuristic fallback, honesty marker. Rejected for v1: candidate B's viewport scheduler. Frozen inputs: `candidate-a.md`, `candidate-b.md`, palette probe measurements below.

## Problem

Color dense notes by semantic role at render time, never writing note content, across two render surfaces that see different text (reading-view DOM vs CM6 raw markdown), with a fallible user-configured API and a hard "never re-classify unchanged content" constraint.

## Usage

Reader: install, paste an OpenAI-compatible base URL, key, and model, open a note. Heuristic colors appear immediately; an API pass refines them seconds later and repaints. Misconfigure or lose the API and the note stays heuristic-colored, visibly marked. Settings expose role toggles, palette preset, intensity, grammar, a connection test, and a cache-clear button.

Composition root (`main.ts`): `registerMarkdownPostProcessor(readingViewAdapter(deps))`, `registerEditorExtension(livePreviewExtension(deps))`, `pipeline.fileOpened/fileEdited/reclassifyNow`, vault rename/delete rekeying. `deps = { store, enqueue, classify, settings }` is the whole vocabulary shared across modules.

## Shape

```ts
// roles.ts
type Role = 'claim' | 'evidence' | 'caveat' | 'question' | 'definition';
const ROLE_CLASS: Record<Role, string>; // sr-claim … shared by both renderers + styles.css

// blocks.ts — the only owner of block identity
type BlockHash = string & { readonly __blockHash: true }; // 16 hex
type BlockKind = 'paragraph' | 'listItem' | 'quoteLine' | 'table' | 'heading' | 'code' | 'frontmatter';
interface BlockRef { hash; kind; fromLine; toLine; text } // text = normalized source, hashed and prompted verbatim
interface BlockIndex { blocks: readonly BlockRef[]; blockAt(line): BlockRef | null }
splitBlocks(source): BlockIndex; hashBlock(normalized): BlockHash
// Normalization: NFC, trim line-trailing space, trim block edges, join "\n". Markdown syntax stays.
// Join rule: BOTH surfaces hash source lines through this same module (CM6 from doc text,
// reading view from ctx.getSectionInfo(el).text). DOM text is never hashed.

// store.ts — global, content-addressed, durable
type AnnotationSource = { source: 'api'; model: string } | { source: 'heuristic' };
interface AnnotationRecord { hash; role: Role; meta: AnnotationSource; at: number }
interface AnnotationStore { get(hash); put(records); delete(hashes); onUpdate(cb); flush() }
// cache.json { version: 1, entries }, LRU 5000 by `at`, single debounced writer.

// heuristic.ts — pure zh/en cue-word classifier, always ok
// api.ts — OpenAI-compatible transport + prompt + the ONLY external-JSON parse
type ClassifyResult = { ok: true; items: { hash; role }[] } | { ok: false; failure: { reason; detail? } };
classify(batch, signal): Promise<ClassifyResult>; probeApi(api): Promise<…>

// pipeline.ts — candidate A lifecycle over candidate B store
interface Pipeline { fileOpened(f); fileEdited(f); reclassifyNow(f); dispose() }
// fileOpened: split, store hits paint, misses → one batch (charBudget 16000, block-boundary
// chunking), retry once, then heuristic for the still-missing; superseded batches abort.
// fileEdited: 1.5 s debounce, re-split, enqueue only misses. reclassifyNow: delete + enqueue all.

// reading-view.ts — getSectionInfo → splitBlocks → ordinal li alignment → classes; embeds skipped
// live-preview.ts — CM6 ViewPlugin → BlockIndex → Decoration.line; docChanged → pipeline.fileEdited
// settings.ts, main.ts — config + composition root
```

## Synthesis decision

Base is candidate A's lifecycle (open/debounce/manual triggers, heuristic-first, batch per note) because reading is top-to-bottom and one batch call per note-open-with-misses is the whole cost story at 45-block scale. Three grafts from candidate B changed it. (1) Identity: B's hash-the-normalized-source with both surfaces deriving blocks through the same splitter provably matches across surfaces; A's strip-all-punctuation DOM fingerprint has a known silent failure class (link destinations stay in source, vanish in DOM) and was rejected on exactly that. (2) Store: B's global content-addressed hash map dominates A's path-keyed annotation on hit rate, invalidation, and edit races (a stale result writes a hash no live block reads). (3) Failure honesty: B's retry-once-then-heuristic per batch with a visible `sr-heur` marker ships the degraded state in the decoration itself. B's viewport scheduler (IntersectionObserver, priority promotion, batch sealing) is deferred, not rejected: it buys marginal latency on notes an order of magnitude longer than the target corpus and would add three modules of accidental complexity now.

## Palette probe evidence (browser harness, sample note, 2026-10-13)

- Text contrast on tinted blocks: 13.4–14.0:1 light, 9.0–10.3:1 dark. WCAG AA floor is 4.5:1.
- Role-pair separation, OKLab ΔE over border colors: cool preset min 0.251 (no close pairs); warm preset caveat–claim 0.065, perceptually identical, so warm ships with caveat moved to the gold domain and a unit test pins min ΔE ≥ 0.1 for every preset.
- Coverage: 36 of 55 blocks decorated by the heuristic fallback (evidence 22, claim 8, caveat 6); question/definition recall is low without the API pass, accepted for the offline engine.
- Default: cool preset, border+tint grammar, normal intensity; all switchable (`data-sr-preset`, `data-sr-grammar`, `data-sr-intensity` on body).

## Tradeoffs accepted

- One API batch per note-open-with-misses and per settled edit session, in exchange for no scheduler state machine.
- Same block text in two notes gets one role (content addressing), in exchange for free invalidation and cross-note hits.
- Heuristic records persist after API recovery until manual reclassify, visibly marked `sr-heur`.
- Whole-table granularity; one edited cell uncolors the table until the next pass.
- `keyterm` cut from v1; roles are block-level only.
- Embeds (`getSectionInfo` null) never classified.

## Next implementation step

`blocks.ts` + `roles.ts` + `heuristic.ts` with unit tests against `docs/sample-note.md`, since every other module consumes `BlockRef`.

## v2 addendum: inline spans replace block tints (2026-10-13)

User verdict on v1: a few large color blocks do not aid reading; the ask is sentence-, keyword-, and concept-level highlighting after real semantic understanding. Redesign as if spans had been the day-one requirement.

- Annotation payload is now `{ quote, role }[]` per block, roles `kp | term | concept`. Anchoring is quote-plus-significant-character matching (NFKC, casefold, whitespace and `*_~[]()#>|` stripped) applied identically to source text, DOM text, and CM6 lines. Source-offset anchoring was rejected again: positions break on any edit above them.
- Reading view wraps located ranges in `mark.sr-*` by walking text nodes and splitting boundaries; live preview maps the same located ranges to `Decoration.mark`. Overlaps are trimmed by priority (kp > term > concept) at anchor time.
- Block-tint mode, the five block roles, palette presets, intensity, and grammar settings were deleted rather than kept behind a flag. The cache format moved to version 2; version-1 caches are ignored so notes re-annotate once.
- The offline heuristic now extracts bold runs as kp and quoted runs as terms, which fits how these notes already encode emphasis.

Verification additions: spans anchoring unit tests; mock-server e2e asserting span parsing; browser harness rendering the sample note with real GLM annotations (65/65 spans rendered, 23 inside list items, zero nested or empty marks, 44/44 sections paired).

## v3 addendum: theme-aware presentation (2026-10-13)

- Keypoint switched from a flat wash to a marker-pen gradient (soft left/right edges, rounded, box-decoration-break per line), with a subtle saturate-on-hover feedback. Concept gained a second style: tinted pill (`data-sr-style="pill"`), selectable in settings.
- Every mark carries `data-sr-label` (set by the DOM wrapper and by CM6 mark attributes) and shows a CSS-only role chip on hover. No status bar, no JS on hover.
- Theme integration is luminance-based rather than class-based: `theme.ts` measures the body background, sets `data-sr-bg=light|dark` (threshold 0.25), and re-measures on a debounced MutationObserver, so community themes that are dark-ish lights or custom backgrounds adapt correctly. Dark backgrounds also shift role hues brighter (`--sr-kp` #e8a33d etc.) and raise underline opacity.
- Measured on four simulated backgrounds (white, near-black, Nord slate, sepia): wash-background delta 0.03-0.20 luminance (visible), text-on-wash contrast 6.3-12.8:1 (all above WCAG AA; light themes above 7:1).
