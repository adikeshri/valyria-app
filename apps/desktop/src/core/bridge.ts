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
  sessionOpen: (workspaceRoot: string) =>
    invoke<SessionInfo>("session_open", { workspaceRoot }),
  sessionStatus: () => invoke<SessionInfo | null>("session_status"),
  taskCreate: (objective: string) => invoke<string>("task_create", { objective }),
  taskList: () => invoke<{ tasks: TaskSummary[] }>("task_list"),
  taskStatus: (taskId: string) => invoke<TaskStatus>("task_status", { taskId }),
  taskPlan: (taskId: string) => invoke<PlanGet>("task_plan", { taskId }),
  taskReport: (taskId: string) => invoke<TaskReport>("task_report", { taskId }),
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
