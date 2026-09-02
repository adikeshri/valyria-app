<p align="center">
  <img src="docs/assets/logo.png" alt="Valyria" width="360">
</p>

<h1 align="center">Valyria App</h1>

<p align="center">
  A full VS&nbsp;Code-class editor — a branded <b>Code&nbsp;-&nbsp;OSS</b>
  distribution — with the <a href="../valyria">Valyria</a> autonomous coding
  agent shipped as a bundled built-in extension. Local-first: inference runs on
  your machine, no account, no telemetry.
</p>

## Shape

| Path | What it is |
|---|---|
| `vscode/` | Code&nbsp;-&nbsp;OSS submodule, pinned by `build/VSCODE_REF` (never edited in place) |
| `build/` | the branding overlay (`product.overlay.json`) + patches, applied by `scripts/bootstrap.sh` |
| `extension/` | the **Valyria** built-in extension — every agent surface (Agent, Task, Activity, Timeline, Approvals, Verification, Agent Commands, Models, Hardware, Settings, Context, About, First-run) |
| `crates/valyria-bridge/` | the only code that speaks Core's protocol — socket client, session supervisor, event pump |
| `crates/valyria-bridge-host/` | the stdio JSON-RPC front end the extension spawns (the role the Tauri host played, minus Tauri) |
| `packages/protocol` · `packages/state` | generated wire types + zod decoders; the pure, synchronous event reducer |

The agent lives entirely in the extension and talks to Core only through
`valyria-bridge-host`. The editor itself — files, search, diff, git, terminal,
debug, tasks — is upstream Code&nbsp;-&nbsp;OSS and the extension does not touch it.

## Run it

```bash
brew install node@24          # one-time; keg-only, non-invasive (see scripts/node-guard.sh)
scripts/bootstrap.sh          # submodule + overlay + patches
scripts/install-deps.sh       # ~5-10 min, ~1 GB
scripts/dev.sh                # watch + launch the branded Valyria window
```

`valyria-app` is a **client** of the Valyria Core runtime, not a second
implementation of it. Core plans, edits, runs and verifies; the app is the
window onto that work, and the place a developer approves what the agent may do.

## Documents

| Document | What it covers |
|---|---|
| [docs/ARCHITECTURE-VSCODE.md](docs/ARCHITECTURE-VSCODE.md) | **Primary.** The Code-OSS-fork architecture — repo topology, process model, branding checklist, what each old Tauri piece became |
| [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | **Primary.** The phase-by-phase build plan (0–11), what shipped per phase, standing gates, capability-gap → phase map |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Sidecars, per-OS gulp targets, signing credentials, the update feed, Windows tier 3 |
| [docs/CORE-INTERFACE.md](docs/CORE-INTERFACE.md) | What Core's protocol offers, the capability gaps (G1–G15), and how each surface degrades until Core closes them |
| [docs/PLAN.md](docs/PLAN.md) | The original Tauri build plan. Still the reference for Core, the protocol, and the design decisions (D1–D14); **superseded on the app shell** by ARCHITECTURE-VSCODE.md |

Start with the design decisions in PLAN §1 and the gap list in CORE-INTERFACE §2
— between them they explain nearly every structural choice.

## The shape of it

```text
┌─ Valyria (Electron / branded Code-OSS) ──────┐     ┌─ valyria serve (Core) ─────┐
│  workbench + editor  ── upstream, untouched   │     │                            │
│  ext host (Node)                              │     │  one daemon per workspace  │
│    └─ extension "valyria"                     │     │  agent loop, tools, index, │
│         child_process ─ valyria-bridge-host ──┼─────►  verification, ledger      │
│              (stdio JSON-RPC)   NDJSON / Unix │     │                            │
└──────────────────────────────────────────────┘     └────────────────────────────┘
        UI process may die                            runtime survives independently
```

Core runs as a supervised sidecar daemon, never inside the UI process, so a
crashed window never kills a running task. The extension owns no socket — that
lives inside `valyria-bridge-host`.

## License

Apache-2.0. See [LICENSE](LICENSE).
