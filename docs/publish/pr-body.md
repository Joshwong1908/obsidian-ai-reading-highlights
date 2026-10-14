# Semantic Reading

## General information

- **Plugin ID:** semantic-reading
- **Plugin name:** Semantic Reading
- **Link to plugin repo:** https://github.com/Joshwong1908/obsidian-semantic-reading
- **Author:** Joshwong1908
- **Supports mobile:** yes

## Requirements checklist

- [x] I have read the developer policies and submission guidelines: https://docs.obsidian.md/Developer+policies
- [x] The plugin is open source and the repository is public.
- [x] The repo includes a README describing the plugin, with the description matching manifest.json.
- [x] The manifest.json `id` (semantic-reading) is unique in community-plugins.json and matches the PR entry.
- [x] The manifest version matches the latest GitHub release tag (1.0.0), and the release attaches main.js, manifest.json, and styles.css built from that tag.
- [x] `minAppVersion` is 1.5.0; functionality degrades gracefully with rgba fallbacks for older rendering engines.
- [x] No obfuscated code, no remote code loading, no eval. All network calls (user-configured OpenAI-compatible endpoint) are opt-in, user-facing, and never run at plugin load without configuration.
- [x] The plugin does not modify note content. All writes are confined to the plugin's own data.json and cache.json inside `.obsidian/plugins/semantic-reading/`.
- [x] No Obsidian trademarks in the name; "Semantic Reading" is descriptive of function.

## What the plugin does

Annotates notes with inline highlights (key sentences, key terms, named concepts) using a user-configured OpenAI-compatible LLM endpoint. Includes an offline heuristic (bold/quoted spans). Highlights render in reading view and live preview via quote-anchored spans; hallucinated quotes that cannot be anchored are dropped. Content-addressed cache avoids re-classifying unchanged blocks.

## About the code

- TypeScript, esbuild, 48 unit/e2e tests (anchoring, parsing, store, pipeline lifecycle, palette contrast, mock-server e2e).
- Verified end-to-end in a real Obsidian 1.14.4 instance (reading view and live preview, computed styles and pixel checks).
