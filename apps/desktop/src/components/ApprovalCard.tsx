import { ShieldAlert, Terminal, Check, X, Clock3 } from "lucide-react";
import type { ApprovalRequest } from "../types/domain";
import { useApp } from "../state/store";

const riskStyle: Record<ApprovalRequest["risk"], { border: string; bg: string; fg: string; label: string }> = {
  low: { border: "var(--border)", bg: "var(--bg-surface-raised)", fg: "var(--text-secondary)", label: "Low risk" },
  medium: { border: "var(--warning-border)", bg: "var(--warning-bg)", fg: "var(--warning)", label: "Medium risk" },
  high: { border: "var(--danger-border)", bg: "var(--danger-bg)", fg: "var(--danger)", label: "High risk — destructive" },
};

export default function ApprovalCard({ approval }: { approval: ApprovalRequest }) {
  const resolveApproval = useApp((s) => s.resolveApproval);
  const open = useApp((s) => s.approvalOpen);
  const style = riskStyle[approval.risk];

  if (!open) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "9px 14px",
        background: "var(--success-bg)", border: "1px solid var(--success-border)",
        borderRadius: 8, margin: "10px 16px 0", fontSize: "var(--text-sm)", color: "var(--success)",
      }}>
        <Check size={14} /> Approved — the agent can continue.
      </div>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby="approval-title"
      style={{
        margin: "10px 16px 0", borderRadius: 10, border: `1px solid ${style.border}`,
        background: style.bg, overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${style.border}` }}>
        <ShieldAlert size={16} style={{ color: style.fg, flexShrink: 0 }} />
        <span id="approval-title" style={{ fontWeight: 650, fontSize: "var(--text-sm)", flex: 1 }}>
          Approval required
        </span>
        <span className={`badge ${approval.risk === "high" ? "badge--danger" : approval.risk === "medium" ? "badge--warning" : "badge--neutral"}`}>
          {style.label}
        </span>
      </div>
      <div style={{ padding: "12px 14px" }}>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{approval.prompt}</p>
        {approval.command && (
          <div style={{
            display: "flex", alignItems: "center", gap: 7, marginTop: 8, padding: "7px 10px",
            background: "var(--bg-sunken)", borderRadius: 6, fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)",
          }}>
            <Terminal size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
            {approval.command}
          </div>
        )}
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 8 }}>{approval.reason}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button className="btn btn--primary" onClick={() => resolveApproval("once")}>
            <Check size={13} /> Allow Once
          </button>
          <button className="btn" title="Requires a scoped approval token Core doesn't expose yet" disabled>
            <Clock3 size={13} /> Allow for Task
          </button>
          <button className="btn btn--danger" onClick={() => resolveApproval("deny")}>
            <X size={13} /> Deny
          </button>
        </div>
      </div>
    </div>
  );
}
