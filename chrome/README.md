# valyria-chrome

Valyria's **workbench identity** as a code-free built-in extension: the product
icon font, a file icon theme, and the chrome `configurationDefaults` that make
the editor read as Valyria and not as a Code-OSS fork
(`docs/UX-DIFFERENTIATION.md`, levers A + B).

**File-type icons stay stock.** The file icon theme (`valyria-files`) is a copy
of the built-in **Seti** theme (`vendor/seti/`, MIT) with only the **folder**
icons replaced by Valyria's rust folders — Dockerfile, Python, `.env`, etc. look
exactly as they do in VS Code.

## Why a separate, code-free extension

Same reasoning as [`theme/`](../theme/README.md). A contribution on the agent
extension (`extension/`) disappears the moment you open an untrusted folder — it
declares `capabilities.untrustedWorkspaces.supported: false`, so Code-OSS
disables it whole in restricted mode and its `contributes` go with it.

An extension with **no `main`** is never disabled by workspace trust
(`extensionManifestPropertiesService`: `!manifest.main` ⇒ untrusted-supported).
So the icons and the chrome defaults live here, on their own, and hold across
trusted and untrusted workspaces alike.

## What it contributes

| Contribution | Effect |
|---|---|
| `productIconThemes` → `valyria` | Replaces the workbench codicon set with a solid geometric Valyria family (tree twisties, window/tab chrome, action + status glyphs, view icons). Undefined icons fall back to the stock codicon. |
| `iconThemes` → `valyria-files` | Stock Seti file-type icons + Valyria rust folder icons. Built from `vendor/seti/` (MIT) — only `folder` / `folderExpanded` / `rootFolder*` are Valyria's. |
| `configurationDefaults` | Chrome defaults (user-overridable, never locked): no command center, compact menu bar, no layout-control button, `startupEditor: none` (the extension opens **Valyria Home** instead), tighter tree indent, `workbench.productIconTheme: valyria`, `workbench.iconTheme: valyria-files`. |

Mode-specific layout (activity-bar location, tab style) is **not** here — it
differs per layout mode and is applied at runtime by
`extension/src/session/layout.ts`.

## Regenerating the icon assets

`dist/` is generated and committed, so CI and `bootstrap.sh` never need font
tooling. To change the icons, edit the glyph library in
[`tools/build_icons.py`](tools/build_icons.py) and:

```bash
python3 chrome/tools/build_icons.py     # needs: pip install fonttools
```

This rewrites `dist/valyria-icons.woff` + `dist/valyria-product-icons.json`, and
merges `vendor/seti/vs-seti-icon-theme.json` with the Valyria folder SVGs into
`dist/valyria-file-icons.json` (+ copies `dist/seti.woff`).
`scripts/check-chrome-icons.mjs` validates the output — product codepoints
unique + well-formed, the Seti merge intact, the folder icons wired — and runs
in CI.

To refresh the vendored Seti icons (rare — cosmetic, changes seldom), re-copy
`vscode/extensions/theme-seti/icons/{vs-seti-icon-theme.json,seti.woff}` and
`ThirdPartyNotices.txt` into `vendor/seti/`, then rebuild.

The product glyphs are built from primitives (rect / polygon / disc / ring) in
font units — no hand-authored SVG — so the family stays consistent. Everything
is polygons (discs are 32-gons), so the TrueType outlines are quadratic-free and
knockouts just wind opposite to their container.

## Bundling

`scripts/bootstrap.sh` symlinks this directory to
`vscode/extensions/valyria-chrome`; the gulp build compiles every directory
under `extensions/`.
