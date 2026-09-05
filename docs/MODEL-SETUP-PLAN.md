# Model select & setup — cross-repo build plan

Bring "choose and install a model from inside the app" to life across
`adikeshri/valyria-app` (this repo) and `adikeshri/valyria` (Core). Covers both
sides plus the integration seam between them.

**Status: implemented (protocol 1.11.0).** The A0 audit found every model RPC
in Core already real (not stubs) and `model_list` already returning the whole
embedded catalog — so there is no `model_catalog` method; `ModelSummaryWire`
was enriched instead. What was actually built:

- **Core** — `ModelInstallRequest { id, accept_license }` (Core refuses with
  `model.license_not_accepted` until `true`), `model_install_cancel`,
  `ModelInspectResponse.license_text` / `license_accepted_at_ms` (license bodies
  bundled offline in `valyria-model-registry`), `ModelSummaryWire` gains
  `display_name` / `parameters_b` / `context_length` / `active_roles`,
  model-store DB migration 902, and full `valyria model` CLI subcommands.
- **App** — schemas re-vendored + codegen, `[patch]` for local Core (removed
  when the Core branch lands and `core.lock.json`'s `git_rev` moves), bridge
  methods + routes, a `modelInstalls` projection in `@valyria/state`, a
  rebuilt Model Manager webview (role-scoped shortlist, fit chips, progress
  bars, license modal, per-role activate, cancel/remove), a first-run
  **Set up a model** step, Hardware→Manager links, `valyria.setupModel`
  command, and the status-bar active-model read off `active_roles`.

Sections below are the original plan; **[verify with Core]** tags are resolved.

---

## 1. Goal

A user on a clean machine can, without leaving the editor:

1. See that they are on the built-in offline model.
2. Open a "Set up a model" flow that shows a short, explained shortlist —
   size, license, and whether it fits this machine.
3. Install one, watch real download progress, accept its license.
4. Have it activated for a role and reflected in the Home / status surfaces.
5. Later: manage installed models (activate per role, remove) and browse the
   full catalog beyond the hardware-scored shortlist.

Non-negotiable (unchanged from [INTEGRATION.md](INTEGRATION.md) D-INT-3): the
app never downloads a weight byte. Every fetch is Core's `valyria-model-store`.

---

## 2. Current state

### Already wired end-to-end (pinned Core rev `865f98e…`, protocol 1.10.0)

| Layer | Evidence |
|---|---|
| Wire methods `model_recommend / install / remove / activate / inspect`, `hardware_probe` | [packages/protocol/src/generated/request.ts](../packages/protocol/src/generated/request.ts), `core.lock.json` capability list has `model_manage` + `hardware` |
| Install lifecycle events `model_install_progress / _completed / _failed` | [packages/protocol/schemas/events/](../packages/protocol/schemas/events/), [events/registry.ts](../packages/protocol/src/events/registry.ts) |
| Rust bridge client | [crates/valyria-bridge/src/client.rs](../crates/valyria-bridge/src/client.rs) `model_install`, `model_activate(id, role)`, … |
| Bridge-host RPC routes | [crates/valyria-bridge-host/src/main.rs](../crates/valyria-bridge-host/src/main.rs) `model/*` |
| Extension bridge contract | [extension/src/bridge/protocol.ts](../extension/src/bridge/protocol.ts) |
| Models view + webview | [extension/src/views/models.ts](../extension/src/views/models.ts), [extension/src/webviews/models/main.ts](../extension/src/webviews/models/main.ts) — Install / Activate / Remove buttons render when `model_manage` is negotiated |

### Stale / contradictory (fix as part of this work)

- [CORE-INTERFACE.md](CORE-INTERFACE.md) G4/G5 headers say "CLOSED" but the body
  paragraphs still say "not reachable / until then".
- [INTEGRATION.md](INTEGRATION.md) §6 still frames install as a future Core
  request.
- [crates/valyria-bridge/tests/models_config.rs](../crates/valyria-bridge/tests/models_config.rs)
  header says "read-only model inventory".

### Missing for the target UX

| Gap | Side |
|---|---|
| No browsable catalog method — `model_list` returns installed-only (empty on a clean machine); discovery only via `model_recommend { role }` | Core |
| `ModelInspectResponse` has `license_name` + `license_url` but no `license_text` body for an offline acceptance prompt | Core **[verify with Core]** |
| No license-acceptance record path (`model_accept_license` or an `accepted:` flag on install) | Core **[verify with Core]** |
| Bridge defaults role to `"code"`, not a valid `ModelRole` (`primary_coder`, `fast_coder`, `planner`, `reviewer`, `embedder`, `reranker`, `autocomplete`, `summarizer`) | App bridge + **[verify with Core]** |
| No install-progress state: reducer/selectors don't fold `model_install_*`; view does `setTimeout(refresh, 1500)` | App extension |
| No license modal; `model/inspect` never called from the extension | App extension |
| No first-run model step ([firstrun.ts](../extension/src/views/firstrun.ts) skips it) | App extension |
| Hardware view shows "Recommended: `<id>`" as dead text — no install action | App extension |
| `hardwareModel` selector reads `c.fits` (field is `fit_kind`); `modelsModel` infers "active" by regex over config keys instead of `model_inspect.active_roles` | App extension (existing bugs) |

---

## 3. Strategy — two phases, recommend-first

**Phase 1 builds the entire UX on `model_recommend`, which the pinned Core
already serves — zero Core change.** This ships the flow, and it is the better
first-run experience anyway ("models that fit *this* machine for *this* role").
It also answers the open risk immediately: if the pinned Core's
`model_install` / `activate` handlers turn out to be stubs, Phase 1 surfaces
that on day one.

**Phase 2 adds `model_catalog` in Core** for the "browse everything / advanced"
path and to decouple the Models tab from hardware scoring. App and Core work
proceed in parallel after Phase 1.

License text + acceptance recording ([verify with Core]) ride whichever phase
Core lands them in; the app degrades to `license_url` + a local acknowledgement
until then.

---

## 4. Workstream A — Core (`adikeshri/valyria`)

> All schema edits are in Core's `docs/protocol/`; every field is snake_case and
> must round-trip through `serde` on the Rust types and `json-schema-to-typescript`
> on the app side.

### A0. Confirm the pinned rev **[verify with Core]**

Build `865f98e…` and run each method against it from a scratch `$VALYRIA_HOME`:

- `model_recommend { role: "primary_coder" }` → non-empty `candidates`?
- `model_install { id }` → returns immediately, emits `model_install_progress`?
- `model_activate { id, role }` → persists a role binding visible in
  `config_show` and/or `model_inspect.active_roles`?
- `model_remove`, `model_inspect` → real responses, not `unimplemented!()`?
- Enumerate the exact accepted `role` strings.

Record findings back into this section; they gate how much of A1–A4 is needed.

### A1. `model_catalog` method (Phase 2)

```
Request  model_catalog { role?: string }          // role optional: filter/rank when present
Response ModelCatalogResponse { entries: ModelCatalogEntryWire[] }

ModelCatalogEntryWire {
  id: string
  display_name: string
  family: string
  quantization: string
  parameters_b: number
  size_bytes: number
  context_length: number
  license_name: string
  license_url?: string | null
  min_ram_bytes: number
  min_vram_bytes?: number | null
  installed: boolean
  source_url: string
}
```

Backed by `valyria-model-registry` (the same card store `fit()` already reads).
No hardware scoring here — that stays in `model_recommend`. Add `model_catalog`
to `valyria_events::…`? No — it is a request, not an event. Add the capability
token `model_catalog` to `hello` **only if** it can ship independently of
`model_manage`; otherwise fold it under `model_manage`.

### A2. License body on inspect **[verify with Core]**

If `ModelInspectResponse` has no `license_text`:

```
ModelInspectResponse {
  …existing…
  license_text?: string | null   // full body when model-store has it locally
}
```

Populated from the license file `valyria-model-store` already fetches during
install; `None` before install when only `license_url` is known.

### A3. License acceptance record **[verify with Core]**

Pick one:

- **Preferred** — `model_install { id, accept_license: bool }`; Core refuses a
  gated install without `accept_license: true` and writes the acceptance
  (timestamp + license id) into `$VALYRIA_HOME/models/<id>/manifest.json`.
- Alternative — separate `model_accept_license { id }` request.

Expose the acceptance in `model_inspect` (`license_accepted_at_ms?: number`).

### A4. Role vocabulary

Confirm the `ModelRole` set and whether `model_activate` accepts a bare
`primary_coder` etc. Document the default role the app should use when the user
doesn't pick one (proposal: `primary_coder`).

### A5. Doc + schema hygiene in Core

- `docs/protocol/version.txt` bump (semver: additive → minor).
- Regenerate `docs/protocol/{request,response}.schema.json`.
- If any `model_install_*` payload shape changes, update
  `docs/protocol/events/model_install_*.schema.json` and
  `crates/valyria-events/src/kind.rs` stays in sync.
- Update Core's own model-store / registry docs.

---

## 5. Workstream B — Protocol vendoring & lockfile bump

Driven by the checklist in `core.lock.json`'s `$comment` and
[INTEGRATION.md](INTEGRATION.md) §3.

1. Land Workstream A on Core `main`; get the merge SHA.
2. In this repo:
   - `Cargo.toml` `[workspace.dependencies]` — move `valyria-protocol` +
     `valyria-types` `rev` to the merge SHA.
   - `core.lock.json` — `git_rev`, `protocol_version`, and `capabilities[]` if a
     new token was added.
   - Re-vendor `packages/protocol/schemas/` from `../valyria/docs/protocol/`
     (`request.schema.json`, `response.schema.json`, `event.schema.json`,
     `events/*.schema.json`, `version.txt`, `event-kinds.txt`).
   - `npm --prefix packages/protocol run codegen` → regenerates
     `packages/protocol/src/generated/{request,response,event,version}.ts`.
   - `cargo run -p xtask -- all` — `verify-core` (lock ⇄ `version.txt`),
     `check-protocol` (vendored ⇄ `../valyria/docs/protocol`), `check-extension`,
     `check-layering` must all pass.
3. Re-capture trace fixtures that touch models (Workstream E).

A Phase-1-only effort still does a smaller version of step 2 if A0 reveals the
pinned rev needs bumping to a newer `main`.

---

## 6. Workstream C — App Rust bridge

[crates/valyria-bridge](../crates/valyria-bridge) + [crates/valyria-bridge-host](../crates/valyria-bridge-host)

### C1. Thread `role` properly

- `crates/valyria-bridge-host/src/main.rs`: `model/activate` and
  `model/recommend` — stop defaulting `role` to `"code"`. Require `role` for
  activate; for recommend default to the documented role from A4.
- `crates/valyria-bridge/src/client.rs`: already takes `role: &str` — no change,
  just callers.

### C2. `model_catalog` (Phase 2)

- `client.rs`: `pub async fn model_catalog(&self, role: Option<&str>) -> Result<ModelCatalogResponse>`
  via `Request::ModelCatalog` (comes from the bumped `valyria-protocol`).
- `main.rs`: route `"model/catalog"` → `c.model_catalog(role)`.

### C3. License acceptance plumbing **[verify with Core]**

- `client.rs`: add `accept_license: bool` to `model_install`, or a
  `model_accept_license` call, matching A3.
- `main.rs`: accept `acceptLicense` in the `model/install` params.

### C4. Tests

Extend [crates/valyria-bridge/tests/models_config.rs](../crates/valyria-bridge/tests/models_config.rs)
(rename its header away from "read-only"):

- `model_recommend` decodes `ModelRecommendResponse` with ≥1 candidate against
  real Core.
- `model_catalog` decodes and is non-empty (Phase 2).
- Gated: a full `model_install` → poll events → `model_install_completed` →
  `model_activate` → `model_inspect.active_roles` contains the role. Guard with
  `#[ignore]` / an env flag — it does a real (small) download.

---

## 7. Workstream D — App extension (TypeScript)

### D1. Bridge contract — [extension/src/bridge/protocol.ts](../extension/src/bridge/protocol.ts)

```ts
"model/activate": [{ id: string; role: string }, unknown];          // add role
"model/recommend": [{ role?: string }, unknown];                    // unchanged
"model/install":  [{ id: string; acceptLicense?: boolean }, unknown]; // [verify with Core]
"model/catalog":  [{ role?: string }, unknown];                     // Phase 2
```

### D2. Install-progress state — [packages/state](../packages/state)

- `reducer.ts`: fold `model_install_progress | _completed | _failed` into a new
  `state.modelInstalls: Record<id, { phase, downloadedBytes, totalBytes,
  status: "running" | "done" | "failed", code?, message? }>`. Pure, trace-replayable
  like every other projection.
- `selectors.ts`: `modelInstalls(state)`, `modelInstall(state, id)`.

### D3. `ModelsModel` + view — [extension/src/store/models.ts](../extension/src/store/models.ts), [extension/src/views/models.ts](../extension/src/views/models.ts), [extension/src/webviews/models/main.ts](../extension/src/webviews/models/main.ts)

- Replace the regex "active" inference with `model_inspect.active_roles` (call
  `model/inspect` per listed model, or a new field on `model_list`
  — **[verify with Core]**).
- Add to `ModelsModel`:
  - `recommendations: { role, candidates: {...ModelCandidateWire}[] }` from
    `model/recommend` (fix the `fit_kind` mapping; drop the dead `c.fits`).
  - `installs: <D2 projection>` for live progress rows.
  - `catalog?: ModelCatalogEntryWire[]` (Phase 2).
- Webview: shortlist section (recommended first, "fits / tight / won't fit"
  chips), per-row install button → progress bar driven by `installs`, an
  "Activate for role…" control (role picker), Remove.
- `ModelsViewProvider.manage()`: before `model/install` on a gated model, call
  `model/inspect`, show the license modal (D5), only install on accept.

### D4. First-run model step — [extension/src/views/firstrun.ts](../extension/src/views/firstrun.ts) + webview

New step between "open repo" and the probe task:

- Calls `model/recommend { role: <default> }` (needs `hardware` cap) and
  `model/list`.
- Shows the recommended model (name, size, license, fit) with **Install &
  continue** / **Skip — use built-in model**.
- Install → progress → `model/activate` → advance. Skip → unchanged
  fake-model path, with the existing honest copy.
- A standalone `valyria.setupModel` command opens the Models view on its empty
  state for the same flow later.

### D5. License modal

`vscode.window.showInformationMessage(..., { modal: true })` with the
`license_text` body (fallback: `license_name` + a link to `license_url` and a
plain acknowledgement) — Accept / Cancel. On Accept, call install with the
acceptance signal from D1/C3.

### D6. Hardware → Models — [extension/src/webviews/hardware/main.ts](../extension/src/webviews/hardware/main.ts)

Make the recommended candidate a button that runs
`manageModel { id, action: "install" }` and deep-links to the Models view.

### D7. Status / Home

[extension/src/status.ts](../extension/src/status.ts) and `homeModel` already
render `activeModel`; confirm they update off the config/inspect change after an
activate (they refresh on `supervisor.onDidChange` + config poll — verify the
poll picks up the new binding, else fire an explicit refresh).

### D8. Extension tests

- `extension/test/models.test.ts` — extend the trace-replay set with a
  model-install trace: assert the progress projection, terminal state, and that
  `ModelsModel.installs` renders without raw JSON.
- Webview render test for the new shortlist + progress + license affordances.
- `packages/protocol` decoder test: `model_install_*` schemas already covered;
  add `model_catalog` response decode (Phase 2).

---

## 8. Workstream E — Integration, fixtures, CI

### E1. Trace fixtures — [fixtures/traces](../fixtures/traces)

Add `model-install.jsonl` (and a `model-install-failed.jsonl`): a real event
sequence captured from Core — `model_install_progress × N` →
`model_install_completed`, task-independent (`task_id: null`). Used by
`packages/state` and `extension` replay tests.

### E2. CI

- The existing `xtask` gates cover the protocol seam.
- Add a CI job (or extend the models one) that, against a Core built from
  `core.lock.json`, runs the Workstream C integration test behind its env flag
  on a scheduled / label-gated run (real download).
- Bundle-size gate ([scripts/check-bundle-size.sh](../scripts/check-bundle-size.sh))
  unaffected — weights never enter the installer.

### E3. `scripts/dev.sh` ergonomics

Document `VALYRIA_BIN=/path/to/valyria/target/debug/valyria scripts/dev.sh` for
running the flow against a locally-built Core with the model store enabled.

### E4. Docs to correct

- [CORE-INTERFACE.md](CORE-INTERFACE.md) G4/G5 — delete the stale "Until then"
  bodies; if `model_catalog` is added, give it its own row.
- [INTEGRATION.md](INTEGRATION.md) §6 — collapse "Now / Core requests /
  End-state" into the shipped flow; keep D-INT-3.
- [PLAN.md](PLAN.md) §4.13 and the Phase 6 section.
- [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) model/first-run bullets.
- `crates/valyria-bridge/tests/models_config.rs` header.

---

## 9. Sequencing

```
Phase 0  A0 verify pinned Core                          ── Core access, ~0.5d
           │
Phase 1  ├─ C1 role threading (bridge)                  ┐
         ├─ D1 bridge contract (role)                   │  no Core change
         ├─ D2 install-progress state + selectors       │  ~1 wk app
         ├─ D3 Models view: recommend shortlist,        │
         │     live progress, role picker, activate     │
         ├─ D5 license modal (license_url fallback)     │
         ├─ D6 Hardware → Models                        │
         ├─ D4 first-run model step                     │
         ├─ E1 model-install trace fixture              │
         └─ D8 / C4 tests                               ┘
           │  ── SHIP: full select+install+activate on model_recommend
           │
Phase 2  ├─ A1 model_catalog (Core)          ┐
         ├─ A2 license_text (Core) [verify]  │  parallel
         ├─ A3 acceptance record (Core) [verify]
         ├─ A4 role vocabulary doc (Core)    ┘
           │
         ├─ B  vendor + lockfile bump + codegen
         ├─ C2/C3 bridge: model/catalog, accept_license
         ├─ D3 catalog browse UI, D5 real license_text
         └─ E2 integration CI job
           │  ── SHIP: browse-all catalog + recorded license acceptance
           │
Phase 3  └─ E4 doc reconciliation, cleanup, changelog
```

Phase 1 is unblocked the moment Core access confirms A0. Phase 2's Core and app
tracks run concurrently and rendezvous at Workstream B.

---

## 10. API contracts (delta)

### New — Core, Phase 2

| Method | Params | Result |
|---|---|---|
| `model_catalog` | `{ role?: string }` | `ModelCatalogResponse { entries: ModelCatalogEntryWire[] }` (§4 A1) |

### Changed — Core, Phase 2 **[verify with Core]**

| Type | Change |
|---|---|
| `ModelInspectResponse` | `+ license_text?: string \| null`, `+ license_accepted_at_ms?: number \| null` |
| `model_install` | `+ accept_license?: bool` (gated installs refused without it) |
| `model_list` / `ModelSummaryWire` | `+ active_roles?: string[]` so the app stops inferring "active" from config keys |

### Changed — app bridge JSON-RPC

| Method | Change |
|---|---|
| `model/activate` | params `{ id }` → `{ id, role }` |
| `model/install` | params `{ id }` → `{ id, acceptLicense?: boolean }` |
| `model/catalog` | new route → `client.model_catalog` (Phase 2) |

---

## 11. Test matrix

| Level | What | Where |
|---|---|---|
| Unit — pure | `model_install_*` fold → `modelInstalls` projection; terminal + failed states | `packages/state` trace replay |
| Unit — pure | `modelsModel` / `hardwareModel` selectors: `fit_kind` chips, `active_roles`, progress rows, no raw JSON | `extension/test/models.test.ts` |
| Unit — schema | `model_catalog` response + changed `ModelInspectResponse` decode | `packages/protocol/test/decoders.test.ts` |
| Render | Models webview: shortlist, progress bar, license modal trigger, role picker | `extension/test/webview-render.test.ts` |
| Integration — Rust | `model_recommend` / `model_catalog` decode vs real Core; full install→activate→inspect (env-gated) | `crates/valyria-bridge/tests/models_config.rs` |
| Protocol seam | `xtask verify-core` + `check-protocol` after the lockfile bump | CI |
| Manual | `VALYRIA_BIN=… scripts/dev.sh` → first-run model step → install a small real model → activate → Home shows it | — |

---

## 12. Risks & open questions

| # | Risk / question | Resolve by |
|---|---|---|
| 1 | Pinned Core's `model_install` / `activate` handlers might be stubs despite the "CLOSED" markers | A0, before any Phase 1 commitment |
| 2 | `model_recommend` candidate set could be empty if the registry ships no cards | A0 — check `valyria-model-registry` card store contents |
| 3 | `license_text` may genuinely not exist; offline license display then needs Core work, not just app work | A2 [verify with Core] |
| 4 | Role strings: `"code"` vs `primary_coder` — silent activate failure if Core is strict | A4 |
| 5 | A large default recommended model makes first-run feel heavy | Pick a small default (e.g. a 3–4B Q4) for the first-run step; full choice in Models tab |
| 6 | Download resumability / cancel UX — is there a `model_install_cancel`? | [verify with Core]; if absent, no cancel button in Phase 1 |
| 7 | `core.lock.json` capability list may need a new `model_catalog` token → touches `xtask verify-core` expectations | Workstream B |
| 8 | Weight store byte-identical across app upgrade (§38 release gate) must still hold with new activate/remove paths | E2 regression check |

---

## 13. Definition of done

- Phase 1: on a clean `$VALYRIA_HOME`, first-run offers a fitting model, installs
  it with a real progress bar, records a license acknowledgement, activates it
  for the default role, and Home + status show it — all against the pinned Core,
  no Core change merged.
- Phase 2: the Models tab browses the full `model_catalog`, license acceptance
  is recorded by Core and shown in `model_inspect`, and the lockfile bump has
  landed with all `xtask` gates green.
- All stale G4/G5 / §6 doc language corrected; `models_config.rs` no longer
  calls itself read-only.
