import { CheckCircle2, XCircle, Loader2, CircleDashed, Clock } from "lucide-react";
import { taskHistory } from "../data/mock";
import type { Task, TaskState } from "../types/domain";
import { useApp } from "../state/store";

function stateIcon(state: TaskState) {
  switch (state) {
    case "completed": return <CheckCircle2 size={13} style={{ color: "var(--success)" }} />;
    case "failed": return <XCircle size={13} style={{ color: "var(--danger)" }} />;
    case "waiting_for_permission": return <Clock size={13} style={{ color: "var(--warning)" }} />;
    case "paused": return <CircleDashed size={13} style={{ color: "var(--text-tertiary)" }} />;
    default: return <Loader2 size={13} className="spin" style={{ color: "var(--info)" }} />;
  }
}

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export default function TaskHistoryPanel() {
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const setSelectedTaskId = useApp((s) => s.setSelectedTaskId);
  const setCenterTab = useApp((s) => s.setCenterTab);

  const groups: Record<string, Task[]> = {};
  for (const t of taskHistory) {
    groups[t.day] = groups[t.day] || [];
    groups[t.day].push(t);
  }

  return (
    <div className="scroll-y" style={{ height: "100%", paddingBottom: 8 }}>
      {Object.entries(groups).map(([day, tasks]) => (
        <div key={day}>
          <div className="section-label" style={{ padding: "10px 12px 4px" }}>{day}</div>
          {tasks.map((t) => (
            <button
              key={t.id}
              className="no-native-focus"
              onClick={() => { setSelectedTaskId(t.id); setCenterTab("task"); }}
              style={{
                display: "flex", gap: 8, width: "100%", padding: "7px 12px", textAlign: "left",
                background: selectedTaskId === t.id ? "var(--bg-active)" : "transparent",
              }}
              onMouseEnter={(e) => { if (selectedTaskId !== t.id) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (selectedTaskId !== t.id) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ marginTop: 1, flexShrink: 0 }}>{stateIcon(t.state)}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{
                  fontSize: "var(--text-sm)", color: "var(--text-primary)",
                  overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
                  WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                }}>
                  {t.objective}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>
                  {t.updatedAt} · {fmtDuration(t.durationSec)} · {t.model.split(" ")[0]}
                </span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
