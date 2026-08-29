import { FileDiff, Undo2 } from "lucide-react";
import { modifiedFiles } from "../data/mock";
import type { Ownership } from "../types/domain";
import { useApp } from "../state/store";

function ownershipBadge(o: Ownership) {
  if (o === "agent") return <span className="badge badge--agent">agent</span>;
  if (o === "user") return <span className="badge badge--user">you</span>;
  return <span className="badge badge--existing">existing</span>;
}

export default function ChangesPanel() {
  const setSelectedFile = useApp((s) => s.setSelectedFile);
  const setDockTab = useApp((s) => s.setDockTab);

  const agentCount = modifiedFiles.filter((f) => f.ownership === "agent").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "0 12px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="section-label">{modifiedFiles.length} changed files</span>
        <span className="badge badge--agent">{agentCount} agent-owned</span>
      </div>
      <div className="scroll-y" style={{ flex: 1 }}>
        {modifiedFiles.map((f) => (
          <button
            key={f.path}
            className="no-native-focus"
            onClick={() => { setSelectedFile(f.path); setDockTab("diff"); }}
            style={{
              display: "flex", flexDirection: "column", gap: 3, width: "100%",
              padding: "8px 12px", textAlign: "left", borderBottom: "1px solid var(--border-subtle)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <FileDiff size={12} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {f.path.split("/").pop()}
              </span>
              {ownershipBadge(f.ownership)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 18 }}>
              <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{f.path}</span>
            </div>
            <div style={{ display: "flex", gap: 8, paddingLeft: 18, fontSize: 10.5, fontFamily: "var(--font-mono)" }}>
              <span style={{ color: "var(--diff-add-text)" }}>+{f.additions}</span>
              <span style={{ color: "var(--diff-del-text)" }}>−{f.deletions}</span>
            </div>
          </button>
        ))}
      </div>
      <div style={{ padding: 10, borderTop: "1px solid var(--border-subtle)" }}>
        <button className="btn btn--sm" style={{ width: "100%", justifyContent: "center" }}>
          <Undo2 size={12} /> Rollback agent changes…
        </button>
      </div>
    </div>
  );
}
