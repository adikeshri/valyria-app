# The Core interface: what v1 gives us, and what it doesn't

`valyria-app` is a **protocol client**. This document is the ground truth for what
that protocol actually offers today, measured against the Core tree at
`../valyria` (protocol `1.0.0`, Phase 11), and what the app needs that Core does
not yet serve.

It exists because the PRD describes a product surface substantially wider than
the frozen v1 wire contract. Every gap below is a decision point: either Core
grows the method (preferred — §41 forbids us reimplementing Core logic), or the
app degrades honestly and says so in the UI.

**This document describes changes we would *request* of `valyria`. Nothing here
is a change we make to that repository.**

---

## Status — all 15 gaps closed (protocol 1.9.0)

Core shipped G1–G15 across protocol `1.1.0`–`1.9.0` (ten stacked PRs). Sections
1–2 below are kept as written against `1.0.0` for the record; each gap heading
now carries the version that closed it and the app-side integration is
summarised in `docs/INTEGRATION.md` → **Phase 10**. Two items remain, all
Core-blocked: an inference runtime linked into the `valyria` bin (RI1), signed
per-triple Core release artifacts, and a Windows access sandbox (Job Objects) —
the Windows *transport* landed in `1.9.0`, only the sandbox is deferred.

| Gap | Closed in | Gap | Closed in |
|---|---|---|---|
| G1 per-task autonomy | 1.1.0 | G9 Windows transport | 1.9.0 |
| G2 approval identity/scope | 1.8.0 | G10 client auth | 1.6.0 |
| G3 repo read surface | 1.2.0 | G11 stream filter | 1.7.0 |
| G4 hardware probe | 1.3.0 | G12 event payload contracts | 1.7.1 |
| G5 model management | 1.3.0 | G13 checkpoint id discovery | 1.5.0 |
| G6 config write | 1.1.0 | G14 structured tool result | 1.5.0 |
| G7 context provenance | 1.4.0 | G15 parsed failure location | 1.5.0 |
| G8 change ownership | 1.4.0 | | |

---

## 1. What v1 actually is

### Transport

- Newline-delimited JSON over a **Unix domain socket**
  (`valyria_protocol::transport`, `valyria_app::daemon::serve`).
- Two frame types up: `ClientFrame::Call(Request)` and
  `ClientFrame::Subscribe { since }`. Two down: `ServerFrame::Response` and
  `ServerFrame::Event`.
- A `Call` connection is **short-lived**: one request, one response, close. A
  `Subscribe` connection is held open for the life of the stream.
- **No authentication.** Confinement is filesystem permissions on the socket
  path. The socket path is entirely caller-supplied (`valyria serve --socket
  <path>`); Core defines no location convention.
- One `Runtime` is bound to **one workspace** at construction
  (`RuntimeConfig { workspace_path, data_dir, permission_mode, global_dir, .. }`).
  There is no multi-workspace daemon; `workspace_status` takes no parameters.

### Methods (19)

| Method | Params | Returns | Serves PRD |
|---|---|---|---|
| `hello` | `client_name` | `protocol_version`, `runtime_version`, `capabilities[]` | §40, §43 |
| `task_create` | `objective` | `task_id` | §8 |
| `task_status` | `task_id` | `state`, `objective`, `paused_from`, `recovery_note` | §11, §29 |
| `task_list` | — | `TaskSummary[]` (`task_id`, `objective`, `state`, `created_at_ms`, `updated_at_ms`) | §28 |
| `task_report` | `task_id` | `status`, `verified[]`, `unverified[]` | §35 |
| `task_plan` | `task_id` | `revision`, `content_hash`, `PlanStepSummary[]` | §11 |
| `task_rollback` | `task_id`, `checkpoint_id` | `restored_files`, `reverted_entries` | §16 |
| `task_pause` / `task_resume` / `task_cancel` | `task_id` | ack | §44, §48.12 |
| `permission_resolve` | `task_id`, `approve` | ack | §13 |
| `events_subscribe` | `since` | event stream | §10, §12, §30 |
| `workspace_status` | — | `root`, `workspace_id`, `data_dir`, `index_generation`, `active_tasks`, `total_tasks` | §6, §7 |
| `doctor_run` | — | `DoctorCheckWire[]` (`name`, `status`, `detail`, `remediation`) | §22, §36 |
| `storage_inspect` / `storage_purge` | — / `scope`, `dry_run` | storage entries / freed bytes | §24 |
| `config_show` | — | `ConfigEntryWire[]` (`key`, `value`, `origin`) | §24, §26 |
| `memory_list` | `query`, `limit` | `MemoryEntryWire[]` | — |
| `model_list` | — | `ModelSummaryWire[]` (`id`, `family`, `quantization`, `size_bytes`, `license`, `installed`) | §21 |

### Capabilities advertised by `hello`

`plan`, `doctor`, `storage`, `memory`, `models`, `rollback`, `events_resume`.

These are the negotiation surface. The app gates UI on **capabilities**, never on
a version string.

### Events

`WireEvent { kind: String, seq: u64, ts_ms: u128, task_id: Option<String>,
payload: any }`.

`kind` is one of 21 values today (`valyria_events::EventKind`): `task_started`,
`plan_created`, `context_retrieved`, `model_started`, `model_completed`,
`tool_started`, `tool_completed`, `file_changed`, `test_started`, `test_passed`,
`test_failed`, `approval_requested`, `task_paused`, `task_completed`,
`task_failed`, `state_changed`, `progress_stalled`,
`external_change_detected`, `verification_evidence`, `memory_written`,
`resource_pressure`.

Two properties matter enormously to us:

1. **`payload` is schema-free by design.** The wire schema says `"payload":
   true`. Core's own doc comment is explicit that this is deliberate, so that new
   payload shapes do not force a breaking protocol change. A payload shape can
   therefore change under a **patch** bump.
2. **Delivery is gap-free.** `Delivery::Lagged` is handled inside
   `EmbeddedClient::subscribe_events` by re-subscribing from the journal at
   `resume_from`, so a slow client sees a stall, never a hole. `seq` is
   monotonic and is our resume cursor.

---

## 2. Gaps between the PRD and v1

Ordered by how much product they block.

### G1 — No per-task permission mode (§25 Autonomy controls)  
**CLOSED — protocol 1.1.0.**

`TaskCreateRequest` carries only `objective`. Permission mode is fixed on
`RuntimeConfig` when the daemon starts. The PRD requires a user-facing
Manual/Assisted/Autonomous switch.

*Requested:* `task_create { objective, permission_mode?: "manual" | "assisted" |
"autonomous" }` — additive, minor bump.

*Until then:* the app sets the mode when it starts the workspace daemon, and
changing it restarts the daemon. The control is **disabled while any task is
running**, with the reason stated in the UI.

### G2 — Approvals have no request identity or scope (§13)  
**CLOSED — protocol 1.8.0.**

`permission_resolve { task_id, approve }` resolves whatever Core considers the
last unresolved ask (`TaskManager::last_unresolved_tool_call`). There is no
request id, so a client cannot prove which prompt it answered, and there is no
`Allow for Task`.

The `approval_requested` payload does carry enough to *render* a good prompt:
`{ prompt, tool, category, target, risk }`.

*Requested:* `approval_requested` payload gains a stable `request_id`;
`permission_resolve { task_id, request_id, decision: "once" | "task" | "deny" }`.

*Until then:* the app shows **one approval at a time per task**, refuses to send
a resolve if a newer `approval_requested` has arrived since the prompt was
rendered (re-prompts instead), and hides `Allow for Task` behind a capability
token rather than faking it client-side.

### G3 — No repository read surface (§7, §14, §17, §33)  
**CLOSED — protocol 1.2.0** (filesystem tree / blob read stay local by design).

Core has `valyria-git` (status, diff, log, branches, blame), `valyria-index`
(files, symbols), and `valyria-search` (seven fused modes with per-hit score
explanations) — all fully implemented, **none exposed on the wire**. PLAN §4.27
already names the intended methods (`search.query`, `workspace.index_status`).

*Requested:* `git_status`, `git_diff { path?, staged? }`, `git_log { limit }`,
`search_query { query, mode, limit }` → `SearchHit[]` with the existing
`ScoreExplanation`, `index_status`.

*Until then:* see [§3, the local-read exception](#3-the-local-read-exception).

### G4 — No hardware surface (§22, §20, §37)  
**CLOSED — protocol 1.3.0.**

`hardware_probe` → `HardwareProbeResponse` and `model_recommend { role }` →
`ModelRecommendResponse` (Core's `fit()` scoring: `recommended` + sorted
`candidates` with `fit_kind` = `comfortable` | `tight` | `will_not_fit`). The
Hardware View renders the structured probe; its recommendation list links each
fitting candidate into the Model Manager. First-run's "Set up a model" step is
built on the same `model_recommend` call.

### G5 — Model management (§20, §21)  
**CLOSED — protocol 1.3.0; license-gated install + cancel added in 1.11.0.**

The full lifecycle is served and the desktop client drives it end to end
(docs/MODEL-SETUP-PLAN.md):

- `model_list` → the **whole embedded catalog** (not installed-only), each row
  a `ModelSummaryWire` with `display_name` / `parameters_b` / `context_length`
  and `active_roles` (Core's role bindings — the client no longer guesses the
  active model from config keys).
- `model_recommend { role }` — hardware-scored shortlist (G4).
- `model_inspect { id }` → `ModelInspectResponse` with `license_text` (the full
  body, bundled offline for every catalog license) and `license_accepted_at_ms`.
- `model_install { id, accept_license }` — Core refuses with
  `model.license_not_accepted` until `accept_license` is `true`, then downloads
  in the background and reports `model_install_progress` / `_completed` /
  `_failed` events. `model_install_cancel { id }` stops an in-flight download
  (`model_store.cancelled`, `.part` kept for resume).
- `model_remove { id }` / `model_activate { id, role }`.

**The app has no download path** — every weight byte is `valyria-model-store`'s
(§20, §38). The extension only forwards the user's license acceptance.

### G6 — Config is read-only, and narrow (§24)  
**CLOSED — protocol 1.1.0.**

`config_show` returns effective values with origin. There is no `config_set`.
The surface is also **small**: `config_show` reports only three leaves today —
`permission.mode`, `log.format`, and `network` (a whole `NetworkPolicy` struct,
debug-formatted into one string). The PRD's Settings has ~15 knobs (iteration
limit, verification policy, model role bindings, context window, …); none of
those keys exist in Core's `Settings` yet.

*Requested:* `config_set { key, value, scope: "workspace" | "user" }` validated
against the policy floor; and `config_show` broadening as the owning subsystems
land (per Core's own `settings.rs` note).

*Until then:* the app edits `<repo>/.valyria/config.toml` or
`~/.valyria/config.toml` — Core's own documented files — via a generic dotted-key
TOML writer (`valyria_bridge::config_writer`), then immediately re-reads
`config_show` and displays the **effective** value with its origin. If the write
did not take effect (policy floor, precedence), the UI shows the resolved value,
not the value we wrote. What the app exposes today: `log.format` and
`network.internet` (written as a nested leaf; read back out of the `network`
blob). The mock Settings knobs with no Core key are hidden when live.

### G7 — No context provenance (§34)  
**CLOSED — protocol 1.4.0.**

The `context_retrieved` event kind exists in the enum but **nothing in Core emits
it**. `valyria-context` records provenance internally. The Context Inspector has
no data source whatsoever.

*Requested:* emit `context_retrieved` with `{ items: [{ path, span?, reason,
trust_level, tokens }], budget_used, budget_total }`, or a `context_explain
{ task_id }` method (PLAN §4.27's `context.explain`).

*Until then:* the Context Inspector ships **disabled**, with a one-line
explanation. It is not faked from file-touch events — inferring provenance would
be exactly the Core-logic duplication §41 forbids.

### G8 — No change-ownership surface (§15, §16)  
**CLOSED — protocol 1.4.0.**

`valyria-ledger` classifies every observed file state as agent-authored,
pre-existing, or a concurrent user modification (`ChangeClassification`).
`task_rollback` uses it. Nothing exposes it for display.

*Requested:* `ledger_changes { task_id }` → `[{ path, classification, task_id,
step_id, checkpoint_id }]`.

*Until then:* the Diff Viewer shows diffs without ownership attribution and
labels the column "ownership unavailable". Rollback still works — it goes through
`task_rollback`, which is ledger-backed inside Core.

### G9 — Windows has no transport (§39, §1)  
**CLOSED — protocol 1.9.0** (named-pipe transport; access sandbox still deferred by Core).

`valyria_app::daemon::serve` binds a `tokio::net::UnixListener`; that module is
Unix-only. Core also has no Windows sandbox (Phase 1, partial). A Windows build
of the app has nothing to talk to.

*Requested:* a named-pipe (or loopback-TCP-with-token) transport behind the same
`Client` trait — Core's `SocketClient`/`serve` split makes this a backend swap.

*Until then:* Windows is **tier 3**: the app builds and installs, and refuses to
start a session with a specific, actionable message. See PLAN §D14.

### G10 — No local authentication of the client (§43)  
**CLOSED — protocol 1.6.0.**

The PRD asks the app to "authenticate the local process relationship". Core's
daemon accepts any connection to the socket.

*Requested:* a per-daemon token written to a `0600` file next to the socket, sent
in `hello`; or `SO_PEERCRED` / `LOCAL_PEERPID` uid checks.

*Until then:* the app creates the socket directory `0700` under `$VALYRIA_HOME`
and treats the socket as a trust boundary it cannot verify. Documented in
`SECURITY.md`.

### G11 — Streaming is coarse  
**CLOSED — protocol 1.7.0.**

`ClientFrame::Subscribe` is the only server-push channel and it is
**workspace-global**, not per-task. There is no method-level progress stream
(needed by model install, indexing). There is no cancellation of an in-flight
call.

*Requested:* an optional `task_id` filter on subscribe, and long-running methods
modelled as "returns immediately + emits progress events" rather than as blocking
calls.

*Until then:* the app subscribes once per workspace and fans out by `task_id`
client-side. That is a projection, not logic.

### G12 — Event payloads are unversioned  
**CLOSED — protocol 1.7.1.**

Covered above. This is the highest-frequency breakage risk in the whole project,
because it breaks **silently** — a renamed payload field yields an empty UI cell,
not an error.

*Requested:* export payload JSON Schemas per `kind` into `docs/protocol/events/`
and extend `xtask check-protocol` to gate them.

*Until then:* see PLAN §D5 (tolerant decoders + captured-trace golden fixtures +
an "unrecognized payload" affordance that shows raw JSON rather than nothing).

### G13 — Rollback checkpoints have no discoverable id (§16)  
**CLOSED — protocol 1.5.0.**

`task_rollback { task_id, checkpoint_id }` is on the wire and the `rollback`
capability is advertised, but **nothing lets a client learn a `checkpoint_id`**.
`task_plan`'s `PlanStepSummary` reports only `checkpoint: bool` /
`rollback_boundary: bool` per step — not the `ckpt_…` id `task_rollback`
expects. Core mints that id internally (`valyria-plan`) and records it in a
`plan_checkpoint` journal entry `{checkpoint_id, step_id}`, but that entry is
**not** among the 21 projected event kinds. (A *completed* rollback is projected
— as a `file_changed` with payload `{checkpoint_id, reverted}` — so the id is
only ever visible *after* you already rolled back.)

*Requested:* project a `plan_checkpoint` event `{ checkpoint_id, step_id,
plan_revision }`, **or** add `checkpoint_id: Option<String>` to
`PlanStepSummary`, **or** a `task_checkpoints { task_id }` method.

*Until then:* the Rollback UI lists the checkpoint boundaries from `task_plan`
and renders the per-step "Roll back" action **disabled**, naming this gap. The
wire path (`CoreClient::task_rollback` → `TaskRollbackResponse`, result reported
verbatim, Core's refusal surfaced as a structured error) is built and tested
against Core's error path (`crates/valyria-bridge/tests/rollback.rs`), plus an
advanced "roll back by id" field for a developer who has one from Core's logs.
The app never computes a partial revert itself (PLAN §4.8).

### G14 — No structured tool-invocation result (§10, §18)  
**CLOSED — protocol 1.5.0.**

`tool_started` carries no invocation id, so a start and its `tool_completed`
can only be paired **positionally** (next completion, same task, greater `seq`).
And `tool_completed.rendered` is a single pre-formatted blob — for a shell
command it is `exit=Some(0) reason=Exited\n--- stdout ---\n…\n--- stderr ---\n`,
undeclared anywhere, with no exit code field, no stdout/stderr split, and no
duration. This is what the read-only agent-command view (PLAN §4.10) has to
render.

*Requested:* a stable `tool_invocation_id` on `tool_started` that matches the one
on `tool_completed`; and structured completion fields
`{ exit_code, stdout, stderr, duration_ms }` alongside `rendered`.

*Until then:* `agentCommandsForTask` (`@valyria/state`) pairs positionally and
parses the `rendered` envelope tolerantly — on any mismatch it keeps the whole
blob and renders it verbatim, never blank (D5). An unpaired start stays
`pending` rather than borrowing a later result.

### G15 — No parsed failure location (§19, §35)  
**CLOSED — protocol 1.5.0.**

PLAN §4.11 wants a test failure to open "its parsed location where Core's failure
parsers supply one". `test_failed` / `verification_evidence` carry only `digest`
and `summary` — no file, no line. Core *has* failure parsers internally; nothing
is on the wire.

*Requested:* a `location: { path, line? }[]` on the `test_failed` payload when a
parser matched.

*Until then:* the test panel's "jump to file" is an **inference** — the last
`file_changed` or write/edit tool target at or before the failing run's `seq` —
and the jump is labelled as inferred, not reported (`reveal`'s `reason`).

---

## 3. The local-read exception

§41 forbids the app implementing **agent planning, tool authorization, repository
indexing, model selection logic, or verification logic**. It does not forbid the
app reading the user's filesystem to draw a file tree.

The line we hold:

| App may do locally | App must ask Core |
|---|---|
| List directories, watch for changes, read file bytes for display | Anything that decides *what the agent should see* |
| `git status` / `git diff` / `git log` for display, read-only | Any git **write** (stage, commit, branch, discard) |
| Substring/filename filtering of an already-listed tree | Symbol search, semantic search, ranked retrieval |
| Render a PTY the human types into | Running a command **as the agent** |
| Show a model's declared size and license from `model_list` | Deciding which model fits this machine |
| Sort, group and filter Core's evidence | Deciding whether something is verified |

Every local-read fallback is (a) strictly scoped to the authorized workspace
root, (b) labeled in the UI as served locally rather than by Core, and (c)
deleted the moment Core exposes the equivalent method. The capability registry
(PLAN §D6) makes that a one-line switch per surface.

---

## 4. Version and compatibility policy

The app pins **one** Core revision per release and records it in
`core.lock.json` (`git_rev`, `runtime_version`, `protocol_version`,
`capabilities[]`). At startup, after `hello`:

| Condition | Behaviour |
|---|---|
| `protocol_version` major ≠ app's expected major | Hard block. Offer the bundled Core, explain the mismatch, link the upgrade path. Never silently proceed (§40). |
| Core minor > app minor | Proceed. Unknown response fields are ignored; unknown event kinds render as generic activity rows. |
| Core minor < app minor | Proceed with reduced features, driven entirely by `capabilities[]`. Each disabled surface names the missing capability. |
| Capability absent | The surface renders its "unavailable" state with the reason. Never a blank panel, never a fake. |

The app **never** downloads or upgrades Core on its own, and an app update never
touches installed model weights (§38).
