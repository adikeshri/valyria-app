// The live projection: a zustand store that runs the pure @valyria/state
// reducer over the Core event stream forwarded by the Tauri host.
//
// When no session is open (or when running as a plain web page), `store` is the
// empty projection and the UI falls back to sample data. Opening a workspace
// wires the event listeners and replays from seq 0.

import { create } from "zustand";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  applyBatch,
  approvalIsCurrent,
  emptyStore,
  mergeTaskSummaries,
  type ConnectionState,
  type StoreState,
} from "@valyria/state";
import {
  bridge,
  inTauri,
  type PermissionMode,
  type RollbackResult,
  type SessionInfo,
} from "./bridge";
import { repo } from "./repo";
import { notify } from "./notify";
import { parseErrorCode } from "./errors";
import { useApp } from "../state/store";

export { parseErrorCode } from "./errors";

/** Outcome of trying to answer an approval — the card uses it to decide whether
 *  to close or show a "this request changed" banner (G2). */
export type ResolveOutcome = "sent" | "superseded" | "error";

/** A startup condition that stops a session from opening and needs the About /
 *  Compatibility surface to explain it (§4.18 / D14): a protocol-major mismatch
 *  or an unsupported platform. Distinct from a transient `error`. */
export interface Blocker {
  code: "bridge.protocol.mismatch" | "bridge.platform.unsupported";
  message: string;
}

interface LiveState {
  available: boolean;
  session: SessionInfo | null;
  connection: ConnectionState;
  store: StoreState;
  error: string | null;
  /** Set when `session_open` fails on a compatibility/platform condition. */
  blocker: Blocker | null;
  /** Non-terminal tasks found at session open — drives the resume prompt. */
  resumePromptDismissed: boolean;
  /** Bumped on every `core://fs-changed`; paths from the latest batch. */
  fsRev: number;
  fsChangedPaths: string[];

  openWorkspace: (root: string) => Promise<void>;
  refreshTasks: () => Promise<void>;
  createTask: (objective: string) => Promise<string | null>;
  pauseTask: (taskId: string) => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  /** §4.8 — goes through Core's `task_rollback` and nothing else. Returns
   *  Core's exact result, or null with `error` set. */
  rollbackTask: (taskId: string, checkpointId: string) => Promise<RollbackResult | null>;
  /** §4.7 / G2 — refuses to answer a prompt a newer `approval_requested` has
   *  superseded (returns `"superseded"`; the card re-prompts). `seenSeq` is the
   *  `approval.seq` the card last rendered. */
  resolveApproval: (taskId: string, approve: boolean, seenSeq: number) => Promise<ResolveOutcome>;
  /** §25 / G1 — restart the workspace daemon under a new autonomy level.
   *  Rejected (error set) when the daemon was adopted from another process. */
  restartSession: (mode: PermissionMode) => Promise<boolean>;
  dismissResumePrompt: () => void;
}

let unlisteners: UnlistenFn[] = [];
async function teardown() {
  await Promise.all(unlisteners.map((u) => u()));
  unlisteners = [];
}

export const useLive = create<LiveState>((set, get) => ({
  available: inTauri,
  session: null,
  connection: "starting",
  store: emptyStore(),
  error: null,
  blocker: null,
  resumePromptDismissed: false,
  fsRev: 0,
  fsChangedPaths: [],

  openWorkspace: async (root) => {
    if (!inTauri) {
      set({ error: "Not running in the Valyria desktop shell." });
      return;
    }
    set({
      connection: "connecting",
      error: null,
      blocker: null,
      store: emptyStore(),
      resumePromptDismissed: false,
      fsRev: 0,
      fsChangedPaths: [],
    });
    try {
      await teardown();
      unlisteners.push(
        await bridge.onEventBatch((b) => {
          set((s) => {
            const next = applyBatch(s.store, b.events);
            emitNotifications(s.store, next, b.events);
            return { store: next };
          });
        }),
      );
      unlisteners.push(
        await bridge.onReconnected(() => set({ connection: "reconnecting" })),
      );
      unlisteners.push(
        await bridge.onClosed(() => set({ connection: "degraded" })),
      );
      unlisteners.push(
        await repo.onFsChanged((paths) =>
          set((s) => ({ fsRev: s.fsRev + 1, fsChangedPaths: paths })),
        ),
      );
      const session = await bridge.sessionOpen(root);
      set({ session, connection: "ready" });
      await get().refreshTasks();
    } catch (e) {
      const msg = String(e);
      const code = parseErrorCode(msg);
      if (code === "bridge.protocol.mismatch" || code === "bridge.platform.unsupported") {
        // Not a transient failure — a compatibility wall. Send the user to the
        // About / Compatibility surface, which explains it (CORE-INTERFACE §4).
        set({ connection: "incompatible", blocker: { code, message: msg } });
        useApp.getState().setRoute("about");
      } else {
        set({ connection: "failed", error: msg });
      }
    }
  },

  refreshTasks: async () => {
    if (!get().session) return;
    try {
      const { tasks } = await bridge.taskList();
      set((s) => ({ store: mergeTaskSummaries(s.store, tasks) }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createTask: async (objective) => {
    try {
      const id = await bridge.taskCreate(objective);
      void get().refreshTasks();
      return id;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  pauseTask: (taskId) => guard(() => bridge.taskPause(taskId), set, get),
  resumeTask: (taskId) => guard(() => bridge.taskResume(taskId), set, get),
  cancelTask: (taskId) => guard(() => bridge.taskCancel(taskId), set, get),

  rollbackTask: async (taskId, checkpointId) => {
    try {
      const result = await bridge.taskRollback(taskId, checkpointId);
      void get().refreshTasks();
      return result;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  resolveApproval: async (taskId, approve, seenSeq) => {
    if (!approvalIsCurrent(get().store, taskId, seenSeq)) {
      set({ error: "The agent's request changed before you answered — review it again." });
      return "superseded";
    }
    try {
      await bridge.permissionResolve(taskId, approve);
      void get().refreshTasks();
      return "sent";
    } catch (e) {
      set({ error: String(e) });
      return "error";
    }
  },

  restartSession: async (mode) => {
    set({ connection: "connecting", error: null });
    try {
      const session = await bridge.sessionRestart(mode);
      set({ session, connection: "ready" });
      await get().refreshTasks();
      return true;
    } catch (e) {
      // The old daemon is gone; the workspace has no session until reopened.
      set({ connection: "failed", error: String(e) });
      return false;
    }
  },

  dismissResumePrompt: () => set({ resumePromptDismissed: true }),
}));

/** Raise OS notifications for the transitions between two projections (§31).
 *  Pure comparison; `notify` itself is a no-op when the category is off, the
 *  master switch is off, or we're outside the Tauri shell. */
function emitNotifications(
  prev: StoreState,
  next: StoreState,
  rawBatch: readonly unknown[],
): void {
  const master = useApp.getState().notificationsEnabled;
  if (!master) return;

  const was = (id: string) => prev.tasks[id];
  for (const t of Object.values(next.tasks)) {
    const before = was(t.id);
    const obj = t.objective ?? "Task";
    if (t.state === "completed" && before?.state !== "completed") {
      void notify("completed", "Task completed", obj, master);
    } else if (t.state === "failed" && before?.state !== "failed") {
      void notify("failed", "Task failed", obj, master);
    } else if (
      t.state === "waiting_for_permission" &&
      before?.state !== "waiting_for_permission"
    ) {
      void notify("permission", "Permission required", obj, master);
      void notify("blocked", "Task blocked", obj, master);
    }
  }

  for (const raw of rawBatch) {
    if ((raw as { kind?: string })?.kind === "test_failed") {
      const p = (raw as { payload?: { summary?: string; command?: string } }).payload ?? {};
      void notify("tests-failed", "Tests failed", p.summary ?? p.command ?? "A verification run failed", master);
      break;
    }
  }
}

async function guard(
  fn: () => Promise<unknown>,
  set: (partial: Partial<LiveState>) => void,
  get: () => LiveState,
): Promise<void> {
  try {
    await fn();
    void get().refreshTasks();
  } catch (e) {
    set({ error: String(e) });
  }
}

/** True once a live session has produced at least one event. */
export const hasLiveData = (s: LiveState) => s.store.events.length > 0;
