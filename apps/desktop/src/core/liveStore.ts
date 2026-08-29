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
  emptyStore,
  mergeTaskSummaries,
  type ConnectionState,
  type StoreState,
} from "@valyria/state";
import { bridge, inTauri, type SessionInfo } from "./bridge";
import { repo } from "./repo";

interface LiveState {
  available: boolean;
  session: SessionInfo | null;
  connection: ConnectionState;
  store: StoreState;
  error: string | null;
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
  resolveApproval: (taskId: string, approve: boolean) => Promise<void>;
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
      store: emptyStore(),
      resumePromptDismissed: false,
      fsRev: 0,
      fsChangedPaths: [],
    });
    try {
      await teardown();
      unlisteners.push(
        await bridge.onEventBatch((b) => {
          set((s) => ({ store: applyBatch(s.store, b.events) }));
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
      set({ connection: "failed", error: String(e) });
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
  resolveApproval: (taskId, approve) =>
    guard(() => bridge.permissionResolve(taskId, approve), set, get),

  dismissResumePrompt: () => set({ resumePromptDismissed: true }),
}));

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
