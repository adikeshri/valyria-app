import { CheckCircle2, Circle, CircleDot, Clock, Cpu, FileDiff, ShieldCheck, Bookmark, Pause, X } from "lucide-react";
import { currentTask, taskHistory } from "../data/mock";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import LiveTaskPanel from "./LiveTaskPanel";
import type { TaskState } from "../types/domain";

const stateLabel: Record<TaskState, string> = {
  planning: "Planning",
  running: "Running",
  waiting_for_permission: "Waiting for permission",
  verifying: "Verifying",
  repairing: "Repairing",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
};

const stateBadge: Record<TaskState, string> = {
  planning: "badge--info",
  running: "badge--info",
  waiting_for_permission: "badge--warning",
  verifying: "badge--info",
  repairing: "badge--warning",
  paused: "badge--neutral",
  completed: "badge--success",
  failed: "badge--danger",
};

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export default function TaskDetailPanel() {
  const liveSession = useLive((s) => s.session);
  if (liveSession) return <LiveTaskPanel />;
  return <MockTaskDetailPanel />;
}

function MockTaskDetailPanel() {
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const setSelectedFile = useApp((s) => s.setSelectedFile);
  const setDockTab = useApp((s) => s.setDockTab);
  const task = taskHistory.find((t) => t.id === selectedTaskId) ?? currentTask;
  const canControl = task.state !== "completed" && task.state !== "failed";

  return (
    <div className="scroll-y" style={{ height: "100%", padding: "18px 20px 28px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <span className={`badge ${stateBadge[task.state]}`}>{stateLabel[task.state]}</span>
            <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 650, marginTop: 8, lineHeight: 1.35 }}>{task.objective}</h2>
          </div>
          {canControl && (
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button className="btn btn--sm"><Pause size={12} /> Pause</button>
              <button className="btn btn--sm btn--danger"><X size={12} /> Cancel</button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14, padding: "12px 0", borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)" }}>
          <Meta icon={<Clock size={13} />} label="Duration" value={fmtDuration(task.durationSec)} />
          <Meta icon={<Cpu size={13} />} label="Model" value={task.model} />
          <Meta icon={<ShieldCheck size={13} />} label="Autonomy" value={task.autonomy} />
          <Meta icon={<FileDiff size={13} />} label="Files" value={`${task.modifiedFiles.length} modified`} />
        </div>

        <section style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 650, marginBottom: 10 }}>Plan</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {task.plan.map((step) => (
              <div key={step.id} style={{ display: "flex", gap: 9, padding: "6px 0" }}>
                <span style={{ marginTop: 2, flexShrink: 0, color: step.status === "done" ? "var(--success)" : step.status === "active" ? "var(--accent)" : "var(--text-tertiary)" }}>
                  {step.status === "done" ? <CheckCircle2 size={15} /> : step.status === "active" ? <CircleDot size={15} /> : <Circle size={15} />}
                </span>
                <div>
                  <div style={{ fontSize: "var(--text-sm)", color: step.status === "pending" ? "var(--text-tertiary)" : "var(--text-primary)" }}>
                    {step.intent}
                    {step.checkpoint && (
                      <span title="Rollback checkpoint" style={{ display: "inline-flex", marginLeft: 6, verticalAlign: "middle" }}>
                        <Bookmark size={11} style={{ color: "var(--text-tertiary)" }} />
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>{step.targets.join(", ")}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 22 }}>
          <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 650, marginBottom: 10 }}>Modified files</h3>
          <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, overflow: "hidden" }}>
            {task.modifiedFiles.map((f, i) => (
              <button
                key={f.path}
                className="no-native-focus"
                onClick={() => { setSelectedFile(f.path); setDockTab("diff"); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", textAlign: "left",
                  borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <FileDiff size={13} style={{ color: "var(--text-tertiary)" }} />
                <span style={{ fontSize: "var(--text-sm)", flex: 1, fontFamily: "var(--font-mono)" }}>{f.path}</span>
                <span className={`badge ${f.ownership === "agent" ? "badge--agent" : f.ownership === "user" ? "badge--user" : "badge--existing"}`}>
                  {f.ownership}
                </span>
                <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--diff-add-text)" }}>+{f.additions}</span>
                <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--diff-del-text)" }}>−{f.deletions}</span>
              </button>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 22 }}>
          <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 650, marginBottom: 10 }}>Verification</h3>
          <VerificationRows task={task} />
        </section>

        <section style={{ marginTop: 22, marginBottom: 10 }}>
          <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 650, marginBottom: 10 }}>Permissions</h3>
          {task.pendingApproval ? (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              Waiting on: <strong style={{ color: "var(--text-primary)" }}>{task.pendingApproval.prompt}</strong>
            </div>
          ) : (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>No pending approvals for this task.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: "var(--text-tertiary)" }}>{icon}</span>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{label}</span>
      <span style={{ fontSize: "var(--text-sm)", fontWeight: 550 }}>{value}</span>
    </div>
  );
}

function VerificationRows({ task }: { task: typeof currentTask }) {
  const rows = [...task.verified, ...task.unverified];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((v) => (
        <div key={v.command} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--bg-sunken)", borderRadius: 6 }}>
          <span className={`badge ${v.outcome === "pass" ? "badge--success" : v.outcome === "fail" ? "badge--danger" : "badge--neutral"}`} style={{ width: 74, justifyContent: "center" }}>
            {v.outcome === "pass" ? "PASS" : v.outcome === "fail" ? "FAIL" : "NOT RUN"}
          </span>
          <span style={{ fontSize: "var(--text-xs)", textTransform: "capitalize", width: 76, flexShrink: 0, color: "var(--text-secondary)" }}>{v.kind.replace("_", " ")}</span>
          <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {v.command}
          </span>
        </div>
      ))}
    </div>
  );
}
