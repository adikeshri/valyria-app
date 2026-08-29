import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, ShieldQuestion, Loader2 } from "lucide-react";
import { currentTask } from "@valyria/state";
import { useLive } from "../core/liveStore";
import { useApp } from "../state/store";
import { bridge, type TaskReport } from "../core/bridge";
import { isActive } from "../core/view";

/** The Phase 4 verification inspector (docs/PLAN.md §4.12, D8): renders
 *  `task_report`'s `verified[]` / `unverified[]` **verbatim** — command, kind,
 *  outcome, run_id. A category with no evidence reads NOT RUN. There is no code
 *  path here that produces a "verified" state from anything other than a
 *  `VerifiedClaimWire`. */
export default function LiveVerificationInspector() {
  const store = useLive((s) => s.store);
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const task = store.tasks[selectedTaskId] ?? currentTask(store);

  const [report, setReport] = useState<TaskReport | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!task) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setPending(true);
    bridge
      .taskReport(task.id)
      .then((r) => !cancelled && setReport(r))
      .catch(() => !cancelled && setReport(null))
      .finally(() => !cancelled && setPending(false));
    return () => {
      cancelled = true;
    };
  }, [task?.id, task?.lastSeq]);

  if (!task) {
    return (
      <div className="scroll-y" style={{ height: "100%", padding: "10px 12px" }}>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
          No task selected.
        </p>
      </div>
    );
  }

  const running = isActive(task.state);

  return (
    <div className="scroll-y" style={{ height: "100%", padding: "10px 12px" }}>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 10 }}>
        Evidence from this task's completion report. A category with no run reads{" "}
        <strong>NOT RUN</strong> — never a generic "verified".
      </p>

      {running && !report && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
          <Loader2 size={13} className="spin" /> Task still running — the report is written at completion.
        </div>
      )}

      {pending && !report && !running && (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Loading report…</div>
      )}

      {report && report.verified.length === 0 && report.unverified.length === 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", background: "var(--bg-sunken)", borderRadius: 8 }}>
          <ShieldQuestion size={14} style={{ color: "var(--text-tertiary)" }} />
          <span style={{ fontSize: "var(--text-sm)" }}>NOT RUN — no verification evidence recorded.</span>
        </div>
      )}

      {report?.verified.map((v) => (
        <div key={v.run_id} style={{ marginBottom: 8, padding: "9px 10px", background: "var(--bg-sunken)", borderRadius: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-secondary)" }}>
              {v.kind.replace(/_/g, " ")}
            </span>
            <span className={`badge ${/pass/i.test(v.outcome) ? "badge--success" : /fail/i.test(v.outcome) ? "badge--danger" : "badge--neutral"}`}>
              {/pass/i.test(v.outcome) ? <CheckCircle2 size={11} /> : /fail/i.test(v.outcome) ? <XCircle size={11} /> : null}
              {v.outcome}
            </span>
          </div>
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", marginTop: 4 }}>{v.command}</div>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>{v.run_id}</div>
        </div>
      ))}

      {report && report.unverified.length > 0 && (
        <>
          <div className="section-label" style={{ margin: "10px 0 6px" }}>Unverified</div>
          {report.unverified.map((u) => (
            <div key={u} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              <ShieldQuestion size={13} /> {u} — <strong style={{ color: "var(--text-secondary)" }}>NOT RUN</strong>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
