# Semantic Reading plugin, design brief

## Product goal

An Obsidian plugin that colors long notes by semantic role at render time, so a reader can tell conclusions from evidence, caveats, and questions at a glance. The note file never changes. The palette must stay comfortable for hour-long reading, in both light and dark themes.

Users: the vault owner reads dense Chinese and English technical notes, typically 100 to 300 lines, structured as conclusions, arguments, evidence with sources, boundary conditions, and open questions. Other users get the plugin from community channels, supply their own OpenAI-compatible API key, and expect it to work without touching their notes.

## Grounded subsystem model

Traced from `keyword-highlighter` v1.3.2 installed in the target vault (`/mnt/e/01Markdown/.obsidian/plugins/keyword-highlighter/main.js`):

- Reading view: `registerMarkdownPostProcessor(cb)` calls `cb(el, ctx)` once per rendered block. `el` is an `HTMLElement` such as `p`, `ul`, or `table`. Adding a class or `data-` attribute decorates without touching source.
- Live preview (editing view): `registerEditorExtension(ViewPlugin)` builds a CodeMirror 6 `Decoration` set. Decorations are ephemeral view state, never document edits. `keyword-highlighter` uses `Decoration.mark` for inline spans; block-level work would use `Decoration.line` or widget decoration on whole lines.
- Settings persist via `Plugin.loadData/saveData` into the plugin folder's `data.json`.
- Plugin id, name, version, and `minAppVersion` live in `manifest.json` beside `main.js` and `styles.css`.

## Hard constraints

1. Never write note content. No `vault.modify` on notes. Classification results live only in plugin data.
2. Classification calls a user-configured OpenAI-compatible chat completions endpoint (`baseUrl`, `apiKey`, `model`). An offline heuristic classifier (regex and cue words, Chinese and English) must exist as fallback and for tests.
3. Re-render must never re-call the API for unchanged content. Classification is cached per note, keyed by a content hash, with bounded storage.
4. Both reading view and live preview get decorated. Same roles, same CSS.
5. Publishable quality: settings tab, manifest, styles.css, README, no `any`, no casts, boundary-parsed external JSON.

## Semantic roles

From the sample note (`docs/sample-note.md`, a real vault note):

- `claim`: conclusions, judgments, the sentences the note exists to say. Often after `## 结论` or bolded.
- `evidence`: experiment results, source citations, numbers with provenance.
- `caveat`: boundary conditions, failure modes, "this gets overturned if".
- `question`: open questions, things the author plans to verify.
- `definition`: term definitions and mental models.
- `keyterm`: inline spans for recurring technical terms. Optional, off by default if noisy.

## Design decisions a candidate must settle

1. Data shape of the annotation store (the named model everything else derives from).
2. Granularity: block-level roles, sentence-level, or both. Cost and noise tradeoff.
3. Pipeline shape: when classification runs (file open, debounce on edit, manual command), how results reach both render paths, how invalidation works on edit.
4. Failure modes: API down, oversized notes, mid-edit reclassification, cache eviction.
5. Module map and public surface. Smaller interface wins.

## Verification surfaces

- Unit tests in Node for the pure core: segmentation, normalization, heuristic classifier, cache logic, API JSON parsing.
- A browser harness that renders the sample note through the real styles for palette decisions.
- Final smoke on the real vault deployment (files land in `.obsidian/plugins/semantic-reading/`).

No Linux Obsidian exists in this environment. The browser harness is the visual surface; the Obsidian wiring is verified by manifest checks, the type-checked build, and the user reloading Obsidian.
