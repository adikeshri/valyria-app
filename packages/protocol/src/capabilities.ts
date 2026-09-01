// The capability registry (docs/PLAN.md D6).
//
// `hello` returns `capabilities: string[]`. Every UI surface declares what it
// needs; a surface whose requirement is absent renders a specific "unavailable"
// state naming the missing capability — never a blank panel, never a
// client-side reimplementation.
//
// This file is the single source of that mapping. It is deliberately data, not
// logic: the renderer reads it, it does not branch on version strings.

/** Capabilities the pinned Core (core.lock.json) advertises today.
 *  Protocol 1.9.0 — the CORE-INTERFACE gap-closure set (G1–G15). */
export const KNOWN_CAPABILITIES = [
  "plan",
  "doctor",
  "storage",
  "memory",
  "models",
  "rollback",
  "events_resume",
  // gap closure:
  "config_write", // G6  — config_set { key, value, scope }
  "task_permission_mode", // G1  — task_create { permission_mode }
  "repo", // G3  — git_status/diff/log/branches, search_query, index_status
  "hardware", // G4  — hardware_probe, model_recommend
  "model_manage", // G5  — model_install/remove/activate/inspect + progress events
  "context", // G7  — context_retrieved event
  "ledger", // G8  — ledger_changes { task_id }
  "diagnostics_v2", // G13,G14,G15 — checkpoint_id, tool_invocation_id, failure locations
  "client_auth", // G10 — peer-uid + per-frame token
  "stream_filter", // G11 — task_id filter on subscribe
  "approval_scope", // G2  — request_id + decision (once|task|deny)
  "daemon", // the IPC transport (Unix socket / Windows named pipe, G9)
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
  // G2 closed (protocol 1.8.0): approval_requested carries request_id;
  // permission_resolve takes { request_id?, decision: once|task|deny }.
  { surface: "approvals", requires: "approval_scope", gap: "G2", fallback: { kind: "none" } },
  {
    surface: "workspace-explorer",
    requires: "repo",
    gap: "G3",
    fallback: { kind: "local-read", label: "Served locally" },
  },
  {
    surface: "code-viewer",
    requires: "repo",
    gap: "G3",
    fallback: { kind: "local-read", label: "Served locally" },
  },
  {
    surface: "git-changes",
    requires: "repo",
    gap: "G3",
    fallback: { kind: "local-read", label: "Served locally · read-only" },
  },
  {
    surface: "search",
    requires: "repo",
    gap: "G3",
    fallback: { kind: "local-read", label: "Filename match only" },
  },
  {
    // The diff text is served by Core's `git_diff` (G3); the ownership
    // column comes from `ledger_changes` (G8).
    surface: "diff-viewer",
    requires: "ledger",
    gap: "G8",
    fallback: { kind: "local-read", label: "git diff · ownership unavailable" },
  },
  {
    // `plan_checkpoint` events + `checkpoint_id` on PlanStepSummary make
    // the per-step rollback action reachable (G13).
    surface: "rollback",
    requires: "diagnostics_v2",
    gap: "G13",
    fallback: { kind: "none" },
  },
  {
    // Core now emits `context_retrieved` (G7).
    surface: "context-inspector",
    requires: "context",
    gap: "G7",
    fallback: { kind: "synthetic-fixture" },
  },
  {
    // `model_install`/`remove`/`activate`/`inspect` + progress events (G5).
    surface: "model-manager",
    requires: "model_manage",
    gap: "G5",
    fallback: { kind: "none" },
  },
  {
    // Structured `hardware_probe` + `model_recommend` (G4).
    surface: "hardware-status",
    requires: "hardware",
    gap: "G4",
    fallback: { kind: "local-read", label: "From doctor_run only" },
  },
  {
    // `config_set` writes and reports the effective value (G6).
    surface: "settings",
    requires: "config_write",
    gap: "G6",
    fallback: { kind: "none" },
  },
  {
    // `task_create { permission_mode }` — no daemon restart (G1).
    surface: "autonomy",
    requires: "task_permission_mode",
    gap: "G1",
    fallback: { kind: "local-read", label: "Applied by restarting Core" },
  },
  {
    // The daemon peer-uid checks every connection and accepts a per-frame
    // token (G10); the security overview can state the boundary as real.
    surface: "security-overview",
    requires: "client_auth",
    gap: "G10",
    fallback: { kind: "none" },
  },
  { surface: "first-run", requires: "doctor", fallback: { kind: "none" } },
  { surface: "terminal", requires: null, fallback: { kind: "none" } }, // app-owned PTY (PLAN §10.4)
] as const;

export function requirementFor(surface: string): SurfaceRequirement | undefined {
  return SURFACE_REQUIREMENTS.find((r) => r.surface === surface);
}

// --- version & compatibility verdict (CORE-INTERFACE §4) ----------------

export type CompatLevel = "ok" | "reduced" | "blocked";

export interface CompatVerdict {
  level: CompatLevel;
  headline: string;
  detail: string;
}

/** Numeric `major.minor` of a version string; `null` if it doesn't parse. */
function majorMinor(v: string): { major: number; minor: number } | null {
  const m = /^(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/**
 * The startup compatibility verdict from CORE-INTERFACE §4's table.
 *
 *   protocol major ≠ expected major → blocked (hard block, never proceed)
 *   Core minor > app minor          → ok      (newer Core; unknown fields ignored)
 *   Core minor < app minor          → reduced (features driven by capabilities[])
 *   otherwise                       → ok
 *
 * `negotiated === null` means no session yet — reported as `ok` with a neutral
 * line so the About surface can render before a workspace is open.
 */
export function compatVerdict(
  expectedProtocol: string,
  negotiated: { protocol_version: string; capabilities: readonly string[] } | null,
): CompatVerdict {
  if (!negotiated) {
    return {
      level: "ok",
      headline: "Not connected",
      detail: `This build speaks protocol ${expectedProtocol}. Open a workspace to check the running Core.`,
    };
  }

  const exp = majorMinor(expectedProtocol);
  const got = majorMinor(negotiated.protocol_version);

  if (!exp || !got || exp.major !== got.major) {
    return {
      level: "blocked",
      headline: "Incompatible Core",
      detail:
        `The Core runtime speaks protocol ${negotiated.protocol_version}; this build of the app ` +
        `requires ${expectedProtocol}. Use the Core bundled with this app, or update the app ` +
        `to a build that matches. The app will not run against a different protocol major.`,
    };
  }

  if (got.minor < exp.minor) {
    const missing = KNOWN_CAPABILITIES.filter((c) => !negotiated.capabilities.includes(c));
    return {
      level: "reduced",
      headline: "Older Core — some features reduced",
      detail: missing.length
        ? `Core is protocol ${negotiated.protocol_version}; this build expects ${expectedProtocol}. ` +
          `Surfaces needing ${missing.join(", ")} show their unavailable state.`
        : `Core is protocol ${negotiated.protocol_version}; this build expects ${expectedProtocol}. ` +
          `All advertised capabilities are present.`,
    };
  }

  if (got.minor > exp.minor) {
    return {
      level: "ok",
      headline: "Compatible (newer Core)",
      detail: `Core is protocol ${negotiated.protocol_version}, ahead of this build's ${expectedProtocol}. Unknown response fields and event kinds are ignored.`,
    };
  }

  return {
    level: "ok",
    headline: "Compatible",
    detail: `Core and app both speak protocol ${negotiated.protocol_version}.`,
  };
}

/** True when `surface` can run at full fidelity against the given capability set. */
export function surfaceIsLive(surface: string, capabilities: readonly string[]): boolean {
  const req = requirementFor(surface);
  if (!req || req.requires === null) return true;
  if (req.requires.startsWith("method:")) return false; // no method introspection on v1
  return capabilities.includes(req.requires);
}
