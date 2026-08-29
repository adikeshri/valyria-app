// The reducer (docs/PLAN.md D4): synchronous, pure, no side effects, no
// Date.now(). This is what makes crash recovery (§30) a property we can test
// against recorded traces rather than a hope.

import { decodeEvent, type DecodedEvent } from "@valyria/protocol";
import {
  emptyStore,
  type StoreState,
  type TaskProjection,
  type TaskState,
} from "./store.js";

/** Apply one raw wire event. `raw` is whatever came off the socket. */
export function applyRawEvent(state: StoreState, raw: unknown): StoreState {
  return applyDecoded(state, decodeEvent(raw));
}

/** Apply an already-decoded event. Split out so tests can inject decoder output. */
export function applyDecoded(state: StoreState, ev: DecodedEvent): StoreState {
  // Contiguity: the pump asserts firstSeq === lastSeq + 1 per batch; here we
  // guard per event so a replayed trace with a hole is caught in unit tests too.
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
        degraded: !ev.ok,
      },
    ],
  };

  if (ev.taskId) {
    next.tasks = {
      ...state.tasks,
      [ev.taskId]: advanceTask(state.tasks[ev.taskId], ev),
    };
  }
  return next;
}

function advanceTask(
  prev: TaskProjection | undefined,
  ev: DecodedEvent,
): TaskProjection {
  const base: TaskProjection =
    prev ??
    {
      id: ev.taskId as string,
      state: "unknown",
      lastSeq: ev.seq,
      firstSeenSeq: ev.seq,
      terminal: false,
    };

  let taskState = base.state;
  let terminal = base.terminal;

  if (ev.ok && ev.kind === "state_changed") {
    const to = (ev.payload as { to?: unknown } | null)?.to;
    if (typeof to === "string") taskState = normalizeState(to);
  }
  if (ev.ok && ev.kind === "task_completed") {
    taskState = "completed";
    terminal = true;
  }
  if (ev.ok && ev.kind === "task_failed") {
    taskState = "failed";
    terminal = true;
  }

  return { ...base, state: taskState, lastSeq: ev.seq, terminal };
}

/** Core's state names are SCREAMING_SNAKE on the wire; the store uses lower. */
function normalizeState(wire: string): TaskState | "unknown" {
  const v = wire.toLowerCase();
  const known: TaskState[] = [
    "planning",
    "running",
    "waiting_for_permission",
    "verifying",
    "repairing",
    "paused",
    "completed",
    "failed",
  ];
  return (known as string[]).includes(v) ? (v as TaskState) : "unknown";
}

/** Replay a whole trace from the empty store — the primary test entry point. */
export function replay(rawEvents: readonly unknown[]): StoreState {
  return rawEvents.reduce<StoreState>((s, e) => applyRawEvent(s, e), emptyStore());
}
