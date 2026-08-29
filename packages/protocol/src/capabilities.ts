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
    // The diff itself is served locally from `git` (G3). The ownership column
    // (agent / user / pre-existing) needs Core's change ledger, which v1 does
    // not expose (G8) — it renders "unavailable", never a guess.
    requires: "method:ledger_changes",
    gap: "G8",
    fallback: { kind: "local-read", label: "git diff · ownership unavailable" },
  },
  {
    surface: "rollback",
    // `task_rollback` + the `rollback` capability exist, but v1 exposes no way
    // to *discover* a `checkpoint_id` (task_plan reports only `checkpoint: bool`;
    // no event carries the id). The per-step action stays disabled with that
    // reason; the wire path is wired and tested against Core's error path.
    requires: "method:plan_checkpoint_event",
    gap: "G13",
    fallback: { kind: "none" },
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
  {
    surface: "autonomy",
    // The mode is a daemon-start flag, not a `task_create` param (G1). The
    // control works — by restarting the workspace daemon — but is disabled
    // while a task runs and when the daemon was adopted from another process.
    requires: "method:task_create_permission_mode",
    gap: "G1",
    fallback: { kind: "local-read", label: "Applied by restarting Core" },
  },
  {
    surface: "security-overview",
    // Rendered from `doctor_run` + `config_show`; no capability gates those,
    // but the socket the app connects over is not authenticated (G10).
    requires: "doctor",
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
