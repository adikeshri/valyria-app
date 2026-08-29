import {
  Search, ListTree, FileCode2, PlayCircle, CheckCircle2, XCircle,
  ShieldQuestion, Loader2, Sparkles, MessageSquare, Wrench, AlertTriangle,
} from "lucide-react";
import { activityLine, timelineRows, currentTask, type EventRow } from "@valyria/state";
import { useLive } from "../core/liveStore";
import { hhmm, isActive } from "../core/view";

function icon(kind: string) {
  switch (kind) {
    case "task_started": return <Sparkles size={14} style={{ color: "var(--accent)" }} />;
    case "context_retrieved": return <Search size={14} style={{ color: "var(--info)" }} />;
    case "plan_created": return <ListTree size={14} style={{ color: "var(--info)" }} />;
    case "file_changed": return <FileCode2 size={14} style={{ color: "var(--own-agent)" }} />;
    case "tool_started":
    case "tool_completed": return <Wrench size={14} style={{ color: "var(--text-tertiary)" }} />;
    case "model_started":
    case "model_completed": return <MessageSquare size={14} style={{ color: "var(--text-tertiary)" }} />;
    case "test_started": return <PlayCircle size={14} style={{ color: "var(--text-tertiary)" }} />;
    case "test_passed": return <CheckCircle2 size={14} style={{ color: "var(--success)" }} />;
    case "test_failed": return <XCircle size={14} style={{ color: "var(--danger)" }} />;
    case "approval_requested": return <ShieldQuestion size={14} style={{ color: "var(--warning)" }} />;
    case "task_completed": return <CheckCircle2 size={14} style={{ color: "var(--success)" }} />;
    case "task_failed": return <XCircle size={14} style={{ color: "var(--danger)" }} />;
    case "progress_stalled": return <AlertTriangle size={14} style={{ color: "var(--warning)" }} />;
    default: return <Loader2 size={14} style={{ color: "var(--text-tertiary)" }} />;
  }
}

export default function LiveActivityFeed() {
  const store = useLive((s) => s.store);
  const task = currentTask(store);
  // oldest → newest for a running narrative
  const rows: EventRow[] = timelineRows(store)
    .filter((e) => !task || e.taskId === task.id || e.taskId === null)
    .reverse();

  const working = task && isActive(task.state);

  if (rows.length === 0) {
    return (
      <div className="panel-empty" style={{ padding: 24 }}>
        <Loader2 size={20} />
        <strong>No activity yet</strong>
        <span>Create a task from the chat to see the agent work here.</span>
      </div>
    );
  }

  return (
    <div className="scroll-y" style={{ height: "100%", padding: "10px 14px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {rows.map((e, i) => (
          <div key={e.seq} style={{ display: "flex", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              {icon(e.kind)}
              {i < rows.length - 1 && <span style={{ width: 1, flex: 1, minHeight: 14, background: "var(--border)", marginTop: 2 }} />}
            </div>
            <div style={{ paddingBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 550, color: e.degraded ? "var(--text-tertiary)" : "var(--text-primary)" }}>
                  {e.degraded ? e.kind.replace(/_/g, " ") : activityLine(e)}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{hhmm(e.ts)} · #{e.seq}</span>
              </div>
            </div>
          </div>
        ))}
        {working && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>
            <Loader2 size={14} className="spin" />
            {task.state === "waiting_for_permission" ? "Blocked — waiting for your approval" : "Working…"}
          </div>
        )}
      </div>
    </div>
  );
}
