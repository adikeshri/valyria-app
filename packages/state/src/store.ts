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

export type TaskState =
  | "planning"
  | "running"
  | "waiting_for_permission"
  | "verifying"
  | "repairing"
  | "paused"
  | "completed"
  | "failed";

export interface TaskProjection {
  id: string;
  /** last known state, from the most recent `state_changed` */
  state: TaskState | "unknown";
  /** seq of the event that last touched this task — the sort key, never wall clock (PLAN §3) */
  lastSeq: number;
  firstSeenSeq: number;
  /** true once a terminal event (task_completed / task_failed) has arrived */
  terminal: boolean;
}

export interface RawEventRow {
  seq: number;
  ts: number;
  kind: string;
  taskId: string | null;
  /** true when the decoder could not type this payload — renders with a raw disclosure (D5) */
  degraded: boolean;
}

export interface StoreState {
  connection: ConnectionState;
  /** contiguity cursor: the highest seq applied. -1 before the first event. */
  lastSeq: number;
  /** set when a gap is detected; the pump re-subscribes rather than guessing (PLAN §4.3) */
  gapDetected: boolean;
  tasks: Record<string, TaskProjection>;
  /** append-only; corrections arrive as later events, earlier rows never mutate (PLAN §3) */
  events: RawEventRow[];
}

export function emptyStore(): StoreState {
  return {
    connection: "starting",
    lastSeq: -1,
    gapDetected: false,
    tasks: {},
    events: [],
  };
}
