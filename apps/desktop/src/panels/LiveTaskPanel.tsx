import { useEffect, useState } from "react";
import {
  CheckCircle2, Circle, CircleDot, Clock, FileDiff, ShieldCheck, Pause, Play, X,
} from "lucide-react";
import { currentTask, eventsForTask, type EventRow } from "@valyria/state";
import { useLive } from "../core/liveStore";
import { useApp } from "../state/store";
import { bridge, type PlanGet, type TaskReport } from "../core/bridge";
import { stateLabel, stateBadgeClass, isActive, fmtDurationMs } from "../core/view";

export default function LiveTaskPanel() {
  const store = useLive((s) => s.store);
  const pauseTask = useLive((s) => s.pauseTask);
  const resumeTask = useLive((s) => s.resumeTask);
  const cancelTask = useLive((s) => s.cancelTask);
  const setSelectedFile = useApp((s) => s.setSelectedFile);
  const setDockTab = useApp((s) => s.setDockTab);
  const selectedTaskId = useApp((s) => s.selectedTaskId);

  const task = store.tasks[selectedTaskId] ?? currentTask(store);
  const [plan, setPlan] = useState<PlanGet | null>(null);
  const [report, setReport] = useState<TaskReport | null>(null);

  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    bridge.taskPlan(task.id).then((p) => !cancelled && setPlan(p)).catch(() => {});
    return () => { cancelled = true; };
  }, [task?.id, task?.lastSeq]);

  useEffect(() => {
    if (!task || isActive(task.state)) { setReport(null); return; }
    let cancelled = false;
    bridge.taskReport(task.id).then((r) => !cancelled && setReport(r)).catch(() => {});
    return () => { cancelled = true; };
  }, [task?.id, task?.state]);

  if (!task) {
    return (
      <div className="panel-empty" style={{ padding: 24 }}>
        <CircleDot size={22} />
        <strong>No task selected</strong>
        <span>Start one from the chat, or pick one from history.</span>
      </div>
    );
  }

  const active = isActive(task.state);
  const changedFiles = filesFrom(eventsForTask(store, task.id));
  const duration = task.lastTs && task.firstTs ? fmtDurationMs(task.lastTs - task.firstTs) : "—";

  return (
    <div className="scroll-y" style={{ height: "100%", padding: "18px 20px 28px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <span className={`badge ${stateBadgeClass(task.state)}`}>{stateLabel(task.state)}</span>
            <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 650, marginTop: 8, lineHeight: 1.35 }}>
              {task.objective ?? "(objective pending)"}
            </h2>
          </div>
          {active && (
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {task.state === "paused" ? (
                <button className="btn btn--sm" onClick={() => void resumeTask(task.id)} title="Resume"><Play size={13} /> Resume</button>
              ) : (
                <button className="btn btn--sm" onClick={() => void pauseTask(task.id)} title="Pause"><Pause size={13} /> Pause</button>
              )}
              <button className="btn btn--sm btn--danger" onClick={() => void cancelTask(task.id)} title="Cancel"><X size={13} /> Cancel</button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Clock size={12} /> {duration}</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>{task.id}</span>
        </div>

        <Section title="Plan">
          {!plan || plan.steps.length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
              {plan ? "Ran as a pass-through — no model-authored plan." : "No plan yet."}
            </p>
          ) : (
            <ol style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {plan.steps.map((st, i) => (
                <li key={st.id || i} style={{ display: "flex", gap: 8, fontSize: "var(--text-sm)" }}>
                  <Circle size={13} style={{ color: "var(--text-tertiary)", marginTop: 3, flexShrink: 0 }} />
                  <span style={{ minWidth: 0 }}>
                    {st.intent}
                    {st.targets?.length > 0 && (
                      <span style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 11 }}> — {st.targets.join(", ")}</span>
                    )}
                    {st.checkpoint && <span className="badge badge--neutral" style={{ marginLeft: 6 }}>checkpoint</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title={`Modified files (${changedFiles.length})`}>
          {changedFiles.length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>None yet.</p>
          ) : (
            changedFiles.map((f) => (
              <button
                key={f}
                className="no-native-focus"
                onClick={() => { setSelectedFile(f); setDockTab("diff"); }}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "4px 0", fontSize: "var(--text-sm)", textAlign: "left" }}
              >
                <FileDiff size={12} style={{ color: "var(--own-agent)", flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f}</span>
              </button>
            ))
          )}
        </Section>

        {report && (
          <Section title="Verification">
            {report.verified.length === 0 && report.unverified.length === 0 ? (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>NOT RUN</p>
            ) : (
              <>
                {report.verified.map((v) => (
                  <div key={v.run_id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)" }}>
                    <CheckCircle2 size={13} style={{ color: "var(--success)" }} />
                    <span style={{ fontFamily: "var(--font-mono)" }}>{v.command}</span>
                    <span style={{ color: "var(--text-tertiary)" }}>· {v.outcome}</span>
                  </div>
                ))}
                {report.unverified.map((u) => (
                  <div key={u} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                    <ShieldCheck size={13} /> {u} — NOT RUN
                  </div>
                ))}
              </>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div className="section-label" style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function filesFrom(events: EventRow[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    if (e.kind === "file_changed") {
      const p = (e.payload as { path?: unknown })?.path;
      if (typeof p === "string") set.add(p);
    }
    if (e.kind === "tool_started") {
      const input = (e.payload as { input?: { path?: unknown } })?.input;
      const tool = (e.payload as { tool?: unknown })?.tool;
      if (typeof input?.path === "string" && typeof tool === "string" && /write|edit|patch/.test(tool)) {
        set.add(input.path);
      }
    }
  }
  return [...set].sort();
}
