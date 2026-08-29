import { ShieldAlert, Terminal, Check, X, Clock3 } from "lucide-react";
import { pendingApprovalFor } from "@valyria/state";
import { useLive } from "../core/liveStore";

/** Driven by `approval_requested` payloads (`prompt`, `tool`, `category`,
 *  `target`, `risk`). One at a time per task; `Allow for Task` is disabled
 *  until Core exposes a scoped token (G2). */
export default function LiveApprovalCard({ taskId }: { taskId: string }) {
  const store = useLive((s) => s.store);
  const resolveApproval = useLive((s) => s.resolveApproval);
  const approval = pendingApprovalFor(store, taskId);
  if (!approval) return null;

  const p = (approval.payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  const risk = (str("risk") ?? "low").toLowerCase();
  const high = risk === "high" || risk === "destructive";
  const medium = risk === "medium" || risk === "network";

  return (
    <div
      role="alertdialog"
      aria-labelledby="approval-title"
      style={{
        margin: "10px 16px 0",
        borderRadius: 10,
        border: `1px solid ${high ? "var(--danger-border)" : medium ? "var(--warning-border)" : "var(--border)"}`,
        background: high ? "var(--danger-bg)" : medium ? "var(--warning-bg)" : "var(--bg-surface-raised)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
        <ShieldAlert size={16} style={{ color: high ? "var(--danger)" : medium ? "var(--warning)" : "var(--text-secondary)", flexShrink: 0 }} />
        <span id="approval-title" style={{ fontWeight: 650, fontSize: "var(--text-sm)", flex: 1 }}>Approval required</span>
        <span className={`badge ${high ? "badge--danger" : medium ? "badge--warning" : "badge--neutral"}`}>
          {high ? "High risk" : medium ? "Medium risk" : "Low risk"}
        </span>
      </div>
      <div style={{ padding: "12px 14px" }}>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
          {str("prompt") ?? `The agent wants to run ${str("tool") ?? "an action"}.`}
        </p>
        {(str("target") || str("tool")) && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, padding: "7px 10px", background: "var(--bg-sunken)", borderRadius: 6, fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
            <Terminal size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
            {str("tool")}{str("target") ? ` · ${str("target")}` : ""}
          </div>
        )}
        {str("category") && (
          <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 8 }}>Category: {str("category")}</p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button className="btn btn--primary" onClick={() => resolveApproval(taskId, true)}>
            <Check size={13} /> Allow
          </button>
          <button className="btn" title="Requires a scoped approval token Core doesn't expose yet (G2)" disabled>
            <Clock3 size={13} /> Allow for Task
          </button>
          <button className="btn btn--danger" onClick={() => resolveApproval(taskId, false)}>
            <X size={13} /> Deny
          </button>
        </div>
      </div>
    </div>
  );
}
