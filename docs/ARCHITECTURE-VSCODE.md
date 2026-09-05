# Valyria App — architecture (Code‑OSS fork)

> **Supersedes the viewer‑client premise of [PLAN.md](PLAN.md).** valyria‑app is
> no longer a bespoke Tauri window onto Core. It is a **branded distribution of
> Code‑OSS** (the MIT‑licensed core of VS Code) with the Valyria autonomous
> agent shipped as a **bundled built‑in extension**. PLAN.md, CORE‑INTERFACE.md
> and INTEGRATION.md remain accurate about *Core* and *the protocol*; they no
> longer describe the app shell.

## 1. Why this shape

The product goal is "a full code editor, every feature, plus the Valyria agent."
Building the editor is 15 years of work; Code‑OSS already is that editor and is
MIT‑licensed. The remaining work is:

1. **Rebrand** Code‑OSS to Valyria (name, icons, `product.json`, Open VSX
   gallery, no Microsoft telemetry).
2. **Bundle** the Valyria agent UI as a built‑in extension.
3. **Package & sign** our own installers for macOS / Windows / Linux.

Cursor and Windsurf are the same shape (VS Code fork + first‑party AI
extension code). GitHub Copilot is the lighter variant (extension only).

## 2. Repository topology

```text
valyria-app/
  vscode/                    git submodule → github.com/microsoft/vscode, pinned (build/VSCODE_REF)
                             Code‑OSS. We never edit files here directly; changes
                             are patches in build/patches/ applied at bootstrap.

  build/
    VSCODE_REF               the pinned upstream tag (e.g. 1.135.0)
    product.overlay.json     our product.json fields, merged over vscode/product.json
    patches/                 *.patch applied to vscode/ after checkout (3, all theme/branding)
    icons/                   source artwork: valyria.icns / .ico / -512.png (real, from the
                             original app); scripts/gen-icons.py expands it into vscode/resources/
    README.md                how the overlay + patch + icon flow works

  theme/                     the Valyria colour themes — a code‑free built‑in extension
    package.json             contributes.themes (Dark/Light/HC/HC‑Light) + configurationDefaults
    themes/*.json            NO `main`: never disabled by workspace trust, so the
                             default theme survives opening an untrusted repo

  chrome/                    the Valyria workbench identity — a code‑free built‑in
    package.json             contributes.productIconThemes + iconThemes + the chrome
                             configurationDefaults (no command center, compact menu,
                             startupEditor:none, …). NO `main`, same trust reasoning.
    vendor/seti/             stock Seti file icon theme + font (MIT), vendored
    tools/build_icons.py     builds dist/ — product‑icon WOFF from a primitive glyph
                             library; file icon theme = vendored Seti + Valyria folders
    dist/                    generated + committed; scripts/check-chrome-icons.mjs gates it
                             See docs/UX-DIFFERENTIATION.md.

  extension/                 the Valyria agent built‑in extension (TypeScript)
    package.json             name: "valyria", publisher: "valyria", contributes: …
    src/
      extension.ts           activate(): spawn bridge‑host, register everything
      bridge/
        host.ts              child‑process lifecycle for valyria-bridge-host
        client.ts            JSON‑RPC 2.0 over stdio: request(), on(notification)
        protocol.ts          generated + hand types for Core wire shapes
      session/               supervisor UI: connect state, workspace open, restart
      views/                 webview + tree providers, one dir per surface
        chat/  task/  activity/  approvals/  verification/  diff-ownership/  …
      commands.ts            command palette + menu contributions → bridge calls
      status.ts              status‑bar: model · Local·Offline · connection state
    media/                   webview assets (bundled React apps, one per view)

  crates/
    valyria-bridge/          UNCHANGED. Socket client, supervisor, event pump, PTY,
                             local‑read surfaces. Still the ONLY code that speaks
                             the Core protocol (PLAN.md D2, layering check kept).
    valyria-bridge-host/     NEW. Thin bin: JSON‑RPC 2.0 over stdio ⇄ valyria-bridge.
                             This is exactly the role src-tauri/bridge_host.rs played,
                             minus Tauri. Emits the Core event stream + PTY output as
                             JSON‑RPC notifications.
    xtask/                   codegen, layering check, release gates (kept, extended)

  packages/
    protocol/                generated TS types + zod decoders + trace fixtures (kept)
    state/                   pure event reducer + selectors (kept — reused inside the
                             extension's webviews instead of a Tauri renderer)

  apps/desktop/              RETIRED after parity. Tauri shell (src-tauri) + React
                             renderer (src). Kept building until the extension covers
                             every surface, then deleted in one PR.

  scripts/
    bootstrap.sh             init submodule → checkout VSCODE_REF → apply patches →
                             merge product overlay → link extension into vscode/extensions
    build.sh                 gulp build of the branded app + bundle bridge-host sidecar
    dev.sh                   watch extension + run ./vscode/scripts/code.sh
```

### The submodule is not edited in place

`vscode/` is upstream, read‑only to us. Every change to Code‑OSS is a file in
`build/patches/` (unified diff, applied with `git apply` in `vscode/` during
bootstrap) or a field in `build/product.overlay.json`. This keeps upstream
bumps to: change `build/VSCODE_REF`, re‑run `bootstrap.sh`, fix any patch that
no longer applies. Aim for **zero or near‑zero patches** — everything the agent
needs should be reachable through the extension API.

**Current patches** (`build/patches/`, applied in filename order):

| Patch | Target | Why it can't be an overlay / extension |
|---|---|---|
| `010-valyria-default-theme.patch` | `src/…/themes/common/workbenchThemeService.ts` — `ThemeSettingDefaults` | The default `workbench.colorTheme` (and the four `preferred*` keys, incl. the `APPLICATION`‑scoped HC path) is a hard‑coded constant. `product.json` has no key for it; an extension `configurationDefaults` is dropped when the agent extension is disabled in an untrusted workspace. |
| `011-theme-default-hardening.patch` | `src/…/themes/browser/workbenchThemeService.ts` | Cold‑start pre‑paint colour map (stock is MS grey/blue); stop the `event.removed` fallback persisting `workbench.colorTheme` to `settings.json`; branded default‑theme notification copy. |
| `020-debrand-electron-build.patch` | `build/lib/electron.ts` `config` | `companyName` / `copyright` / `darwinHelpBook*` are string literals baked into the packaged app's Info.plist / PE resources. |
| `031-activitybar-top-bigger-centred.patch` | `src/…/parts/media/paneCompositePart.css` — appended rules | `workbench.activityBar.location: top`'s composite bar has a hard‑coded ~16px, left‑hugging icon row — no setting. Appended CSS grows and centres it. |
| `032-valyria-letterpress-watermark.patch` | `src/…/parts/editor/media/letterpress-{dark,light,hcDark,hcLight}.svg` | The empty‑editor‑group watermark is a CSS `background-image`, unreachable from the extension or a theme. Stock's sidebar‑and‑lines glyph → a vector trace of the dragon head from `docs/assets/logo.png`, same fill/opacity structure as the originals. |

On a `VSCODE_REF` bump, re‑check each: the theme‑service line numbers move often;
`ThemeSettingDefaults` string values change most releases (`Dark 2026` was
`Dark Modern` a version earlier). The Valyria default theme also relies on the
code‑free `theme/` built‑in staying enabled in restricted mode
(`extensionManifestPropertiesService`: an extension with no `main` is always
untrusted‑supported) — verify that contract survives the bump.

## 3. Process model

```text
┌─ Valyria (Electron, branded Code‑OSS) ─────────────────────────┐
│  renderer  ── workbench + editor (upstream, unmodified)        │
│  ext host  ── Node.js                                          │
│     └─ extension "valyria"                                     │
│           child_process: valyria-bridge-host  ◄── stdio JSON‑RPC
│                              │                                 │
└──────────────────────────────┼─────────────────────────────────┘
                               │ Unix socket, NDJSON (unchanged)
                    ┌──────────▼───────────┐
                    │ valyria serve (Core) │  one daemon per workspace,
                    │  agent loop, tools,  │  outlives the UI (PLAN.md D1)
                    │  index, verify       │
                    └──────────────────────┘
```

- The **extension** owns no socket. It spawns `valyria-bridge-host` and speaks
  JSON‑RPC to it, the same contract the Tauri renderer had (`session_*`,
  `task_*`, `pty_*`, …) plus notifications (`core/eventBatch`,
  `core/reconnected`, `core/closed`, `core/fsChanged`, `core/ptyOutput`,
  `core/ptyExit`).
- `valyria-bridge-host` is shipped as an Electron **resource** (a platform
  binary under the app's resources dir), located by the extension via
  `context.extensionPath` → `../../bin/` or an absolute resources path.
- One `valyria-bridge-host` per window (per workspace). It supervises one
  `valyria serve` daemon. D1/D3/D4/D5/D7/D8 from PLAN.md all still hold — they
  were always about the bridge, not the shell.

## 4. What each existing piece becomes

| Today (Tauri) | Now (Code‑OSS fork) |
|---|---|
| `src-tauri/bridge_host.rs` — `#[tauri::command]` wrappers + `app.emit` | `crates/valyria-bridge-host` — JSON‑RPC methods + stdout notifications |
| `apps/desktop/src/panels/Live*.tsx` | `extension/src/views/*` webviews (same React, `@valyria/state` reducer reused) |
| `apps/desktop/src/components/CommandPalette.tsx` | native command palette + `contributes.commands` |
| `apps/desktop/src/panels/FileTreePanel` etc. | **deleted** — the editor's own explorer/search/diff/git/terminal |
| Tauri updater / bundler | Code‑OSS gulp bundler + our signing in `scripts/build.sh` |
| `core.lock.json` | unchanged — still pins Core + protocol + capabilities |

The agent‑specific surfaces that Code‑OSS has no equivalent for and that the
extension must provide:

- **Agent Chat** — task entry + the task's event stream as a conversation
- **Task panel** — objective, plan, checkpoints, modified files, verification
- **Agent Activity / Timeline** — running narrative + raw event inspector
- **Approvals** — risk‑treated, supersession‑aware (CORE‑INTERFACE G2)
- **Verification Inspector** — `task_report` `verified[]` / `unverified[]` (D8)
- **Change ownership** — agent / user / pre‑existing gutter decorations (G8),
  layered on the editor's own diff via the `FileDecoration` + editor‑decoration APIs
- **Agent command view** — read‑only, rendered from `tool_*` events, never the
  integrated terminal's buffer (D7)
- **Context Inspector**, **Model Manager**, **Hardware**, **First‑run**,
  **Autonomy control**, **Security overview** — as today, gated by `hello`
  capabilities (D6)

### UX identity (docs/UX-DIFFERENTIATION.md)

On top of the surfaces above, the app carries a Valyria‑specific UX so it does
not read as a Code‑OSS fork — all within the extension API / `configurationDefaults`
(no new patches):

- **`chrome/`** built‑in — the product icon theme, a file icon theme (stock Seti
  file icons + Valyria folder icons), and chrome defaults (lever A/B).
- **Dual‑mode layout** (`extension/src/session/layout.ts`) — a per‑workspace
  `agent` / `editor` switch that applies a bundle of `workbench.*` settings and a
  `valyria.layoutMode` context (lever C).
- **Editor‑area surfaces** (`extension/src/views/editorPanels.ts`) — Home (lands
  instead of the Welcome page), Task Workspace, Review Changes (lever D).
- **Status‑bar agent ticker** + task‑verb command palette + a `⌘I` /
  `⌘K` chord family (lever E).

## 5. Branding / de‑Microsoft checklist (`build/product.overlay.json` + patches)

- `nameShort` / `nameLong` / `applicationName` → Valyria
- `dataFolderName` → `.valyria`
- **Icons** — `scripts/gen-icons.py` writes `vscode/resources/{darwin,win32,linux}/`
  from `build/icons/` (app `code.{icns,ico,png}`, `code.xpm`, Start‑menu tiles,
  and all 55 per‑language document icons re‑badged). `bootstrap.sh` runs it, then
  wipes `vscode/.build/electron` — `preLaunch.ts` only re‑brands the app bundle
  when that directory is missing, and `darwinIcon`/`winIcon` are literals in
  `build/lib/electron.ts` that no overlay key can point at `build/icons/`.
- `win32*` identifiers, `darwinBundleIdentifier`; company/copyright/HelpBook via
  `020-debrand-electron-build.patch`
- **Default colour theme** — the `theme/` built‑in (code‑free, always enabled)
  contributes `Valyria Dark/Light/High Contrast[ Light]` + `configurationDefaults`;
  `010-valyria-default-theme.patch` makes it the schema default too.
- `extensionsGallery` → Open VSX (`https://open-vsx.org/vscode/gallery`, …)
- Remove `enableTelemetry`, `crashReporter`, `msftInternalDomains`,
  `aiConfig`, `documentationUrl`‑style MS links; keep `reportIssueUrl` → our repo
- **Bundled Copilot chat** — Code‑OSS 1.135 ships `extensions/copilot`;
  `bootstrap.sh` step 3b `rm -rf`s it (folder‑scanned at runtime), then step 3c
  runs `scripts/strip-copilot-refs.mjs` to remove the `compile-copilot` /
  `watch-copilot` legs from the root `package.json` build scripts (they
  `npm --prefix extensions/copilot` and ENOENT the whole build once the dir is
  gone). `product.json` `defaultChatAgent` is left intact — it is dereferenced
  unguarded at startup, so nulling it white‑screens the window. The core chat
  view, its setup agents, the title‑bar Sign In and inline suggestions are core
  workbench and survive the delete; `valyria-chrome` sets
  `"chat.disableAIFeatures": true` in `configurationDefaults`, which Code‑OSS's
  `ChatEntitlementContext` reads as a forced `hidden` state and gates all of
  them off (docs/UX-DIFFERENTIATION.md).
- `builtInExtensions` — the Valyria extensions bundle under
  `vscode/extensions/valyria`, `valyria-theme` and `valyria-chrome` via bootstrap
  symlinks so they compile in the standard build
- `linkProtectionTrustedDomains`, `trustedExtensionAuthAccess` as needed
- Offline guarantee (PLAN.md §32): CI job runs the built app with the network
  disabled; no update check, no gallery ping, no telemetry endpoint resolves

## 6. Build & run

```bash
scripts/bootstrap.sh          # one‑time / after VSCODE_REF or patch changes
scripts/dev.sh                # watch extension + launch ./vscode/scripts/code.sh
scripts/build.sh              # branded installers + bundled bridge-host sidecar
```

`scripts/build.sh` also builds `valyria-bridge-host` for each target triple and
drops it where the extension resolves it, mirroring the old Tauri `externalBin`
sidecar flow (INTEGRATION.md D‑INT‑1).

## 7. Migration phases

1. **Scaffold** — submodule, overlay, `bootstrap.sh`, extension skeleton,
   `valyria-bridge-host` with the JSON‑RPC framing + `session_*` + event pump.
   Exit: branded Code‑OSS launches; extension activates; connects to a real Core
   daemon; raw event feed in a webview; `kill -9` the window, relaunch, adopt.
2. **Task experience** — chat, activity, timeline, task panel, approvals,
   pause/resume/cancel, history, resume‑on‑launch. Port the `Live*` panels.
3. **Editor‑integrated agent surfaces** — change ownership decorations on the
   native diff; verification inspector; agent‑command view beside the terminal;
   cross‑navigation (failure → file → diff).
4. **Models / hardware / first‑run / settings / autonomy / security** — port,
   wired to `config_show` + `doctor_run`, D13 write‑then‑verify against
   `<repo>/.valyria/config.toml`.
5. **Packaging** — branded signed installers on 3 OSes, bridge‑host sidecar per
   triple, Open VSX gallery, updater pointed at our release feed, offline CI job.
6. **Retire Tauri** — delete `apps/desktop/`, drop Tauri deps from the Cargo
   workspace, update `xtask` gates, rewrite the top‑level README.

Standing gates from PLAN.md still apply per phase: keyboard reachable, focus
visible, light/dark/high‑contrast correct, `axe` clean on our webviews, no new
event decoder without a trace fixture, layering check green
(`valyria-bridge` + `valyria-bridge-host` depend on `valyria-protocol` /
`valyria-types` only).
