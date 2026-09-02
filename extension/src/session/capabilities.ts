/**
 * The capability registry in the extension (PLAN.md D6).
 *
 * `hello` returns `capabilities: string[]`. `@valyria/protocol` owns the
 * surface → requirement mapping (`SURFACE_REQUIREMENTS`); this class just holds
 * the live set and answers "is surface X available, and if not, how does it
 * degrade?". No branching on version strings, ever.
 */
import {
  SURFACE_REQUIREMENTS,
  type Fallback,
  type SurfaceRequirement,
} from "@valyria/protocol";

export interface SurfaceState {
  surface: string;
  available: boolean;
  /** How the surface behaves while unavailable. */
  fallback: Fallback;
  /** The missing capability token, when `available` is false. */
  missing?: string;
  /** The CORE-INTERFACE gap that blocks it, if any. */
  gap?: string;
}

export class Capabilities {
  private caps = new Set<string>();

  /** Replace the set from a fresh `hello` (via `session/open`). */
  set(caps: readonly string[]): void {
    this.caps = new Set(caps);
  }

  clear(): void {
    this.caps = new Set();
  }

  has(cap: string): boolean {
    return this.caps.has(cap);
  }

  list(): string[] {
    return [...this.caps].sort();
  }

  private met(req: SurfaceRequirement["requires"]): boolean {
    if (req === null) return true;
    if (req.startsWith("method:")) {
      // No introspection of method support on the wire yet; a declared method
      // requirement is treated as met once we have any session (caps non-empty).
      return this.caps.size > 0;
    }
    return this.caps.has(req);
  }

  resolve(surface: string): SurfaceState {
    const req = SURFACE_REQUIREMENTS.find((r) => r.surface === surface);
    if (!req) {
      return { surface, available: true, fallback: { kind: "none" } };
    }
    const available = this.met(req.requires);
    const out: SurfaceState = { surface, available, fallback: req.fallback };
    if (!available && typeof req.requires === "string") out.missing = req.requires;
    if (req.gap) out.gap = req.gap;
    return out;
  }

  /** All surfaces + their current state — for the About / diagnostics view. */
  snapshot(): SurfaceState[] {
    return SURFACE_REQUIREMENTS.map((r) => this.resolve(r.surface));
  }
}
