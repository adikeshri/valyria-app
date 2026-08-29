# Valyria App — Build Plan

The desktop application for Valyria: a local-first autonomous software engineer.

This plan is written against the Core tree at `../valyria` as of protocol
`1.0.0` / Phase 11. Core's own build plan is `valyria/docs/PLAN.md`; the
conventions here deliberately mirror it so the two repositories read as one
project.

Companion document: **[CORE-INTERFACE.md](CORE-INTERFACE.md)** — exactly what the
frozen v1 protocol offers, the twelve gaps between it and the PRD, and the
additive Core methods this plan requests. Read it before Phase 1; most of the
hard decisions below are consequences of it.

## Table of contents

1. [Design decisions that shape everything](#1-design-decisions-that-shape-everything)
2. [Repository topology](#2-repository-topology)
3. [Cross-cutting conventions](#3-cross-cutting-conventions)
4. [Subsystem designs](#4-subsystem-designs)
5. [Build phases](#5-build-phases)
6. [Acceptance mapping](#6-acceptance-mapping)
7. [Testing strategy](#7-testing-strategy)
8. [Risk register](#8-risk-register)
9. [Platform and performance targets](#9-platform-and-performance-targets)
10. [Decisions I need from you](#10-decisions-i-need-from-you)

---

## 1. Design decisions that shape everything

### D1 — Core runs as a supervised sidecar daemon, never embedded in the UI process

Core can be linked in-process (`valyria_app::Runtime`) or spoken to over a socket
(`valyria serve`). The CLI defaults to embedded. **We do the opposite, always.**

PRD §30 requires that a UI crash not kill a running agent task, and §43 states
that "the Core runtime may continue independently from the UI". If the runtime
lives inside the Tauri process, a renderer OOM or a panic in our own Rust code
takes the agent's work with it. Embedding would also put a `tokio` multi-thread
runtime, SQLite, tree-sitter and (eventually) a model runtime inside the same
address space as a WebView — a debugging and packaging liability with no
compensating benefit.

Consequence: the app owns a **session supervisor** (§4.2) that starts, adopts,
health-checks and reaps `valyria serve` processes. This is the single most
load-bearing subsystem we build.

### D2 — The protocol is the only way we talk to Core

Mirroring Core's D11. No app code imports a Core crate other than
`valyria-protocol` (and `valyria-types` for shared newtypes). A CI check fails
the build if `crates/valyria-bridge/Cargo.toml` grows a dependency on
`valyria-agent`, `valyria-index`, `valyria-verify`, `valyria-permissions`,
`valyria-model-registry`, or any other logic crate — the direct analogue of
`xtask check-layering`.

This is what makes §41 ("no Core logic duplication") mechanically checkable
rather than aspirational.

### D3 — Core is the source of truth; the app holds a projection

The app has no authoritative state. Everything on screen is derived from
protocol responses and the event stream, and can be rebuilt from scratch by
replaying from `seq = 0`. Local persistence exists only as a **cache**, keyed by
`(workspace_id, protocol_version, core_runtime_version)` and discarded on any
mismatch.

Practical test: deleting the app's entire local data directory must lose nothing
but window geometry and theme. Task history, plans, evidence and diffs all come
back, because they live in `<repo>/.valyria/workspace.db`.

### D4 — The event log is the UI's spine

One workspace-global subscription per session, consumed by a pure reducer into a
normalized store. Every panel is a selector over that store. `seq` is the resume
cursor; on reconnect we send `events_subscribe { since: lastSeq }` and Core
replays from its journal (Core handles subscriber lag internally by
re-subscribing at `resume_from`, so the stream has stalls but no holes).

The reducer is **synchronous, pure, and unit-tested against recorded traces**.
No fetching, no side effects, no `Date.now()`. This is what makes crash recovery
(§30) a property we can test rather than a hope.

### D5 — Event payloads are untrusted input, decoded tolerantly

Core states plainly that event payloads are loose-typed so that new shapes do not
force a protocol break — a payload field can be renamed under a *patch* bump. A
naive `payload.tool_name` in a React component fails **silently**, rendering an
empty cell instead of an error.

So: every payload passes through a declared decoder (`zod`) at the transport
boundary. A decoder that fails does not throw away the event — it produces
`{ kind, seq, ts, raw }`, which the Activity feed renders as a generic row with a
"raw payload" disclosure. Unknown `kind` values do the same. The UI degrades to
"less informative", never to "blank" or "crashed".

Backing this: a `fixtures/traces/` corpus of real `valyria run --events` output,
replayed in CI, plus a decoder-coverage report that fails the build when a `kind`
Core emits has no decoder.

### D6 — Every surface declares the capability it needs

A single registry maps UI surface → required capability token or protocol method.
`hello`'s `capabilities[]` drives it. A surface whose capability is absent
renders a specific, honest empty state naming what Core does not yet provide —
never a blank panel, never a client-side reimplementation.

This is the mechanism that lets us build the whole PRD surface against a Core
that only implements part of it, and lets each Core release light up features
with no app change. It is also the enforcement point for the local-read exception
in [CORE-INTERFACE.md §3](CORE-INTERFACE.md#3-the-local-read-exception): a
locally-served surface is registered as such and carries a visible "served
locally" marker.

### D7 — Agent actions and human actions are never visually merged

Applies to the terminal (§18), the diff viewer (§15), and the file tree. The
integrated terminal is a human PTY owned by the app; agent commands are Core tool
invocations rendered from events. They share a panel but never a buffer, and each
row carries an unambiguous origin badge. Confusing the two is a security problem,
not a cosmetic one — a user who thinks the agent ran a command it did not run
will approve the wrong things.

### D8 — Verification is displayed as evidence, never as a badge

PRD §35 is explicit and Core agrees: an unbacked "tests pass" is reported as *not
verified*. `task_report` returns `verified[]` (each with `command`, `kind`,
`outcome`, `run_id`) and `unverified[]`. The Verification Inspector renders those
two lists. There is no code path in the app that can produce a "verified" state
from anything other than a `VerifiedClaimWire`.

### D9 — Long-running work never blocks the UI thread or the socket

Core's `Call` connections are one-shot and short-lived, so a slow call cannot
block the event stream. On our side, all protocol traffic lives in the Rust
bridge, off the WebView main thread, surfaced to the frontend as Tauri events.
The renderer never opens a socket and never blocks on I/O.

### D10 — Accessibility and theming are constraints, not a phase

Keyboard-first navigation, visible focus, reduced-motion, and light/dark/system
are acceptance criteria on **every** phase's exit, not a Phase 9 cleanup. A
developer tool that cannot be driven from the keyboard is a broken developer
tool. Retrofitting focus management into a completed three-pane layout costs more
than building it in.

### D11 — Tauri 2 + React + TypeScript

Per the PRD's recommendation, and because a Rust host process is exactly what we
need for D1 (process supervision, socket I/O, PTY) with no second runtime to
ship. Alternatives considered: Electron (Node runtime, ~120MB heavier bundles, no
Rust host for the sidecar work), and a native Rust GUI (egui/iced — the diff
viewer, code viewer and virtualized tree are years of work we would be
reinventing). The WebView is the trade: platform-variable rendering, which we
absorb with a visual-regression suite per platform (§7).

### D12 — CodeMirror 6 for code and diffs, not Monaco

Monaco brings a large bundle and an editing model we do not need — the app is a
*viewer* with a diff surface, not an IDE editor (Core owns editing). CodeMirror 6
is smaller, has first-class virtualized rendering for large files, a real
accessibility story, and composable decoration APIs that make agent-vs-user
change attribution (§15) a gutter decoration rather than a fork.

### D13 — Settings write to Core's config files, and display Core's resolved answer

There is no `config_set` on the wire (G6). We write `<repo>/.valyria/config.toml`
or `~/.valyria/config.toml` — Core's own documented user surfaces — then
immediately re-read `config_show` and render the **effective** value with its
`origin`. If the policy floor or a precedence rule overrode us, the user sees
that, not our optimistic write. A setting we cannot confirm shows as pending.

We never write a config key Core does not already report in `config_show`.

### D14 — Windows ships as tier 3 from day one

Core's daemon is a `UnixListener` and Core has no Windows sandbox. We produce a
Windows installer (§39 requires it) that launches, shows version and
compatibility information, and refuses to start a session with the specific
reason and a link to G9. Shipping a Windows build that silently misbehaves would
be worse than shipping one that is honest about its state.

---

## 2. Repository topology

A pnpm workspace with a Cargo workspace inside it.

```text
valyria-app/
  apps/
    desktop/                 Tauri app: Rust host + React renderer
      src/                   renderer (TypeScript/React)
      src-tauri/             Tauri host crate
  crates/
    valyria-bridge/          protocol client, session supervisor, PTY host
    valyria-app-xtask/       codegen, layering check, release gates
  packages/
    protocol/                generated TS types + payload decoders + fixtures
    ui/                      design system: tokens, primitives, a11y helpers
    state/                   event reducer, normalized store, selectors
    features/                one directory per PRD surface
  fixtures/
    traces/                  recorded `valyria run --events` output
    repos/                   small git fixture repositories
  core.lock.json             pinned Core revision + protocol/capability snapshot
  docs/
```

### `crates/valyria-bridge` — the only code that speaks the protocol

Owns: socket client, session supervisor, event pump, PTY host, workspace
registry, config file writer. Depends on `valyria-protocol` and `valyria-types`
**only** (D2, enforced by `xtask check-layering`).

Everything above it — including `src-tauri` — talks to Core through the bridge's
commands, never through a socket of its own.

### `packages/protocol` — the typed boundary

Generated from `valyria/docs/protocol/*.schema.json` at the pinned revision.
Contains: request/response types, the payload decoder registry (D5), the
capability registry (D6), and the trace fixtures. `xtask check-protocol` fails
the build when the pinned Core's schemas differ from what is generated — the
app-side mirror of Core's own drift gate.

### `packages/state` — the projection

Pure reducer, normalized store (`tasks`, `events`, `files`, `approvals`,
`evidence`, `models`, `workspaces`), selectors. No React, no I/O, no clock. This
package is where most of the app's unit tests live because it is where most of
the app's logic lives.

### `packages/features` — one directory per PRD surface

`workspace-explorer`, `agent-chat`, `task-view`, `agent-activity`, `code-viewer`,
`diff-viewer`, `terminal`, `git-changes`, `model-manager`, `hardware-status`,
`approvals`, `settings`, `task-history`, `context-inspector`,
`verification-inspector`, `first-run`.

Each exports a component plus a **capability declaration**. A feature that cannot
name the capability it needs does not ship.

---

## 3. Cross-cutting conventions

**Rust side.** Matches Core: `thiserror` per module, stable error `code` strings,
`tokio` multi-thread, one `CancellationToken` tree per session, `tracing` spans
that carry the protocol `seq` so a log line ties to a UI event.

**TypeScript side.** `strict` plus `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. No `any` outside the decoder boundary, where it is
immediately narrowed by `zod`. ESLint forbids importing from
`packages/protocol/generated` outside `packages/protocol`.

**Errors.** Every user-visible error answers PRD §36's four questions: what
happened, whether the agent stopped, whether user action is needed, what to do
next. An `ErrorPresentation` type makes those four fields **required**, so
"Something went wrong" is not expressible. Core's `WireError` (`code`, `message`,
`retryable`) maps into it through a table keyed by `code`, with a documented
fallback that still names the code.

**IDs.** Core's ULID strings pass through untouched. The app never mints an id
for anything Core owns.

**Time.** All timestamps are Core's `ts_ms`. The app renders relative time but
sorts on `seq`, never on wall clock — a projection sorted by clock reorders under
clock skew and resume.

**Immutability of history.** Events are append-only in the store. A correction
arrives as a later event; we never mutate an earlier one.

**Determinism.** The reducer, all selectors, and all formatting take injected
`now`. This is what lets trace replay assert exact rendered output.

**Feature flags.** Surfaces gated by D6 capabilities, not by build flags. One
binary behaves correctly against several Core versions.

**Observability.** Structured local logs under the app data dir, rotating, with
the same redaction rules as Core (no absolute paths outside the workspace, no
secrets). No telemetry, ever — §32's offline promise is a product guarantee and
the CI offline job (the app-side analogue of Core's) enforces it by running the
full integration suite with the network disabled.

**CI.** `cargo fmt`/`clippy -D warnings`, `check-layering`, `check-protocol`,
`tsc --noEmit`, ESLint, unit + trace-replay + integration + e2e, `axe`
accessibility scan, visual regression per platform, bundle-size budget,
`cargo-deny`, and a three-OS installer build.

---

## 4. Subsystem designs

### 4.1 Application shell (§5)

Three panes plus a bottom dock, per the PRD layout. Implemented as a persisted
layout tree (split sizes, collapsed state, active tabs) stored per workspace.
Every pane is independently focusable with a documented keyboard shortcut; the
command palette (`Cmd/Ctrl-K`) reaches every action in the app, which is also how
we satisfy §46 without building a separate accessibility mode.

The header carries the three things that must always be true and always visible:
active model, hardware/runtime status, and the **Local / Offline** indicator
(§32).

### 4.2 Session supervisor (§43, §30, §40) — the load-bearing subsystem

One Core daemon per workspace. Lifecycle:

```text
open workspace
  → resolve workspace_id (canonical path hash)
  → look for ~/.valyria/run/<workspace_id>/{sock,pid,meta.json}
  → if present: connect, `hello`, verify runtime_version + pid liveness
      → healthy?  adopt it (this is §30 crash recovery)
      → stale?    clean up, fall through
  → spawn `valyria serve --socket <sock> --workspace <root>` (bundled sidecar)
  → poll-connect with bounded backoff
  → `hello` → negotiate protocol_version + capabilities → populate D6 registry
  → `workspace_status`, `task_list` → hydrate
  → `events_subscribe { since }` → live
  → Ready
```

Core defines no socket-path convention, so the app defines one and owns it:
`$VALYRIA_HOME/run/<workspace_id>/` created `0700`, socket `0600`.

Supervision rules:

- The daemon **outlives the UI**. Quitting the app with a running task leaves the
  daemon up and says so; the user can end it explicitly.
- An idle daemon with no active tasks is reaped after a configurable timeout
  (default 10 min).
- A daemon that dies with a task running is **not** auto-restarted silently: we
  restart it, re-`hello`, re-subscribe from `lastSeq`, and surface a "Core
  restarted; task state reloaded from journal" notice with the recovered state.
- Reconnection uses bounded exponential backoff with a visible connection state
  in the header. Every state is nameable: `starting`, `connecting`, `ready`,
  `degraded`, `reconnecting`, `incompatible`, `failed`.

Multi-repository workspaces (§6) are N supervised daemons, each with its own
event stream, multiplexed into one store keyed by `workspace_id`.

### 4.3 Protocol client and event pump (§42)

In the bridge: a request queue with per-method timeouts and cancellation, and a
long-lived subscription task. Events cross into the renderer as batched Tauri
events (coalesced at ~16ms) so a burst of thousands cannot starve rendering. The
batch carries `firstSeq`/`lastSeq`; the renderer asserts contiguity and, on a
gap, re-subscribes rather than guessing.

The renderer never sees a socket. The bridge exposes one command per protocol
method plus `session_*` commands for supervision.

### 4.4 Workspace management (§6, §7)

The workspace registry (recents, authorization, multi-repo grouping) is app
state; Core's `workspace_status` supplies `root`, `workspace_id`, `data_dir`,
`index_generation`, and task counts. Opening a directory is an **explicit user
authorization act**: the chosen root is recorded, shown in the header, and is the
only path the app will read outside its own data dir (§26).

The explorer is a virtualized tree over a locally-served directory listing with
an `fs` watcher for external changes (§7), marked "served locally" per D6 until
Core exposes a repository read surface (G3). Modified/deleted/agent-owned
decorations come from git status and, when available, the ledger (G8).

### 4.5 Agent chat and task creation (§8)

Chat is a task-entry surface, not a chatbot. A submitted message becomes
`task_create { objective }` and the conversation view becomes a projection of
that task's events. There is no local model call and no local prompt assembly —
if the app ever constructs a prompt, it has become a second agent, which §41
forbids.

Context attachments (§9) are appended to the objective text as an explicit,
visible preamble until Core accepts structured context on `task_create`; the
exact text sent is always inspectable, because a user must be able to see what
was actually asked.

### 4.6 Activity, timeline and task panel (§10, §11, §12, §44)

All three are selectors over the same event projection at different granularity:

- **Activity** — a human-readable running narrative ("Editing auth/service.py",
  "2 tests failed"). Derived from `tool_started`/`tool_completed`,
  `file_changed`, `test_*`, `state_changed`. No model reasoning text is ever
  rendered here (§10).
- **Timeline** — every event, timestamped, expandable to its decoded payload and
  its raw JSON.
- **Task panel** — objective, state, plan (`task_plan`), modified files,
  actions, verification (`task_report`), permissions, duration, model.

Long tasks (§44) keep the UI fully interactive: browsing, diffs, history and
read-only inspection all work while an agent runs, because none of them mutate
Core state. Mutating concurrency is Core's to arbitrate (§45); the app surfaces
`active_tasks` and lets Core reject what it will not allow.

### 4.7 Approvals (§13)

A dedicated modal-but-non-blocking surface driven by `approval_requested`
payloads (`prompt`, `tool`, `category`, `target`, `risk`). Risk drives visual
treatment: destructive and network operations get a distinct, unmissable
treatment and require a deliberate second interaction.

Given G2 (no request id, no scope), the app shows one approval at a time per
task and refuses to resolve a prompt that a newer `approval_requested` has
superseded — it re-prompts instead. `Allow for Task` is capability-gated and
absent until Core supports it. A pending approval raises an OS notification
(§31) and marks the task **blocked**, not "working".

### 4.8 Diff, change ownership, rollback (§14, §15, §16)

CodeMirror 6 merge view: per-file unified/split, intra-line highlighting,
next/previous change navigation, and a changed-file rail. Ownership (agent /
user / pre-existing) is a gutter decoration sourced from the ledger when Core
exposes it (G8) and explicitly marked unavailable otherwise — the app never
guesses ownership from file-touch events.

Rollback goes through `task_rollback { task_id, checkpoint_id }`, with
checkpoints read from `task_plan`'s `PlanStepSummary.checkpoint` /
`rollback_boundary`. The confirmation dialog shows what Core will restore, and
the result (`restored_files`, `reverted_entries`) is reported exactly. Discarding
a single agent hunk without the ledger is **not offered** — a partial revert we
compute ourselves would desynchronize Core's ledger.

### 4.9 Git (§17)

Read-only until Core exposes `git_*` (G3): branch, status, staged/unstaged,
diff, recent commits, served locally and labeled. Write operations (stage,
commit, discard, branch) are rendered but disabled with the reason, because §17
requires them to respect Core's permission policy and we have no way to route
them through it.

### 4.10 Terminal (§18)

A PTY hosted in the bridge (`portable-pty`) with xterm.js in the renderer, opened
at the workspace root with the same environment the user's shell would get.
Agent-run commands appear in a **separate, read-only** view rendered from
`tool_started`/`tool_completed` events, side by side with the human terminal and
unmistakably badged (D7).

### 4.11 Test panel (§19)

Passed / failed / skipped / not-run, built from `test_*` events and
`verification_evidence`. Each failure opens its output, its parsed location where
Core's failure parsers supply one, and a jump to the implicated file and the
relevant diff.

### 4.12 Verification inspector (§35)

Renders `task_report`'s `verified[]` / `unverified[]` verbatim: the command, its
kind, its outcome, its `run_id`. Categories with no evidence read **NOT RUN**.
Per D8 there is no path to a generic "verified" badge.

### 4.13 Models, hardware, first run (§20, §21, §22, §37)

Constrained hard by G4 and G5: `model_list` is read-only and there is no
structured hardware surface.

What ships now: an inventory Model Manager (id, family, quantization, size,
license, installed, active), a Hardware View built from `doctor_run` with
unreported fields explicitly marked, and a first-run flow that explains local
inference, shows what Core reports, lets the user open a repository, and runs a
harmless read-only task to prove the stack works end to end.

What is gated on Core: install/remove/activate, the hardware probe, and the
model **recommendation** — including its explanation, which must come from Core's
`fit()` scoring rather than a heuristic we invent (§41). Until then the wizard
does not recommend; it lists and asks.

Non-negotiable: **the app never downloads a model.** No fetch path exists in the
app for weights (§20, §38).

### 4.14 Search and context inspector (§33, §34)

Search UI is built now against a local filename/substring implementation, clearly
marked as such, and switches to Core's seven-mode fused search — including the
per-hit `ScoreExplanation`, which is the whole point — the moment `search_query`
exists (G3).

The Context Inspector ships **disabled with an explanation**: Core never emits
`context_retrieved` today (G7), and inferring provenance would be exactly the
duplication §41 prohibits. The UI is built and trace-tested against a synthetic
fixture so it lights up on the first Core release that emits the event.

### 4.15 Settings, autonomy, security overview (§24, §25, §26)

Settings render `config_show` entries grouped into the PRD's five sections, each
showing value **and origin**. Writes follow D13.

Autonomy (§25) is constrained by G1: the mode is a daemon-start parameter, so the
switch restarts the workspace daemon and is disabled while a task runs, with that
stated inline. Each level's meaning is spelled out in the UI from Core's own
documented semantics.

The Security overview (§26) is rendered from `config_show` plus `doctor_run`'s
`sandbox` and `permission_config` checks, and states plainly which lines are
enforced by Core and which are unreported. A checkmark we cannot source from Core
is not drawn.

### 4.16 Task history and resume (§28, §29, §30)

History is `task_list`, grouped by day, each entry reopenable into a full task
view rebuilt from `task_status` + `task_report` + `task_plan` + replayed events.

On launch, any task in a non-terminal state (including
`WAITING_FOR_PERMISSION`, using `paused_from` and `recovery_note`) surfaces the
PRD's Resume / Inspect / Discard prompt. State recovery is entirely Core's
(`task_resume`, `task_cancel`); the app only asks the question.

### 4.17 Notifications and offline (§31, §32)

Local OS notifications only, opt-in per category (completed, blocked, permission
required, tests failed, waiting). No push infrastructure.

The offline indicator is permanent and specific: `Local · Offline · Model:
<active>`. It reflects observed state, not a hard-coded string — if Core reports
a network-capable model runtime, the indicator changes accordingly rather than
lying.

### 4.18 Packaging, updates, compatibility (§38, §39, §40)

Tauri bundler produces `.dmg`/`.app` (universal), `.msi`/`.exe`, and
`.deb`/`.AppImage`. The Core binary ships as a Tauri `externalBin` sidecar built
from the `core.lock.json` revision for each target triple, with the app also able
to use a user-supplied Core binary (developers will want this).

An About/Compatibility surface shows app version, Core runtime version, protocol
version, negotiated capabilities, and installed model versions, with the
compatibility verdict from CORE-INTERFACE §4.

Updates: Tauri's updater for the app. Core updates arrive **only** with an app
update, and the release notes name the Core revision. Model weights are never
touched by an app update (§38) — a release-gate test asserts the model store is
byte-identical across an upgrade.

---

## 5. Build phases

Ordering principle, borrowed from Core: **a walking skeleton by Phase 1**, then
depth. Phase 1 is the milestone that de-risks everything — if we can supervise a
Core daemon, stream its events, survive a UI kill, and reattach, the rest is
incremental product work.

Every phase's exit criteria include the standing gates: keyboard reachable,
focus visible, light/dark/system correct, `axe` clean, and no new decoder
without a fixture.

### Phase 0 — Foundations
pnpm + Cargo workspace, Tauri 2 shell, TS strict config, `packages/protocol`
codegen from the pinned Core schemas, `packages/ui` tokens and primitives,
`xtask check-layering` + `check-protocol`, three-OS CI, bundle budget.
**Exit:** an empty signed-shape app builds and installs on all three OSes in CI;
a deliberate schema drift and a deliberate layering violation each fail the
build.

### Phase 1 — Session and event spine ⭐
`valyria-bridge`: socket client, session supervisor (spawn / adopt / health /
reap), `hello` negotiation, capability registry, event pump with batching and
contiguity assertion. `packages/state` reducer. A minimal UI: connection state,
workspace status, task list, an objective box, and a raw event feed.
**Exit:** against a real Core built from the pinned revision with the fake model
and a fixture repo — create a task, watch events stream live, `kill -9` the
**UI**, relaunch, adopt the still-running daemon, resume from `lastSeq` with zero
missed or duplicated `seq`, and see the completed task. Then `kill -9` the
**daemon** mid-task and confirm the app restarts it, re-hydrates from the
journal, and says so. **This is the most important milestone in the plan.**

### Phase 2 — Task experience
Agent chat, activity feed, timeline, task panel, plan view, pause/resume/cancel,
task history, resume-on-launch prompt. Payload decoders with the trace fixture
corpus and the decoder-coverage gate.
**Exit:** a full fake-model task is legible end to end from chat to completion
with no raw JSON on the happy path; a trace replay reproduces the rendered
timeline byte-for-byte; every non-terminal task state produces the correct
resume prompt.

### Phase 3 — Repository surfaces
Workspace registry, multi-repo, virtualized explorer with fs watcher, code viewer,
local search UI behind the capability switch, git read-only panel.
**Exit:** a 100k-file repository opens and scrolls at 60fps; external file
changes appear within 500ms; every locally-served surface carries its marker and
flips to Core when the capability is faked on in a test harness.

### Phase 4 — Changes and verification
Diff viewer, changed-file navigation, ownership decorations behind the ledger
capability, rollback through `task_rollback`, test panel, verification inspector.
**Exit:** a seeded-bug fixture task produces a reviewable diff; rollback restores
exactly what Core reports and leaves an unrelated user edit untouched; a task
with no evidence renders NOT RUN everywhere and no "verified" state is reachable.

### Phase 5 — Approvals, security, autonomy
Approval UI with risk treatment and supersession handling, permission overview,
autonomy control with daemon restart semantics, repository instruction viewer
(`VALYRIA.md` / `AGENTS.md`) with authorized-vs-ordinary distinction.
**Exit:** a manual-mode task blocks on every mutating action and each is
approvable and deniable; a superseded prompt re-prompts rather than mis-resolving;
the security overview contains no claim not sourced from Core.

### Phase 6 — Models, hardware, first run
Model manager inventory, hardware view, first-run wizard, offline indicator,
notifications, settings with D13 write-then-verify.
**Exit:** a clean machine reaches "Ready" and completes a harmless task without
the user learning what a model server is; no code path in the app can initiate a
model download; every setting shows its origin and reflects Core's resolved value
after a write.

### Phase 7 — Terminal and parallel interaction
Human PTY, agent-command view, the D7 separation, cross-panel navigation
(failure → file → diff → change).
**Exit:** agent and human command output are never in the same buffer and each
row's origin is unambiguous; every read-only surface stays fully usable through a
long running task, verified by a soak test.

### Phase 8 — Packaging, updates, compatibility
Sidecar bundling per triple, installers, updater, About/Compatibility surface,
Windows tier-3 behaviour, `SECURITY.md`.
**Exit:** signed installers on three OSes; a major protocol mismatch hard-blocks
with a specific message; an app upgrade leaves the model store byte-identical;
the Windows build launches and explains itself.

### Phase 9 — Hardening
Accessibility audit (automated + manual screen-reader pass), visual regression
per platform, perf budgets under load, error-presentation audit against §36,
release gates.
**Exit:** §9 budgets met; every error surface answers the four §36 questions; a
grep for banned generic error strings returns nothing; the full offline CI job
passes with the network disabled.

### Dependency graph

```text
0 ──► 1 ──┬─► 2 ──┬─► 4 ──► 5
          ├─► 3 ──┘        │
          └─► 6 ───────────┤
                7 ─────────┤
                           └─► 8 ──► 9
```

Phases 2, 3 and 6 are parallelizable after Phase 1. Phase 7 needs only Phase 1.
Phase 8 needs everything that ships in the release.

---

## 6. Acceptance mapping

PRD §48, and where each criterion is proven.

| # | Criterion | How it's proven | Blocked on Core |
|---|---|---|---|
| 1 | Installs on supported OSes | Phase 8 CI installer job on three OSes | Windows: G9 (tier 3) |
| 2 | Detects local hardware | Phase 6 hardware view | Partial — G4 |
| 3 | Helps select a model | Phase 6 first-run | **Yes — G4** (no recommendation without Core's fit scoring) |
| 4 | Installs/manages models via Core | Phase 6 | **Yes — G5** |
| 5 | Opens repositories | Phase 3 workspace tests | no |
| 6 | Creates agent tasks | Phase 1 walking skeleton | no |
| 7 | Real-time agent activity | Phase 2 trace-replay tests | no |
| 8 | Presents approvals | Phase 5 manual-mode integration test | Partial — G2 (no `Allow for Task`) |
| 9 | Tool and test activity | Phase 4 test panel | no |
| 10 | Git diffs | Phase 4 diff viewer | Local-read fallback; G3 |
| 11 | Distinguishes agent changes | Phase 4 ownership decorations | **Yes — G8** |
| 12 | Pause / resume / cancel | Phase 2 | no |
| 13 | Reconnects after restart | Phase 1 exit criterion | no |
| 14 | Task history | Phase 2 (`task_list`) | no |
| 15 | Context provenance | Phase 2 UI, disabled | **Yes — G7** (no event emitted) |
| 16 | Verification evidence | Phase 4 (`task_report`) | no |
| 17 | Works entirely locally | Offline CI job, all phases | no |
| 18 | No duplicated Core logic | `xtask check-layering` | no |

Six of eighteen are wholly or partly blocked on additive Core methods. That is
the honest state of the interface and the main input to sequencing Core work
alongside this plan.

---

## 7. Testing strategy

**Unit.** The reducer, selectors, decoders and formatters are pure; they carry
the bulk of the coverage. Rust bridge units cover framing, backoff, supervisor
state transitions and path scoping.

**Trace replay.** `fixtures/traces/*.jsonl` captured from real
`valyria run --events` runs, replayed through the reducer with an injected clock,
asserting exact rendered output. This is the primary defense against D5's silent
payload drift and is regenerated against each Core bump.

**Contract.** `check-protocol` diffs the pinned Core's exported schemas against
generated types. A decoder-coverage test fails when Core emits a `kind` we do not
decode. A capability-coverage test fails when a feature declares a capability
`hello` never advertises.

**Integration.** The real Core sidecar, the fake model (deterministic by design —
Core's D12), and fixture git repos. Covers the full lifecycle including kill/
resume, approval flows, rollback, and the daemon-adoption path.

**End-to-end.** `tauri-driver` (WebDriver) over the packaged app for the flows a
user actually performs: first run, open repo, submit task, approve, review diff,
roll back.

**Accessibility.** `axe` in CI on every route; a manual VoiceOver/NVDA pass per
release; a keyboard-only traversal test that asserts every interactive element is
reachable and focus is never trapped.

**Visual regression.** Per-platform screenshots of every surface in light and
dark, because D11's WebView renders differently across platforms.

**Performance.** Scripted load: 100k-file tree, 50k-event stream, 10k-line diff,
measured against §9.

**Offline.** The whole integration suite with networking disabled — the app-side
mirror of Core's offline job, enforcing §32 as a property rather than a claim.

---

## 8. Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Event payload drift breaks the UI **silently** (D5) | High / likely | Tolerant decoders, coverage gate, trace fixtures per Core bump, raw-payload disclosure. Ask Core for per-kind payload schemas (G12). |
| R2 | Core's v1 surface is too narrow for the PRD (six blocked criteria) | High / certain | CORE-INTERFACE.md as a standing request list; capability-gated UI so features light up with no app change; honest empty states meanwhile. |
| R3 | Session supervision is subtle: orphans, stale sockets, double-spawn races | High | Phase 1 is entirely this. Lockfile + pid liveness + `hello` handshake before adoption; kill/restart tests on both sides in CI. |
| R4 | Windows has no transport and no sandbox (G9) | Medium | Tier 3, declared (D14). Revisit when Core lands a named-pipe transport. |
| R5 | Scope creep into an IDE — inline editing, then "just a small prompt tweak" | High | D2 + the layering check make the agent-logic boundary mechanical. Editing stays Core's; the app is a viewer. |
| R6 | WebView performance on huge trees and diffs | Medium | Virtualize everything; CodeMirror 6 (D12); perf budgets in CI from Phase 3. |
| R7 | Approval race from G2's missing request id | Medium / security-relevant | One prompt at a time, supersession re-prompt, no `Allow for Task` until Core supports scope. |
| R8 | Core is pre-1.0 and moving; app churn tracking it | Medium | Pin one revision per release in `core.lock.json`; a bump is a deliberate PR that regenerates types and re-records fixtures. |
| R9 | Users mistake agent output for their own terminal (D7) | Medium / security-relevant | Separate buffers, permanent origin badges, covered by an e2e assertion. |
| R10 | Only a fake model exists today, so no real UX signal on latency/streaming | Medium | Build against a local `llama-server` through Core's openai-compat adapter as soon as Core wires it; keep token/sec surfaces capability-gated until then. |

---

## 9. Platform and performance targets

| Target | Budget |
|---|---|
| Cold start → interactive shell | < 1.5s |
| Cold start → Ready (daemon adopted, subscribed) | < 3s |
| Workspace open → explorer usable, 100k files | < 2s |
| Event ingest sustained | 5,000 events/s with no dropped frames |
| Keystroke → render, chat input | < 16ms |
| Diff render, 10,000-line file | < 150ms |
| Idle memory, one workspace | < 400MB (excluding Core) |
| Installer size (excluding models) | < 120MB per platform |

Tiers: macOS aarch64 and Linux x86_64 tier 1 (matching Core); macOS x86_64 and
Linux aarch64 tier 2; Windows tier 3 (D14).

---

## 10. Decisions I need from you

Defaults are chosen so work can start regardless.

1. **Core coupling.** Default: pin one Core revision per app release in
   `core.lock.json` and bundle that binary. Alternative: track Core's `main`
   continuously, which trades release stability for a shorter gap-closing loop.
2. **Sequencing against Core's gaps.** Default: build every blocked surface now,
   capability-gated and honestly disabled, so each Core release lights features
   up with no app change. Alternative: defer those surfaces until Core lands the
   methods, shipping a smaller but fully-live first version.
3. **Windows.** Default: tier 3, installer ships and explains itself (D14).
   Alternative: block Windows entirely until Core has a transport, which is
   cleaner but contradicts §39.
4. **Terminal ownership.** Default: the human terminal is an app-owned PTY
   (§18 wants an integrated terminal; Core exposes no PTY). Alternative: no human
   terminal until Core offers one — strictly purer against §41, materially worse
   as a product.
5. **First-run without model management.** Default: ship the wizard now, ending
   at a harmless read-only task against whatever Core reports, with install
   disabled (G5). Alternative: hold the first-run experience until Core exposes
   `model_install`, which means no onboarding story in the first release.
6. **Editor scope.** Default: read-only code viewer; all edits go through the
   agent or the user's own editor. Alternative: allow direct editing in the app,
   which is a real feature request and a real risk to the ledger's
   agent-vs-user attribution (§15).
