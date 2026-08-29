import {
  Search, ListTree, FileCode2, PlayCircle, CheckCircle2, XCircle,
  ShieldQuestion, Loader2, Sparkles,
} from "lucide-react";
import { timeline } from "../data/mock";
import type { TimelineKind } from "../types/domain";

function iconFor(kind: TimelineKind) {
  switch (kind) {
    case "task_started": return <Sparkles size={14} style={{ color: "var(--accent)" }} />;
    case "context_retrieved": return <Search size={14} style={{ color: "var(--info)" }} />;
    case "plan_created": return <ListTree size={14} style={{ color: "var(--info)" }} />;
    case "file_changed": return <FileCode2 size={14} style={{ color: "var(--own-agent)" }} />;
    case "test_started": return <PlayCircle size={14} style={{ color: "var(--text-tertiary)" }} />;
    case "test_passed": return <CheckCircle2 size={14} style={{ color: "var(--success)" }} />;
    case "test_failed": return <XCircle size={14} style={{ color: "var(--danger)" }} />;
    case "approval_requested": return <ShieldQuestion size={14} style={{ color: "var(--warning)" }} />;
    default: return <Loader2 size={14} style={{ color: "var(--text-tertiary)" }} />;
  }
}

export default function ActivityFeed() {
  return (
    <div className="scroll-y" style={{ height: "100%", padding: "10px 14px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {timeline.map((e, i) => (
          <div key={e.id} style={{ display: "flex", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              {iconFor(e.kind)}
              {i < timeline.length - 1 && <span style={{ width: 1, flex: 1, minHeight: 14, background: "var(--border)", marginTop: 2 }} />}
            </div>
            <div style={{ paddingBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 550 }}>{e.title}</span>
                <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{e.ts}</span>
              </div>
              {e.detail && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 2 }}>{e.detail}</div>}
            </div>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>
          <Loader2 size={14} className="spin" />
          Paused — waiting for your approval above
        </div>
      </div>
    </div>
  );
}
