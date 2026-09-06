/**
 * View-model builders (PLAN.md D3/D4).
 *
 * Pure functions of `(StoreState, focusedTaskId, connection)` → the exact shape
 * a webview renders. All the projection logic is `@valyria/state` selectors;
 * this file only assembles and trims. No `vscode`, no clock — unit-tested by
 * trace replay.
 */
import {
  activeTasks,
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
  AboutModel,
  AgentCommandsModel,
  ApprovalsModel,
  ChatModel,
  Connection,
  ContextModel,
  HardwareModel,
  HistoryModel,
  HomeModel,
  ModelsModel,
  ReviewModel,
  SecurityModel,
  SettingsModel,
  TaskModel,
  TickerModel,
  TimelineModel,
  VerificationModel,
  WorkspaceModel,
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

// --- Models (§20, §21, §37 — select, install, activate; weights are Core's) ---

/** Every assignable `ModelRole` (Core's `valyria_model_registry::ModelRole`). */
export const MODEL_ROLES = [
  "primary_coder",
  "fast_coder",
  "planner",
  "reviewer",
  "embedder",
  "reranker",
  "autocomplete",
  "summarizer",
] as const;

export const DEFAULT_MODEL_ROLE = "primary_coder";

interface ModelSummary {
  id: string;
  family: string;
  display_name?: string;
  quantization: string;
  parameters_b?: number;
  context_length?: number;
  size_bytes: number;
  installed: boolean;
  license: string;
  active_roles?: string[];
}

interface RecommendCandidate {
  id: string;
  display_name?: string;
  size_bytes?: number;
  fit_kind?: string;
  fit_detail?: string | null;
  suitability?: number;
  installed?: boolean;
}
interface RecommendResult {
  role: string;
  recommended: unknown;
  candidates: unknown[];
}

const FIT_KINDS = ["comfortable", "tight", "will_not_fit"] as const;
type FitKind = (typeof FIT_KINDS)[number];

interface ModelInstallLike {
  id: string;
  phase: string | null;
  downloadedBytes: number;
  totalBytes: number;
  status: "running" | "completed" | "failed";
  code: string | null;
  message: string | null;
}

function installRow(m: ModelInstallLike): import("../webviews/shared/protocol").ModelInstallRow {
  const fraction =
    m.totalBytes > 0 ? Math.max(0, Math.min(1, m.downloadedBytes / m.totalBytes)) : null;
  return {
    id: m.id,
    phase: m.phase,
    downloadedBytes: m.downloadedBytes,
    totalBytes: m.totalBytes,
    status: m.status,
    code: m.code,
    message: m.message,
    fraction: m.status === "completed" ? 1 : fraction,
  };
}

export function modelsModel(input: {
  models: ModelSummary[] | null;
  recommend: RecommendResult | null;
  installs: ModelInstallLike[];
  role: string;
  manageCapable: boolean;
  hardwareCapable: boolean;
}): ModelsModel {
  const role = input.role || DEFAULT_MODEL_ROLE;
  const installById = new Map(input.installs.map((i) => [i.id, i]));

  const rec = input.recommend && input.recommend.role === role ? input.recommend : null;
  const recById = new Map<string, RecommendCandidate>();
  for (const raw of rec?.candidates ?? []) {
    const c = raw as RecommendCandidate;
    if (c && typeof c.id === "string") recById.set(c.id, c);
  }
  const recRecommended = rec?.recommended as RecommendCandidate | null | undefined;
  const recommendedId =
    recRecommended && typeof recRecommended.id === "string" ? recRecommended.id : null;

  const rows: ModelsModel["models"] = (input.models ?? []).map((m) => {
    const c = recById.get(m.id);
    const install = installById.get(m.id);
    const fk = c?.fit_kind;
    const fit: FitKind | null = (FIT_KINDS as readonly string[]).includes(fk ?? "")
      ? (fk as FitKind)
      : null;
    return {
      id: m.id,
      displayName: m.display_name ?? m.id,
      family: m.family,
      quantization: m.quantization,
      parametersB: m.parameters_b ?? 0,
      contextLength: m.context_length ?? 0,
      sizeBytes: m.size_bytes,
      installed: m.installed,
      license: m.license,
      activeRoles: (m.active_roles ?? []).slice().sort(),
      fit,
      fitDetail: c?.fit_detail ?? null,
      suitability: typeof c?.suitability === "number" ? c.suitability : null,
      recommended: m.id === recommendedId,
      install: install ? installRow(install) : null,
    };
  });

  // Recommended first, then fitting (by suitability desc), then non-fitting,
  // then everything the recommender didn't score.
  const rank = (r: (typeof rows)[number]): number => {
    if (r.recommended) return 0;
    if (r.fit === "comfortable") return 1;
    if (r.fit === "tight") return 2;
    if (r.fit === "will_not_fit") return 4;
    return 3;
  };
  rows.sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const s = (b.suitability ?? -1) - (a.suitability ?? -1);
    if (s !== 0) return s;
    return a.displayName.localeCompare(b.displayName);
  });

  const bindings: { role: string; modelId: string }[] = [];
  for (const m of input.models ?? []) {
    for (const boundRole of m.active_roles ?? []) bindings.push({ role: boundRole, modelId: m.id });
  }
  bindings.sort((a, b) => a.role.localeCompare(b.role));

  return {
    manageCapable: input.manageCapable,
    hardwareCapable: input.hardwareCapable,
    hasList: input.models !== null,
    role,
    roles: [...MODEL_ROLES],
    recommendedId,
    models: rows,
    bindings,
  };
}

// --- Hardware (§21, §37 — probe + recommendation; G4 gates fit()) ---

export function hardwareModel(input: {
  probe: Record<string, unknown> | null;
  recommend: {
    role: string;
    recommended: Record<string, unknown> | null;
    candidates: Record<string, unknown>[];
  } | null;
  hardwareCapable: boolean;
}): HardwareModel {
  const p = input.probe;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const cpu = asRecord(p?.["cpu"]);
  const gpus = Array.isArray(p?.["gpus"]) ? (p!["gpus"] as Record<string, unknown>[]) : [];

  return {
    hasProbe: p !== null,
    hardwareCapable: input.hardwareCapable,
    os: p ? `${str(p["os"]) ?? "?"} ${str(p["os_version"]) ?? ""}`.trim() : null,
    arch: p ? str(p["arch"]) : null,
    cpu: p
      ? {
          brand: str(cpu["brand"]),
          physicalCores: num(cpu["physical_cores"]),
          logicalCores: num(cpu["logical_cores"]),
        }
      : null,
    ramTotalBytes: p ? num(p["ram_total_bytes"]) : null,
    ramAvailableBytes: p ? num(p["ram_available_bytes"]) : null,
    diskAvailableBytes: p ? num(p["disk_available_bytes"]) : null,
    unifiedMemory: p ? p["unified_memory"] === true : null,
    // Some fields are "probed and absent" (Some(false)) vs "not probed" (None).
    acceleratorPresent:
      p && typeof p["accelerator_present"] === "boolean"
        ? (p["accelerator_present"] as boolean)
        : null,
    gpus: gpus.map((g) => ({
      name: str(g["name"]) ?? "?",
      vendor: str(g["vendor"]),
      vramBytes: num(g["vram_bytes"]),
    })),
    recommendation: input.recommend
      ? {
          role: input.recommend.role,
          recommendedId: str(asRecord(input.recommend.recommended)["id"]),
          candidates: input.recommend.candidates.map((c) => {
            const r = asRecord(c);
            return {
              id: str(r["id"]) ?? "?",
              displayName: str(r["display_name"]) ?? str(r["id"]) ?? "?",
              sizeBytes: num(r["size_bytes"]),
              fitKind: str(r["fit_kind"]) ?? "unknown",
              fitDetail: str(r["fit_detail"]),
              suitability: num(r["suitability"]),
              installed: r["installed"] === true,
            };
          }),
        }
      : null,
  };
}

// --- Settings (§24 — render config_show; D13 write-then-verify) ---

const SETTINGS_SECTIONS: { title: string; match: RegExp }[] = [
  { title: "Agent", match: /^(agent|permission|autonomy|approvals|task)\b/i },
  { title: "Models", match: /^(model|models|inference|runtime)\b/i },
  { title: "Security", match: /^(network|sandbox|security|isolation|workspace\.write)\b/i },
  { title: "Repository", match: /^(repo|repository|index|git|search)\b/i },
  { title: "Application", match: /.*/ },
];

export function settingsModel(input: {
  entries: { key: string; value: string; origin: string }[] | null;
}): SettingsModel {
  const entries = input.entries;
  if (!entries) return { hasConfig: false, sections: [] };

  const used = new Set<string>();
  const sections = SETTINGS_SECTIONS.map((sec) => {
    const rows = entries
      .filter((e) => !used.has(e.key) && sec.match.test(e.key))
      .map((e) => {
        used.add(e.key);
        return {
          key: e.key,
          value: e.value,
          origin: e.origin,
          // Only string-ish leaves are editable via config/write (a TOML string).
          editable: sec.title !== "Application" || /^(log|ui|editor)\./i.test(e.key),
        };
      });
    return { title: sec.title, rows };
  }).filter((s) => s.rows.length > 0);

  return { hasConfig: true, sections };
}

// --- Context inspector (§34 — disabled with an explanation until G7) ---

export function contextModel(state: StoreState, focusId: string | undefined, contextCapable: boolean): ContextModel {
  const id = resolveFocus(state, focusId);
  const rows: ContextModel["items"] = [];
  if (id && contextCapable) {
    for (const e of eventsForTask(state, id)) {
      if (e.kind !== "context_retrieved") continue;
      const p = asRecord(e.payload);
      rows.push({
        seq: e.seq,
        source: typeof p["source"] === "string" ? (p["source"] as string) : null,
        path: typeof p["path"] === "string" ? (p["path"] as string) : null,
        trust: typeof p["trust"] === "string" ? (p["trust"] as string) : null,
        tokens: typeof p["tokens"] === "number" ? (p["tokens"] as number) : null,
        summary: activityLine(e),
      });
    }
  }
  return {
    available: contextCapable,
    taskId: id ?? null,
    items: rows,
  };
}

// --- About / Compatibility (§40, CORE-INTERFACE §4) ---------------

export function aboutModel(input: {
  appName: string;
  platform: string;
  windowsTier3: boolean;
  connection: Connection;
  about: { bridgeHost?: string; expectedProtocol?: string; compatibility?: string } | null;
  session: {
    protocolVersion: string;
    runtimeVersion: string;
    origin: string;
    ownsDaemon: boolean;
    authenticated: boolean;
    permissionMode: string | null;
    workspaceRoot: string;
  } | null;
  capabilities: string[];
  surfaces: { surface: string; available: boolean; missing?: string; gap?: string }[];
  models: { id: string; installed: boolean }[];
  activeModelIds: Set<string>;
}): AboutModel {
  return {
    appName: input.appName,
    bridgeHost: input.about?.bridgeHost ?? "?",
    expectedProtocol: input.about?.expectedProtocol ?? "?",
    connection: input.connection,
    platform: input.platform,
    windowsTier3: input.windowsTier3,
    session: input.session,
    compatibility: input.about?.compatibility ?? (input.session ? "compatible" : "no session"),
    capabilities: [...input.capabilities].sort(),
    surfaces: input.surfaces,
    models: input.models.map((m) => ({
      id: m.id,
      installed: m.installed,
      active: input.activeModelIds.has(m.id),
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

// --- Status-bar agent ticker (docs/UX-DIFFERENTIATION.md, lever E) --------

const TOOL_VERB: Record<string, string> = {
  read_file: "Reading",
  list_dir: "Reading",
  search: "Searching",
  grep: "Searching",
  write_file: "Editing",
  edit_file: "Editing",
  apply_patch: "Editing",
  run_command: "Running",
};

/** A 1–3 word phase for the status bar, derived from the focused task's event
 *  tail. Pure and clock-free so trace replay asserts the exact string. */
export function tickerModel(
  state: StoreState,
  focusId: string | undefined,
  connection: Connection
): TickerModel {
  const id = resolveFocus(state, focusId);
  const task = id ? state.tasks[id] : undefined;
  const filesTouched = id ? changedFilesForTask(state, id).length : 0;

  if (!id || !task) {
    return { connection, hasTask: false, taskId: null, phase: null, tone: "idle", filesTouched: 0 };
  }
  if (task.state === "waiting_for_permission") {
    return { connection, hasTask: true, taskId: id, phase: "Blocked: approval", tone: "blocked", filesTouched };
  }
  if (task.state === "paused") {
    return { connection, hasTask: true, taskId: id, phase: "Paused", tone: "paused", filesTouched };
  }
  if (task.terminal) {
    const failed = task.state === "failed";
    return {
      connection,
      hasTask: true,
      taskId: id,
      phase: failed ? "Task failed" : "Task done",
      tone: failed ? "failed" : "done",
      filesTouched,
    };
  }

  const evs = eventsForTask(state, id);
  let phase = task.state.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  for (let i = evs.length - 1; i >= 0 && i >= evs.length - 16; i--) {
    const e = evs[i]!;
    if (e.kind === "test_started") { phase = "Running tests"; break; }
    if (e.kind === "test_failed") { phase = "Tests failing"; break; }
    if (e.kind === "test_passed") { phase = "Tests passing"; break; }
    if (e.kind === "verification_evidence") { phase = "Verifying"; break; }
    if (e.kind === "plan_created") { phase = "Planning"; break; }
    if (e.kind === "tool_started") {
      const p = asRecord(e.payload);
      const tool = typeof p["tool"] === "string" ? (p["tool"] as string) : "";
      const input = asRecord(p["input"]);
      const prog = typeof input["program"] === "string" ? (input["program"] as string) : null;
      if (tool === "run_command" && prog) { phase = `Running ${prog}`; break; }
      const verb = TOOL_VERB[tool];
      if (verb === "Editing" && filesTouched > 0) {
        phase = `Editing ${filesTouched} file${filesTouched === 1 ? "" : "s"}`;
        break;
      }
      if (verb) { phase = verb; break; }
    }
    if (e.kind === "file_changed" && filesTouched > 0) {
      phase = `Editing ${filesTouched} file${filesTouched === 1 ? "" : "s"}`;
      break;
    }
  }
  return { connection, hasTask: true, taskId: id, phase, tone: "working", filesTouched };
}

// --- Valyria Home (docs/UX-DIFFERENTIATION.md, lever D) ------------------

function homeTask(t: {
  id: string;
  objective: string | null;
  state: string;
  terminal: boolean;
  lastTs: number;
}, filesTouched: number): HomeModel["active"][number] {
  return {
    id: t.id,
    objective: t.objective,
    state: t.state,
    terminal: t.terminal,
    blocked: t.state === "waiting_for_permission",
    filesTouched,
    when: new Date(t.lastTs).toISOString().slice(0, 10),
  };
}

export function homeModel(
  state: StoreState,
  input: {
    connection: Connection;
    hasRepo: boolean;
    repoName: string | null;
    activeModel: string | null;
    networkRuntime: boolean;
    autonomy: string | null;
    layoutMode: "agent" | "editor";
  }
): HomeModel {
  const busy = activeTasks(state).some(
    (t) => t.state !== "paused" && t.state !== "waiting_for_permission"
  );
  const active = activeTasks(state).map((t) => homeTask(t, changedFilesForTask(state, t.id).length));
  const recent = tasksByRecency(state)
    .filter((t) => t.terminal)
    .slice(0, 8)
    .map((t) => homeTask(t, changedFilesForTask(state, t.id).length));

  return {
    connection: input.connection,
    hasRepo: input.hasRepo,
    repoName: input.repoName,
    canSubmit: input.connection === "ready" && !busy,
    activeModel: input.activeModel,
    networkRuntime: input.networkRuntime,
    autonomy: input.autonomy,
    layoutMode: input.layoutMode,
    active,
    recent,
  };
}

// --- Task Workspace (docs/UX-DIFFERENTIATION.md, lever D) ----------------

interface ReportInput {
  status?: string;
  verified?: { kind: string; command: string; outcome: string; run_id?: string }[];
  unverified?: string[];
}

export function workspaceModel(
  state: StoreState,
  focusId: string | undefined,
  input: {
    connection: Connection;
    ownership: Record<string, string>;
    report: ReportInput | null;
    rollbackCapable?: boolean;
  }
): WorkspaceModel {
  const chat = chatModel(state, focusId, input.connection);
  const task = taskModel(state, focusId, input.rollbackCapable ?? false);
  const ap = task.taskId ? pendingApprovalFor(state, task.taskId) : undefined;
  const apP = asRecord(ap?.payload);

  return {
    connection: input.connection,
    taskId: chat.taskId,
    objective: chat.objective,
    state: chat.state,
    terminal: chat.terminal,
    working: chat.working,
    blocked: chat.blocked,
    canSubmit: chat.canSubmit,
    transcript: chat.transcript,
    planSteps: task.planSteps,
    files: task.files.map((f) => ({
      path: f.path,
      change: f.change,
      ownership: input.ownership[f.path] ?? null,
    })),
    tests: task.tests.map((t) => ({
      command: t.command,
      outcome: t.outcome,
      summary: t.summary,
      failureCount: t.failureCount,
    })),
    verified: (input.report?.verified ?? []).map((v) => ({
      kind: v.kind,
      command: v.command,
      outcome: v.outcome,
    })),
    unverified: input.report?.unverified ?? [],
    approval: ap
      ? {
          seq: ap.seq,
          prompt: typeof apP["prompt"] === "string" ? (apP["prompt"] as string) : "Approval requested",
          tool: typeof apP["tool"] === "string" ? (apP["tool"] as string) : null,
          risk: typeof apP["risk"] === "string" ? (apP["risk"] as string) : null,
        }
      : null,
  };
}

// --- Review (docs/UX-DIFFERENTIATION.md, lever D) -----------------------

export function reviewModel(
  state: StoreState,
  focusId: string | undefined,
  input: {
    connection: Connection;
    ledgerAvailable: boolean;
    ownership: Record<string, string>;
    report: ReportInput | null;
  }
): ReviewModel {
  const id = resolveFocus(state, focusId);
  const task = id ? state.tasks[id] : undefined;
  const files = id
    ? changedFilesForTask(state, id).map((f) => ({
        path: f.path,
        change: f.change,
        ownership: input.ownership[f.path] ?? null,
      }))
    : [];
  const ap = id ? pendingApprovalFor(state, id) : undefined;
  const apP = asRecord(ap?.payload);

  return {
    connection: input.connection,
    taskId: id ?? null,
    objective: task?.objective ?? null,
    ledgerAvailable: input.ledgerAvailable,
    reportStatus: input.report?.status ?? null,
    files,
    verified: (input.report?.verified ?? []).map((v) => ({
      kind: v.kind,
      command: v.command,
      outcome: v.outcome,
    })),
    unverified: input.report?.unverified ?? [],
    approval: ap
      ? {
          seq: ap.seq,
          prompt: typeof apP["prompt"] === "string" ? (apP["prompt"] as string) : "Approval requested",
          tool: typeof apP["tool"] === "string" ? (apP["tool"] as string) : null,
          risk: typeof apP["risk"] === "string" ? (apP["risk"] as string) : null,
        }
      : null,
  };
}
