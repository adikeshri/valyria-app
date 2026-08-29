// Small presentation helpers shared by the live panels. Pure; time formatting
// takes an explicit `now` so it stays testable and deterministic.

import type { TaskState } from "@valyria/state";

export function stateLabel(state: TaskState | "unknown"): string {
  if (state === "unknown") return "…";
  return state.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function stateBadgeClass(state: TaskState | "unknown"): string {
  switch (state) {
    case "completed":
      return "badge--success";
    case "failed":
      return "badge--danger";
    case "cancelled":
      return "badge--neutral";
    case "waiting_for_permission":
    case "repairing":
      return "badge--warning";
    case "paused":
      return "badge--neutral";
    default:
      return "badge--info";
  }
}

export function isActive(state: TaskState | "unknown"): boolean {
  return !["completed", "failed", "cancelled"].includes(state);
}

export function relTime(ms: number, now: number): string {
  if (!ms) return "";
  const d = Math.max(0, now - ms);
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function dayBucket(ms: number, now: number): "Today" | "Yesterday" | "Earlier" {
  if (!ms) return "Earlier";
  const day = 86_400_000;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (ms >= startOfToday) return "Today";
  if (ms >= startOfToday - day) return "Yesterday";
  return "Earlier";
}

export function hhmm(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtDurationMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
