/**
 * The typed message contract between the extension host and a Valyria webview.
 *
 * The host pushes a *view-model* (the output of `@valyria/state` selectors run
 * in the ext host — PLAN.md D3/D4: the webview holds no logic). The webview
 * emits *intents*: `ready` once, then `command`s the host maps to bridge calls.
 */

/** Host → webview. */
export type HostMessage =
  | { type: "state"; view: string; model: unknown }
  | { type: "focus" };

/** Webview → host. Names are free-form; the host's `onCommand` switch owns them. */
export type WebviewMessage =
  | { type: "ready" }
  | { type: "command"; name: string; args?: unknown };

export type Connection =
  | "starting"
  | "connecting"
  | "ready"
  | "degraded"
  | "reconnecting"
  | "incompatible"
  | "failed";

// --- per-view model shapes ---------------------------------------------

/** The status-bar agent ticker (docs/UX-DIFFERENTIATION.md, lever E) — a live
 *  one-line read of what the focused task is doing. Pure projection of the
 *  store; no clock. */
export interface TickerModel {
  connection: Connection;
  hasTask: boolean;
  taskId: string | null;
  /** e.g. "Planning", "Editing 3 files", "Running cargo test", "Blocked: approval". */
  phase: string | null;
  tone: "idle" | "working" | "blocked" | "done" | "failed" | "paused";
  /** distinct files the agent has touched in this task */
  filesTouched: number;
}

/** The Valyria Home surface (docs/UX-DIFFERENTIATION.md, lever D) — the editor
 *  tab you land on: a task prompt, active + recent tasks, and the runtime state. */
export interface HomeModel {
  connection: Connection;
  hasRepo: boolean;
  repoName: string | null;
  canSubmit: boolean;
  activeModel: string | null;
  networkRuntime: boolean;
  autonomy: string | null;
  layoutMode: "agent" | "editor";
  active: HomeTask[];
  recent: HomeTask[];
}
export interface HomeTask {
  id: string;
  objective: string | null;
  state: string;
  terminal: boolean;
  blocked: boolean;
  filesTouched: number;
  when: string;
}

/** The Task Workspace surface — the focused task as a full editor-area document:
 *  conversation, plan, changed files, verification, and any pending approval in
 *  one layout. Assembled from the same selectors the sidebar views use. */
export interface WorkspaceModel {
  connection: Connection;
  taskId: string | null;
  objective: string | null;
  state: string | null;
  terminal: boolean;
  working: boolean;
  blocked: boolean;
  canSubmit: boolean;
  transcript: ChatEntry[];
  planSteps: { intent: string; status: string | null; checkpoint: boolean }[];
  files: { path: string; change: string | null; ownership: string | null }[];
  tests: {
    command: string;
    outcome: "started" | "passed" | "failed";
    summary: string | null;
    failureCount: number | null;
  }[];
  verified: { kind: string; command: string; outcome: string }[];
  unverified: string[];
  approval: { seq: number; prompt: string; tool: string | null; risk: string | null } | null;
}

/** The Review surface — agent-authored changes framed for approval, each row a
 *  jump into the editor's own diff. Ownership + verification come from Core
 *  (ledger + task_report); the app never infers ownership. */
export interface ReviewModel {
  connection: Connection;
  taskId: string | null;
  objective: string | null;
  ledgerAvailable: boolean;
  reportStatus: string | null;
  files: {
    path: string;
    change: string | null;
    /** agent_authored | concurrent_user_modification | pre_existing | unknown | null */
    ownership: string | null;
  }[];
  verified: { kind: string; command: string; outcome: string }[];
  unverified: string[];
  approval: { seq: number; prompt: string; tool: string | null; risk: string | null } | null;
}

export interface ActivityModel {
  connection: Connection;
  /** humanised narrative, oldest → newest */
  lines: string[];
  /** count of events the decoder could not type (D5) */
  degraded: number;
}

export interface ChatEntry {
  seq: number;
  role: "you" | "agent";
  text: string;
}

export interface ChatModel {
  connection: Connection;
  taskId: string | null;
  objective: string | null;
  state: string | null;
  terminal: boolean;
  working: boolean;
  blocked: boolean;
  transcript: ChatEntry[];
  canSubmit: boolean;
}

export interface FailureLoc {
  kind: string | null;
  message: string | null;
  failingTest: string | null;
  locations: { path: string; line: number | null }[];
}

export interface TaskModel {
  taskId: string | null;
  objective: string | null;
  state: string | null;
  terminal: boolean;
  planSteps: { intent: string; status: string | null; checkpoint: boolean }[];
  checkpoints: {
    stepId: string | null;
    intent: string | null;
    rollbackBoundary: boolean;
    checkpointId: string | null;
    rollbackReady: boolean;
  }[];
  files: { path: string; change: string | null }[];
  tests: {
    command: string;
    outcome: "started" | "passed" | "failed";
    summary: string | null;
    failureCount: number | null;
    failures: FailureLoc[];
  }[];
  approval: { prompt: string; tool: string | null; risk: string | null } | null;
  agentCommandCount?: number;
}

export interface AgentCommandsModel {
  taskId: string | null;
  commands: {
    seq: number;
    program: string;
    args: string[];
    exitCode: number | null;
    stdout: string | null;
    stderr: string | null;
    raw: string | null;
    succeeded: boolean | null;
    durationMs: number | null;
    pending: boolean;
  }[];
}

export interface VerificationModel {
  taskId: string | null;
  status: string | null;
  verified: { kind: string; command: string; outcome: string; runId: string }[];
  unverified: string[];
  hasReport: boolean;
}

export interface TimelineRow {
  seq: number;
  ts: number;
  kind: string;
  taskId: string | null;
  degraded: boolean;
  summary: string;
  raw: string;
}
export interface TimelineModel {
  rows: TimelineRow[];
}

export interface ApprovalsModel {
  taskId: string | null;
  allowForTaskSupported: boolean;
  approval: {
    seq: number;
    prompt: string;
    tool: string | null;
    category: string | null;
    target: string | null;
    /** "destructive" | "network" | "elevated" | "standard" | null */
    risk: string | null;
  } | null;
}

export interface SecurityModel {
  autonomy: {
    mode: string | null;
    canChange: boolean;
    reason: string;
    levels: { id: string; label: string; desc: string }[];
  };
  settings: { key: string; value: string | null; origin: string | null; reported: boolean }[];
  checks: { name: string; status: string; detail: string; remediation: string | null }[];
  doctorSummary: string | null;
  repoInstructions: { name: string; text: string; authorized: boolean }[];
  compatible: boolean | null;
}

/** A model install the event stream is tracking (§20). */
export interface ModelInstallRow {
  id: string;
  /** "downloading" | "verifying" | "probing" while running. */
  phase: string | null;
  downloadedBytes: number;
  totalBytes: number;
  status: "running" | "completed" | "failed";
  /** `model_store.*` code on failure (`model_store.cancelled` for a cancel). */
  code: string | null;
  message: string | null;
  /** 0..1, or null when the total is not yet known. */
  fraction: number | null;
}

/** One row of the model manager — a catalog model joined with local state,
 *  hardware fit for the focused role, and any live install. */
export interface ModelRow {
  id: string;
  displayName: string;
  family: string;
  quantization: string;
  parametersB: number;
  contextLength: number;
  sizeBytes: number;
  installed: boolean;
  license: string;
  /** `ModelRole` names this model currently serves. */
  activeRoles: string[];
  /** Fit for the focused role, from `model/recommend`. Null when hardware
   *  scoring is unavailable or the model is not a candidate for the role. */
  fit: "comfortable" | "tight" | "will_not_fit" | null;
  fitDetail: string | null;
  /** Catalog role suitability 0..100 for the focused role, when scored. */
  suitability: number | null;
  /** True when this is Core's top pick for the focused role. */
  recommended: boolean;
  /** The live install for this model, if the stream has seen one. */
  install: ModelInstallRow | null;
}

export interface ModelsModel {
  /** `model_manage` — install / cancel / activate / remove are reachable. */
  manageCapable: boolean;
  /** `hardware` — the shortlist can be fit-scored. */
  hardwareCapable: boolean;
  hasList: boolean;
  /** The role the shortlist + recommendation are scoped to. */
  role: string;
  /** Every assignable `ModelRole`, for the activate control. */
  roles: string[];
  /** Core's recommended model id for `role`, if anything fits. */
  recommendedId: string | null;
  /** Recommended first, then other fitting, then non-fitting, then the rest. */
  models: ModelRow[];
  /** Role→model bindings from `model/list` (`active_roles`), for the summary. */
  bindings: { role: string; modelId: string }[];
}

export interface HardwareModel {
  hasProbe: boolean;
  hardwareCapable: boolean;
  os: string | null;
  arch: string | null;
  cpu: { brand: string | null; physicalCores: number | null; logicalCores: number | null } | null;
  ramTotalBytes: number | null;
  ramAvailableBytes: number | null;
  diskAvailableBytes: number | null;
  unifiedMemory: boolean | null;
  acceleratorPresent: boolean | null;
  gpus: { name: string; vendor: string | null; vramBytes: number | null }[];
  recommendation: {
    role: string;
    recommendedId: string | null;
    candidates: {
      id: string;
      displayName: string;
      sizeBytes: number | null;
      /** "comfortable" | "tight" | "will_not_fit" */
      fitKind: string;
      fitDetail: string | null;
      suitability: number | null;
      installed: boolean;
    }[];
  } | null;
}

export interface SettingsModel {
  hasConfig: boolean;
  sections: {
    title: string;
    rows: { key: string; value: string; origin: string; editable: boolean }[];
  }[];
}

export interface AboutModel {
  appName: string;
  bridgeHost: string;
  expectedProtocol: string;
  connection: Connection;
  platform: string;
  windowsTier3: boolean;
  session: {
    protocolVersion: string;
    runtimeVersion: string;
    origin: string;
    ownsDaemon: boolean;
    authenticated: boolean;
    permissionMode: string | null;
    workspaceRoot: string;
  } | null;
  compatibility: "compatible" | "incompatible" | "no session" | string;
  capabilities: string[];
  surfaces: { surface: string; available: boolean; missing?: string; gap?: string }[];
  models: { id: string; installed: boolean; active: boolean }[];
}

export interface ContextModel {
  available: boolean;
  taskId: string | null;
  items: {
    seq: number;
    source: string | null;
    path: string | null;
    trust: string | null;
    tokens: number | null;
    summary: string;
  }[];
}

export interface HistoryTask {
  id: string;
  objective: string | null;
  state: string;
  terminal: boolean;
  blocked: boolean;
  focused: boolean;
}
export interface HistoryModel {
  focusedTaskId: string | null;
  groups: { day: string; tasks: HistoryTask[] }[];
}

// --- command names (webview → host) ---------------------------------

export const CMD = {
  createTask: "createTask",
  pauseTask: "pauseTask",
  resumeTask: "resumeTask",
  cancelTask: "cancelTask",
  focusTask: "focusTask",
  /** { allow: boolean, seq: number, scope?: "once" | "task" } */
  resolveApproval: "resolveApproval",
  /** { mode: "manual" | "assisted" | "autonomous" } */
  setAutonomy: "setAutonomy",
  refreshSecurity: "refreshSecurity",
  openFile: "openFile", // { path: string, line?: number }
  /** { checkpointId: string, intent?: string } */
  rollbackTo: "rollbackTo",
  refreshVerification: "refreshVerification",
  /** { id: string } — host runs model/inspect, shows the license, installs on accept */
  installModel: "installModel",
  /** { id: string } — cancel an in-flight install */
  cancelModelInstall: "cancelModelInstall",
  /** { id: string, role: string } */
  activateModel: "activateModel",
  /** { id: string } */
  removeModel: "removeModel",
  /** { role: string } — re-scope the shortlist + recommendation */
  setModelRole: "setModelRole",
  refreshModels: "refreshModels",
  refreshHardware: "refreshHardware",
  /** open the Models view (from the Hardware recommendation) */
  openModelManager: "openModelManager",
  /** { key: string, value: string } */
  writeConfig: "writeConfig",
  firstRunOpenRepo: "firstRunOpenRepo",
  firstRunProbeTask: "firstRunProbeTask",
  firstRunDismiss: "firstRunDismiss",
  /** open one of the editor-area surfaces: { surface: "home" | "workspace" | "review" } */
  openSurface: "openSurface",
  /** open the editor's own diff for an agent-changed file: { path: string } */
  openDiff: "openDiff",
  /** { mode: "agent" | "editor" } */
  setLayoutMode: "setLayoutMode",
} as const;
