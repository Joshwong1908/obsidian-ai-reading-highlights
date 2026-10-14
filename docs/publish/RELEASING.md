# Releasing Semantic Reading

The Obsidian Community directory accepts plugins through community.obsidian.md, not through pull requests to obsidian-releases. This file records the current official flow so the next release repeats it exactly. Sources: the developer docs pages for developer policies, submission requirements, plugin guidelines, and "Submit your plugin", fetched 2026-10-14 into /tmp/obs-docs during release preparation.

## One-time setup

1. A GitHub account with the plugin repository public.
2. An Obsidian account at obsidian.md, with the GitHub account linked from the community.obsidian.md profile.

## Per release

1. Update `manifest.json` version to the new semver (x.y.z only).
2. Update `versions.json` with the new version mapped to its minimum app version.
3. Build production assets: `npm run build -- --production`.
4. Run `bun test`; all tests must pass.
5. Commit and push to the default branch. The directory reads `manifest.json` from the branch HEAD.
6. Create a GitHub release whose tag equals the manifest version, and attach `main.js`, `manifest.json`, and `styles.css` as release assets. Obsidian installs from these assets, never from the branch.
7. In community.obsidian.md, open the plugin entry, update the description if needed, and publish. The automated review must report no errors before the version becomes installable.

## First announcement

After publication, announce in the forum's Share & showcase category and in the #updates channel on Discord (requires the developer role).

## Policy obligations that apply to this plugin

- Network use disclosure in the README, because classification calls a user-configured OpenAI-compatible endpoint. Keep the disclosure section when editing the README.
- LICENSE file at the repository root, MIT.
- No client-side telemetry, no self-update, no obfuscation. The plugin must keep writing only to its own data.json and cache.json.

## House rules this repo follows (from the plugin guidelines)

- Settings headings via `Setting.setHeading()`, never h1/h3 elements.
- Sentence case in every UI string.
- Event listeners through `registerEvent`, unsubscribes in `onunload`.
- No innerHTML from variable content, no default hotkeys, no global `app`, no regex lookbehind (mobile).
