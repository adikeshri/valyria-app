import { currentTask } from "../data/mock";
import { useLive } from "../core/liveStore";
import LiveVerificationInspector from "./LiveVerificationInspector";

export default function VerificationPanel() {
  const liveSession = useLive((s) => s.session);
  if (liveSession) return <LiveVerificationInspector />;
  return <MockVerificationPanel />;
}

function MockVerificationPanel() {
  const rows = [...currentTask.verified, ...currentTask.unverified];
  return (
    <div className="scroll-y" style={{ height: "100%", padding: "10px 12px" }}>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 10 }}>
        Evidence for this task's completion report. A category with no run reads <strong>NOT RUN</strong> — never a generic "verified".
      </p>
      {rows.map((v) => (
        <div key={v.command} style={{ marginBottom: 8, padding: "9px 10px", background: "var(--bg-sunken)", borderRadius: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-secondary)" }}>
              {v.kind.replace("_", " ")}
            </span>
            <span className={`badge ${v.outcome === "pass" ? "badge--success" : v.outcome === "fail" ? "badge--danger" : "badge--neutral"}`}>
              {v.outcome === "pass" ? "PASS" : v.outcome === "fail" ? "FAIL" : "NOT RUN"}
            </span>
          </div>
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", marginTop: 4 }}>{v.command}</div>
          {v.runId && <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>{v.runId}</div>}
        </div>
      ))}
    </div>
  );
}
