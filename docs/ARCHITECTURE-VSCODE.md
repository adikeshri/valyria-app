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
    patches/                 *.patch applied to vscode/ after checkout (keep minimal)
    icons/                   Valyria app icons per platform
    README.md                how the overlay + patch flow works

  extension/                 the Valyria built‑in extension (TypeScript)
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

## 5. Branding / de‑Microsoft checklist (`build/product.overlay.json` + patches)

- `nameShort` / `nameLong` / `applicationName` → Valyria
- `dataFolderName` → `.valyria`
- Icons (`build/icons/`), `win32*` identifiers, `darwinBundleIdentifier`
- `extensionsGallery` → Open VSX (`https://open-vsx.org/vscode/gallery`, …)
- Remove `enableTelemetry`, `crashReporter`, `msftInternalDomains`,
  `aiConfig`, `documentationUrl`‑style MS links; keep `reportIssueUrl` → our repo
- `builtInExtensions` — add the Valyria extension (or bundle under
  `vscode/extensions/valyria` via bootstrap symlink so it compiles in the
  standard build)
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
