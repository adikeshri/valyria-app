import { useEffect, useState } from "react";
import {
  CheckCircle2, Circle, CircleDot, Clock, FileDiff, ShieldCheck, Pause, Play, X,
  Undo2, Bookmark,
} from "lucide-react";
import { checkpointIdsForTask, currentTask, eventsForTask, type EventRow } from "@valyria/state";
import { useLive } from "../core/liveStore";
import { useApp } from "../state/store";
import { bridge, type PlanGet, type RollbackResult, type TaskReport } from "../core/bridge";
import { stateLabel, stateBadgeClass, isActive, fmtDurationMs } from "../core/view";
import { present } from "../core/errors";
import ErrorState from "../components/ErrorState";

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

        <Section title="Rollback">
          <RollbackSection task={task} plan={plan} checkpointIds={checkpointIdsForTask(store, task.id)} />
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

/** Rollback goes through Core's `task_rollback` and nothing else (§4.8): the
 *  app never computes a partial revert. The confirmation states what Core will
 *  do; the result is reported exactly.
 *
 *  G13: a checkpoint id is now discoverable — `task_plan` reports `checkpoint_id`
 *  per step, and Core emits a `plan_checkpoint` event (`{ checkpoint_id,
 *  step_id }`) live. Each boundary step whose id is known gets a working
 *  per-step "Roll back" button; a boundary Core has not checkpointed yet stays
 *  disabled with that reason. The advanced "by id" path remains for a hand-held
 *  id. */
function RollbackSection({
  task,
  plan,
  checkpointIds,
}: {
  task: { id: string; state: string };
  plan: PlanGet | null;
  checkpointIds: Record<string, string>;
}) {
  const rollbackTask = useLive((s) => s.rollbackTask);
  const boundaries = (plan?.steps ?? []).filter((s) => s.checkpoint || s.rollback_boundary);

  const [advOpen, setAdvOpen] = useState(false);
  const [advId, setAdvId] = useState("");
  // The checkpoint id the confirm dialog is armed for (from a step row or the
  // advanced input); null when nothing is pending.
  const [pending, setPending] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RollbackResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function idForStep(step: PlanGet["steps"][number]): string | null {
    return step.checkpoint_id ?? checkpointIds[step.id] ?? null;
  }

  async function doRollback() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const r = await rollbackTask(task.id, pending.id);
    setBusy(false);
    setPending(null);
    if (r) setResult(r);
    else setError(useLive.getState().error ?? "[bridge.protocol.error] rollback was refused");
  }

  return (
    <div style={{ fontSize: "var(--text-sm)" }}>
      {boundaries.length === 0 ? (
        <p style={{ color: "var(--text-tertiary)" }}>
          This task's plan declares no rollback checkpoints.
        </p>
      ) : (
        <ol style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {boundaries.map((s, i) => {
            const ckptId = idForStep(s);
            return (
              <li key={s.id || i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Bookmark size={13} style={{ color: ckptId ? "var(--accent)" : "var(--text-tertiary)", flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.intent}
                  {ckptId && (
                    <span style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10, marginLeft: 6 }}>
                      {ckptId}
                    </span>
                  )}
                </span>
                <button
                  className="btn btn--sm"
                  disabled={!ckptId || busy}
                  title={
                    ckptId
                      ? `Roll the workspace back to the checkpoint taken at "${s.intent}".`
                      : "Core has not recorded a checkpoint id for this step yet (it arrives on task_plan or a plan_checkpoint event, G13)."
                  }
                  onClick={() => ckptId && setPending({ id: ckptId, label: s.intent })}
                >
                  <Undo2 size={12} /> Roll back
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <button
        className="btn btn--sm btn--ghost"
        style={{ marginTop: 10 }}
        onClick={() => setAdvOpen((v) => !v)}
        aria-expanded={advOpen}
      >
        {advOpen ? "Hide" : "Advanced: roll back by checkpoint id"}
      </button>

      {advOpen && (
        <div style={{ marginTop: 8, padding: 10, border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
          <label style={{ display: "block", fontSize: 11.5, color: "var(--text-tertiary)", marginBottom: 4 }}>
            Checkpoint id (<code style={{ fontFamily: "var(--font-mono)" }}>ckpt_…</code>)
          </label>
          <input
            value={advId}
            onChange={(e) => setAdvId(e.target.value)}
            placeholder="ckpt_01J…"
            className="no-native-focus"
            style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12, padding: "5px 7px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-sunken)" }}
          />
          <button
            className="btn btn--sm btn--danger"
            style={{ marginTop: 8 }}
            disabled={!advId.trim() || busy}
            onClick={() => setPending({ id: advId.trim(), label: advId.trim() })}
          >
            <Undo2 size={12} /> Roll back…
          </button>
        </div>
      )}

      {pending && (
        <div style={{ marginTop: 10, padding: 10, background: "var(--bg-sunken)", borderRadius: 6 }}>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
            Core will restore the files checkpointed at{" "}
            <strong style={{ fontFamily: "var(--font-mono)" }}>{pending.id}</strong>
            {pending.label !== pending.id && <> (&ldquo;{pending.label}&rdquo;)</>} and{" "}
            <strong>refuse</strong> if any of them changed since — by you or the agent. This cannot be undone from the app.
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn--sm btn--danger" disabled={busy} onClick={() => void doRollback()}>
              {busy ? "Rolling back…" : "Confirm rollback"}
            </button>
            <button className="btn btn--sm" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--success)" }}>
            <CheckCircle2 size={13} /> Reverted {result.reverted_entries} ledger{" "}
            {result.reverted_entries === 1 ? "entry" : "entries"}.
          </div>
          {result.restored_files.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              {result.restored_files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 10 }}>
          <ErrorState presentation={present(error, { context: "Rolling back" })} compact />
        </div>
      )}
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
