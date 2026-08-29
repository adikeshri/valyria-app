import { HardDrive } from "lucide-react";

/** The visible marker every local-read fallback surface must carry
 *  (docs/PLAN.md D6, CORE-INTERFACE §3). Drops away per-surface when Core
 *  exposes the equivalent method (G3). */
export default function ServedLocally({ detail }: { detail?: string }) {
  return (
    <div
      title={
        detail ??
        "Read directly from your filesystem, not from the Core runtime. Read-only."
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 12px",
        fontSize: 10.5,
        color: "var(--text-tertiary)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <HardDrive size={11} />
      Served locally{detail ? ` · ${detail}` : ""}
    </div>
  );
}
