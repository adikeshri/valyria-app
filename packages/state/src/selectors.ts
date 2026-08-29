// Selectors over the normalized store. Every panel is one of these (PLAN D4).
// Pure; sort on `seq`, never wall clock (PLAN §3).

import type {
  ApprovalProjection,
  EventRow,
  FileChangeProjection,
  PlanProjection,
  StoreState,
  TaskProjection,
  TestRunProjection,
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

/** A short human line per event for the Activity feed (PLAN §4.6).
 *
 *  §10: **no model reasoning text is ever surfaced here** — this function must
 *  never read `model_completed.text` or `tool_completed.rendered`.
 *
 *  Best-effort against loose payloads (D5): unknown shapes fall back to the
 *  humanized kind. */
export function activityLine(e: EventRow): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  const toolTarget = (): string | undefined => {
    const input = p.input;
    if (input && typeof input === "object" && "path" in input) {
      const v = (input as { path?: unknown }).path;
      return typeof v === "string" ? v : undefined;
    }
    return undefined;
  };
  const verb = (tool?: string): string => {
    switch (tool) {
      case "read_file":
        return "Reading";
      case "write_file":
      case "edit_file":
      case "apply_patch":
        return "Editing";
      case "run_command":
      case "bash":
      case "shell":
        return "Running";
      case "search":
      case "grep":
        return "Searching";
      default:
        return "Running";
    }
  };

  switch (e.kind) {
    case "task_started":
      return "Task started";
    case "plan_created":
      return typeof p.revision === "number" ? `Plan updated (rev ${p.revision})` : "Plan created";
    case "model_started":
      return "Consulting the model";
    case "model_completed":
      return "Model responded"; // never the text
    case "tool_started": {
      const t = str("tool");
      const tgt = toolTarget();
      return tgt ? `${verb(t)} ${tgt}` : t ? `${verb(t)} (${t})` : "Tool started";
    }
    case "tool_completed":
      return p.success === false
        ? `${str("tool") ?? "Tool"} failed`
        : `${str("tool") ?? "Tool"} done`;
    case "file_changed":
      return str("path") ? `Changed ${str("path")}` : "File changed";
    case "test_started":
      return "Running tests";
    case "test_passed":
      return "Tests passed";
    case "test_failed":
      return str("summary") ?? "Tests failed";
    case "verification_evidence":
      return str("command") ? `Verified: ${str("command")}` : "Verification recorded";
    case "approval_requested":
      return str("prompt") ?? "Approval requested";
    case "state_changed":
      return str("to") ? `→ ${str("to")}` : "State changed";
    case "task_paused":
      return "Task paused";
    case "task_completed":
      return "Task completed";
    case "task_failed":
      return str("reason") ? `Task failed — ${str("reason")}` : "Task failed";
    case "progress_stalled":
      return str("reason") ? `Stalled: ${str("reason")}` : "Progress stalled";
    case "external_change_detected":
      return "External change detected";
    case "memory_written":
      return "Memory updated";
    case "resource_pressure":
      return "Resource pressure";
    case "context_retrieved":
      return "Context retrieved";
    default:
      return e.kind.replace(/_/g, " ");
  }
}

export function planFor(state: StoreState, taskId: string): PlanProjection | undefined {
  return state.plans[taskId];
}

/** The changed-file rail for a task (§4.8), ordered by first touch (`seq`). No
 *  ownership column — Core's ledger is not on the wire (G8). */
export function changedFilesForTask(
  state: StoreState,
  taskId: string,
): FileChangeProjection[] {
  return [...(state.files[taskId] ?? [])].sort((a, b) => a.firstSeq - b.firstSeq);
}

/** Test runs for a task (§4.11), newest event first. Categories with no run are
 *  the panel's "NOT RUN" — this returns only what Core emitted. */
export function testResultsForTask(
  state: StoreState,
  taskId: string,
): TestRunProjection[] {
  return [...(state.tests[taskId]?.runs ?? [])].sort((a, b) => b.seq - a.seq);
}

/** A checkpoint boundary a task's plan declares. Sourced from the `plan_created`
 *  payload's `steps[]` (loose by design). `id` is the **step** id: v1 exposes
 *  no `checkpoint_id`, so it cannot drive `task_rollback` yet (G13) — the
 *  Rollback UI shows these boundaries and keeps the action disabled with that
 *  reason. */
export interface CheckpointBoundary {
  stepId: string | null;
  intent: string | null;
  rollbackBoundary: boolean;
}

export function checkpointsForTask(
  state: StoreState,
  taskId: string,
): CheckpointBoundary[] {
  const plan = state.plans[taskId];
  const steps = (plan?.payload as { steps?: unknown })?.steps;
  if (!Array.isArray(steps)) return [];
  const out: CheckpointBoundary[] = [];
  for (const raw of steps) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    if (s.checkpoint !== true && s.rollback_boundary !== true) continue;
    out.push({
      stepId: typeof s.id === "string" ? s.id : null,
      intent: typeof s.intent === "string" ? s.intent : null,
      rollbackBoundary: s.rollback_boundary === true,
    });
  }
  return out;
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
