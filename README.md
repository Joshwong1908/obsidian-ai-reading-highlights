# Semantic Reading

Highlights what matters inside your notes: the model reads each block, then marks key sentences, key terms, and named concepts directly in the rendered text. Note files are never modified; everything lives in the render.

Built for dense Chinese and English technical notes where the value is in scanning what the author concluded, what evidence supports it, and which concepts carry the argument.

## Highlights and styling

| Highlight | Meaning | Styling |
|---|---|---|
| Keypoint | The sentence that carries a block's point | Warm sentence wash, 16% alpha |
| Term | Domain keywords worth remembering | Solid indigo underline |
| Concept | Named models, methods, laws | Dotted teal underline |

Each highlight category can be toggled in settings. The keypoint wash keeps text contrast far above WCAG AA; underline colors are perceptually distinct by test (OKLab ΔE ≥ 0.1).

Two engines produce the highlights:

- **API engine.** Any OpenAI-compatible endpoint. The model copies verbatim quotes from each block and tags them; quotes that cannot be anchored back into the text are dropped, hallucinated highlights cannot render.
- **Offline heuristic.** Bold spans become keypoints, quoted phrases become terms. No API, no waiting, always on.

Both reading view and live preview get the same inline marks (DOM `mark` elements and CM6 mark decorations respectively). Source text and the file on disk stay untouched.

## Install

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/semantic-reading/`, then enable **Semantic Reading** in Settings → Community plugins.

For Zhipu GLM Coding Plan keys: base URL `https://open.bigmodel.cn/api/coding/paas/v4` (the standard `/api/paas/v4` endpoint rejects plan keys), model `glm-5.3-flash`, and leave "Disable model thinking" on, which cuts annotation latency from minutes to seconds.

## Configure

1. Settings → Semantic Reading → Classification API.
2. Fill base URL, API key, model. Click **Test connection**.
3. Open a note. Heuristic highlights appear immediately; API highlights refine within seconds.

Privacy: annotation sends block text to the endpoint you configured. Nothing else is sent, and nothing is written back into your notes.

## How it behaves

- Annotations are stored per block, keyed by a hash of the block's normalized source text (`cache.json`, 5000-block LRU). Unchanged blocks are never re-annotated; edits re-annotate only what changed.
- Quotes are anchored by significant-character matching (NFKC, case-folded, whitespace and markdown noise stripped), so a highlight survives bold markers, link syntax, and re-wrapping.
- Editing retriggers annotation after a 1.5s debounce. A failed API call keeps heuristic highlights and backs off 60s.
- The command **Reclassify current note now** re-runs the API pass on demand.
- Notes larger than 16,000 characters are annotated in block-boundary chunks.

## Development

```
bun install
bun test                                  # 45 tests: anchoring, parse, store, pipeline, mock-server e2e, palette
npm run build                             # esbuild bundle to main.js
npm run build -- --production
bun scripts/fetch-gl-spans.ts             # real GLM annotations for docs/sample-note.md into /tmp
```

Design rationale (v1 block roles and the v2 inline-span redesign) lives in `docs/design.md`.
