// Typed wrappers over the Tauri host commands and events (crates/valyria-bridge
// via apps/desktop/src-tauri/src/bridge_host.rs). The renderer never opens a
// socket — it calls these and listens for the batched event stream.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface SessionInfo {
  workspace_root: string;
  workspace_id: string;
  socket_path: string;
  origin: "spawned" | "adopted";
  protocol_version: string;
  runtime_version: string;
  capabilities: string[];
  /** Autonomy level the daemon runs under (§25); null when adopted from a
   *  daemon that recorded none. */
  permission_mode: "manual" | "assisted" | "autonomous" | null;
  /** False for an adopted daemon — the autonomy switch is disabled then (G1). */
  owns_daemon: boolean;
}

export type PermissionMode = "manual" | "assisted" | "autonomous";

export interface DoctorCheck {
  name: string;
  /** pass | warn | fail */
  status: string;
  detail: string;
  remediation: string | null;
}
export interface DoctorReport {
  checks: DoctorCheck[];
  /** worst status across all checks */
  summary: string;
}

export interface ConfigEntry {
  key: string;
  value: string;
  /** default | global | workspace | env | task */
  origin: string;
}
export interface ConfigReport {
  entries: ConfigEntry[];
}

export type ConfigScope = "workspace" | "user";

/** `model_list` — `ModelSummaryWire`. No `role` / `active` / min-RAM on the
 *  wire (CORE-INTERFACE G4/G5). */
export interface ModelSummary {
  id: string;
  family: string;
  quantization: string;
  size_bytes: number;
  installed: boolean;
  license: string;
}
export interface ModelReport {
  models: ModelSummary[];
}

export interface WorkspaceStatus {
  root: string;
  workspace_id: string;
  data_dir: string;
  index_generation: number | null;
  active_tasks: number;
  total_tasks: number;
}

export interface TaskSummary {
  task_id: string;
  objective: string;
  state: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface TaskStatus {
  task_id: string;
  objective: string;
  state: string;
  paused_from: string | null;
  recovery_note: string | null;
}

export interface PlanStep {
  id: string;
  intent: string;
  targets: string[];
  depends_on: string[];
  rollback_boundary: boolean;
  checkpoint: boolean;
}

export interface PlanGet {
  revision: number | null;
  content_hash: string | null;
  steps: PlanStep[];
}

export interface VerifiedClaim {
  kind: string;
  command: string;
  outcome: string;
  run_id: string;
}

export interface TaskReport {
  task_id: string;
  status: string;
  verified: VerifiedClaim[];
  unverified: string[];
}

/** `task_rollback` result — reported to the user verbatim (§4.8). */
export interface RollbackResult {
  reverted_entries: number;
  restored_files: string[];
}

/** `about_info` — static build + platform facts for the About / Compatibility
 *  surface (§4.18). No session required; also backs the Windows tier-3 screen. */
export interface AboutInfo {
  app_version: string;
  expected_protocol: string;
  os: string;
  arch: string;
  /** false on a platform with no Core transport (Windows, G9). */
  sessions_supported: boolean;
  /** provenance of the bundled Core sidecar; null in a dev build. */
  core_provenance: {
    core_repo?: string;
    core_ref?: string;
    core_sha?: string;
    rust_toolchain?: string;
    target?: string;
    built_at?: string;
  } | null;
}

/** Shape of `core://event-batch` — mirrors `valyria_bridge::EventBatch`. */
export interface CoreEventBatch {
  first_seq: number;
  last_seq: number;
  events: unknown[]; // raw WireEvent JSON; decoded by @valyria/state
  gap_before: boolean;
}

/** True when running inside the Tauri shell (vs. `npm run dev` in a browser). */
export const inTauri = typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
  "undefined";

export const bridge = {
  sessionOpen: (workspaceRoot: string, permissionMode?: PermissionMode) =>
    invoke<SessionInfo>("session_open", { workspaceRoot, permissionMode: permissionMode ?? null }),
  /** Restart the workspace daemon under a new autonomy level. Rejected when the
   *  daemon was adopted from another process (G1). */
  sessionRestart: (permissionMode: PermissionMode) =>
    invoke<SessionInfo>("session_restart", { permissionMode }),
  sessionStatus: () => invoke<SessionInfo | null>("session_status"),
  aboutInfo: () => invoke<AboutInfo>("about_info"),
  doctorRun: () => invoke<DoctorReport>("doctor_run"),
  configShow: () => invoke<ConfigReport>("config_show"),
  /** D13 write-then-verify: edit Core's `config.toml`, get a fresh
   *  `config_show` back so the caller renders the effective value + origin. */
  configWrite: (scope: ConfigScope, key: string, value: string) =>
    invoke<ConfigReport>("config_write", { scope, key, value }),
  workspaceStatus: () => invoke<WorkspaceStatus>("workspace_status"),
  modelList: () => invoke<ModelReport>("model_list"),
  taskCreate: (objective: string) => invoke<string>("task_create", { objective }),
  taskList: () => invoke<{ tasks: TaskSummary[] }>("task_list"),
  taskStatus: (taskId: string) => invoke<TaskStatus>("task_status", { taskId }),
  taskPlan: (taskId: string) => invoke<PlanGet>("task_plan", { taskId }),
  taskReport: (taskId: string) => invoke<TaskReport>("task_report", { taskId }),
  taskRollback: (taskId: string, checkpointId: string) =>
    invoke<RollbackResult>("task_rollback", { taskId, checkpointId }),
  taskPause: (taskId: string) => invoke<null>("task_pause", { taskId }),
  taskResume: (taskId: string) => invoke<null>("task_resume", { taskId }),
  taskCancel: (taskId: string) => invoke<null>("task_cancel", { taskId }),
  permissionResolve: (taskId: string, approve: boolean) =>
    invoke<null>("permission_resolve", { taskId, approve }),

  onEventBatch: (cb: (b: CoreEventBatch) => void): Promise<UnlistenFn> =>
    listen<CoreEventBatch>("core://event-batch", (e) => cb(e.payload)),
  onReconnected: (cb: (from: number) => void): Promise<UnlistenFn> =>
    listen<number>("core://reconnected", (e) => cb(e.payload)),
  onClosed: (cb: (lastSeq: number) => void): Promise<UnlistenFn> =>
    listen<number>("core://closed", (e) => cb(e.payload)),
};
