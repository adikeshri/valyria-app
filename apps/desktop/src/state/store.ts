import { create } from "zustand";
import type { ConnectionState } from "../types/domain";
import { currentTask, pendingApproval } from "../data/mock";

export type SidebarSection = "files" | "changes" | "tasks" | "git" | "models" | "hardware";
export type CenterTab = "chat" | "task" | "code";
export type DockTab = "activity" | "timeline" | "terminal" | "tests" | "diff";
export type RightTab = "context" | "search" | "verify";
export type TerminalSub = "human" | "agent";
export type Theme = "light" | "dark" | "system";
export type Route = "workspace" | "settings" | "first-run" | "about";

/** A request from one panel to open a file in another (Phase 7 cross-panel
 *  navigation — the failure → file → diff → change chain). `reveal()` is the
 *  single carrier; it replaces the ad-hoc `setSelectedFile(p); setDockTab(...)`
 *  pairs that were duplicated across panels and could not convey a line or a
 *  reason. */
export interface RevealTarget {
  path: string;
  /** 1-based; the diff viewer scrolls here when present */
  line?: number;
  /** where to show it — the diff dock tab (default) or the code viewer */
  in?: "diff" | "code";
  /** why this file is implicated — the target panel may surface it; absent when
   *  the user picked the file directly */
  reason?: string;
}

interface AppState {
  theme: Theme;
  setTheme: (t: Theme) => void;

  route: Route;
  setRoute: (r: Route) => void;

  connection: ConnectionState;

  sidebarSection: SidebarSection;
  setSidebarSection: (s: SidebarSection) => void;

  centerTab: CenterTab;
  setCenterTab: (t: CenterTab) => void;

  dockTab: DockTab;
  setDockTab: (t: DockTab) => void;
  dockCollapsed: boolean;
  toggleDock: () => void;

  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;
  rightCollapsed: boolean;
  toggleRight: () => void;

  /** Human / agent split inside the Terminal dock panel. In the store (not
   *  panel-local) so `reveal`-style jumps and the command palette can target
   *  the agent-command view. */
  terminalSub: TerminalSub;
  setTerminalSub: (t: TerminalSub) => void;

  selectedFile: string | null;
  setSelectedFile: (p: string | null) => void;
  /** The most recent cross-panel jump (Phase 7). Panels read `line` / `reason`;
   *  `null` when nothing has been revealed this session. */
  revealed: RevealTarget | null;
  reveal: (t: RevealTarget) => void;

  selectedTaskId: string;
  setSelectedTaskId: (id: string) => void;

  approvalOpen: boolean;
  resolveApproval: (decision: "once" | "task" | "deny") => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (v: boolean) => void;

  /** Master switch for OS notifications (§31). Per-category opt-in lives in
   *  core/notify.ts. Persisted to localStorage. */
  notificationsEnabled: boolean;
  setNotificationsEnabled: (v: boolean) => void;

  /** Minimize animation throughout the app (D10). Applied to <html> by
   *  useReducedMotionEffect; persisted to localStorage. Defaults on when the
   *  OS asks for reduced motion. */
  reducedMotion: boolean;
  setReducedMotion: (v: boolean) => void;
}

const NOTIF_LS_KEY = "valyria.notify.master";
function readNotifMaster(): boolean {
  try {
    return localStorage.getItem(NOTIF_LS_KEY) !== "off";
  } catch {
    return true;
  }
}

const REDUCED_MOTION_LS_KEY = "valyria.reducedMotion";
function readReducedMotion(): boolean {
  try {
    const stored = localStorage.getItem(REDUCED_MOTION_LS_KEY);
    if (stored === "on") return true;
    if (stored === "off") return false;
  } catch {
    /* private mode */
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export const useApp = create<AppState>((set) => ({
  theme: "system",
  setTheme: (theme) => set({ theme }),

  route: "workspace",
  setRoute: (route) => set({ route }),

  connection: "ready",

  sidebarSection: "files",
  setSidebarSection: (sidebarSection) => set({ sidebarSection }),

  centerTab: "chat",
  setCenterTab: (centerTab) => set({ centerTab }),

  dockTab: "activity",
  setDockTab: (dockTab) => set({ dockTab, dockCollapsed: false }),
  dockCollapsed: false,
  toggleDock: () => set((s) => ({ dockCollapsed: !s.dockCollapsed })),

  rightTab: "context",
  setRightTab: (rightTab) => set({ rightTab, rightCollapsed: false }),
  rightCollapsed: false,
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),

  terminalSub: "human",
  setTerminalSub: (terminalSub) => set({ terminalSub }),

  selectedFile: "src/auth/service.py",
  setSelectedFile: (selectedFile) => set({ selectedFile }),

  revealed: null,
  reveal: (target) =>
    set(
      target.in === "code"
        ? { selectedFile: target.path, revealed: target, centerTab: "code" }
        : { selectedFile: target.path, revealed: target, dockTab: "diff", dockCollapsed: false },
    ),

  selectedTaskId: currentTask.id,
  setSelectedTaskId: (selectedTaskId) => set({ selectedTaskId }),

  approvalOpen: Boolean(pendingApproval),
  resolveApproval: () => set({ approvalOpen: false }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

  notificationsEnabled: readNotifMaster(),
  setNotificationsEnabled: (notificationsEnabled) => {
    try {
      localStorage.setItem(NOTIF_LS_KEY, notificationsEnabled ? "on" : "off");
    } catch {
      /* ignore */
    }
    set({ notificationsEnabled });
  },

  reducedMotion: readReducedMotion(),
  setReducedMotion: (reducedMotion) => {
    try {
      localStorage.setItem(REDUCED_MOTION_LS_KEY, reducedMotion ? "on" : "off");
    } catch {
      /* ignore */
    }
    set({ reducedMotion });
  },
}));
