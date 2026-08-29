// The reducer (docs/PLAN.md D4): synchronous, pure, no side effects, no
// Date.now(). This is what makes crash recovery (§30) a property we can test
// against recorded traces rather than a hope.

import { decodeEvent, type DecodedEvent } from "@valyria/protocol";
import {
  emptyStore,
  type ConnectionState,
  type StoreState,
  type TaskProjection,
  type TaskState,
} from "./store.js";

/** Apply one raw wire event. `raw` is whatever came off the socket. */
export function applyRawEvent(state: StoreState, raw: unknown): StoreState {
  return applyDecoded(state, decodeEvent(raw));
}

/** Fold a whole batch (the pump's unit of delivery) in one pass. */
export function applyBatch(state: StoreState, raws: readonly unknown[]): StoreState {
  return raws.reduce<StoreState>((s, r) => applyRawEvent(s, r), state);
}

/** Set the transport-level connection state (not event-derived). */
export function setConnection(state: StoreState, connection: ConnectionState): StoreState {
  return state.connection === connection ? state : { ...state, connection };
}

/** Apply an already-decoded event. Split out so tests can inject decoder output. */
export function applyDecoded(state: StoreState, ev: DecodedEvent): StoreState {
  const expected = state.lastSeq + 1;
  if (ev.seq < expected) {
    return state; // already applied (idempotent resume) — ignore
  }
  const gapDetected = state.gapDetected || ev.seq > expected;

  const next: StoreState = {
    ...state,
    lastSeq: ev.seq,
    gapDetected,
    events: [
      ...state.events,
      {
        seq: ev.seq,
        ts: ev.ts,
        kind: ev.kind,
        taskId: ev.taskId,
        payload: ev.ok ? ev.payload : ev.raw,
        degraded: !ev.ok,
      },
    ],
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
  }
  return next;
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
