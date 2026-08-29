// Selectors over the normalized store. Every panel is one of these (PLAN D4).
// Pure; sort on `seq`, never wall clock (PLAN §3).

import type {
  ApprovalProjection,
  EventRow,
  PlanProjection,
  StoreState,
  TaskProjection,
} from "./store.js";

export function tasksByRecency(state: StoreState): TaskProjection[] {
  return Object.values(state.tasks).sort((a, b) => b.lastSeq - a.lastSeq);
}

export function activeTasks(state: StoreState): TaskProjection[] {
  return tasksByRecency(state).filter((t) => !t.terminal);
}

export function taskById(state: StoreState, id: string): TaskProjection | undefined {
  return state.tasks[id];
}

/** The most recently touched task — the app's default focus. */
export function currentTask(state: StoreState): TaskProjection | undefined {
  return tasksByRecency(state)[0];
}

export function eventsForTask(state: StoreState, taskId: string): EventRow[] {
  return state.events.filter((e) => e.taskId === taskId);
}

/** All events, newest first — the Timeline surface (PLAN §4.6). */
export function timelineRows(state: StoreState): EventRow[] {
  return [...state.events].sort((a, b) => b.seq - a.seq);
}

/** A short human line per event for the Activity feed (PLAN §4.6). No model
 *  reasoning text is ever surfaced here (§10). Best-effort against loose
 *  payloads — unknown shapes fall back to the kind. */
export function activityLine(e: EventRow): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  switch (e.kind) {
    case "task_started":
      return s("objective") ? `Task started — ${s("objective")}` : "Task started";
    case "plan_created":
      return "Plan created";
    case "tool_started":
      return s("tool") ? `Running ${s("tool")}${s("target") ? ` on ${s("target")}` : ""}` : "Tool started";
    case "tool_completed":
      return s("tool") ? `Finished ${s("tool")}` : "Tool completed";
    case "file_changed":
      return s("path") ? `Edited ${s("path")}` : "File changed";
    case "test_started":
      return "Running tests";
    case "test_passed":
      return "Tests passed";
    case "test_failed":
      return s("summary") ?? "Tests failed";
    case "approval_requested":
      return s("prompt") ?? "Approval requested";
    case "state_changed":
      return s("to") ? `State → ${s("to")}` : "State changed";
    case "task_completed":
      return "Task completed";
    case "task_failed":
      return s("reason") ? `Task failed — ${s("reason")}` : "Task failed";
    case "verification_evidence":
      return "Verification evidence recorded";
    case "progress_stalled":
      return "Progress stalled";
    default:
      return e.kind.replace(/_/g, " ");
  }
}

export function planFor(state: StoreState, taskId: string): PlanProjection | undefined {
  return state.plans[taskId];
}

/** The pending approval for a task — only while the task is actually blocked on
 *  one (visibility derived from state, not stored — G2 supersession handling
 *  lives in the bridge). */
export function pendingApprovalFor(
  state: StoreState,
  taskId: string,
): ApprovalProjection | undefined {
  const task = state.tasks[taskId];
  if (!task || task.state !== "waiting_for_permission") return undefined;
  return state.approvals[taskId];
}

/** Rows the decoder could not type — surfaced with a raw-payload disclosure (D5). */
export function degradedEvents(state: StoreState): EventRow[] {
  return state.events.filter((e) => e.degraded);
}

export function needsResubscribe(state: StoreState): boolean {
  return state.gapDetected;
}
