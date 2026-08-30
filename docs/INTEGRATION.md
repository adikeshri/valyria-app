# Integrating Core: distribution, runtime setup, and models

How `valyria-app` ships the Core runtime and connects to it. This document
settles the questions [PLAN.md](PLAN.md) §4.18 and §10 leave open — packaging,
first-run, and model acquisition — and specifies exactly how the Core tree at
`../valyria` (protocol `1.0.0`, rev pinned in [`core.lock.json`](../core.lock.json))
enters this repository.

Read [PLAN.md](PLAN.md) §1 (design decisions) and
[CORE-INTERFACE.md](CORE-INTERFACE.md) §2 (the gap list) first. This document
does not restate them; it depends on them.

---

## 1. The target experience

> A user downloads one file. The Valyria runtime is already inside it — no
> toolchain, no package manager, no build step. On first launch the app opens a
> repository and runs a real agent task against Core's built-in offline model.
> Choosing and downloading a real model is a deliberate, later, in-app step.

This splits into two principles that are handled completely differently:

- **Runtime setup is invisible.** The `valyria` binary is bundled as a Tauri
  sidecar. "Setup" is the session supervisor spawning it and Core creating its
  own state directories. There is nothing for the user to install.
- **Model acquisition is explicit and Core-mediated.** The app never fetches
  weights (PLAN §20, §41, D2). The Model Manager drives Core's
  `valyria-model-store` through the protocol and renders progress events. Until
  Core exposes those methods (G5), the app runs on the deterministic fake model
  and says so.

---

## 2. What ships in the app bundle

### D-INT-1 — The `valyria` binary is a bundled Tauri sidecar

The `valyria` binary (crate `valyria-cli`, which links the full
`valyria-app::Runtime` and carries `serve`) is built per target triple and
shipped via Tauri `externalBin`. It is the entire runtime in one file: agent
loop, tools, index, verification, journal, daemon.

The session supervisor (PLAN §4.2) resolves which binary to run, in order:

1. `settings.coreBinaryPath` — explicit user override
2. `VALYRIA_BIN` environment variable
3. the bundled sidecar

Developers use 1 or 2 against their own `../valyria` checkout. Everyone else
gets 3, transparently.

### D-INT-2 — First run needs no model

Core's fake model is deterministic and runs the complete agent loop. A clean
machine reaches **Ready → open repository → run a harmless read-only task →
watch events stream** with zero network activity. That is the onboarding
proof-of-life, and it is enough to ship a first release (PLAN §10 decision 5,
default).

### D-INT-3 — The app has no code path that downloads a model

Not in the renderer, not in `valyria-bridge`. The bridge depends only on
`valyria-protocol` and `valyria-types` (D2, enforced by `xtask check-layering`);
a downloader would be new logic and a layering violation. Every weight byte
flows Core → disk; the app renders `model_install_progress` events and nothing
else.

---

## 3. How Core enters this repository

Three separate things flow from Core, each pinned to the same
`core.lock.json` `git_rev`, each with its own mechanism:

| From Core | Mechanism | Rationale |
|---|---|---|
| `valyria-protocol` + `valyria-types` Rust crates (the bridge compiles against these) | **Cargo git dependency** pinned to `rev` in `crates/valyria-bridge/Cargo.toml` | Small subtree — protocol, types, util, serde, tokio, futures. No tree-sitter, no SQLite, no model runtime. Compiles in seconds. |
| Protocol JSON schemas (`docs/protocol/*.schema.json`, `version.txt`) + captured event traces | **Vendored copy** committed at `packages/protocol/schemas/` and `fixtures/traces/` | TS codegen and the `check-protocol` drift gate must run in CI with no Core checkout. Refreshed by `xtask sync-core` on a bump. |
| The `valyria` daemon binary | **Downloaded Core release artifact** (target state) → **git submodule built in CI** (interim, until Core publishes per-triple binaries) | App CI should not compile ~40 Rust crates + a model runtime on every build. The binary is a versioned artifact with its own provenance. |

### `core.lock.json`

```json
{
  "git_rev": "<40-hex>",
  "protocol_version": "1.0.0",
  "runtime_version": "<from hello>",
  "capabilities": ["plan", "doctor", "storage", "memory", "models", "rollback", "events_resume"]
}
```

### Bumping Core

One PR: update `git_rev` + `runtime_version`, run `xtask sync-core` (re-vendors
schemas, re-runs TS codegen, re-captures trace fixtures), bump the cargo git dep
`rev`, update the sidecar artifact reference. CI's `check-protocol` fails the PR
if the vendored schemas and the generated types disagree. A `capabilities`
change is called out in the PR description.

### Interim binary source (until Core ships release artifacts)

- Core added as a submodule at `vendor/valyria`, pinned to `git_rev`.
- `vendor/` is excluded from the root Cargo workspace (two workspaces, one
  tree).
- The per-platform release job runs
  `cargo build --release -p valyria-cli --target <triple>` with Core's pinned
  Rust toolchain, then renames the output to `valyria-<triple>`.
- **Core request:** a release workflow that publishes signed `valyria-<triple>`
  binaries per tag. When it lands, the release job's "get the binary" step
  swaps from *build* to *download + verify checksum/signature*; nothing else
  changes. Track alongside the CORE-INTERFACE gap list.

---

## 4. Sidecar mechanics

1. **Place** the binary at `apps/desktop/src-tauri/bin/valyria-<target-triple>`
   (`valyria-aarch64-apple-darwin`, `valyria-x86_64-unknown-linux-gnu`, …). The
   triple suffix is mandatory.
2. **Declare** in `apps/desktop/src-tauri/tauri.conf.json`:
   ```json
   { "bundle": { "externalBin": ["bin/valyria"] } }
   ```
   `tauri build` resolves the current triple, copies the binary into the bundle,
   and drops the suffix in the packaged app.
3. **Permit** in `apps/desktop/src-tauri/capabilities/default.json`: the shell
   plugin's sidecar-execute permission, scoped to `valyria`.
4. **Spawn** from `valyria-bridge`, applying the D-INT-1 resolution order:
   ```rust
   let cmd = match source {
       Source::Explicit(path) => app.shell().command(path),
       Source::Sidecar        => app.shell().sidecar("valyria")?,
   };
   let (mut events, child) = cmd
       .args(["serve", "--workspace", &root, "--socket", &sock])
       .spawn()?;
   // supervisor owns `child`: watches exit, restarts on mid-task death,
   // re-subscribes from lastSeq, surfaces the "Core restarted" notice.
   ```
5. **Sign.** The nested binary is signed and notarized as part of `tauri build`
   because it lives inside the bundle — but the macOS signing identity must be
   configured in CI or Gatekeeper blocks the whole app. Linux needs nothing
   extra.

The sidecar shares no Cargo workspace with `src-tauri`. `src-tauri` builds the
Tauri host and `valyria-bridge` (against the pinned `valyria-protocol` crate);
the `valyria` binary is produced by a separate build and meets the app only as a
file in `bin/`.

---

## 5. First-run flow

The runtime needs nothing installed. On first workspace-open the supervisor
spawns the sidecar and Core creates `$VALYRIA_HOME` (`~/.valyria`:
`config.toml`, `run/`, `models/`, `logs/`) and `<repo>/.valyria/workspace.db`.
That is the entirety of "setup".

1. **Welcome** — "Valyria runs entirely on your machine. The runtime is already
   installed."
2. **Environment check** — `doctor_run`; render the ten checks; issues show
   Core's specific remediation string.
3. **Open a repository** — an explicit authorization act; the root is recorded
   and shown in the header (PLAN §4.4).
4. **Prove the stack** — the daemon runs a harmless read-only task (e.g.
   "summarize the README") against the fake model; the user watches events
   stream. "Your runtime works."
5. **Model step — deferred** — "You're on the built-in offline model, good for
   trying the flow. Add a real model from the Models tab." If Core has
   `model_catalog` / `model_install`, this step becomes §6's flow instead.

No step blocks on a download.

---

## 6. Models

### Now (no Core change)

- Model Manager is an inventory view over `model_list` — empty on a clean
  machine.
- First-run ends honestly on the fake model (D-INT-2).
- Escape hatch: point `config.toml` `[model]` at an existing local GGUF via a
  D13 config write — a setting, not a download.

### Core requests (file against `adikeshri/valyria`, per CORE-INTERFACE G4/G5)

| Method | Purpose |
|---|---|
| `model_catalog` | Installable models with id, family, quantization, size, license, min RAM/VRAM — from Core's registry, so the app hardcodes no model list. |
| `model_install { id }` | Returns immediately; emits `model_install_progress { id, bytes, total, phase }` / `_completed` / `_failed` on the event stream. Backed by `valyria-model-store` (verified resumable download, checksum, license, GC). |
| `model_remove { id }` / `model_activate { id, role }` / `model_inspect { id }` | Lifecycle + license text for the acceptance prompt. |
| `hardware_probe` / `model_recommend { role }` | So the wizard can *explain* a recommendation using Core's `fit()` scoring rather than an app heuristic (§41). |

### End-state UX (once those land)

1. App works immediately (bundled runtime + fake model).
2. A "Set up a real model" step calls `hardware_probe` + `model_recommend` and
   shows a short list with size / license / "fits your machine".
3. Install → `model_install` → progress bar fed by events → `model_activate` on
   completion.
4. License text rendered from `model_inspect`; acceptance recorded by Core.
5. Weights land in `$VALYRIA_HOME/models/`, Core-owned. A release-gate test
   asserts that directory is byte-identical across an app upgrade (§38).

---

## 7. Build and release pipeline

`.github/workflows/release.yml` — one matrix job per target
(`aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`,
`x86_64-pc-windows-msvc`). Triggered by a `v*` tag or manual dispatch.

1. Checkout `valyria-app`; checkout `adikeshri/valyria` at `core_ref` (default
   `main`; `pinned` reads `core.lock.json`'s `git_rev`) into `core/`, record the
   resolved SHA. No submodule.
2. Toolchain `1.97.1` + the target (both repos pin it via `rust-toolchain.toml`).
3. `cargo build --release --locked --bin valyria --manifest-path core/Cargo.toml
   --target <triple>` → stage at `apps/desktop/src-tauri/binaries/valyria-<triple>`.
   *(Measured: 15 MB, macOS arm64, no inference runtime linked yet — see RI1.)*
4. Write `src-tauri/core-provenance.json` (`core_ref`, `core_sha`, target,
   toolchain, timestamp) — bundled as an app resource for the
   About/Compatibility surface.
5. `npm ci` in `apps/desktop`; `tauri-action` runs `tauri build --target <triple>
   --config src-tauri/tauri.release.conf.json`. The overlay adds
   `bundle.externalBin: ["binaries/valyria"]` + the provenance resource — kept
   out of `tauri.conf.json` so `tauri dev` needs no sidecar.
6. **Upload:** `tauri-action` drafts a GitHub Release on
   `adikeshri/valyria-app` and attaches `.dmg` / `.app.tar.gz`, `.deb` /
   `.AppImage`, `.msi` / `.exe`, with the Core SHA and signing status in the
   body. Manual builds with `publish=false` keep the installers as workflow
   artifacts instead. *(GitHub Releases is the default target; swap the final
   step for `aws s3 cp` / `wrangler r2` / a `gh release` to a dedicated repo if
   a CDN or separate download host is wanted.)*
7. macOS signing/notarization activates when the `APPLE_*` repo secrets exist;
   without them the builds are unsigned (Gatekeeper will warn — RI2).

Phase 8 wired the rest: the **120 MB bundle-size gate** is now a real
`release.yml` step (fails the release if any installer exceeds the PLAN §9
budget); the **fresh-install → `hello` → fake-model-task** proof-of-life and the
**`$VALYRIA_HOME/models/` byte-identical upgrade** check are documented,
scriptable release gates in [RELEASING.md](RELEASING.md) (a literal CI test needs
two installer versions; the model-store guarantee is already enforced by
`xtask check-layering` + D-INT-3).

---

## 8. Risks specific to this approach

| # | Risk | Mitigation |
|---|---|---|
| RI1 | The sidecar binary blows the 120 MB installer budget once a model runtime (llama.cpp / MLX) is statically linked into Core. | Measure a real Core build with the runtime linked *before* committing to a single bundled binary. Fallback: bundle `valyria serve` only; have Core fetch the inference engine as a second on-demand component on first `model_install`. Decision stays data-driven. |
| RI2 | Unsigned nested executable → macOS Gatekeeper blocks the whole app. | Signing identity configured in the release job; a gate asserts the bundled binary is signed. |
| RI3 | ~~App Rust toolchain older than Core's~~ | **Done.** Both repos pin `1.97.1` via `rust-toolchain.toml`; the release job installs that one toolchain for both builds. |
| RI4 | Windows: bundling the binary does not help — no Unix socket, no sandbox (G9). | Tier 3 (D14): installs, shows version/compat, refuses to start a session with the reason. Revisit when Core lands a named-pipe transport. |
| RI5 | The release job compiles ~40 Core crates per target (~70 s cached on an M-series; slower cold in CI). | `Swatinem/rust-cache` keyed on the resolved Core SHA + target. Acceptable for a release-only workflow. If it gets painful, split "build Core" into its own job that publishes the binary as an artifact, or consume a Core release artifact once Core publishes them. |

---

## 9. Decisions

**Locked:**

- **D-INT-1** — `valyria` ships as a bundled Tauri sidecar; supervisor
  resolution order is override → env → sidecar.
- **D-INT-2** — first release ships with the fake model; no download gates
  onboarding.
- **D-INT-3** — no model-download code path exists in the app.
- Core enters via three pinned inflows (§3): cargo git dep for the protocol
  crates, vendored copy for schemas/fixtures, release artifact (interim:
  submodule) for the binary.
- **npm workspaces**, not pnpm (PLAN §2's default). The repo already
  standardized on npm (`apps/desktop/package-lock.json`, `.claude/launch.json`);
  workspace semantics are equivalent for `packages/*`. Revisit only if a pnpm-
  specific need appears.
- The cargo git dep resolves against `9203d23…`, already reachable from
  `origin/main` — no submodule needed for the protocol crates. The submodule is
  introduced only when the release pipeline needs to build the binary, and is
  removed once Core publishes release artifacts.

**Increment 1 landed** (branch `integrate/core-bridge`): `core.lock.json`,
`rust-toolchain.toml`, the Cargo + npm workspace roots, `crates/valyria-bridge`
(workspace id + socket-path convention, Core-binary resolution, `hello`
handshake with protocol-major checking), `crates/xtask`
(`check-layering` / `check-protocol` / `verify-core`, all green, layering
violation verified to fail), `packages/protocol` (vendored schemas, TS codegen,
capability registry, tolerant event-decoder registry), `packages/state` (pure
reducer + store + selectors).

**Phase 1 landed** (PLAN Phase 1 — the milestone): `valyria-bridge` gained the
session supervisor (`spawn_or_adopt`: adopt a live daemon via pid-liveness +
`hello`, else spawn `valyria serve` and poll-connect with bounded backoff;
`Session::shutdown_daemon` = SIGKILL + reap), the typed `CoreClient` (one
timeout-bounded method per protocol call), and the `EventPump` (one held
subscription, ~16ms coalesced batches with `first_seq`/`last_seq`, contiguity
flag, reconnect-from-cursor — Core's `since` is exclusive). The Tauri host
(`src-tauri/src/bridge_host.rs`) exposes `session_open` / `task_*` /
`permission_resolve` commands and forwards the stream to the renderer as
`core://event-batch` events. **`tests/walking_skeleton.rs` passes against a
real `valyria serve`**: spawn → stream gapless to completion → drop the UI →
adopt the still-running daemon → resume from a mid cursor with an exact,
hole-free tail → SIGKILL the daemon → re-spawn → task rehydrated from the
journal. CI gains `rust` (fmt/clippy/test/gates) and `node`
(codegen-drift/typecheck/test/build) jobs.

**Phase 2 — task experience (complete)**. `apps/desktop` is an npm-workspace
member consuming `@valyria/protocol` + `@valyria/state`. The renderer spine:
`src/core/bridge.ts` (typed `invoke`/`listen`), `src/core/liveStore.ts` (a
zustand store folding `core://event-batch` through the pure reducer, plus
`task_list` hydration for objectives), `src/core/view.ts` (presentation
helpers), and `ConnectBar` (workspace root → spawn/adopt). Live-or-mock, every
panel falling back to `mock.ts` labeled "sample data":

- **Chat → `task_create`** (`LiveChatPanel`) — the conversation view is a
  projection of that task's events; the exact text sent is what the user typed
  (no local prompt assembly, §41).
- **Activity feed** (`LiveActivityFeed`) — the `activityLine` narrative;
  **never** surfaces `model_completed.text` / `tool_completed.rendered` (§10).
- **Timeline** — raw event inspector, expandable to decoded payload.
- **Task panel** (`LiveTaskPanel`) — objective / state / duration, plan from
  `task_plan`, modified files from `file_changed`, verification from
  `task_report` (NOT RUN when unbacked, §35), pause / resume / cancel.
- **Task history** (`LiveTaskHistory`) — `task_list` grouped Today / Yesterday
  / Earlier, reopenable.
- **Approvals** (`LiveApprovalCard`) — `approval_requested` payload, one at a
  time; "Allow for Task" disabled (G2).
- **Resume-on-launch** (`ResumePrompt`) — non-terminal tasks at session open
  get Resume / Inspect / Discard.

Decoders are tightened: `packages/protocol/src/events/registry.ts` has a
per-kind zod schema for all 21 kinds (permissive `.passthrough()`, so a renamed
field degrades rather than blanks). `schemas/event-kinds.txt` pins Core's kind
list; `xtask check-protocol` and `packages/protocol/test/decoders.test.ts`
(node:test + tsx) fail on drift or an undecoded kind — closing risk R1 / G12.
`packages/state/test/replay.test.ts` replays a real captured trace
(`fixtures/traces/add-a-function.jsonl`, from the `#[ignore] capture_trace`
bridge helper) — gapless, idempotent on resume, hole-detecting.

**Phase 3 — repository surfaces (complete)** via the local-read exception
(CORE-INTERFACE §3). `valyria-bridge`:

- `workspace_fs` — list dir / read file / **filename search**, all **scoped to
  the authorized root** (`resolve` rejects absolute paths, `..`, and symlink
  escape via `canonicalize` + containment re-check; the escape cases are
  unit-tested).
- `git` — status / diff / log / branch by shelling out, **read-only**; writes
  stay Core's (§17).
- `watcher` — a recursive `notify` watch, coalesced ~250ms in the bridge,
  emitting `core://fs-changed`; git-object churn is dropped. Unit test asserts a
  new file is reported within a second.

Host commands: `fs_list_dir` / `fs_read_file` / `fs_search` / `git_status` /
`git_log` / `git_diff` / `git_branch` / `task_status` / `task_plan` /
`task_report`, all `spawn_blocking`. Renderer: `src/core/repo.ts` wrappers, a
`ServedLocally` marker on every fallback surface, and `LiveFileTree`
(flatten + `@tanstack/react-virtual` windowing, lazy per-dir load, git-status
dots, filename search mode, live refresh on `core://fs-changed`), `LiveGitPanel`
(read-only, refreshes on fs change, writes disabled with the G3 reason),
`CodeViewerPanel` (`fs_read_file`, re-reads the open file when the watcher
reports it changed, binary + truncation handling). Layering check still green —
the new modules use `std` + `serde` + `notify` only.

**Phase 4 — changes and verification (complete)**. The projection
(`@valyria/state`) grew two pure slices — `files` (changed-file rail, folded
from `file_changed` + write/edit `tool_started`; **no ownership field** — G8)
and `tests` (per-command outcomes, latest event wins) — with selectors
`changedFilesForTask` / `testResultsForTask` / `checkpointsForTask`, all
replay-tested against a new `fixtures/traces/seeded-bug-fix.jsonl` (fail →
repair → pass, payload shapes mirrored from Core's `driver.rs`). Decoders for
`test_*` / `verification_evidence` tightened to Core's real VERIFY_RESULT
fields; the seeded-bug trace joins the `decoders.test.ts` corpus.

`valyria-bridge`: `CoreClient::task_rollback` → `TaskRollbackResponse` (result
reported verbatim; Core's refusal is a structured `BridgeError::Protocol`, not a
transport error — `tests/rollback.rs` against real Core), and `git.diff_file`
(covers a still-untracked new file via `git diff --no-index`) + `git.show`
(the "before" side at `HEAD`). Host: `task_rollback` / `git_diff_file` /
`git_show_head`.

Renderer live panels (each a dispatcher over the mock, per the Phase 2/3
pattern): `LiveDiffViewer` — CodeMirror 6 `unifiedMergeView` (D12), read-only,
intra-line highlighting, `goToNextChunk`/`goToPreviousChunk` navigation, a
changed-file rail from `git_status` with agent-touched paths marked (never
filtered), and a permanent **"ownership unavailable"** column (G8);
`LiveTestPanel` — passed / failed / running from the `tests` slice, each run
expandable to Core's `digest`, jump-to-file → diff; `LiveVerificationInspector`
— `task_report`'s `verified[]` / `unverified[]` verbatim, NOT RUN when empty, no
synthesizable "verified". Rollback UI lives in `LiveTaskPanel`: checkpoint
boundaries from `task_plan`, the per-step action **disabled with the G13 reason**
(no `checkpoint_id` on the wire), plus an advanced roll-back-by-id path that
exercises the full confirm → `task_rollback` → exact-result flow. New gap
**G13** filed. CodeMirror 6 added (`codemirror` + `@codemirror/merge` +
lang-javascript/python/rust); the layering check is unaffected (renderer-only).

**Phase 5 — approvals, security, autonomy (complete)**.

`valyria-bridge`: `CoreClient::{doctor_run, config_show}`; `SupervisorConfig`
gained `permission_mode` — passed as `valyria serve --permission-mode <mode>`,
recorded in `run/<id>/meta.json`, and **read back on adopt** so an adopted
session still knows its autonomy level (`hello` never carries it). `Session`
exposes `permission_mode` + `is_owned()`. `tests/autonomy.rs` proves the
spawn → record → adopt round-trip against real Core.

Host: `doctor_run` / `config_show` commands; `session_open` takes an optional
`permissionMode`; new `session_restart { permissionMode }` — rejected for an
**adopted** daemon (`[bridge.autonomy.not_owned]`), otherwise
`shutdown_daemon` + respawn (task state rebuilds from the journal). Added
`tauri-plugin-notification` + its capability.

`@valyria/state`: `blockedTasks` (tasks in `waiting_for_permission`) and the
pure **G2 supersession guard** `approvalIsCurrent(state, taskId, seenSeq)` —
`phase5.test.ts` covers both.

Renderer: `LiveApprovalCard` records the `approval.seq` it rendered; the store's
`resolveApproval(taskId, approve, seenSeq)` refuses to answer a superseded
prompt (returns `"superseded"`, the card re-prompts). Destructive / network
requests need a deliberate second confirm. New settings dispatchers —
`LiveAutonomyControl` (restart-to-apply, disabled while a task runs or the
daemon is adopted), `LiveSecurityOverview` (`doctor_run` + `config_show`,
every row Core-sourced or marked unreported — D8; notes the G10 socket
boundary), `LiveRepoInstructions` (`VALYRIA.md` / `AGENTS.md` read locally,
trust position labelled *per Core policy*, not Core-confirmed). OS notifications
(`core/notify.ts`, opt-in per category in `localStorage`, master switch in
`useApp`) fire on completed / failed / blocked / permission / tests-failed
transitions, computed by diffing the projection in `liveStore`. `session_open`
never yet passes a mode from the UI — the app opens at Core's default and the
switch restarts into a chosen one.

**Phase 6 — models, hardware, first run (complete)**.

`valyria-bridge`: `CoreClient::model_list`; new `config_writer` module — a
generic dotted-key TOML read-modify-write (`write_key`, `config_path`,
`ConfigScope`), atomic via temp-file + rename, siblings preserved,
`toml` + `std` only (layering unaffected). Host: `model_list`,
`workspace_status`, and `config_write { scope, key, value }` — edits the file
then returns a fresh `config_show` in one call (D13). `models_config.rs`
proves both against real Core: `model_list` decodes (empty on a clean box —
D-INT-3), and `write_key("log.format","json")` → `config_show` reports it with
`origin = "global"`; a nested `network.internet` write shows up in the policy
blob.

Renderer dispatchers (live when a session is open): `LiveModelsPanel` —
`model_list` inventory (id, family, quant, GiB, license, installed); install /
remove **disabled with the G5 reason**, "the app never downloads a model" note.
`LiveHardwarePanel` — `doctor_run` rows (disk / model store / sandbox) with
status + remediation, and an explicit **"Not reported by Core"** block for CPU /
memory / GPU / VRAM / accelerator naming G4; no recommendation. `LiveFirstRun` —
welcome → real `doctor_run` → open a repository → one harmless
`task_create("summarize the top-level modules")` watched live to completion →
"Runtime verified"; **no model-install step** (D-INT-2). `LiveConfigSettings`
in Settings → Agent — write-then-verify for `network.internet` and `log.format`,
each showing effective value + `origin`; the mock iteration/verification knobs
are hidden when live (G6 — no key). `Header` tells the truth when live: model
chip = sole installed model or "not reported", the RAM chip is dropped (G4),
"N approvals waiting" from `blockedTasks`. First run auto-opens once
(`localStorage` `valyria.seenFirstRun`). **Notifications** were delivered in
Phase 5.

**Phase 7 — terminal and parallel interaction (complete)**.

`valyria-bridge`: new `pty` module — `PtySession::start` opens `$SHELL` (login,
falling back zsh → bash → sh) at the authorized root, on a named OS thread with
an `AtomicBool` stop + `Drop`-join, mirroring `watcher`. A 256 KiB scrollback
ring (UTF-8-boundary-trimmed) is the terminal's source of truth so the shell
survives the dock unmounting the panel on every tab switch. `portable-pty` is
crate-level (`check-layering` is name-prefix only, unaffected); the crate keeps
`#![forbid(unsafe_code)]`. `BridgeError::{PtySpawn, PtyIo}` → `bridge.pty.*`.
Host: `pty_open { cols, rows }` (returns replayed scrollback; re-attaches a live
shell), `pty_write` / `pty_resize` / `pty_close`, output on new channels
`core://pty-output` (String) / `core://pty-exit` (Option<i32>); the `PtySession`
lives on `Live` so it dies with the session. `crates/valyria-bridge/tests/soak.rs`
(self-skips without a Core binary): while a real task runs, hammers
`fs.list_dir` / `git.status` / `fs.read_file` / `task_status` for 4s with a PTY
alongside, asserting every read cycle stays < 2s and the event stream still
reaches a terminal state gapless.

Renderer: `TerminalPanel` is now a dispatcher whose human/agent split is a real
`role="tablist"` with arrow-key roving focus — the one dock strip where
confusing the panes is a security problem (D7). `terminalSub` moved to the store
so the command palette's new "Show agent commands" can target it.
- `LiveTerminalPanel` (the **only** non-mock `@xterm/xterm` importer) — `pty_open`
  → write scrollback → `core://pty-output`; `term.onData` → `pty_write`; a
  measured-cell probe drives cols/rows (xterm's FitAddon is still on an xterm-5
  peer range); xterm colours re-read on a theme flip; **double-Esc** leaves for
  the tab strip without stealing a single Esc from vim. Unmount tears down xterm
  but **not** the shell.
- `LiveAgentCommands` — a plain list, never an xterm, from the new pure selector
  `agentCommandsForTask` (`@valyria/state`): pairs a shell `tool_started`
  (`run_command` / `bash` / `shell`, from the shared `SHELL_TOOL_NAMES`) with the
  next `tool_completed`, parses the `rendered` envelope tolerantly, keeps the raw
  blob on a parse miss, leaves an unpaired start `pending` (G14).
- `xtask check-d7` (fourth gate, in `xtask all`) — text-scans `apps/desktop/src`:
  `@xterm/xterm` only in the two allowlisted terminal files; `LiveAgentCommands`
  references no PTY plumbing. Fails the build the day someone merges the buffers.
- Cross-panel nav: `useApp.reveal({ path, line?, in?, reason? })` + `revealed`
  replace the ~8 duplicated `setSelectedFile(p); setDockTab("diff")` pairs (also
  fixing the mock file tree jumping to `chat` where the live one jumps to
  `code`). `LiveDiffViewer` scrolls to `revealed.line`. The test-failure hop is
  scoped to `seq <= run.seq` (per-run, not per-task) and labelled inferred (G15).

Decoder: `tool_started.input` tightened from `z.unknown()` to
`{ program?, args?, path? }.passthrough()` (union with `z.unknown()` so a
non-object `input` degrades rather than blanks); covered by the existing
`add-a-function.jsonl` seq-16 `run_command` pair, no new fixture. New gaps
**G14** (no tool-invocation id / structured result) and **G15** (no parsed
failure location) filed.

**Phase 8 — packaging, updates, compatibility (complete)**.

`valyria-bridge`: `BridgeError::PlatformUnsupported` → `bridge.platform.unsupported`;
`spawn_or_adopt` runs a `#[cfg]` `platform_precheck` first, so a non-unix host
refuses a session in milliseconds with a specific code instead of a 20-second
`StartupTimeout` (D14 / G9). Host: `about_info` command — app version
(`CARGO_PKG_VERSION`), `EXPECTED_PROTOCOL`, `os`/`arch`, `sessions_supported`
(`cfg!(unix)`), and the bundled `core-provenance.json` resource (`None` in
`tauri dev`). `lib.rs` registers `tauri-plugin-updater` + `tauri-plugin-process`;
`capabilities/default.json` gains `updater:default` / `process:default`.

`tauri.conf.json`: `plugins.updater` (endpoint = the GitHub Releases
`latest.json`, committed pubkey) + `bundle.createUpdaterArtifacts`. The updater
signing **private** key is a CI secret (`TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`),
added to `release.yml`'s `tauri-action` env — empty when unset, so tauri-action
just skips `latest.json`/`.sig` (same graceful degradation as the `APPLE_*`
path). `release.yml` also gained a **bundle-size gate** (< 120 MB per installer,
PLAN §9).

`@valyria/protocol`: `compatVerdict(expectedProtocol, negotiated)` — CORE-INTERFACE
§4's table as a pure function (`blocked` on protocol-major mismatch, `reduced`
for an older Core listing the absent capabilities, `ok` otherwise);
`packages/protocol/test/compat.test.ts` covers every row.

Renderer: new `route: "about"` + `AboutView` (the established overlay shell) —
app / platform / bundled-Core-provenance / connected-Core (runtime + protocol +
capability chips) / installed models / the verdict / a "Check for updates"
button (`core/updater.ts` → `check()` → `downloadAndInstall()` + `relaunch()`).
The `SettingsView` About stub becomes a link into it; `Header` gets an info
button; the command palette gets "About" + "Check for updates".
`liveStore.openWorkspace` now parses the `[code]` off a failed
`session_open` — `bridge.protocol.mismatch` / `bridge.platform.unsupported` set
`connection: "incompatible"` + a `blocker` and route to About, which renders the
hard-block / tier-3 banner. `"incompatible"` — a defined `ConnectionState` that
nothing set before — finally has a producer and consumer.

Docs: `SECURITY.md` (repo root; GitHub private vulnerability reporting; the
offline / no-model-download / local-read / socket-boundary / D7 guarantees) and
`docs/RELEASING.md` (the pipeline, required secrets, and the pre-release
checklist absorbing §7's three formerly-unwired gates). No new CORE-INTERFACE
gaps.

**Phase 9 — hardening (complete)**.

*Error presentation (§3 / §36).* New `apps/desktop/src/core/errors.ts`:
`ErrorPresentation` (four required fields — what happened, did the agent stop,
is action needed, what next), a `code`-keyed audit table for the ~20 real
`BridgeError` codes, and `present()` with a fallback that still names the code
and keeps the raw detail. `<ErrorState>` renders it (a `compact` inline
variant). Every raw `String(e)` / `{err}` render across ~14 `Live*` panels +
`ConnectBar` + `AboutView` now goes through it. `bridge_host.rs`'s two un-coded
`"no session is open"` strings gained the `[bridge.no_session]` prefix. New
`xtask check-error-strings` (in `xtask all`) bars raw error renders and banned
generics.

*Accessibility.* `core/useOverlayA11y` (focus-in, Tab-trap, Escape,
focus-restore) on every route overlay — Settings, About, First-run (+ mock),
command palette. `components/TabStrip` is now the single `role="tablist"`
implementation (roving tabindex + Arrow/Home/End); Dock, Center, RightRail and
the Terminal sub-tabs use it. `components/LiveRegion` — one polite `role=
"status"` announcing connection transitions and approval arrivals. The dead
"Reduced motion" setting is wired: `state/useReducedMotionEffect` +
`data-reduced-motion` CSS + a persisted `useApp` flag defaulting to the OS
preference. New `xtask check-a11y` holds the invariants (overlays trap focus,
one tab strip, every `<img>` has `alt`). Manual VoiceOver/NVDA + axe pass in new
`docs/ACCESSIBILITY.md`, run per release.

*Perf budgets (§9).* `flattenTree` extracted from `LiveFileTree` to
`core/tree.ts`; `countDiffLines` to `core/diffstat.ts`. New `apps/desktop`
node:test harness (`"test"` script + `tsconfig.test.json`) — `errors.test.ts`,
`tree.test.ts` (100k-node flatten < 50ms), `diffstat.test.ts` (10k-line diff
< 20ms). `packages/state/test/phase9.test.ts` — 50k-event fold clears
5,000 events/s, gapless. The frame-pacing and cold-start budgets stay manual
(RELEASING.md table + the bridge soak test).

*Release gates.* `deny.toml` + a `cargo-deny` CI job (advisories / licenses /
bans / sources; the unfixable Tauri/GTK3 transitive advisories are ignored by
id, with reasons). New `offline` CI job — warm the caches, cut outbound network
with `iptables`, then run `npm test` + `npm run build` + `cargo test --offline`
+ `xtask all` (§32; a from-scratch offline build is impossible and documented as
such). `RELEASING.md` gains the visual-regression + a11y manual steps and the
§9 budget table. No new CORE-INTERFACE gaps.

**Open:**

- **Single bundled binary vs. split runtime/engine** — resolved by RI1's
  measurement, not now.
- **When to switch the interim submodule to downloaded artifacts** — gated on a
  Core release workflow existing.
