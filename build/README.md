# `build/` — the Code‑OSS overlay

`vscode/` is an unmodified upstream submodule. Everything that makes it *Valyria*
lives here and is applied by [`scripts/bootstrap.sh`](../scripts/bootstrap.sh).

| File | Role |
|---|---|
| `VSCODE_REF` | The pinned upstream tag. `bootstrap.sh` checks the submodule out to this. Bump = the whole upgrade. |
| `product.overlay.json` | Deep‑merged over `vscode/product.json`. Branding, gallery, telemetry‑off, update feed. Keep minimal. |
| `patches/*.patch` | Unified diffs applied to `vscode/` with `git apply` after checkout. Ordered by filename. Aim for **zero**; currently 3 (see below). |
| `icons/` | Source artwork — `valyria.icns` (complete Retina set), `valyria.ico`, `valyria-512.png`. `scripts/gen-icons.py` expands these into `vscode/resources/` during bootstrap. |

## Adding a patch

Only when something genuinely cannot be done from the extension API:

```bash
cd vscode
# make your edit
git diff > ../build/patches/NN-short-description.patch
git checkout .            # leave the submodule clean
```

`bootstrap.sh` re‑applies all patches from a clean checkout every run, so the
submodule working tree is disposable. Because the patches touch `src/`,
`bootstrap.sh` no longer preserves `vscode/out*` — `preLaunch.ts` recompiles the
workbench on the next `dev.sh`.

### Current patches

| Patch | What / why |
|---|---|
| `010-valyria-default-theme.patch` | `ThemeSettingDefaults` → `Valyria Dark/Light/High Contrast[ Light]`. The default `workbench.colorTheme` is a hard‑coded constant; no `product.json` key sets it, and an extension `configurationDefaults` vanishes when the agent extension is disabled in an untrusted workspace. |
| `011-theme-default-hardening.patch` | Valyria cold‑start pre‑paint colours (stock is MS grey/blue); stop the "theme removed" fallback writing `workbench.colorTheme` into `settings.json`; branded default‑theme notification string. |
| `020-debrand-electron-build.patch` | `build/lib/electron.ts`: `companyName` / `copyright` / `darwinHelpBook*` — string literals baked into the packaged Info.plist / PE resources. |

`docs/ARCHITECTURE-VSCODE.md §5` has the per‑bump re‑check notes.

## Upgrading Code‑OSS

1. `echo <new-tag> > build/VSCODE_REF`
2. `scripts/bootstrap.sh` — it will report any patch that no longer applies
3. Refresh broken patches against the new tree, re‑run
4. `(cd vscode && npm ci && npm run compile)` — a REF bump invalidates deps.
   `bootstrap.sh` keeps `node_modules` and `.build` (minus `.build/electron`,
   which it always wipes) but not `out*` — the patches touch `src/`, so the
   workbench is recompiled by `preLaunch.ts` on the next `dev.sh`
5. `scripts/build.sh` and smoke‑test

## Offline guarantee

`scripts/verify-offline.sh` is the local canary for PLAN.md §32: it asserts the
overlay cleared every telemetry / survey / marketplace endpoint in
`vscode/product.json` and that the gallery points at Open VSX. The authoritative
enforcement is the CI offline job (Phase 9), which runs the integration suite
with the network disabled.

## Icons

`build/icons/` holds the real Valyria artwork (recovered from the original
desktop app): `valyria.icns` — a full Retina set including the 1024px variant —
plus `valyria.ico` and the square `valyria-512.png`. `valyria.svg` is the
canonical vector mark (kept for reference / future re‑exports); the running app
does not read it — the activity‑bar icon is `extension/media/valyria-activity.svg`
and the in‑app brand lockup is inline SVG in `extension/src/webviews/shared/render.ts`.

`scripts/gen-icons.py` (run by `bootstrap.sh`) writes the whole platform set into
`vscode/resources/`:

- `darwin/code.icns` — `valyria.icns` verbatim
- `win32/code.ico` (16–256), `win32/code_{70x70,150x150}.png` tiles
- `linux/code.png` (1024), `linux/rpm/code.xpm`
- all 28 `darwin/<lang>.icns` + 27 `win32/<lang>.ico` document icons, with the
  blue VS Code corner badge painted over with a Valyria "V" badge (page shape and
  language glyph kept)

It needs **Pillow**; `.icns` output also needs macOS **`iconutil`** (absent →
loud warning, PNG/ICO/XPM still written, `code.icns` still copied). No SVG
rasteriser is involved — `rsvg-convert` is *not* a dependency. `bootstrap.sh`
runs it with no `|| true`, then deletes `vscode/.build/electron` so `preLaunch.ts`
re‑brands the Electron app bundle (its icon/`Info.plist` are only rewritten when
that directory is regenerated). On macOS the Dock caches per bundle path — a
`killall Dock` may be needed to see the new icon on an existing checkout.
