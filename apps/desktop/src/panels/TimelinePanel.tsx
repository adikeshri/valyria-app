import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { timelineRows, activityLine } from "@valyria/state";
import { useLive } from "../core/liveStore";
import { timeline as mockTimeline } from "../data/mock";

/** HH:MM from a wall-clock ms stamp (render only — sorting is on seq). */
function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function TimelinePanel() {
  const [expanded, setExpanded] = useState<number | string | null>(null);
  const live = useLive((s) => s.store);
  const isLive = live.events.length > 0;

  const rows = isLive
    ? timelineRows(live).map((e) => ({
        key: e.seq,
        seq: e.seq,
        ts: hhmm(e.ts),
        kind: e.kind,
        title: activityLine(e),
        raw: { seq: e.seq, ts_ms: e.ts, kind: e.kind, task_id: e.taskId, payload: e.payload },
        degraded: e.degraded,
      }))
    : mockTimeline.map((e) => ({
        key: e.id,
        seq: e.seq,
        ts: e.ts,
        kind: e.kind,
        title: e.title,
        raw: { seq: e.seq, ts_ms: "…", kind: e.kind, payload: { title: e.title, detail: e.detail, ...e.payload } },
        degraded: false,
      }));

  return (
    <div className="scroll-y" style={{ height: "100%" }}>
      {!isLive && (
        <div style={{ padding: "6px 14px", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
          Sample data — open a workspace to stream live events.
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)" }}>
        <tbody>
          {rows.map((e) => (
            <Fragment key={e.key}>
              <tr
                onClick={() => setExpanded((x) => (x === e.key ? null : e.key))}
                style={{ cursor: "pointer", borderBottom: "1px solid var(--border-subtle)" }}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "6px 4px 6px 14px", width: 20 }}>
                  <ChevronRight size={12} style={{ transform: expanded === e.key ? "rotate(90deg)" : "none", color: "var(--text-tertiary)" }} />
                </td>
                <td style={{ padding: "6px 10px 6px 0", width: 52, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>{e.ts}</td>
                <td style={{ padding: "6px 10px 6px 0", width: 34, color: "var(--text-tertiary)" }}>#{e.seq}</td>
                <td style={{ padding: "6px 10px 6px 0", width: 170 }}>
                  <span className={`badge ${e.degraded ? "badge--warning" : "badge--neutral"}`}>{e.kind}</span>
                </td>
                <td style={{ padding: "6px 14px 6px 0" }}>{e.title}</td>
              </tr>
              {expanded === e.key && (
                <tr>
                  <td colSpan={5} style={{ padding: "0 14px 12px 46px", background: "var(--bg-sunken)" }}>
                    <pre style={{ margin: "8px 0 0", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(e.raw, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
