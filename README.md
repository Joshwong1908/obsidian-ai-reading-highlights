# Semantic Reading

Colors notes by semantic role at render time, so a long note can be scanned for its conclusions, evidence, caveats, questions, and definitions before it is read line by line. Note files are never modified. Colors live only in the render.

Built for dense Chinese and English technical notes where the interesting structure (what the author concluded, what it rests on, where it breaks) is implicit in the prose.

## Roles and colors

| Role | Meaning | Default color (Scholarly preset) |
|---|---|---|
| Claim | The conclusion or judgment the note argues for | Indigo |
| Evidence | Sourced findings, experiments, numbers with provenance | Teal |
| Caveat | Boundary conditions, limitations, failure modes | Amber |
| Question | Open questions, things to verify | Sky |
| Definition | Term definitions and mental models | Rose |

Each role gets a 3px left border plus a 13% background tint. The tint keeps text contrast at 13.4:1 on light and 9.0:1 on dark themes; WCAG AA requires 4.5:1. Role-pair separation is at least 0.1 OKLab ΔE in both presets, guarded by `tests/palette.test.ts`.

Two presets ship: Scholarly (cool, default) and Warm paper. Marker style (border + tint, tint only, border only) and intensity (normal, subtle) are switchable in settings. Colors are block-level only: whole paragraphs, list items, and tables.

## Install

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/semantic-reading/`, then enable **Semantic Reading** in Settings → Community plugins. Reload Obsidian.

## Configure

1. Settings → Semantic Reading → Classification API.
2. Fill in an OpenAI-compatible base URL (for example `https://api.openai.com/v1`, `https://api.deepseek.com/v1`, or a local Ollama endpoint), your API key, and a model name.
3. Click **Test connection**.

Without an API the plugin still works: a built-in heuristic classifier (Chinese and English cue words, section context) colors what it can recognize. Heuristic-colored blocks carry a dashed left border, so you can see which colors are provisional. The command **Reclassify current note now** re-runs the API classifier on demand and upgrades provisional colors.

Privacy: classifying a note sends its block text to the endpoint you configured. Nothing else is sent, and nothing is written back into your notes.

## How it behaves

- Opening a note colors it instantly from the heuristic pass and the cache; an API pass refines it seconds later if needed.
- Classifications are stored per block, keyed by a hash of the block's normalized source text, in the plugin's own `cache.json` (capped at 5000 blocks). Unchanged content is never re-classified, identical blocks are shared across notes, and edits only re-classify what changed.
- Editing a note retriggers classification after a 1.5s debounce. A failed API call keeps the heuristic colors and backs off for 60s.
- Notes larger than 16,000 characters are classified in block-boundary chunks.
- Both reading view and live preview are decorated; source mode and the file on disk stay untouched.

## Development

```
bun install
bun test          # unit + mock-server e2e + palette regression
npm run build     # esbuild bundle to main.js
npm run build -- --production
```

Design rationale, the two architecture candidates considered, and the palette measurements live in `docs/design.md`.
