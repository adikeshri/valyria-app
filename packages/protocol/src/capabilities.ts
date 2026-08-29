// The capability registry (docs/PLAN.md D6).
//
// `hello` returns `capabilities: string[]`. Every UI surface declares what it
// needs; a surface whose requirement is absent renders a specific "unavailable"
// state naming the missing capability — never a blank panel, never a
// client-side reimplementation.
//
// This file is the single source of that mapping. It is deliberately data, not
// logic: the renderer reads it, it does not branch on version strings.

/** Capabilities the pinned Core (core.lock.json) advertises today. */
export const KNOWN_CAPABILITIES = [
  "plan",
  "doctor",
  "storage",
  "memory",
  "models",
  "rollback",
  "events_resume",
] as const;

export type Capability = (typeof KNOWN_CAPABILITIES)[number];

/** How a surface is powered when its Core capability is missing. */
export type Fallback =
  | { kind: "none" } // hard-disabled, show the reason
  | { kind: "local-read"; label: string } // served locally, must be labeled (CORE-INTERFACE §3)
  | { kind: "synthetic-fixture" }; // built + trace-tested, lights up when Core emits

export interface SurfaceRequirement {
  /** PRD surface id (mirrors packages/features/ dir names in PLAN §2). */
  surface: string;
  /** Capability token from `hello`, or a protocol method name, or null when
   *  the surface works against v1 as-is. */
  requires: Capability | `method:${string}` | null;
  /** The CORE-INTERFACE gap this surface is blocked by, if any. */
  gap?: `G${number}`;
  fallback: Fallback;
}

export const SURFACE_REQUIREMENTS: readonly SurfaceRequirement[] = [
  { surface: "agent-chat", requires: null, fallback: { kind: "none" } },
  { surface: "task-view", requires: "plan", fallback: { kind: "none" } },
  { surface: "agent-activity", requires: null, fallback: { kind: "none" } },
  { surface: "task-history", requires: null, fallback: { kind: "none" } },
  { surface: "verification-inspector", requires: null, fallback: { kind: "none" } },
  { surface: "approvals", requires: null, gap: "G2", fallback: { kind: "none" } },
  {
    surface: "workspace-explorer",
    requires: "method:index_status",
    gap: "G3",
    fallback: { kind: "local-read", label: "Served locally" },
  },
  {
    surface: "code-viewer",
    requires: "method:index_status",
    gap: "G3",
    fallback: { kind: "local-read", label: "Served locally" },
  },
  {
    surface: "git-changes",
    requires: "method:git_status",
    gap: "G3",
    fallback: { kind: "local-read", label: "Served locally · read-only" },
  },
  {
    surface: "search",
    requires: "method:search_query",
    gap: "G3",
    fallback: { kind: "local-read", label: "Filename match only" },
  },
  {
    surface: "diff-viewer",
    requires: "rollback",
    fallback: { kind: "local-read", label: "Ownership unavailable" },
  },
  {
    surface: "context-inspector",
    requires: "method:context_explain",
    gap: "G7",
    fallback: { kind: "synthetic-fixture" },
  },
  {
    surface: "model-manager",
    requires: "models",
    gap: "G5",
    fallback: { kind: "none" }, // inventory only until model_install exists
  },
  {
    surface: "hardware-status",
    requires: "method:hardware_probe",
    gap: "G4",
    fallback: { kind: "local-read", label: "From doctor_run only" },
  },
  { surface: "settings", requires: null, gap: "G6", fallback: { kind: "none" } },
  { surface: "first-run", requires: "doctor", fallback: { kind: "none" } },
  { surface: "terminal", requires: null, fallback: { kind: "none" } }, // app-owned PTY (PLAN §10.4)
] as const;

export function requirementFor(surface: string): SurfaceRequirement | undefined {
  return SURFACE_REQUIREMENTS.find((r) => r.surface === surface);
}

/** True when `surface` can run at full fidelity against the given capability set. */
export function surfaceIsLive(surface: string, capabilities: readonly string[]): boolean {
  const req = requirementFor(surface);
  if (!req || req.requires === null) return true;
  if (req.requires.startsWith("method:")) return false; // no method introspection on v1
  return capabilities.includes(req.requires);
}
