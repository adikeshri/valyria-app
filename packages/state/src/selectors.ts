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

/** Tool names Core uses for "run a shell command" (valyria-agent). The single
 *  source for this list — `activityLine`'s verb map and `agentCommandsForTask`
 *  both read it, so the agent-command view and the activity narrative never
 *  disagree about what counts as a command. */
export const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "run_command",
  "bash",
  "shell",
  "sh",
]);

export function tasksByRecency(state: StoreState): TaskProjection[] {
  return Object.values(state.tasks).sort((a, b) => b.lastSeq - a.lastSeq);
}

export function activeTasks(state: StoreState): TaskProjection[] {
  return tasksByRecency(state).filter((t) => !t.terminal);
}

/** Tasks blocked on a human decision (§13). Distinct from "working" — the task
 *  panel and history badge these differently, and a transition into this set is
 *  what raises the "permission required" notification (§31). */
export function blockedTasks(state: StoreState): TaskProjection[] {
  return tasksByRecency(state).filter((t) => t.state === "waiting_for_permission");
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
    if (tool && SHELL_TOOL_NAMES.has(tool)) return "Running";
    switch (tool) {
      case "read_file":
        return "Reading";
      case "write_file":
      case "edit_file":
      case "apply_patch":
        return "Editing";
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

/** One shell command the agent ran, paired from a `tool_started` (a shell tool)
 *  and its following `tool_completed` (§4.10). This is the *only* source for the
 *  read-only "Agent Commands" view — it never touches the human PTY, and D7
 *  forbids the two ever sharing a buffer.
 *
 *  Tolerances (D5): `tool_started` carries no invocation id, so a start is
 *  paired to the next `tool_completed` before the next `tool_started` — an
 *  unpaired start stays `pending` rather than borrowing a later result. And
 *  `tool_completed.rendered` is one undeclared pre-formatted blob
 *  (`exit=Some(0) reason=Exited\n--- stdout ---\n…\n--- stderr ---\n`, G14) —
 *  when it does not parse, the whole blob is kept in `raw` and rendered
 *  verbatim. */
export interface AgentCommand {
  seq: number;
  ts: number;
  program: string;
  args: string[];
  /** null while pending, or when `rendered` gave no `exit=Some(n)` */
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  /** the `rendered` blob when it did not parse into stdout/stderr */
  raw: string | null;
  /** `tool_completed.success`; null while pending */
  succeeded: boolean | null;
  pending: boolean;
}

interface RenderedParts {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Parse Core's `run_command` `rendered` envelope. Returns null on any shape
 *  mismatch so the caller falls back to the raw blob. */
function parseRenderedCommand(rendered: string | null): RenderedParts | null {
  if (rendered == null) return null;
  const outMarker = "--- stdout ---\n";
  const errMarker = "--- stderr ---\n";
  const si = rendered.indexOf(outMarker);
  const ei = rendered.lastIndexOf(errMarker);
  if (si === -1 || ei === -1 || ei < si) return null;
  const head = rendered.slice(0, si);
  const stdout = rendered.slice(si + outMarker.length, ei);
  const stderr = rendered.slice(ei + errMarker.length);
  const m = head.match(/exit=Some\((-?\d+)\)/);
  return { exitCode: m ? Number(m[1]) : null, stdout, stderr };
}

export function agentCommandsForTask(state: StoreState, taskId: string): AgentCommand[] {
  const rows = eventsForTask(state, taskId).sort((a, b) => a.seq - b.seq);
  const out: AgentCommand[] = [];
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i]!;
    if (e.kind !== "tool_started") continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const tool = typeof p.tool === "string" ? p.tool : "";
    if (!SHELL_TOOL_NAMES.has(tool)) continue;

    const input = (p.input ?? {}) as Record<string, unknown>;
    const program = typeof input.program === "string" ? input.program : "";
    const args = Array.isArray(input.args)
      ? (input.args.filter((a) => typeof a === "string") as string[])
      : [];

    let completion: EventRow | undefined;
    for (let j = i + 1; j < rows.length; j++) {
      const n = rows[j]!;
      if (n.kind === "tool_started") break;
      if (n.kind === "tool_completed") {
        completion = n;
        break;
      }
    }

    const cmd: AgentCommand = {
      seq: e.seq,
      ts: e.ts,
      program,
      args,
      exitCode: null,
      stdout: null,
      stderr: null,
      raw: null,
      succeeded: null,
      pending: completion === undefined,
    };

    if (completion) {
      const cp = (completion.payload ?? {}) as Record<string, unknown>;
      cmd.succeeded = typeof cp.success === "boolean" ? cp.success : null;
      const rendered = typeof cp.rendered === "string" ? cp.rendered : null;
      const parts = parseRenderedCommand(rendered);
      if (parts) {
        cmd.exitCode = parts.exitCode;
        cmd.stdout = parts.stdout;
        cmd.stderr = parts.stderr;
      } else if (rendered !== null) {
        cmd.raw = rendered;
      }
    }

    out.push(cmd);
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

/** G2 supersession guard: is the approval the UI last rendered (`seenSeq`) still
 *  the one Core is waiting on? `permission_resolve` carries no request id, so
 *  the app must not answer a prompt a newer `approval_requested` has replaced —
 *  it re-prompts instead (docs/PLAN.md §4.7). Returns false when there is no
 *  pending approval at all. */
export function approvalIsCurrent(
  state: StoreState,
  taskId: string,
  seenSeq: number,
): boolean {
  return state.approvals[taskId]?.seq === seenSeq;
}

/** Rows the decoder could not type — surfaced with a raw-payload disclosure (D5). */
export function degradedEvents(state: StoreState): EventRow[] {
  return state.events.filter((e) => e.degraded);
}

export function needsResubscribe(state: StoreState): boolean {
  return state.gapDetected;
}
