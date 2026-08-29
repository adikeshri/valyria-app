<p align="center">
  <img src="docs/assets/logo.png" alt="Valyria" width="360">
</p>

<h1 align="center">Valyria App</h1>

<p align="center">
  The desktop application for <a href="../valyria">Valyria</a> — a local-first
  autonomous coding agent + harness that runs entirely on your own machine.
</p>

## See it

![Valyria App — clicking through the Agent, Task, Diff, Tests and Terminal surfaces](docs/assets/demo.gif)

<p align="center">
  <img src="docs/assets/screenshot.png" alt="The Valyria App desktop renderer" width="900">
</p>

The tour above runs against `apps/desktop/src/data/mock.ts` — every panel is
built on the exact data shapes Core's protocol will provide.

> **Status: visual prototype, now a real native app.** [apps/desktop](apps/desktop)
> is a full renderer implementation of every PRD surface, running against
> realistic local sample data, packaged with a Tauri native shell — it builds
> and launches as an actual desktop window (`npm run app:dev`), not just a
> browser tab. See [apps/desktop/README.md](apps/desktop/README.md) to run it.
> The Rust protocol bridge and the real Core connection are not wired up yet;
> that's the deliberate next phase (see [docs/PLAN.md](docs/PLAN.md) Phase 1).

`valyria-app` is a **client** of the Valyria Core runtime, not a second
implementation of it. Core plans, edits, runs and verifies; the app is the
window onto that work — repository, task, context, actions, verification — and
the place a developer approves what the agent is allowed to do.

## Documents

| Document | What it covers |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | The build plan: design decisions, topology, subsystem designs, ten phases, acceptance mapping, risks |
| [docs/CORE-INTERFACE.md](docs/CORE-INTERFACE.md) | What Core's frozen v1 protocol offers, the twelve gaps between it and the product, and the additive methods the app needs |

Start with the design decisions in PLAN §1 and the gap list in CORE-INTERFACE §2
— between them they explain nearly every structural choice in the plan.

## The shape of it

```text
┌──────────────────────────────┐        ┌────────────────────────────┐
│ valyria-app (Tauri)          │        │ valyria serve (Core)       │
│                              │        │                            │
│  renderer  ── React/TS       │  NDJSON│  one runtime per workspace │
│  bridge    ── Rust           │◄──────►│  agent loop, tools, index, │
│              protocol client │  Unix  │  verification, ledger      │
│              supervisor, PTY │  socket│                            │
└──────────────────────────────┘        └────────────────────────────┘
        UI process may die              runtime survives independently
```

Core runs as a supervised sidecar daemon, never inside the UI process, so a
crashed window never kills a running task.

## License

Apache-2.0. See [LICENSE](LICENSE).
