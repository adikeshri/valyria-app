import { create } from "zustand";
import type { ConnectionState } from "../types/domain";
import { currentTask, pendingApproval } from "../data/mock";

export type SidebarSection = "files" | "changes" | "tasks" | "git" | "models" | "hardware";
export type CenterTab = "chat" | "task" | "code";
export type DockTab = "activity" | "timeline" | "terminal" | "tests" | "diff";
export type RightTab = "context" | "symbols" | "verify";
export type Theme = "light" | "dark" | "system";
export type Route = "workspace" | "settings" | "first-run";

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

  selectedFile: string | null;
  setSelectedFile: (p: string | null) => void;

  selectedTaskId: string;
  setSelectedTaskId: (id: string) => void;

  approvalOpen: boolean;
  resolveApproval: (decision: "once" | "task" | "deny") => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (v: boolean) => void;
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

  selectedFile: "src/auth/service.py",
  setSelectedFile: (selectedFile) => set({ selectedFile }),

  selectedTaskId: currentTask.id,
  setSelectedTaskId: (selectedTaskId) => set({ selectedTaskId }),

  approvalOpen: Boolean(pendingApproval),
  resolveApproval: () => set({ approvalOpen: false }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
}));
