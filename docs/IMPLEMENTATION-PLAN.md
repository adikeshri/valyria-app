# Valyria App — implementation plan (Code‑OSS fork)

The phase‑by‑phase build plan for turning valyria‑app into a **complete
VS Code‑class editor** (a branded Code‑OSS distribution) with the **Valyria
autonomous agent as a bundled built‑in extension**.

- Architecture & topology: [ARCHITECTURE-VSCODE.md](ARCHITECTURE-VSCODE.md)
- Core protocol, capability gaps (G1–G12), design decisions (D1–D14):
  [PLAN.md](PLAN.md), [CORE-INTERFACE.md](CORE-INTERFACE.md)
- The 21‑domain editor feature ledger (delivered by the Code‑OSS base, not by
  us): tracked separately; any gap becomes an upstream contribution or a
  `build/patches/` entry.

Each phase is a coherent increment that leaves the app in a working state. Do
them roughly in order; 3–6 parallelise once Phase 1 lands.

---

## Standing gates (every phase's exit criteria include these)

Lifted from PLAN.md §D10 and §3, applied to the extension + our webviews (the
Code‑OSS base already meets them):

1. **Keyboard reachable** — every action in a Valyria surface has a keyboard
   path; the command palette reaches all of them.
2. **Focus visible & trapped correctly** — modals and overlays trap focus and
   restore it; no keyboard traps.
3. **Theme correct** — light / dark / high‑contrast, driven by `--vscode-*`
   theme variables, never hard‑coded colour.
4. **Reduced motion** honoured (`workbench.reduceMotion`).
5. **`axe` clean** on every webview in CI.
6. **No new event decoder without a trace fixture** (D5); decoder‑coverage +
   capability‑coverage gates stay green.
7. **Layering green** — `cargo run -p xtask -- check-layering`:
   `valyria-bridge` → `valyria-protocol`/`valyria-types` only;
   `valyria-bridge-host` → `valyria-bridge` only.
8. **Errors answer §36's four questions** — what happened, did the agent stop,
   is user action needed, what next. No banned generic strings
   (`check-error-strings`).
9. **Offline** — no phase adds a network path the active Core runtime didn't
   report (§32).

## Cross‑cutting conventions

- **Rust** matches Core: `thiserror` per module, stable `code` strings,
  `tokio` multi‑thread, `tracing` spans carrying the protocol `seq`.
- **TypeScript** `strict` + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes`. No `any` outside the decoder boundary.
- **IDs / time** — Core's ULIDs pass through untouched; render relative time,
  sort on `seq`, never wall clock.
- **History is append‑only** in the store; a correction is a later event.
- **Determinism** — the reducer, selectors and formatters take injected `now`,
  so trace replay asserts exact rendered output.
- **Feature flags are capabilities** (D6), not build flags. One binary behaves
  correctly against several Core versions.

## Dependency graph

```text
0 ──► 1 ──┬─► 2 ──► 3 ──► 4 ──► 5
          │              ┌──────┘
          └─► 6 ◄────────┘
7 ─────────────────────────────► 8 ──► 9 ──► 10 ──► 11
        (7 needs only 0; 8 needs 5+6+7; 9 needs 8; 10 needs 9; 11 last)
```

---

## Phase 0 — Scaffold & bootstrap  ✅ **DONE**

**Goal:** a branded Code‑OSS window launches with the Valyria extension
activating (no Core connection yet).

**Done:**
- `vscode/` submodule pinned to `1.135.0` (`build/VSCODE_REF`), shallow.
- `build/product.overlay.json` + `scripts/merge-product.mjs` deep‑merge into
  `vscode/product.json` — verified: `nameLong: Valyria`, `dataFolderName:
  .valyria-editor`, `extensionsGallery` → Open VSX.
- `scripts/bootstrap.sh` / `install-deps.sh` / `dev.sh` / `build.sh` /
  `node-guard.sh`.
- **Node toolchain solved non‑invasively:** Code‑OSS 1.135.0 needs Node
  ≥ 24.18.0 (same major). `scripts/node-guard.sh` (sourced by every script)
  detects a too‑old default `node` and prepends a keg‑only Homebrew
  `node@24` (installed here at 24.20.0) without shadowing the user's global
  node. Fallback message points at nvm/fnm/volta.
- `extension/` — self‑contained (own `package-lock.json`, **not** a root npm
  workspace, so its `@types/vscode` can't collide with Code‑OSS's own
  `vscode.d.ts` during the gulp compile). `tsc` clean, compiles to `out/`.
  JSON‑RPC stdio client, bridge‑host child‑process lifecycle, supervisor +
  status bar, raw‑event‑feed webview, commands, `contributes` block.
- `crates/valyria-bridge-host/` — builds, `clippy`/`fmt` clean. Framing +
  `session/open` + event pump + ~35 methods mapped.
- `xtask check-layering` extended to cover `valyria-bridge-host`.
- Docs: `ARCHITECTURE-VSCODE.md`, `IMPLEMENTATION-PLAN.md`, README banner,
  PLAN.md marked superseded on app‑shell.

**Verified (2026‑09‑02):**
- `scripts/install-deps.sh` — `npm ci` in `vscode/` + its full `dirs.ts`
  postinstall (all `extensions/*`, `remote/*`, `test/*`) → RC 0.
- `npm run compile` in `vscode/` → `compile-src … 0 errors`, RC 0.
- `npm run electron` → `vscode/.build/electron/Valyria.app` (Electron 42.8.1,
  Node 24.18.1).
- `node build/lib/preLaunch.ts` → 3 built‑in `ms-vscode.js-debug*` extensions
  synced from **Open VSX**, RC 0.
- **Launch:** `./vscode/scripts/code.sh` → branded `Valyria.app` +
  `Valyria Helper*` processes; data dir `.valyria-editor`; ext‑host log
  `logs/…/exthost/valyria.valyria/Valyria.log` reads:
  `Valyria extension activating` → `spawning bridge-host: …/bin/valyria-bridge-host`
  (resolved through the built‑in symlink) → `Valyria extension activated` →
  `initial session/open failed: no Core binary found` — the intended Phase 1
  boundary, handled without a crash.

**Exit criterion — met.**

---

## Phase 1 — Session & event spine (walking skeleton)  ⭐  *(code complete; live cycle needs a Core binary)*

**Goal:** supervise a real Core daemon, stream its events into the extension,
survive a window kill, re‑attach. The milestone that de‑risks everything.

**Done (2026‑09‑02):**
- `valyria-bridge-host` — every method implemented, no stubs. `session/restart`
  (owned‑daemon check → `shutdown_daemon` → re‑open), `config/write`
  (`ConfigScope::parse` → `config_path` → `write_key` → re‑read `config_show`),
  `about/info` with a `compatibility` verdict, `search/query` with
  `modes`+`anchors`+`limit`, `git/diff` `staged`, `model/{recommend,activate}`
  `role`. No PTY.
- **Supervisor lifecycle** — `core/connectionState` emits all 7 states; a
  `supervise` task owns the pump, tracks the high‑water `last_seq`, and on
  `PumpMessage::Closed` runs `restart()`: bounded backoff
  (`[200,500,1000,2000,4000,8000]` ms) → `spawn_or_adopt` → swap
  session+client into `Live` in place (never aborts itself) → new
  `EventPump` from `last_seq` → `ready` + a `core/log` "Core restarted…"
  notice. All attempts exhausted → `failed`.
- **Extension `BridgeHost`** — auto‑respawn on unexpected exit with backoff,
  `intentionalStop` guard, `markHealthy()` resets the counter, `onRespawn`
  re‑wires the client stream and re‑opens the session from `store.lastSeq`.
- **Ext‑host `Store`** (`extension/src/store/store.ts`) — `vscode`‑free,
  wraps `@valyria/state`'s `applyBatch`/`setConnection`/selectors; contiguity
  check → `warn` on a gap; `reset()` for a fresh session; `activityLines()`
  via the `activityLine` selector.
- **esbuild** extension‑host bundle (`extension/esbuild.mjs`) — `@valyria/state`
  + `@valyria/protocol` + `zod` inlined into one CJS `out/extension.js`
  (157 kB). tsc is typecheck‑only (`moduleResolution: bundler`).
- **Activity view** renders `store.activityLines()` + the live connection
  state, themed with `--vscode-*`, `aria-live`, CSP+nonce.
- **Commands** — open workspace, new task, pause/resume/cancel (default to the
  store's current task), reconnect (resume from `store.lastSeq`), restart
  bridge, about.
- **Tests** — `crates/valyria-bridge-host/tests/rpc_smoke.rs` (6: framing,
  dispatch, error codes, boot notification) + `extension/test/store.test.ts`
  (9: trace replay of both `fixtures/traces/*.jsonl` — lastSeq/task tracking,
  drip‑vs‑batch convergence, crash‑recovery replay‑from‑0, idempotent resume
  overlap, gap detection). `xtask check-layering` green for both crates.
- **Launch verified** — branded window, extension activates, bridge‑host
  spawns, `core/connectionState` `starting`→`connecting` reaches the Store +
  Supervisor, clean shutdown; stops at `session/open: no Core binary` (the
  boundary).

**Remaining for the exit criterion:** a real `valyria` Core binary (the
`core.lock.json` rev) on `PATH`/`$VALYRIA_BIN` to run the live
create‑task → `kill -9` window → adopt → resume, and `kill -9` daemon →
`restart()` cycle. The adoption path itself is already covered by
`valyria-bridge`'s own integration tests against a real Core sidecar;
`valyria-bridge-host` is a thin wrapper over that code.

**Deliverables (original):**
- **Finish `valyria-bridge-host` — every method, no stubs:**
  - `session/restart` (autonomy restart, G1) — port `bridge_host.rs::session_restart`:
    refuse for an adopted daemon, `shutdown_daemon()`, re‑`spawn_or_adopt`.
  - `config/write` (TOML write‑then‑verify, D13/G6) — port `config_write`:
    resolve `config_path(scope, data_dir)`, `write_key`, re‑read `config_show`.
  - `workspace/status`, `core git_*` (status/diff+staged/log/branches),
    `search/query` with `modes` + `anchors` + `limit`, `index/status`,
    `index/build`, `hardware/probe`, `model/recommend(role)`,
    `model/activate(id, role)`, `model/inspect`, `ledger/changes`,
    `about/info` (with a compatibility verdict — CORE‑INTERFACE §4).
  - Drop all PTY methods — the integrated terminal is Code‑OSS's own now.
- **Supervisor lifecycle** surfaced as `core/connectionState` notifications
  covering all 7 states (`starting`, `connecting`, `ready`, `degraded`,
  `reconnecting`, `incompatible`, `failed`); bounded exponential backoff on
  reconnect; on `core/closed` with a task running → restart the daemon,
  re‑`hello`, re‑subscribe from `lastSeq`, emit a "Core restarted; state
  reloaded from journal" notice.
- **Extension `BridgeHost`** — respawn on crash with backoff; "the Core daemon
  keeps running" notice on host (not daemon) exit.
- **Capability registry (D6)** — populate from `hello`'s `capabilities[]`; a
  `has(cap)` the whole extension gates surfaces on.
- **Ext‑host event store** — `import { reducer, selectors } from
  "@valyria/state"`; feed it `core/eventBatch`; assert `seq` contiguity, on a
  gap re‑subscribe (not guess); crash recovery = replay from `seq 0`
  reproduces identical state. Unit‑tested against recorded traces with an
  injected clock.
- **Activity view** reads narrative rows from the store (still coarse; Phase 3
  makes it rich).
- **Commands** wired end‑to‑end: open workspace (explicit auth act), new task
  (`task_create`), pause/resume/cancel, reconnect, about.

**Blocked on Core:** none. (Autonomy restart is constrained by G1 but the
mechanism — daemon restart — is ours.)

**Exit:** against a real Core built from the `core.lock.json` rev + the fake
model + a fixture repo — create a task, watch events stream live in the
Activity view with no raw JSON crashes; `kill -9` the **editor window**,
relaunch, adopt the still‑running daemon, resume from `lastSeq` with **zero
missed or duplicated `seq`**, see the completed task. Then `kill -9` the
**daemon** mid‑task → the host restarts it, re‑hydrates from the journal, and
says so.

---

## Phase 2 — Webview runtime & design system  *(done; live visual check deferred to Phase 3)*

**Goal:** the shared infrastructure every agent surface is built on.

**Done (2026‑09‑02):**
- **Bundler** — `extension/esbuild.mjs` now builds two graphs: the CJS host
  entry, and one IIFE bundle per `src/webviews/<name>/main.ts`
  (`out/webviews/<name>.{js,css}`), plus `tokens.css` copied alongside.
  `npm run watch` watches both.
- **Design tokens** — `src/webviews/shared/tokens.css`: the Tauri panels' token
  *names* (`--bg-canvas`, `--text-primary`, `--accent`, `--own-agent`, …)
  resolved to `--vscode-*` theme variables, so webviews follow the editor's
  active theme (light / dark / any HC) with no media queries. Reduced‑motion
  honoured; base reset + `.visually-hidden` + `:focus-visible` ring.
- **Message protocol** — `src/webviews/shared/protocol.ts`: host→webview
  `{type:"state",view,model}` / `{type:"focus"}`; webview→host `{type:"ready"}`
  / `{type:"command",name,args}`. Per‑view model interfaces (`ActivityModel`).
- **Webview host helper** — `src/webviews/shared/host.ts`: `mountWebview` wraps
  `acquireVsCodeApi`, drives `getState`/`setState` persistence, posts `ready`,
  exposes `command`/`save`; `announce()` (aria‑live polite region), `el()`.
- **`WebviewBase`** (`src/views/webviewBase.ts`) — abstract `WebviewViewProvider`
  owning the security boundary (`localResourceRoots` + strict CSP + per‑resolve
  nonce, extracted to the vscode‑free `webviewHtml.ts` for testing), the
  `ready`/`command` message loop, and auto‑push on `wire()`d changes. Activity
  view re‑expressed as a 30‑line subclass; render logic moved to
  `src/webviews/activity/`.
- **Decoder layer** — the store already routes every event through
  `@valyria/protocol`'s `decodeEvent` (via `@valyria/state`); added
  `Store.degradedCount()` (`degradedEvents` selector) and surfaced it in the
  Activity model as an honest count, never hidden.
- **Capability registry (D6)** — `src/session/capabilities.ts`: `Capabilities`
  holds the live `hello` set and `resolve(surface)` /`snapshot()` against
  `@valyria/protocol`'s `SURFACE_REQUIREMENTS`. Owned by `Supervisor`
  (`supervisor.caps`), refreshed on every `session/open`, dumped by
  `valyria.showAbout`.
- **Tests — 26 total (+12):**
  `decoder-coverage.test.ts` (7): every kind in `fixtures/traces/*` is known
  and decodes; the store records zero degraded events.
  `capabilities.test.ts` (5): every surface resolves; the pinned Core lights
  all of them; an empty set gates exactly the capability‑bound ones to their
  fallback.
  `webview-html.test.ts` (5): `default-src 'none'`, the single `<script>` is
  nonce‑gated, styles/fonts limited to `cspSource`, every resource under
  `cspSource`.

**Deferred:** a live visual check of the rendered Activity webview (the harness
here can't drive the VS Code UI). Confirmed: extension activates with no CSP
errors and both bundles emit. The panels become interactive in Phase 3, where
the visual pass happens.

**Deliverables (original):**
- **Bundler** — esbuild config producing webview bundles from
  `extension/src/webviews/*` (one entry per view, or one app + a `view` param).
  `npm --prefix extension run watch` rebuilds webviews too.
- **Design tokens** — port `packages/ui` tokens to a webview stylesheet that
  maps every colour/spacing token onto `--vscode-*` theme variables; verified
  in light, dark, and both high‑contrast themes.
- **Message protocol** (typed, one module): `host → webview` `{type:"state",
  view, model}`; `webview → host` `{type:"ready"}` and `{type:"command",
  name, args}`. The webview holds no logic — it renders a view‑model and emits
  intents. All selectors run in the ext host.
- **Webview host helper** — CSP + nonce, `acquireVsCodeApi`, `getState`/
  `setState` persistence, focus management, an `aria-live` region, a
  reduced‑motion class, an `axe`‑clean baseline layout.
- **Decoder layer** — port `@valyria/protocol` zod decoders into the ext‑host
  store (D5): a failed decode yields `{kind, seq, ts, raw}`, never a throw;
  unknown `kind` → generic row.
- **Trace fixtures** — `fixtures/traces/*.jsonl` replayed through the store in
  a test asserting rendered view‑models byte‑for‑byte; **decoder‑coverage**
  gate (fail when Core emits a `kind` with no decoder) and
  **capability‑coverage** gate (fail when a surface needs a capability `hello`
  never advertises).

**Exit:** a sample webview renders themed and keyboard‑navigable, passes
`axe`, persists its scroll state across reload; a recorded trace replays to a
stable snapshot; removing a decoder fails CI.

---

## Phase 3 — Agent Chat, Task, Activity, Timeline, History  *(done; live visual pass still pending a Core binary)*

**Goal:** a fake‑model task is legible end‑to‑end with no raw JSON on the
happy path. Port the `Live*` panels from `apps/desktop/src/panels/`.

**Done (2026‑09‑02):**
- **View‑model builders** — `extension/src/store/models.ts`: pure
  `(StoreState, focusedTaskId, connection)` → `ChatModel` / `TaskModel` /
  `TimelineModel` / `HistoryModel`, all assembled from `@valyria/state`
  selectors (`eventsForTask`, `planFor`, `changedFilesForTask`,
  `testResultsForTask`, `checkpointsForTask`, `pendingApprovalFor`,
  `timelineRows`, `tasksByRecency`, `activityLine`). No `vscode`, no clock.
- **`valyria.chat`** — composer (`Cmd/Ctrl‑Enter` or button → `createTask`),
  disabled unless Core is ready and nothing is in flight; transcript = a
  curated projection of the focused task's events via `activityLine` (objective
  leads as the "you" turn when Core sends one); `working` / `blocked` /
  `completed` / `failed` status pill.
- **`valyria.task`** — objective + state badge, a surfaced pending approval
  (prompt / tool / risk), the plan with per‑step status + `checkpoint`
  markers, changed‑file rail, verification list (`NOT RUN` when empty — D8),
  agent‑command count, and Pause/Resume/Cancel while non‑terminal.
- **`valyria.activity`** — already narrative from Phase 2; now on the shared
  runtime, oldest→newest, with the honest degraded‑event count.
- **`valyria.timeline`** — every event newest‑first, each a `<details>` row
  expanding to the decoded payload as pretty JSON; degraded rows tagged `raw`;
  open rows persisted via `setState`.
- **`valyria.history`** — `tasksByRecency` grouped by ISO day; a row click
  posts `focusTask`, which pins `TaskFocus` and re‑models every panel.
- **`TaskFocus`** (`src/session/focus.ts`) — the pinned‑vs‑most‑recent task the
  panels show; cleared on a fresh session.
- **`makeWebviewDispatch`** (`src/views/dispatch.ts`) — the single place
  webview intents (`createTask` / `pause|resume|cancelTask` / `focusTask` /
  `resolveApproval`) become bridge calls.
- **Resume‑on‑launch** (`src/session/resume.ts`) — once events have hydrated a
  fresh session, `activeTasks()` non‑empty → a Resume / Inspect / Discard
  prompt; Inspect pins the task and reveals the Task view; Discard confirms
  then `task/cancel`. Fires once per session.
- **Shared render toolkit** — `src/webviews/shared/render.ts` (`h`, `section`,
  `badge`, `empty`, `connBanner`, `stateLabel`) + `.vy-*` component styles
  appended to `tokens.css`. Two more collapsed views (`timeline`, `history`)
  added to `package.json`.
- **Tests — 43 total (+17):**
  `models.test.ts` (12): trace replay → objective leads the transcript, no
  `{}`/`"payload"` in any transcript line, `terminal` at trace end,
  `timelineModel.rows.length === events.length` with valid‑JSON `raw`,
  history lists the task; synthetic `waiting_for_permission` → `blocked` not
  `working`; unknown focus pin falls back to current.
  `webview-render.test.ts` (5): each built bundle loaded into **jsdom** with a
  stubbed `acquireVsCodeApi` — `#root` gets the expected text, no
  `[object Object]`, `history` row click posts `focusTask`, timeline rows are
  expandable. This is the CI stand‑in for the visual pass.

**Deferred:** the live visual pass in the real VS Code webview (needs a Core
binary to produce a task, and UI access the harness here doesn't have). jsdom
render tests + clean activation cover the mechanics.

**Deliverables (original):**
- **`valyria.chat`** (port `LiveChatPanel`) — task entry → `task_create`;
  conversation view = projection of that task's events; a "working" / "blocked"
  indicator; context attachments appended to the objective as a visible,
  inspectable preamble (no local prompt assembly — §41).
- **`valyria.task`** (port `LiveTaskPanel` + `TaskDetailPanel`) — objective,
  state, plan (`task_plan`) with checkpoints & rollback boundaries, modified
  files with ownership badges, actions, verification summary, permissions,
  duration, model.
- **`valyria.activity`** (port `LiveActivityFeed`) — human narrative
  ("Editing auth/service.py", "2 tests failed") from
  `tool_started/completed`, `file_changed`, `test_*`, `state_changed`. **No
  model reasoning text** (§10).
- **`valyria.timeline`** (port `TimelinePanel`) — every event, timestamped,
  expandable to decoded payload + raw JSON. Command‑opened webview panel.
- **History** (port `LiveTaskHistory`) — `task_list` grouped by day; each entry
  reopens into a full task view rebuilt from `task_status` + `task_report` +
  `task_plan` + replayed events.
- **Resume‑on‑launch** — any task in a non‑terminal state (incl.
  `WAITING_FOR_PERMISSION`, using `paused_from` / `recovery_note`) → a
  Resume / Inspect / Discard prompt (`task_resume` / `task_cancel`).

**Blocked on Core:** structured context on `task_create` (until then, preamble
text).

**Exit:** a full fake‑model task is legible from chat to completion with no raw
JSON on the happy path; trace replay reproduces the rendered timeline
byte‑for‑byte; every non‑terminal task state produces the correct resume
prompt.

---

## Phase 4 — Approvals, autonomy, security overview  *(done)*

**Goal:** a manual‑mode task blocks on every mutating action, each approvable
and deniable, with honest risk treatment.

**Done (2026‑09‑02):**
- `valyria.approvals` — one pending ask at a time (`pendingApprovalFor`), card
  shows `prompt` / `tool` / `category` / `target` / `risk`; `destructive` /
  `network` / `elevated` get high‑risk styling and a two‑step Allow
  (arm → "Confirm — allow this"). `Allow for task` shown only when Core
  advertises `approval_scope`, otherwise an honest "needs capability" line.
- **G2 supersession** — the decision carries the approval's `seq`;
  `dispatch` refuses to resolve when `approvalIsCurrent(state, taskId, seq)` is
  false and tells the user to review again. Resolve routes through
  `permission/resolveScoped` (once|task) when `approval_scope` is present, else
  `permission/resolve`.
- **Notification** (`session/notify.ts`) — a new pending approval raises a
  toast (warning for high‑risk) with Allow once / Deny / Review, gated on the
  `valyria.notifications.categories` setting; Review reveals the Approvals view.
- `valyria.security` — autonomy radios (`manual`/`assisted`/`autonomous`),
  `canChange` only when we own the daemon and no task is active, with the
  reason spelled out; changing it calls `session/restart`. Policy list from
  `config_show` — a key Core doesn't return renders "not reported", never an
  invented checkmark (D8). Environment checks filtered from `doctor_run` to
  sandbox / permission / network names, with remediation. Repository
  instructions: `VALYRIA.md` / `AGENTS.md` (root = "authorized"), read via
  `vscode.workspace.fs`.
- **Tests — 50 total (+7):** `phase4.test.ts` — pending destructive approval
  with metadata; approval clears when the task moves on; G2 stale‑seq guard;
  autonomy `canChange` matrix; unreported keys stay unreported (D8); render
  smoke: destructive prompt needs the second click, autonomy radios post
  `setAutonomy`.

**Deliverables (original):**
- **`valyria.approvals`** (port `LiveApprovalCard` / `ApprovalCard`) —
  modal‑but‑non‑blocking, driven by `approval_requested` payloads (`prompt`,
  `tool`, `category`, `target`, `risk`). Risk drives visual treatment;
  destructive and network operations require a deliberate second interaction.
- **Supersession (G2)** — one approval at a time per task; refuse to resolve a
  prompt a newer `approval_requested` superseded — re‑prompt instead.
  `Allow for Task` is capability‑gated and absent until Core supports it.
- A pending approval raises an OS notification and marks the task **blocked**,
  not "working".
- **Autonomy control** (port `LiveAutonomyControl`) — the mode is a
  daemon‑start parameter (G1), so the switch calls `session/restart` and is
  disabled while a task runs, with that stated inline. Each level's meaning is
  spelled out from Core's own documented semantics.
- **Security overview** (port `LiveSecurityOverview`) — rendered from
  `config_show` + `doctor_run`'s `sandbox` / `permission_config` checks;
  states which lines Core enforces and which are unreported. No checkmark that
  can't be sourced from Core (D8).
- **Repo instructions** (port `LiveRepoInstructions`) — `VALYRIA.md` /
  `AGENTS.md` with the authorized‑vs‑ordinary distinction.

**Blocked on Core:** `Allow for Task` scope (G2).

**Exit:** manual‑mode task blocks on every mutating action, each approvable and
deniable; a superseded prompt re‑prompts rather than mis‑resolving; the
security overview contains no claim not sourced from Core.

---

## Phase 5 — Editor‑integrated agent surfaces  *(done)*

**Goal:** the agent's work shows up *in the editor* — diff ownership,
verification, agent commands beside the terminal, cross‑navigation — without
the extension re‑implementing anything Code‑OSS already does.

**Done (2026‑09‑02):**
- **Change ownership (G8)** — `views/ownership.ts`: a
  `FileDecorationProvider` badging `agent_authored` (`A`, purple) and
  `concurrent_user_modification` (`!`, warning) from `ledger/changes` for the
  focused task. `available` is false when Core lacks the `ledger` capability —
  then **no decorations and no guessing** (D7/D8). Refreshes on focus change.
- **`valyria.verification`** (D8) — `views/verification.ts` fetches
  `task/report` per focused task (cached), renders `verified[]` (kind /
  command / outcome / run_id) and `unverified[]` (each `NOT RUN`) verbatim.
  No code path produces a generic "verified" state; "no report yet" until the
  RPC answers, with a retry.
- **`valyria.commands`** (D7) — `views/agentCommands.ts` +
  `agentCommandsModel`: read‑only projection of shell commands from
  `tool_started` / `tool_completed` (`agentCommandsForTask`), each row badged
  `agent`, expandable to output. Never touches the integrated terminal.
- **Rollback (§16 / G13)** — `taskModel` threads `checkpoint_id` from
  `plan_checkpoint` events; a checkpoint is `rollbackReady` only with the id
  **and** the `diagnostics_v2` capability **and** a non‑terminal task. The Task
  view shows a "Roll back to here" button → a modal confirm → `task/rollback`,
  then reports `reverted_entries` / `restored_files` exactly. Boundaries with
  no id show disabled with the reason.
- **Cross‑navigation** — test failures carry `location[]` (`parseFailures`);
  the Task view renders `path:line` links that post `openFile`, and `dispatch`
  opens the file at the line. Changed‑file paths are openable too.
- **Bug fix** — the `npm test` glob (`test/**` → `test/*`) was recursing into
  the symlinked `node_modules/@valyria/state/test/` and running that package's
  suite instead of the extension's.
- **Tests — 58 total (+8):** `phase5.test.ts` — verificationModel verbatim /
  NOT RUN, agentCommandsModel pairing + output, `rollbackReady` gated on the
  capability, failure `location` → `path:line`; render smoke: verification
  claims + NOT RUN, agent‑commands `agent` badge + no posted commands, Task
  "Roll back to here" posts `rollbackTo`.

**Deliverables (original):**
- **Change ownership (G8)** — a `FileDecorationProvider` for explorer badges +
  editor gutter decorations, sourced from `ledger_changes`. When the `ledger`
  capability is absent, the decoration is explicitly "unavailable" — **never
  guessed** from file‑touch events (D7/D8).
- **`valyria.verification`** (port `LiveVerificationInspector`) —
  `task_report`'s `verified[]` / `unverified[]` verbatim: command, kind,
  outcome, `run_id`. No evidence → **NOT RUN**. There is no code path to a
  generic "verified" badge.
- **Agent‑command view** (port `LiveAgentCommands`) — read‑only, rendered from
  `tool_started` / `tool_completed`, shown beside the integrated terminal,
  unmistakably badged. **Never shares the terminal's buffer** (D7). CI's
  `check-d7` guards this.
- **Test results** (port `LiveTestPanel` essentials) — the agent's `test_*`
  events + `verification_evidence`, each failure opening its output, parsed
  location, and a jump to the file + the relevant diff. (Distinct from the
  editor's own Test Explorer, which covers the human's runs.)
- **Rollback** — `task_rollback { task_id, checkpoint_id }` from `task_plan`
  checkpoints; the confirmation shows what Core will restore; the result
  (`restored_files`, `reverted_entries`) is reported exactly. No partial‑hunk
  revert without the ledger.
- **Diff/merge** — use the editor's native diff and 3‑way merge; layer only
  the ownership decorations on top.
- **Cross‑panel navigation** — failure → file → diff → change, all via
  `vscode.window.showTextDocument` + reveal ranges.

**Blocked on Core:** ownership needs the `ledger` capability (G8); structured
diagnostics for failure locations depend on `diagnostics_v2`.

**Exit:** a seeded‑bug fixture task produces a reviewable diff with ownership
decorations; rollback restores exactly what Core reports and leaves an
unrelated user edit untouched; agent and human command output are never in the
same buffer.

---

## Phase 6 — Models, hardware, first‑run, settings, context  *(done)*

**Goal:** a clean machine reaches "Ready" and completes a harmless task
without the user learning what a model server is.

**Done (2026‑09‑02):**
- **`valyria.models`** — inventory from `model/list` (id, family, quant, size,
  license, installed; `active` derived from a `model.*` config binding).
  Install / remove / activate call Core and are shown only with the
  `model_manage` capability (G5); a modal confirm precedes each. A prominent
  "Valyria never downloads model weights — Core does" line, and a render test
  asserts no `http(s)://` in the DOM (§20/§38).
- **`valyria.hardware`** — from `hardware/probe`; a field Core returns as
  `None` renders "not probed" (distinct from a probed `false`). Recommendation
  from `model/recommend` when `hardware` is advertised (G4); otherwise the view
  says Core doesn't score fit yet and points at the RAM figures.
- **`valyria.settings`** — `config/show` grouped into Agent / Models / Security
  / Repository / Application by key prefix, each row value **+ origin badge**.
  An edit → `config/write` (workspace scope, TOML) → the response *is* a fresh
  `config_show`, so the effective value is rendered; a policy adjustment is
  surfaced. The provider refuses to write a key Core didn't report (D13).
- **`valyria.context`** — ships disabled: "Core does not emit
  `context_retrieved` yet (G7)"; built so it lights up automatically —
  trace‑tested against a synthetic `context_retrieved` event.
- **`valyria.firstrun`** — a webview view gated on the `valyria.showFirstRun`
  context key (set from `globalState`): explains local inference, opens a
  repository, runs one fixed read‑only probe task, and marks itself seen on
  completion.
- **Offline marker** — `StatusBar` gains a second item:
  `$(shield) Local · Offline · Model: <id>`, or `$(globe) Network runtime`
  when `doctor_run` actually reports one — observed state, not a constant (§32).
- **Notifications** (`session/notify.ts`, renamed `watchNotifications`) — adds
  `completed` (task terminal) and `tests_failed` (`test_failed` events) on top
  of the Phase‑4 approval toast, all gated on
  `valyria.notifications.categories`.
- **Tests — 65 total (+7):** `phase6.test.ts` — active‑model derivation +
  manage gating, `None`→null hardware fields + G4 gating, settings grouping /
  single‑appearance / known‑keys, context G7 disabled vs lit; render smoke:
  models "never downloads" note + no URLs, context names G7, settings edit
  posts `writeConfig`.

**Deliverables (original):**
- **Model Manager** (port `LiveModelsPanel`) — inventory: id, family,
  quantization, size, license, installed, active. Install / remove / activate
  gated on the `model_manage` capability (G5). **No download path exists in the
  extension** for weights (§20/§38) — a CI test asserts it.
- **Hardware view** (port `LiveHardwarePanel`) — from `hardware_probe` /
  `doctor_run`, unreported fields explicitly marked. The **recommendation** is
  gated on Core's `fit()` scoring (G4); until then the UI lists and asks, it
  does not recommend.
- **First‑run** (port `FirstRunView` + `LiveFirstRun`) — a `walkthroughs`
  contribution + a webview: explain local inference, show what Core reports,
  open a repository (the explicit authorization act), run a harmless read‑only
  task to prove the stack end to end.
- **Settings** (port `LiveConfigSettings` / `SettingsView`) — render
  `config_show` grouped into the PRD's five sections, each showing **value and
  origin**. Writes go through `config/write` (TOML) then immediately re‑read
  `config_show` and render the **effective** value with its `origin` (D13). A
  key Core doesn't report is never written. A setting we can't confirm shows as
  pending.
- **`valyria.context`** (port `LiveContextInspector`) — ships **disabled with
  an explanation**: Core emits no `context_retrieved` today (G7). Built and
  trace‑tested against a synthetic fixture so it lights up on the first Core
  release that emits the event.
- **Offline indicator** — permanent, specific: `Local · Offline · Model:
  <active>`, reflecting observed state (changes if Core reports a
  network‑capable runtime).
- **Notifications** — local OS only, opt‑in per category (completed, blocked,
  permission required, tests failed, waiting). No push infrastructure.

**Blocked on Core:** model recommendation + its explanation (G4);
install/remove/activate + the hardware probe (G5); context provenance (G7).

**Exit:** a clean machine reaches "Ready" and completes a harmless task with no
model‑server jargon; no code path can initiate a model download; every setting
shows its origin and reflects Core's resolved value after a write.

---

## Phase 7 — Branding & de‑Microsoft completeness

**Goal:** the product is unmistakably Valyria and phones home to nothing.
*(Depends only on Phase 0; can run in parallel with 1–6.)*

**Deliverables:**
- Complete `build/product.overlay.json` — every branding field; `build/icons/`
  per platform (`.icns`, `.ico`, PNG set) copied in by `bootstrap.sh`; URL
  protocol `valyria://`; bundle identifiers; About box strings.
- Open VSX gallery wired and smoke‑tested (search, install, update); Microsoft
  Marketplace URLs removed.
- Telemetry / crash‑reporter / `aiConfig` / MS‑internal‑domain fields cleared;
  `reportIssueUrl` → our repo; update feed empty until Phase 8.
- Branded Welcome page + walkthroughs; branded release‑notes renderer.
- **Offline guarantee** — a fresh launch on a network‑disabled machine makes
  zero outbound connections (no update check, no gallery ping, no telemetry
  endpoint resolvable).
- `build/patches/` minimised — anything achievable via the extension API is
  moved there; each remaining patch is small and documented in
  `build/patches/README.md`.

**Exit:** fresh launch, network disabled → zero outbound connections; branding
consistent across window title, About, dock/taskbar, installer name;
`bootstrap.sh` on a clean checkout yields the branded tree with N patches, N
small and documented.

---

## Phase 8 — Packaging, sidecar, updates, compatibility

**Goal:** signed installers on three OSes, each carrying the bridge‑host and
Core sidecars.

**Deliverables:**
- `scripts/build.sh` → real per‑OS gulp targets:
  `vscode-darwin-{arm64,x64,universal}-min`, `vscode-win32-{x64,arm64}`,
  `vscode-linux-{x64,arm64}-{deb,rpm}` + AppImage / Snap.
- `valyria-bridge-host` built per target triple, placed in the packaged
  resources dir where `BridgeHost.resolveBinary()` looks.
- `valyria` Core binary bundled per triple from the `core.lock.json` rev
  (Tauri `externalBin` analogue), with a `valyria.core.binaryPath` override
  for developers.
- Code signing + notarization (macOS), signed MSI/exe + winget manifest
  (Windows), Linux repo metadata.
- **Updater** — Code‑OSS's update mechanism pointed at our release feed. Core
  updates ship **only** with an app update; release notes name the Core rev;
  a release‑gate test asserts the model store is byte‑identical across an
  upgrade (§38).
- **About / Compatibility surface** — app version, Core runtime version,
  protocol version, negotiated capabilities, installed model versions, and the
  compatibility verdict (CORE‑INTERFACE §4).
- **Windows tier 3 (G9)** — the installer launches, shows version + compat
  info, and refuses to start a session with a specific reason and a link.

**Exit:** signed installers on three OSes from CI; a major protocol mismatch
hard‑blocks with a specific message; an app upgrade leaves the model store
byte‑identical; the Windows build launches and explains itself.

---

## Phase 9 — CI, gates, integration, offline job

**Goal:** every invariant in this document is machine‑checked.

**Deliverables:**
- **Static** — `cargo fmt` / `clippy -D warnings`, `xtask all` (layering,
  check‑protocol, verify‑core, check‑d7, check‑error‑strings, check‑a11y),
  `tsc --noEmit`, ESLint, `cargo-deny`.
- **Unit + replay** — ext‑host store units, selector units, decoder units;
  `fixtures/traces/*` replayed with an injected clock; decoder‑coverage +
  capability‑coverage gates.
- **Integration** — real Core sidecar + fake model + fixture git repos: full
  lifecycle including kill/resume, approval flows, rollback, daemon adoption.
- **E2E** — `@vscode/test-electron` (or Playwright‑Electron) over the packaged
  app: first run, open repo, submit task, approve, review diff, roll back.
- **Offline job** — the whole integration suite with networking disabled
  (§32 as a property, not a claim).
- **Visual regression** — per‑platform screenshots of every webview in light /
  dark / high‑contrast (WebView rendering is platform‑variable — D11).
- **Perf** — scripted load: 50k‑event stream through the store, webview render
  under burst; the 100k‑file tree and 10k‑line diff are Code‑OSS's own budgets
  but re‑measured in our shell. Targets from PLAN.md §9.
- **3‑OS installer build** in CI.

**Exit:** all gates green on three OSes; the offline job passes; a deliberate
schema drift, a layering violation, a missing decoder, and a banned error
string each fail the build.

---

## Phase 10 — Retire Tauri & consolidate docs

**Goal:** one product, one architecture, no dead code.

**Deliverables:**
- Delete `apps/desktop/` (renderer + `src-tauri`); drop
  `apps/desktop/src-tauri` from `Cargo.toml` `members`; remove Tauri
  dependencies from the workspace.
- `@valyria/state` and `@valyria/protocol` keep only the extension as a
  consumer; prune Tauri‑era exports.
- Any still‑referenced shapes from `apps/desktop/src/data/mock.ts` move into
  `fixtures/`.
- Rewrite the top‑level README for the Code‑OSS product; retire PLAN.md's
  app‑shell sections (keep Core / protocol / D‑decisions), make
  `ARCHITECTURE-VSCODE.md` the primary architecture doc.
- Update `docs/INTEGRATION.md`, `docs/RELEASING.md`, `docs/ACCESSIBILITY.md`
  for the new shape.
- `npm run typecheck` / `cargo check --workspace` with no `apps/` present.

**Exit:** `apps/` is gone, the workspace builds with no Tauri, every doc
describes the Code‑OSS product, no dead references remain.

---

## Phase 11 — Hardening & first release

**Goal:** ship it.

**Deliverables:**
- **Accessibility audit** — automated `axe` + a manual screen‑reader pass
  (VoiceOver + NVDA) on every webview and the first‑run flow; a keyboard‑only
  traversal test asserting every interactive element is reachable and focus is
  never trapped.
- **Error‑presentation audit** — every extension‑surfaced error answers §36's
  four questions; a grep for banned generic strings returns nothing.
- **Security review** — the extension‑host boundary, webview CSP, secret
  storage, and the guarantee of no unsanctioned network.
- **Soak** — a long‑running task with every read‑only surface exercised stays
  responsive; the event store doesn't leak.
- **Release** — tag; signed installers for three OSes; publish the extension to
  Open VSX if it's also distributed standalone; release notes naming the Core
  rev and the negotiated protocol version.

**Exit:** PLAN.md §9 budgets met; a11y clean (automated + manual); no banned
error strings; the offline CI job is green; signed release artifacts are
published.

---

## Capability‑gap → phase map (CORE‑INTERFACE §2)

| Gap | What it blocks | Phase | Behaviour until Core ships it |
|---|---|---|---|
| G1 | autonomy level change without daemon restart | 4 | switch restarts the daemon, disabled during a task |
| G2 | approval request id / `Allow for Task` scope | 4 | one prompt at a time; re‑prompt on supersession; no "for task" |
| G3 | repo read / search / git as Core surfaces | 1, 5 | Core's `git_*` + `search_query` used where present; editor's own otherwise |
| G4 | model recommendation via `fit()` | 6 | list & ask; no recommendation |
| G5 | model install / remove / activate | 6 | inventory only; lifecycle buttons disabled with reason |
| G7 | `context_retrieved` event | 6 | Context Inspector disabled with an explanation |
| G8 | ledger / change ownership | 5 | ownership decorations marked "unavailable" |
| G9 | Windows sandbox | 8 | Windows tier 3 — launches, explains, refuses a session |

---

## Current state

**Phase 0 is complete and verified** — `scripts/bootstrap.sh` →
`scripts/install-deps.sh` → `scripts/dev.sh` launches a branded **Valyria**
window with the built‑in extension active. Phase 1 (the session & event spine)
is the next work and the one that proves the whole architecture.

Toolchain note for contributors: the machine's default Homebrew `node` may be
too old (or, as seen here, broken by a `simdjson` dylib bump — `brew reinstall
node` fixes that). `scripts/node-guard.sh` sidesteps it by using a keg‑only
`node@24`; `brew install node@24` is the one‑time setup.
