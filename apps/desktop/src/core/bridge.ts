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
  /** True when every frame to Core carries this session's per-instance auth
   *  token (G10). False only when adopting a daemon started without one. */
  authenticated: boolean;
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

/** `model_list` — `ModelSummaryWire`. */
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

// --- CORE-INTERFACE gap closure (protocol 1.9.0) -----------------------

/** `hardware_probe` — mirrors `valyria_hardware::HardwareReport` (G4). */
export interface HardwareProbe {
  os: string;
  os_version: string | null;
  arch: string;
  cpu: {
    brand: string;
    physical_cores: number;
    logical_cores: number;
    arch: string;
  };
  ram_total_bytes: number;
  ram_available_bytes: number;
  gpus: {
    name: string;
    vendor: string | null;
    core_count: number | null;
    vram_bytes: number | null;
  }[];
  unified_memory: boolean;
  accelerator_present: boolean | null;
  disk_total_bytes: number;
  disk_available_bytes: number;
}

/** One scored `model_recommend` candidate (G4). */
export interface ModelCandidate {
  id: string;
  display_name: string;
  family: string;
  size_bytes: number;
  license_name: string;
  installed: boolean;
  suitability: number;
  /** comfortable | tight | will_not_fit */
  fit_kind: string;
  fit_detail: string | null;
  adjusted_score: number | null;
}
export interface ModelRecommend {
  role: string;
  recommended: ModelCandidate | null;
  candidates: ModelCandidate[];
}

/** `model_inspect` (G5). */
export interface ModelInspect {
  id: string;
  display_name: string;
  family: string;
  parameters_b: number;
  quantization: string;
  context_length: number;
  size_bytes: number;
  license_name: string;
  license_url: string | null;
  source_url: string;
  installed: boolean;
  installed_at_ms: number | null;
  probe_tokens_per_sec: number | null;
  active_roles: string[];
}

export interface ModelRemoveResult {
  freed_bytes: number;
}

/** `git_status` (G3). */
export interface GitStatus {
  branch: string | null;
  detached: boolean;
  head_commit: string | null;
  files: { path: string; kind: string; staged: boolean }[];
}
export interface GitDiffResult {
  unified: string;
  truncated: boolean;
}
export interface GitCommitWire {
  sha: string;
  author_name: string;
  author_email: string;
  message: string;
  time_unix: number;
  parents: string[];
}
export interface GitLogResult {
  commits: GitCommitWire[];
}
export interface GitBranchWire {
  name: string;
  commit: string;
  is_head: boolean;
}
export interface GitBranchesResult {
  branches: GitBranchWire[];
}

/** `search_query` — fused, explained hits (G3). */
export interface SearchHit {
  path: string;
  symbol_path: string | null;
  line: number | null;
  snippet: string | null;
  score: number;
  explanation: {
    stage_scores: { mode: string; rank: number; raw_score: number }[];
    features: { name: string; value: number; weight: number; contribution: number }[];
    retrieval_paths: string[];
  };
}
export interface SearchResult {
  hits: SearchHit[];
  modes_run: string[];
  degraded: string[];
}

export interface IndexStatus {
  generation: number | null;
  stage: string | null;
  file_count: number;
  symbol_count: number;
  created_at_ms: number | null;
}

/** `ledger_changes` — per-file agent/user/pre-existing classification (G8). */
export interface LedgerChange {
  path: string;
  /** agent_authored | pre_existing | concurrent_user_modification | unknown */
  classification: string;
  /** write | delete */
  kind: string;
  task_id: string;
  step_id: string;
  tool_invocation_id: string | null;
}
export interface LedgerChanges {
  changes: LedgerChange[];
}

/** once — approve this call · task — Allow for Task · deny */
export type ApprovalDecision = "once" | "task" | "deny";

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
  /** The id `task_rollback` expects for a checkpoint taken at this step, when
   *  Core has recorded one (G13). Also arrives live as a `plan_checkpoint`
   *  event; the Rollback UI prefers whichever it sees first. */
  checkpoint_id?: string | null;
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

  // --- gap closure (protocol 1.9.0) ---
  /** `config_set` — write one leaf to a Core-owned file, get a fresh
   *  `config_show` back (G6). Supersedes the local `configWrite`. */
  configSet: (scope: ConfigScope, key: string, value: string) =>
    invoke<ConfigReport>("config_set", { scope, key, value }),
  taskCreateWithMode: (objective: string, permissionMode: PermissionMode | null) =>
    invoke<string>("task_create_with_mode", { objective, permissionMode }),
  permissionResolveScoped: (
    taskId: string,
    requestId: string | null,
    decision: ApprovalDecision,
  ) => invoke<null>("permission_resolve_scoped", { taskId, requestId, decision }),
  coreGitStatus: () => invoke<GitStatus>("core_git_status"),
  coreGitDiff: (path: string | null, staged: boolean) =>
    invoke<GitDiffResult>("core_git_diff", { path, staged }),
  coreGitLog: (limit: number | null) => invoke<GitLogResult>("core_git_log", { limit }),
  coreGitBranches: () => invoke<GitBranchesResult>("core_git_branches"),
  searchQuery: (query: string, modes: string[], anchors: string[], limit: number | null) =>
    invoke<SearchResult>("search_query", { query, modes, anchors, limit }),
  indexStatus: () => invoke<IndexStatus>("index_status"),
  hardwareProbe: () => invoke<HardwareProbe>("hardware_probe"),
  modelRecommend: (role: string) => invoke<ModelRecommend>("model_recommend", { role }),
  /** Begin a download; progress arrives as `model_install_*` events. */
  modelInstall: (id: string) => invoke<null>("model_install", { id }),
  modelRemove: (id: string) => invoke<ModelRemoveResult>("model_remove", { id }),
  modelActivate: (id: string, role: string) =>
    invoke<null>("model_activate", { id, role }),
  modelInspect: (id: string) => invoke<ModelInspect>("model_inspect", { id }),
  ledgerChanges: (taskId: string) =>
    invoke<LedgerChanges>("ledger_changes", { taskId }),

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
