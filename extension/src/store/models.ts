/**
 * View-model builders (PLAN.md D3/D4).
 *
 * Pure functions of `(StoreState, focusedTaskId, connection)` → the exact shape
 * a webview renders. All the projection logic is `@valyria/state` selectors;
 * this file only assembles and trims. No `vscode`, no clock — unit-tested by
 * trace replay.
 */
import {
  activityLine,
  agentCommandsForTask,
  changedFilesForTask,
  checkpointsForTask,
  currentTask,
  eventsForTask,
  pendingApprovalFor,
  planFor,
  tasksByRecency,
  testResultsForTask,
  timelineRows,
  type StoreState,
} from "@valyria/state";
import type {
  ChatModel,
  HistoryModel,
  TaskModel,
  TimelineModel,
  Connection,
} from "../webviews/shared/protocol";

/** The task the panels focus on: an explicit pick, else the most recent. */
export function resolveFocus(state: StoreState, explicit: string | undefined): string | undefined {
  if (explicit && state.tasks[explicit]) return explicit;
  return currentTask(state)?.id;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

// --- Chat --------------------------------------------------------------

/** Kinds worth showing in the conversational transcript (§8, §10 — no model
 *  text). Everything else stays in the Timeline. */
const TRANSCRIPT_KINDS = new Set([
  "plan_created",
  "tool_started",
  "tool_completed",
  "file_changed",
  "test_started",
  "test_passed",
  "test_failed",
  "verification_evidence",
  "approval_requested",
  "task_paused",
  "task_completed",
  "task_failed",
  "progress_stalled",
]);

export function chatModel(
  state: StoreState,
  focusId: string | undefined,
  connection: Connection
): ChatModel {
  const id = resolveFocus(state, focusId);
  const task = id ? state.tasks[id] : undefined;

  const transcript: ChatModel["transcript"] = [];
  if (task?.objective) {
    transcript.push({ seq: task.firstSeenSeq, role: "you", text: task.objective });
  }
  if (id) {
    for (const e of eventsForTask(state, id)) {
      if (!TRANSCRIPT_KINDS.has(e.kind)) continue;
      transcript.push({ seq: e.seq, role: "agent", text: activityLine(e) });
    }
  }

  const working =
    !!task &&
    !task.terminal &&
    task.state !== "waiting_for_permission" &&
    task.state !== "paused";
  const blocked = task?.state === "waiting_for_permission";

  return {
    connection,
    taskId: id ?? null,
    objective: task?.objective ?? null,
    state: task?.state ?? null,
    terminal: task?.terminal ?? false,
    working,
    blocked,
    transcript,
    // A new task can be created whenever Core is reachable and nothing is mid-flight.
    canSubmit: connection === "ready" && !working && !blocked,
  };
}

// --- Task panel ------------------------------------------------------

export function taskModel(state: StoreState, focusId: string | undefined): TaskModel {
  const id = resolveFocus(state, focusId);
  if (!id || !state.tasks[id]) {
    return { taskId: null, objective: null, state: null, terminal: false, planSteps: [], checkpoints: [], files: [], tests: [], approval: null };
  }
  const task = state.tasks[id]!;

  const planSteps: TaskModel["planSteps"] = [];
  const steps = asRecord(planFor(state, id)?.payload).steps;
  if (Array.isArray(steps)) {
    for (const raw of steps) {
      const s = asRecord(raw);
      planSteps.push({
        intent: typeof s.intent === "string" ? s.intent : "(step)",
        status: typeof s.status === "string" ? s.status : null,
        checkpoint: s.checkpoint === true || s.rollback_boundary === true,
      });
    }
  }

  const ap = pendingApprovalFor(state, id);
  const apPayload = asRecord(ap?.payload);

  return {
    taskId: id,
    objective: task.objective,
    state: task.state,
    terminal: task.terminal,
    planSteps,
    checkpoints: checkpointsForTask(state, id).map((c) => ({
      stepId: c.stepId,
      intent: c.intent,
      rollbackBoundary: c.rollbackBoundary,
    })),
    files: changedFilesForTask(state, id).map((f) => ({ path: f.path, change: f.change })),
    tests: testResultsForTask(state, id).map((t) => ({
      command: t.command,
      outcome: t.outcome,
      summary: t.summary,
      failureCount: t.failureCount,
    })),
    approval: ap
      ? {
          prompt: typeof apPayload.prompt === "string" ? apPayload.prompt : "Approval requested",
          tool: typeof apPayload.tool === "string" ? apPayload.tool : null,
          risk: typeof apPayload.risk === "string" ? apPayload.risk : null,
        }
      : null,
    agentCommandCount: agentCommandsForTask(state, id).length,
  };
}

// --- Timeline ------------------------------------------------------

export function timelineModel(state: StoreState): TimelineModel {
  return {
    rows: timelineRows(state).map((e) => ({
      seq: e.seq,
      ts: e.ts,
      kind: e.kind,
      taskId: e.taskId,
      degraded: e.degraded,
      summary: activityLine(e),
      raw: JSON.stringify(e.payload ?? null, null, 2),
    })),
  };
}

// --- History -----------------------------------------------------

export function historyModel(state: StoreState, focusId: string | undefined): HistoryModel {
  const focused = resolveFocus(state, focusId) ?? null;
  const byDay = new Map<string, HistoryModel["groups"][number]["tasks"]>();

  for (const t of tasksByRecency(state)) {
    const day = new Date(t.lastTs).toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? [];
    bucket.push({
      id: t.id,
      objective: t.objective,
      state: t.state,
      terminal: t.terminal,
      blocked: t.state === "waiting_for_permission",
      focused: t.id === focused,
    });
    byDay.set(day, bucket);
  }

  return {
    focusedTaskId: focused,
    groups: [...byDay.entries()].map(([day, tasks]) => ({ day, tasks })),
  };
}
