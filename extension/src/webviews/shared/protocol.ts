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

/** A managed `llama-server` backing the coding model, live off the event
 *  stream (`model_inference` — `model_server_starting` / `_ready` /
 *  `_failed` / `_stopped`). There's only ever one role in play (see
 *  `store/models.ts`'s note on `DEFAULT_MODEL_ROLE`), so this carries no
 *  role name — just the state of *the* active model's server. */
export interface ModelServerRow {
  state: "starting" | "ready" | "failed" | "stopped";
  /** Loopback port once `ready`. */
  port: number | null;
  /** `llamacpp.*` / `engine_store.*` code on a failure. */
  code: string | null;
  message: string | null;
}

/** One row of the model manager — a catalog model joined with local state
 *  and any live install. */
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
  /** This is the model currently active for coding. */
  active: boolean;
  /** Can this model actually serve chat/tool-calling? `false` for
   *  embedder/reranker models — see `isChatCapable`'s doc comment. They can
   *  still be installed, just never offered as the active coding model. */
  chatCapable: boolean;
  /** Fit for coding, from `model/recommend`. Null when hardware scoring is
   *  unavailable or the model isn't a candidate. */
  fit: "comfortable" | "tight" | "will_not_fit" | null;
  fitDetail: string | null;
  /** Catalog suitability 0..100 for coding, when scored. */
  suitability: number | null;
  /** True when this is Core's top pick. */
  recommended: boolean;
  /** The live install for this model, if the stream has seen one. */
  install: ModelInstallRow | null;
  /** The active model's live server, if the stream has seen one — empty
   *  when `model_inference` is absent, this isn't the active model, or
   *  nothing has been activated yet. */
  servers: ModelServerRow[];
  /** An activate/restart request for this model is in flight. `model_activate`
   *  blocks until the server answers `/health` or fails (tens of seconds), so
   *  without this the button gives no feedback and a second click boots a
   *  second `llama-server` — two boots contending for RAM can starve each
   *  other past the health-check timeout. */
  actionPending: boolean;
}

export interface ModelsModel {
  /** `model_manage` — install / cancel / activate / remove are reachable. */
  manageCapable: boolean;
  /** `hardware` — the shortlist can be fit-scored. */
  hardwareCapable: boolean;
  /** `model_inference` — activating a model boots a real server and reports
   *  `servers` above; without it, activation still works but is silent
   *  about whether the model is actually serving. */
  inferenceCapable: boolean;
  hasList: boolean;
  /** Core's recommended model id for coding, if anything fits. */
  recommendedId: string | null;
  /** Recommended first, then other fitting, then non-fitting, then the rest. */
  models: ModelRow[];
  /** Inference-engine (llama.cpp) download, if the event stream has seen
   *  one — Core fetching its own `llama-server` before the first activate. */
  engineInstall: ModelInstallRow | null;
}

/** The primary product surface (right-hand Secondary Side Bar, like
 *  Cursor's chat): a message here becomes a real Core task —
 *  `task/create`, the full agent loop (system prompt, tools, plan,
 *  verification), not a raw model probe. `transcript`/`canSubmit` are
 *  exactly {@link ChatModel}'s; this adds the in-chat model picker and an
 *  inline approval prompt, since the sidebar no longer has separate
 *  Models/Approvals/Task/Activity panels to show one in. */
export interface ModelChatModel {
  connection: Connection;
  /** `model_inference` — without it, activating a model never boots a real
   *  server, so there's nothing behind `activeModelId` even when set. */
  inferenceCapable: boolean;
  /** Every installed, chat-capable model — the picker's option list.
   *  `unratedForCoding`: Core's catalog gives this model no `primary_coder`
   *  suitability at all (not just a low one) — it's tuned for something
   *  else (autocomplete, summarizing, ...) and activating it here tends to
   *  produce nonsense tool calls even for a plain "Hi". `false` when
   *  hardware scoring is unavailable, not when it's actually confirmed fit. */
  models: { id: string; displayName: string; unratedForCoding: boolean }[];
  /** Which of `models` is currently active for coding, if any. */
  activeModelId: string | null;
  /** An activate request from the picker is in flight — `model_activate`
   *  blocks for as long as the server takes to boot, so the picker disables
   *  itself rather than let a second selection race the first. */
  activating: boolean;
  taskId: string | null;
  objective: string | null;
  state: string | null;
  terminal: boolean;
  working: boolean;
  blocked: boolean;
  canSubmit: boolean;
  transcript: ChatEntry[];
  approval: {
    seq: number;
    prompt: string;
    tool: string | null;
    category: string | null;
    target: string | null;
    risk: string | null;
    allowForTaskSupported: boolean;
  } | null;
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
  windowsReducedSandbox: boolean;
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
  /** { id: string } — make this the active coding model */
  activateModel: "activateModel",
  /** { id: string } — re-activate the model already bound, e.g. after
   *  `model_server_failed` */
  restartServer: "restartServer",
  /** { id: string } */
  removeModel: "removeModel",
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
