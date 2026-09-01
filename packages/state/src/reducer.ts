// The reducer (docs/PLAN.md D4): synchronous, pure, no side effects, no
// Date.now(). This is what makes crash recovery (§30) a property we can test
// against recorded traces rather than a hope.

import { decodeEvent, type DecodedEvent } from "@valyria/protocol";
import {
  emptyStore,
  type ConnectionState,
  type EventRow,
  type FileChangeProjection,
  type StoreState,
  type TaskProjection,
  type TaskState,
  type FailureProjection,
  type TestProjection,
  type TestRunProjection,
} from "./store.js";

/** Apply one raw wire event. `raw` is whatever came off the socket. */
export function applyRawEvent(state: StoreState, raw: unknown): StoreState {
  return applyDecoded(state, decodeEvent(raw));
}

/** Fold a whole batch (the pump's unit of delivery) in one pass. The
 *  append-only `events` array is copied exactly once for the batch rather than
 *  once per event — a 512-event pump delivery onto a large store is O(batch),
 *  not O(batch × store) (docs/PLAN.md §9 event-ingest budget). */
export function applyBatch(state: StoreState, raws: readonly unknown[]): StoreState {
  let s = state;
  const appended: EventRow[] = [];
  for (const r of raws) {
    const { state: next, row } = applyDecodedNoAppend(s, decodeEvent(r));
    s = next;
    if (row) appended.push(row);
  }
  if (appended.length === 0) return s;
  return { ...s, events: [...state.events, ...appended] };
}

/** Set the transport-level connection state (not event-derived). */
export function setConnection(state: StoreState, connection: ConnectionState): StoreState {
  return state.connection === connection ? state : { ...state, connection };
}

/** Apply an already-decoded event. Split out so tests can inject decoder output. */
export function applyDecoded(state: StoreState, ev: DecodedEvent): StoreState {
  const { state: next, row } = applyDecodedNoAppend(state, ev);
  if (!row) return next;
  return { ...next, events: [...state.events, row] };
}

/** The body of {@link applyDecoded} minus the `events` append: returns the new
 *  state (with `events` left untouched) plus the row to append, or `null` when
 *  the event was ignored. Lets {@link applyBatch} copy `events` once per batch
 *  instead of once per event. */
function applyDecodedNoAppend(
  state: StoreState,
  ev: DecodedEvent,
): { state: StoreState; row: EventRow | null } {
  const expected = state.lastSeq + 1;
  if (ev.seq < expected) {
    return { state, row: null }; // already applied (idempotent resume) — ignore
  }
  const gapDetected = state.gapDetected || ev.seq > expected;

  const row: EventRow = {
    seq: ev.seq,
    ts: ev.ts,
    kind: ev.kind,
    taskId: ev.taskId,
    payload: ev.ok ? ev.payload : ev.raw,
    degraded: !ev.ok,
  };

  const next: StoreState = {
    ...state,
    lastSeq: ev.seq,
    gapDetected,
  };

  if (ev.taskId) {
    next.tasks = {
      ...state.tasks,
      [ev.taskId]: advanceTask(state.tasks[ev.taskId], ev),
    };

    if (ev.ok && ev.kind === "plan_created") {
      next.plans = {
        ...state.plans,
        [ev.taskId]: { taskId: ev.taskId, seq: ev.seq, payload: ev.payload },
      };
    }
    if (ev.ok && ev.kind === "approval_requested") {
      next.approvals = {
        ...state.approvals,
        [ev.taskId]: { taskId: ev.taskId, seq: ev.seq, payload: ev.payload },
      };
    }

    if (ev.ok) {
      const files = foldFileChange(state.files[ev.taskId], ev);
      if (files !== state.files[ev.taskId]) {
        next.files = { ...state.files, [ev.taskId]: files };
      }
      const tests = foldTestRun(state.tests[ev.taskId], ev);
      if (tests && tests !== state.tests[ev.taskId]) {
        next.tests = { ...state.tests, [ev.taskId]: tests };
      }
    }
  }
  return { state: next, row };
}

/** `file_changed`, plus write/edit `tool_started` (its `input.path`), folded
 *  into the changed-file rail. Returns the same reference when nothing changed
 *  so the caller can skip the copy. */
function foldFileChange(
  prev: readonly FileChangeProjection[] | undefined,
  ev: DecodedEvent & { ok: true },
): FileChangeProjection[] {
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  let path: string | undefined;
  let change: string | null = null;

  if (ev.kind === "file_changed") {
    path = typeof p.path === "string" ? p.path : undefined;
    change = typeof p.change === "string" ? p.change : null;
  } else if (ev.kind === "tool_started") {
    const tool = typeof p.tool === "string" ? p.tool : "";
    const input = p.input;
    const ipath =
      input && typeof input === "object" && "path" in input
        ? (input as { path?: unknown }).path
        : undefined;
    if (/write|edit|patch/.test(tool) && typeof ipath === "string") {
      path = ipath;
    }
  }
  if (!path) return (prev ?? []) as FileChangeProjection[];

  const list = prev ? [...prev] : [];
  const at = list.findIndex((f) => f.path === path);
  if (at === -1) {
    list.push({ path, change, firstSeq: ev.seq, lastSeq: ev.seq });
  } else {
    const cur = list[at]!;
    list[at] = { ...cur, change: change ?? cur.change, lastSeq: ev.seq };
  }
  return list;
}

/** `test_started` / `test_passed` / `test_failed` folded per verification
 *  command, latest event wins (a `started` row is replaced by its outcome). */
function foldTestRun(
  prev: TestProjection | undefined,
  ev: DecodedEvent & { ok: true },
): TestProjection | undefined {
  if (
    ev.kind !== "test_started" &&
    ev.kind !== "test_passed" &&
    ev.kind !== "test_failed"
  ) {
    return prev;
  }
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  const command = typeof p.command === "string" ? p.command : "(unnamed run)";
  const run: TestRunProjection = {
    command,
    outcome:
      ev.kind === "test_passed"
        ? "passed"
        : ev.kind === "test_failed"
          ? "failed"
          : "started",
    runId: typeof p.run_id === "string" ? p.run_id : null,
    failureCount:
      typeof p.failure_count === "number" ? p.failure_count : null,
    summary:
      typeof p.summary === "string"
        ? p.summary
        : typeof p.outcome === "string"
          ? p.outcome
          : null,
    failures: parseFailures(p.failures),
    seq: ev.seq,
  };

  const runs = prev ? [...prev.runs] : [];
  const at = runs.findIndex((r) => r.command === command);
  if (at === -1) runs.push(run);
  else runs[at] = run;
  return { taskId: ev.taskId as string, runs };
}

/** G15: Core's `failures[]` — `{ kind, message, failing_test, location[] }` —
 *  into `FailureProjection[]`. Loose by design (D5): a non-array or malformed
 *  entry degrades to fewer fields, never a throw. */
function parseFailures(raw: unknown): FailureProjection[] {
  if (!Array.isArray(raw)) return [];
  const out: FailureProjection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const locsRaw = Array.isArray(f.location) ? f.location : [];
    const locations: { path: string; line: number | null }[] = [];
    for (const l of locsRaw) {
      if (!l || typeof l !== "object") continue;
      const loc = l as Record<string, unknown>;
      if (typeof loc.path !== "string") continue;
      locations.push({
        path: loc.path,
        line: typeof loc.line === "number" ? loc.line : null,
      });
    }
    out.push({
      kind: typeof f.kind === "string" ? f.kind : null,
      message: typeof f.message === "string" ? f.message : null,
      failingTest: typeof f.failing_test === "string" ? f.failing_test : null,
      locations,
    });
  }
  return out;
}

function advanceTask(
  prev: TaskProjection | undefined,
  ev: DecodedEvent,
): TaskProjection {
  const base: TaskProjection = prev ?? {
    id: ev.taskId as string,
    state: "unknown",
    objective: null,
    lastSeq: ev.seq,
    firstSeenSeq: ev.seq,
    firstTs: ev.ts,
    lastTs: ev.ts,
    terminal: false,
  };

  let taskState = base.state;
  let terminal = base.terminal;
  let objective = base.objective;

  if (ev.ok) {
    const payload = (ev.payload ?? {}) as Record<string, unknown>;
    if (ev.kind === "task_started" && typeof payload.objective === "string") {
      objective = payload.objective;
    }
    if (ev.kind === "state_changed" && typeof payload.to === "string") {
      taskState = normalizeState(payload.to);
    }
    if (ev.kind === "task_completed") {
      taskState = "completed";
      terminal = true;
    }
    if (ev.kind === "task_failed") {
      taskState = "failed";
      terminal = true;
    }
  }

  return {
    ...base,
    state: taskState,
    objective,
    lastSeq: ev.seq,
    lastTs: ev.ts,
    terminal,
  };
}

/** Core's state names are SCREAMING_SNAKE on the wire; the store uses lower and
 *  keeps them 1:1 (§41 — no bucketing). Unknown values become "unknown". */
function normalizeState(wire: string): TaskState | "unknown" {
  const v = wire.toLowerCase();
  const known: TaskState[] = [
    "idle",
    "understanding",
    "discovery",
    "planning",
    "implementing",
    "verifying",
    "repairing",
    "waiting_for_permission",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ];
  return (known as string[]).includes(v) ? (v as TaskState) : "unknown";
}

/** Replay a whole trace from the empty store — the primary test entry point. */
export function replay(rawEvents: readonly unknown[]): StoreState {
  return applyBatch(emptyStore(), rawEvents);
}

/** A `task_list` / `task_status` row. The event stream never carries the
 *  objective (`task_started` payload is `{}`), so it is merged in from here. */
export interface TaskSummaryLike {
  task_id: string;
  objective: string;
  state: string;
  created_at_ms?: number;
  updated_at_ms?: number;
}

const TERMINAL_STATES = new Set<TaskState | "unknown">(["completed", "failed", "cancelled"]);

/** Merge task summaries into the projection. The event stream stays
 *  authoritative for `state` / `terminal` on any task it has actually touched
 *  (`lastSeq > 0`); summaries fill objective, and everything for
 *  history-only tasks. */
export function mergeTaskSummaries(
  state: StoreState,
  summaries: readonly TaskSummaryLike[],
): StoreState {
  let tasks = state.tasks;
  let changed = false;

  for (const su of summaries) {
    const prev = tasks[su.task_id];
    const streamed = prev !== undefined && prev.lastSeq > 0;
    const summaryState = normalizeState(su.state);

    const merged: TaskProjection = {
      id: su.task_id,
      state: streamed ? prev.state : summaryState,
      objective: prev?.objective ?? (su.objective || null),
      lastSeq: prev?.lastSeq ?? 0,
      firstSeenSeq: prev?.firstSeenSeq ?? 0,
      firstTs: prev?.firstTs ?? su.created_at_ms ?? 0,
      lastTs: prev?.lastTs ?? su.updated_at_ms ?? 0,
      terminal: streamed ? prev.terminal : TERMINAL_STATES.has(summaryState),
    };

    if (
      !prev ||
      prev.state !== merged.state ||
      prev.objective !== merged.objective ||
      prev.terminal !== merged.terminal ||
      prev.lastTs !== merged.lastTs
    ) {
      if (!changed) {
        tasks = { ...tasks };
        changed = true;
      }
      tasks[su.task_id] = merged;
    }
  }

  return changed ? { ...state, tasks } : state;
}
