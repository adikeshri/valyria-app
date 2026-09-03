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

export interface ModelsModel {
  manageCapable: boolean;
  hasList: boolean;
  models: {
    id: string;
    family: string;
    quantization: string;
    sizeBytes: number;
    installed: boolean;
    license: string;
    active: boolean;
  }[];
  bindings: { key: string; value: string; origin: string }[];
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
    candidates: { id: string; fits: boolean; reason: string | null }[];
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
  /** { id: string, action: "install" | "remove" | "activate" } */
  manageModel: "manageModel",
  refreshModels: "refreshModels",
  refreshHardware: "refreshHardware",
  /** { key: string, value: string } */
  writeConfig: "writeConfig",
  firstRunOpenRepo: "firstRunOpenRepo",
  firstRunProbeTask: "firstRunProbeTask",
  firstRunDismiss: "firstRunDismiss",
} as const;
