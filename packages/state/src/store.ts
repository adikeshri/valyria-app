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

/** One file the agent touched during a task, folded from `file_changed` and
 *  write/edit `tool_*` events (§4.8). `firstSeq`/`lastSeq` order the rail on
 *  `seq`, never wall clock (§3). Ownership (agent / user / pre-existing) is
 *  deliberately absent — Core's ledger is not on the wire (G8), and the app
 *  never guesses it from touch order. */
export interface FileChangeProjection {
  path: string;
  /** best-effort from the event: "modified" | "added" | "deleted" | "renamed" */
  change: string | null;
  firstSeq: number;
  lastSeq: number;
}

/** Test outcomes for a task, folded from `test_started` / `test_passed` /
 *  `test_failed` (§4.11). One row per distinct command; the latest event for a
 *  command wins. `NOT RUN` categories are the panel's job — this only records
 *  what Core actually emitted. */
export type TestOutcome = "started" | "passed" | "failed";

/** One parsed verification failure (§19, §35, G15). Locations are Core's — the
 *  app renders them as jump targets and never parses a digest itself. */
export interface FailureProjection {
  /** `compile_error` | `test_failure` | `test_panic` | `lint_error` |
   *  `type_error` | `format_violation` | `timeout` | `unknown` */
  kind: string | null;
  message: string | null;
  failingTest: string | null;
  locations: { path: string; line: number | null }[];
}

export interface TestRunProjection {
  /** the verification command, e.g. `cargo test` — the stable identity */
  command: string;
  outcome: TestOutcome;
  /** VERIFY_RESULT payload fields, when present */
  runId: string | null;
  failureCount: number | null;
  summary: string | null;
  /** G15: Core's parsed failures with file/line locations. Empty until a
   *  `test_failed` / `verification_evidence` event carries them. */
  failures: FailureProjection[];
  seq: number;
}

export interface TestProjection {
  taskId: string;
  runs: TestRunProjection[];
}

/** A model install folded from `model_install_progress` / `_completed` /
 *  `_failed` (workspace-global events, `task_id: null`). One entry per model
 *  id; the latest event wins. Survives a reconnect because those events
 *  replay from the journal like any other. */
export interface ModelInstallProjection {
  id: string;
  /** "downloading" | "verifying" | "probing" while running; unchanged on a
   *  terminal event. */
  phase: string | null;
  downloadedBytes: number;
  totalBytes: number;
  status: "running" | "completed" | "failed";
  /** `model_store.*` code on a failure (e.g. `model_store.cancelled`). */
  code: string | null;
  message: string | null;
  /** seq of the last event that touched this install — the sort/staleness key. */
  lastSeq: number;
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
  /** per-task changed-file rail (§4.8) */
  files: Record<string, FileChangeProjection[]>;
  /** per-task test outcomes (§4.11) */
  tests: Record<string, TestProjection>;
  /** in-flight and recently-finished model installs, keyed by model id (§20) */
  modelInstalls: Record<string, ModelInstallProjection>;
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
    files: {},
    tests: {},
    modelInstalls: {},
    events: [],
  };
}
