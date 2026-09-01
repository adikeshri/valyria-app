# apps/desktop — the Valyria renderer + Tauri host

The desktop half of `valyria-app`: a Vite + React + TypeScript renderer and a
Rust/Tauri host (`src-tauri`) that bridges it to a live Core runtime. Every
primary surface — Workspace Explorer, Agent Chat, Task Panel, Agent Activity,
Timeline, Code Viewer, Diff Viewer, Terminal, Git, Model Manager, Hardware,
Approvals, Settings, Task History, Context Inspector, Verification, First-Run —
is implemented against Core's real protocol.

## Run it

```bash
# from the repo root
npm install
VALYRIA_BIN=$(pwd)/../valyria/target/release/valyria npm run app:dev -w desktop
```

`app:dev` (`tauri dev`) compiles the Rust shell, starts the Vite dev server on
:5183, and opens a native window (1440×900, 1024×640 min). First compile of the
Tauri/WebView tree is ~1–2 min; after that it's incremental.

- **Open Folder…** (connect bar, or the first-run wizard) → native directory
  picker → the host spawns `valyria serve --workspace <root>` and the session
  goes live.
- `npm run dev` alone runs the renderer as a browser tab against
  `src/data/mock.ts` — no host, no Core.
- `npm run app:build` → a platform-native installer under
  `src-tauri/target/release/bundle/`.

## Live vs. mock

Every panel is a switch: `XPanel` renders `<LiveXPanel/>` when a Core session
is open and `<MockXPanel/>` (fixtures from `src/data/mock.ts`) when one is not.
The mock path exists only for `npm run dev` UI iteration; with a session, every
surface reads Core:

| Surface | Source when live |
|---|---|
| Explorer / Code Viewer | workspace-root-scoped filesystem reads (Core exposes no blob RPC) |
| Git panel / Changes | `git_status` · `git_log` · `git_branches` |
| Diff Viewer | local `git` bytes + `ledger_changes` for the ownership column |
| Search | `search_query` (fused, explained hits) + `index_status`; **Build index** runs `index_build` |
| Terminal | a real PTY at the workspace root, kept in a separate buffer from the read-only Agent Commands view (enforced by `xtask check-d7`) |
| Task / Plan / Rollback | `task_plan` · `task_report` · `plan_checkpoint` events · `task_rollback` |
| Context Inspector | `context_retrieved` events |
| Tests | `test_*` / `verification_evidence` events with parsed failure locations |
| Hardware | `hardware_probe` + `doctor_run` |
| Models | `model_list` / `model_install` / `model_remove` / `model_activate` / `model_inspect` |
| Settings | `config_show` / `config_set`; autonomy via per-task `permission_mode` |
| Security overview | `doctor_run` + the session's auth / peer-uid state |

Running a *task* still plays Core's scripted fake-model scenario — Core links no
real inference runtime yet.

## Key modules

| Path | Role |
|---|---|
| `src/core/bridge.ts` | Typed wrappers over the Tauri host commands + the batched event stream |
| `src/core/liveStore.ts` | zustand store that folds `core://event-batch` through `@valyria/state`'s reducer |
| `src/core/repo.ts` | The workspace-root-scoped local filesystem/git reads (labeled "Served locally" in the UI) |
| `src/panels/Live*.tsx`, `src/components/Live*.tsx` | The live surfaces |
| `src-tauri/src/bridge_host.rs` | The `#[tauri::command]` layer over `valyria-bridge` |
| `src-tauri/src/lib.rs` | Plugin registration + the command handler table |

## Notes

- Cross-panel navigation goes through one carrier: `useApp().reveal({ path, line, in })`.
- All user-facing errors go through `core/errors.ts` `present()` + `<ErrorState>` (`xtask check-error-strings`).
- Overlays trap focus via `core/useOverlayA11y`; `<TabStrip>` is the only tab-strip implementation (`xtask check-a11y`).
