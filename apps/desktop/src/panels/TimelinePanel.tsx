import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { timeline } from "../data/mock";

export default function TimelinePanel() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="scroll-y" style={{ height: "100%" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)" }}>
        <tbody>
          {timeline.map((e) => (
            <Fragment key={e.id}>
              <tr
                onClick={() => setExpanded((x) => (x === e.id ? null : e.id))}
                style={{ cursor: "pointer", borderBottom: "1px solid var(--border-subtle)" }}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "6px 4px 6px 14px", width: 20 }}>
                  <ChevronRight size={12} style={{ transform: expanded === e.id ? "rotate(90deg)" : "none", color: "var(--text-tertiary)" }} />
                </td>
                <td style={{ padding: "6px 10px 6px 0", width: 52, fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>{e.ts}</td>
                <td style={{ padding: "6px 10px 6px 0", width: 34, color: "var(--text-tertiary)" }}>#{e.seq}</td>
                <td style={{ padding: "6px 10px 6px 0", width: 170 }}>
                  <span className="badge badge--neutral">{e.kind}</span>
                </td>
                <td style={{ padding: "6px 14px 6px 0" }}>{e.title}</td>
              </tr>
              {expanded === e.id && (
                <tr>
                  <td colSpan={5} style={{ padding: "0 14px 12px 46px", background: "var(--bg-sunken)" }}>
                    <pre style={{ margin: "8px 0 0", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                      {JSON.stringify({ seq: e.seq, task_id: "task_01", ts_ms: "…", kind: e.kind, payload: { title: e.title, detail: e.detail, ...e.payload } }, null, 2)}
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
