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

export interface TaskModel {
  taskId: string | null;
  objective: string | null;
  state: string | null;
  terminal: boolean;
  planSteps: { intent: string; status: string | null; checkpoint: boolean }[];
  checkpoints: { stepId: string | null; intent: string | null; rollbackBoundary: boolean }[];
  files: { path: string; change: string | null }[];
  tests: {
    command: string;
    outcome: "started" | "passed" | "failed";
    summary: string | null;
    failureCount: number | null;
  }[];
  approval: { prompt: string; tool: string | null; risk: string | null } | null;
  agentCommandCount?: number;
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
  resolveApproval: "resolveApproval", // { allow: boolean }
} as const;
