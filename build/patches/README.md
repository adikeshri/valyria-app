# Patches applied to `vscode/`

Applied in filename order by `scripts/bootstrap.sh`, from a clean checkout of the
tag in `build/VSCODE_REF`.

**Keep this directory as close to empty as possible.** Anything the Valyria
agent needs should be reachable through the VS Code extension API from
`extension/`. A patch here is upgrade debt paid on every Code‑OSS bump.

Naming: `NNN-kebab-summary.patch`.

## Current patches

| File | Target | Why it can't live in `extension/` or the overlay |
|---|---|---|
| `010-valyria-default-theme.patch` | `src/vs/workbench/services/themes/common/workbenchThemeService.ts` — the `ThemeSettingDefaults` namespace | The default `workbench.colorTheme` (+ the four `preferred*` keys) is a hard‑coded constant. `product.json` exposes no key for it, and an extension `configurationDefaults` is stripped along with the agent extension when a workspace is untrusted. Points them at the `Valyria …` ids contributed by the code‑free `theme/` built‑in. |
| `011-theme-default-hardening.patch` | `src/vs/workbench/services/themes/browser/workbenchThemeService.ts` | (1) cold‑start pre‑paint colour map → Valyria surfaces (stock is Microsoft grey/blue, drawn before the theme JSON loads); (2) the "current theme was removed" fallback passed `'auto'`, which **persists** `workbench.colorTheme` into `settings.json` and then wins permanently — changed to a non‑persisting fallback; (3) the "VS Code has a new default theme" notification string → branded copy. |
| `020-debrand-electron-build.patch` | `build/lib/electron.ts` — the `config` object | `companyName`, `copyright`, `darwinHelpBookFolder/Name` are string literals compiled into the packaged app's `Info.plist` / Windows PE resources. |
| `031-activitybar-top-bigger-centred.patch` | `src/vs/workbench/browser/parts/media/paneCompositePart.css` — appended rules | With `workbench.activityBar.location: top` (a `valyria-chrome` default) the view‑container switcher renders as a horizontal composite bar in the side bar's `.header-or-footer`. Its icon size (~16px) and left alignment are hard‑coded — no setting. Appended CSS bumps the icons to 20px and centres the row. Append‑only, so it is the lowest‑conflict kind of patch. |

The bundled GitHub Copilot chat is **not** patched out — it is removed without a
patch: `scripts/bootstrap.sh` deletes `vscode/extensions/copilot`, strips the
`compile-copilot` / `watch-copilot` build legs (`scripts/strip-copilot-refs.mjs`),
and the `valyria-chrome` built‑in sets `"chat.disableAIFeatures": true` in its
`configurationDefaults`, which forces the core chat entitlement `hidden` state and
suppresses the chat view, its setup agents, the title‑bar Sign In, and inline
suggestions. See `docs/UX-DIFFERENTIATION.md` "De‑Microsoft".

On every `VSCODE_REF` bump: re‑check line numbers (the theme service churns) and
the `ThemeSettingDefaults` string values (`Dark 2026` was `Dark Modern` one
release earlier — if upstream renames again, `010` must follow).
See `docs/ARCHITECTURE-VSCODE.md §5`.
