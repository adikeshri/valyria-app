import { useEffect, useRef, useState } from "react";
import { ShieldAlert, Terminal, Check, X, Clock3, RefreshCw } from "lucide-react";
import { pendingApprovalFor } from "@valyria/state";
import { useLive } from "../core/liveStore";

/** Driven by `approval_requested` payloads (`prompt`, `tool`, `category`,
 *  `target`, `risk`). One at a time per task (§4.7).
 *
 *  G2 hardening: `permission_resolve` carries no request id, so the card
 *  records the `seq` it rendered and the store refuses to answer if a newer
 *  `approval_requested` has arrived since — it re-prompts instead. `Allow for
 *  Task` stays disabled until Core exposes a scoped token.
 *
 *  Destructive / network operations require a deliberate second click. */
export default function LiveApprovalCard({ taskId }: { taskId: string }) {
  const store = useLive((s) => s.store);
  const resolveApproval = useLive((s) => s.resolveApproval);
  const approval = pendingApprovalFor(store, taskId);

  const [confirm, setConfirm] = useState<null | "allow" | "deny">(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // A new request (different seq) resets any in-flight confirmation.
  const seq = approval?.seq ?? -1;
  useEffect(() => {
    setConfirm(null);
    setChanged(false);
    cardRef.current?.focus();
  }, [seq]);

  if (!approval) return null;

  const p = (approval.payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  const risk = (str("risk") ?? "low").toLowerCase();
  const high = risk === "high" || risk === "destructive";
  const medium = risk === "medium" || risk === "network";
  const needsConfirm = high || medium;

  async function answer(approve: boolean) {
    setBusy(true);
    const outcome = await resolveApproval(taskId, approve, seq);
    setBusy(false);
    setConfirm(null);
    if (outcome === "superseded") setChanged(true);
  }

  function onButton(kind: "allow" | "deny") {
    if (needsConfirm && confirm !== kind) {
      setConfirm(kind);
      return;
    }
    void answer(kind === "allow");
  }

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
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
        {changed && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, padding: "7px 10px", background: "var(--bg-sunken)", borderRadius: 6, fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            <RefreshCw size={12} /> The request changed before your answer was sent. Review the current one below.
          </div>
        )}
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

        {confirm ? (
          <div style={{ marginTop: 12, padding: 10, background: "var(--bg-sunken)", borderRadius: 6 }}>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 8 }}>
              {confirm === "allow"
                ? `This is a ${high ? "destructive or irreversible" : "network"} operation. Allow it?`
                : "Deny this request and stop the agent here?"}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className={confirm === "allow" ? "btn btn--danger" : "btn btn--primary"}
                disabled={busy}
                onClick={() => void answer(confirm === "allow")}
              >
                {confirm === "allow" ? <Check size={13} /> : <X size={13} />}
                Confirm {confirm === "allow" ? "allow" : "deny"}
              </button>
              <button className="btn" disabled={busy} onClick={() => setConfirm(null)}>Back</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn btn--primary" disabled={busy} onClick={() => onButton("allow")}>
              <Check size={13} /> {needsConfirm ? "Allow…" : "Allow"}
            </button>
            <button className="btn" title="Requires a scoped approval token Core doesn't expose yet (G2)" disabled>
              <Clock3 size={13} /> Allow for Task
            </button>
            <button className="btn btn--danger" disabled={busy} onClick={() => onButton("deny")}>
              <X size={13} /> {needsConfirm ? "Deny…" : "Deny"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
