// The normalized store shape (docs/PLAN.md §2 "packages/state").
//
// Everything here is derived from protocol responses and the event stream and
// can be rebuilt from scratch by replaying from seq = 0 (D3). Nothing in this
// package is authoritative.

export type ConnectionState =
  | "starting"
  | "connecting"
  | "ready"
  | "degraded"
  | "reconnecting"
  | "incompatible"
  | "failed";

/** Core's own task-machine vocabulary, lowercased. Kept 1:1 with the wire
 *  rather than bucketed — the reducer must not invent states (§41). An
 *  unrecognized `to` value becomes `"unknown"`. */
export type TaskState =
  | "idle"
  | "understanding"
  | "discovery"
  | "planning"
  | "implementing"
  | "verifying"
  | "repairing"
  | "waiting_for_permission"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskProjection {
  id: string;
  /** last known state, from the most recent `state_changed` */
  state: TaskState | "unknown";
  /** the objective, once a `task_started` payload has carried it */
  objective: string | null;
  /** seq of the event that last touched this task — the sort key, never wall clock (PLAN §3) */
  lastSeq: number;
  firstSeenSeq: number;
  /** wall-clock ms of the first and last event for this task (render only) */
  firstTs: number;
  lastTs: number;
  /** true once a terminal event (task_completed / task_failed) has arrived */
  terminal: boolean;
}

export interface EventRow {
  seq: number;
  ts: number;
  kind: string;
  taskId: string | null;
  /** the decoded payload (loose — Core's payloads are schema-free, D5) */
  payload: unknown;
  /** true when the decoder could not type this payload — renders with a raw
   *  disclosure rather than a friendly row (D5) */
  degraded: boolean;
}

/** Latest plan seen for a task (`plan_created`). Payload is loose by design. */
export interface PlanProjection {
  taskId: string;
  seq: number;
  payload: unknown;
}

/** Latest approval ask for a task (`approval_requested`). Visibility is derived
 *  from task state, not stored — see `pendingApprovalFor`. */
export interface ApprovalProjection {
  taskId: string;
  seq: number;
  payload: unknown;
}

export interface StoreState {
  connection: ConnectionState;
  /** contiguity cursor: the highest seq applied. `0` before the first event
   *  (Core's seq run starts at 1; `since` is exclusive). */
  lastSeq: number;
  /** set when a gap is detected; the pump re-subscribes rather than guessing (PLAN §4.3) */
  gapDetected: boolean;
  tasks: Record<string, TaskProjection>;
  plans: Record<string, PlanProjection>;
  approvals: Record<string, ApprovalProjection>;
  /** append-only; corrections arrive as later events, earlier rows never mutate (PLAN §3) */
  events: EventRow[];
}

export function emptyStore(): StoreState {
  return {
    connection: "starting",
    lastSeq: 0,
    gapDetected: false,
    tasks: {},
    plans: {},
    approvals: {},
    events: [],
  };
}
