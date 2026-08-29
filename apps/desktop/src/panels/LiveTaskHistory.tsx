import { useEffect } from "react";
import { CheckCircle2, XCircle, Loader2, CircleDashed, Clock } from "lucide-react";
import { tasksByRecency, type TaskProjection } from "@valyria/state";
import { useLive } from "../core/liveStore";
import { useApp } from "../state/store";
import { dayBucket, relTime, isActive } from "../core/view";

function stateIcon(t: TaskProjection) {
  switch (t.state) {
    case "completed": return <CheckCircle2 size={13} style={{ color: "var(--success)" }} />;
    case "failed": return <XCircle size={13} style={{ color: "var(--danger)" }} />;
    case "cancelled": return <CircleDashed size={13} style={{ color: "var(--text-tertiary)" }} />;
    case "waiting_for_permission": return <Clock size={13} style={{ color: "var(--warning)" }} />;
    case "paused": return <CircleDashed size={13} style={{ color: "var(--text-tertiary)" }} />;
    default: return <Loader2 size={13} className="spin" style={{ color: "var(--info)" }} />;
  }
}

const BUCKETS = ["Today", "Yesterday", "Earlier"] as const;

export default function LiveTaskHistory() {
  const store = useLive((s) => s.store);
  const refreshTasks = useLive((s) => s.refreshTasks);
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const setSelectedTaskId = useApp((s) => s.setSelectedTaskId);
  const setCenterTab = useApp((s) => s.setCenterTab);

  useEffect(() => { void refreshTasks(); }, [refreshTasks]);

  const now = Date.now();
  const all = tasksByRecency(store);

  if (all.length === 0) {
    return (
      <div className="panel-empty" style={{ padding: 24 }}>
        <Clock size={20} />
        <strong>No tasks yet</strong>
        <span>Tasks you run in this workspace appear here.</span>
      </div>
    );
  }

  const grouped = new Map<string, TaskProjection[]>();
  for (const t of all) {
    const k = dayBucket(t.lastTs || t.firstTs, now);
    let arr = grouped.get(k);
    if (!arr) {
      arr = [];
      grouped.set(k, arr);
    }
    arr.push(t);
  }

  return (
    <div className="scroll-y" style={{ height: "100%", paddingBottom: 8 }}>
      {BUCKETS.filter((b) => grouped.has(b)).map((day) => (
        <div key={day}>
          <div className="section-label" style={{ padding: "10px 12px 4px" }}>{day}</div>
          {grouped.get(day)!.map((t) => (
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
              <span style={{ marginTop: 1, flexShrink: 0 }}>{stateIcon(t)}</span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{
                  fontSize: "var(--text-sm)", color: "var(--text-primary)",
                  overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
                  WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                }}>
                  {t.objective ?? "(objective pending)"}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>
                  {t.state}{isActive(t.state) ? " · running" : ""} · {relTime(t.lastTs || t.firstTs, now)}
                </span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
