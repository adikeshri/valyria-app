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
  checkpointIdsForTask,
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
  AgentCommandsModel,
  ApprovalsModel,
  ChatModel,
  Connection,
  HistoryModel,
  SecurityModel,
  TaskModel,
  TimelineModel,
  VerificationModel,
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

export function taskModel(
  state: StoreState,
  focusId: string | undefined,
  rollbackCapable = false
): TaskModel {
  const id = resolveFocus(state, focusId);
  if (!id || !state.tasks[id]) {
    return {
      taskId: null, objective: null, state: null, terminal: false,
      planSteps: [], checkpoints: [], files: [], tests: [], approval: null,
    };
  }
  const task = state.tasks[id]!;
  const cpIds = checkpointIdsForTask(state, id);

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
    checkpoints: checkpointsForTask(state, id).map((c) => {
      const checkpointId = c.stepId ? (cpIds[c.stepId] ?? null) : null;
      return {
        stepId: c.stepId,
        intent: c.intent,
        rollbackBoundary: c.rollbackBoundary,
        checkpointId,
        // §16 / G13: rollback needs Core's checkpoint_id and the diagnostics_v2
        // capability. Without both the boundary is shown but the action is off.
        rollbackReady: rollbackCapable && checkpointId !== null && !task.terminal,
      };
    }),
    files: changedFilesForTask(state, id).map((f) => ({ path: f.path, change: f.change })),
    tests: testResultsForTask(state, id).map((t) => ({
      command: t.command,
      outcome: t.outcome,
      summary: t.summary,
      failureCount: t.failureCount,
      failures: t.failures.map((fl) => ({
        kind: fl.kind,
        message: fl.message,
        failingTest: fl.failingTest,
        locations: fl.locations.map((l) => ({ path: l.path, line: l.line })),
      })),
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

// --- Agent commands (§4.10, D7) ----------------------------------

/** The read-only projection of shell commands the agent ran. This is the ONLY
 *  source for this view — it never touches the integrated terminal's buffer. */
export function agentCommandsModel(
  state: StoreState,
  focusId: string | undefined
): AgentCommandsModel {
  const id = resolveFocus(state, focusId);
  if (!id) return { taskId: null, commands: [] };
  return {
    taskId: id,
    commands: agentCommandsForTask(state, id).map((c) => ({
      seq: c.seq,
      program: c.program,
      args: c.args,
      exitCode: c.exitCode,
      stdout: c.stdout,
      stderr: c.stderr,
      raw: c.raw,
      succeeded: c.succeeded,
      durationMs: c.durationMs,
      pending: c.pending,
    })),
  };
}

// --- Verification inspector (§35, D8) --------------------------------

/** Built from `task_report` (verified[] / unverified[]) — verbatim. There is no
 *  path here to a generic "verified" state; a category with no evidence is
 *  NOT RUN. `report` is null until the RPC has answered. */
export function verificationModel(input: {
  taskId: string | null;
  report: {
    status: string;
    verified: { kind: string; command: string; outcome: string; run_id: string }[];
    unverified: string[];
  } | null;
}): VerificationModel {
  return {
    taskId: input.taskId,
    status: input.report?.status ?? null,
    verified: (input.report?.verified ?? []).map((v) => ({
      kind: v.kind,
      command: v.command,
      outcome: v.outcome,
      runId: v.run_id,
    })),
    unverified: input.report?.unverified ?? [],
    hasReport: input.report !== null,
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

// --- Approvals (§4.7, G2) ------------------------------------------

export function approvalsModel(
  state: StoreState,
  focusId: string | undefined,
  allowForTaskSupported: boolean
): ApprovalsModel {
  const id = resolveFocus(state, focusId);
  const ap = id ? pendingApprovalFor(state, id) : undefined;
  if (!id || !ap) {
    return { taskId: id ?? null, approval: null, allowForTaskSupported };
  }
  const p = asRecord(ap.payload);
  const str = (k: string): string | null => (typeof p[k] === "string" ? (p[k] as string) : null);
  return {
    taskId: id,
    allowForTaskSupported,
    approval: {
      seq: ap.seq,
      prompt: str("prompt") ?? "Approval requested",
      tool: str("tool"),
      category: str("category"),
      target: str("target"),
      // `destructive` | `network` | `elevated` | `standard` | null
      risk: str("risk"),
    },
  };
}

// --- Security / autonomy (§4.15, §25, §26) -------------------------

interface DoctorCheck {
  name: string;
  status: string;
  detail: string;
  remediation?: string | null;
}
interface ConfigEntry {
  key: string;
  value: string;
  origin: string;
}

const SECURITY_KEYS = [
  "network",
  "permission.mode",
  "sandbox",
  "sandbox.mode",
  "approvals.required",
  "workspace.write_outside_root",
];

export function securityModel(input: {
  configEntries: ConfigEntry[] | null;
  doctor: { checks: DoctorCheck[]; summary: string } | null;
  session: {
    permissionMode: string | null;
    ownsDaemon: boolean;
    protocolVersion: string;
    runtimeVersion: string;
  } | null;
  activeTasks: number;
  repoInstructions: { name: string; text: string; authorized: boolean }[];
}): SecurityModel {
  const entries = input.configEntries ?? [];
  const pick = (k: string) => entries.find((e) => e.key === k);

  return {
    autonomy: {
      mode: input.session?.permissionMode ?? null,
      // G1: changing autonomy restarts the daemon — only possible when we own it
      // and nothing is running.
      canChange: !!input.session?.ownsDaemon && input.activeTasks === 0,
      reason: !input.session
        ? "No session."
        : !input.session.ownsDaemon
          ? "Core was started by another process — change autonomy there."
          : input.activeTasks > 0
            ? "A task is running — autonomy changes restart Core."
            : "Changing this restarts the Core daemon.",
      levels: [
        { id: "manual", label: "Manual", desc: "Approve every mutating action." },
        { id: "assisted", label: "Assisted", desc: "Approve destructive & network actions only." },
        { id: "autonomous", label: "Autonomous", desc: "No approval prompts. Use with care." },
      ],
    },
    // Only lines Core actually reports. A key it doesn't return renders as
    // "not reported" — never a checkmark we invented (D8).
    settings: SECURITY_KEYS.map((k) => {
      const e = pick(k);
      return { key: k, value: e?.value ?? null, origin: e?.origin ?? null, reported: !!e };
    }),
    checks: (input.doctor?.checks ?? [])
      .filter((c) => /sandbox|permission|network|isolation|write/i.test(c.name))
      .map((c) => ({
        name: c.name,
        status: c.status,
        detail: c.detail,
        remediation: c.remediation ?? null,
      })),
    doctorSummary: input.doctor?.summary ?? null,
    repoInstructions: input.repoInstructions,
    compatible: input.session
      ? input.session.protocolVersion.split(".")[0] === "1"
      : null,
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
