import { AlertTriangle } from "lucide-react";
import type { ErrorPresentation } from "../core/errors";

/** Renders an ErrorPresentation's four §36 answers (docs/PLAN.md §3). Every
 *  error surface in the app uses this — a raw `String(e)` in JSX is barred by
 *  `xtask check-error-strings`. `compact` is the one-line variant for inline
 *  strips (ConnectBar, a settings row). */
export default function ErrorState({
  presentation: p,
  compact,
}: {
  presentation: ErrorPresentation;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div
        role="alert"
        style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 11.5, lineHeight: 1.5 }}
      >
        <AlertTriangle size={12} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} />
        <span style={{ color: "var(--danger)" }}>
          {p.what}{" "}
          <span style={{ color: "var(--text-tertiary)" }}>{p.whatNext}</span>
        </span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
        padding: 24,
        maxWidth: 460,
      }}
    >
      <AlertTriangle size={22} style={{ color: "var(--danger)" }} />
      <strong style={{ fontSize: "var(--text-sm)" }}>{p.what}</strong>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
        {p.agentStopped ? "The agent's task stopped." : "The agent's task is unaffected."}
        {p.userActionNeeded ? " Your action is needed." : ""}
      </span>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
        What to do: {p.whatNext}
      </span>
      {p.code && (
        <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {p.code}
        </span>
      )}
    </div>
  );
}
