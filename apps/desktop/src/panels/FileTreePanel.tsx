import { useMemo, useState } from "react";
import { ChevronRight, Folder, FolderOpen, FileCode, Search, X } from "lucide-react";
import type { FileChangeState, FileNode } from "../types/domain";
import { fileTree } from "../data/mock";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import LiveFileTree from "./LiveFileTree";

function changeColor(state?: FileChangeState) {
  switch (state) {
    case "agent": return "var(--own-agent)";
    case "modified": return "var(--warning)";
    case "added": return "var(--success)";
    case "deleted": return "var(--danger)";
    default: return undefined;
  }
}

function Node({ node, depth, filter }: { node: FileNode; depth: number; filter: string }) {
  const [open, setOpen] = useState(depth < 2);
  const selectedFile = useApp((s) => s.selectedFile);
  const reveal = useApp((s) => s.reveal);

  const matches = (n: FileNode): boolean => {
    if (!filter) return true;
    if (n.name.toLowerCase().includes(filter.toLowerCase())) return true;
    return n.children?.some(matches) ?? false;
  };
  if (!matches(node)) return null;

  if (node.kind === "dir") {
    return (
      <div>
        <button
          className="no-native-focus"
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "flex", alignItems: "center", gap: 5, width: "100%",
            padding: "3px 10px", paddingLeft: 8 + depth * 14,
            fontSize: "var(--text-sm)", color: "var(--text-secondary)", textAlign: "left",
            borderRadius: 5,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms", flexShrink: 0, color: "var(--text-tertiary)" }} />
          {open ? <FolderOpen size={13} style={{ color: "var(--text-tertiary)" }} /> : <Folder size={13} style={{ color: "var(--text-tertiary)" }} />}
          <span>{node.name}</span>
        </button>
        {open && (
          <div>
            {node.children?.map((c) => (
              <Node key={c.path} node={c} depth={depth + 1} filter={filter} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const active = selectedFile === node.path.replace(/^\//, "");
  return (
    <button
      className="no-native-focus"
      onClick={() => reveal({ path: node.path.replace(/^\//, ""), in: "code" })}
      style={{
        display: "flex", alignItems: "center", gap: 5, width: "100%",
        padding: "3px 10px", paddingLeft: 8 + depth * 14 + 17,
        fontSize: "var(--text-sm)", color: active ? "var(--text-primary)" : "var(--text-secondary)",
        textAlign: "left", borderRadius: 5,
        background: active ? "var(--bg-active)" : "transparent",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
      title={node.path}
    >
      <FileCode size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{node.name}</span>
      {node.changeState && (
        <span
          title={node.changeState === "agent" ? "Changed by agent" : node.changeState}
          style={{ width: 6, height: 6, borderRadius: "50%", background: changeColor(node.changeState), flexShrink: 0 }}
        />
      )}
    </button>
  );
}

export default function FileTreePanel() {
  const liveSession = useLive((s) => s.session);
  if (liveSession) return <LiveFileTree />;
  return <MockFileTree />;
}

function MockFileTree() {
  const [filter, setFilter] = useState("");
  const root = fileTree[0];

  const legend = useMemo(
    () => [
      { label: "Agent-owned", color: "var(--own-agent)" },
      { label: "Modified", color: "var(--warning)" },
    ],
    []
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "0 10px 8px" }}>
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 8, top: 8, color: "var(--text-tertiary)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search files"
            aria-label="Search files"
            className="no-native-focus"
            style={{
              width: "100%", padding: "6px 8px 6px 26px", borderRadius: 6,
              border: "1px solid var(--border)", background: "var(--bg-canvas)",
              fontSize: "var(--text-sm)", color: "var(--text-primary)",
            }}
          />
          {filter && (
            <button className="no-native-focus" onClick={() => setFilter("")} style={{ position: "absolute", right: 6, top: 6, color: "var(--text-tertiary)" }}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="scroll-y" style={{ flex: 1, paddingBottom: 8 }}>
        {root.children?.map((c) => (
          <Node key={c.path} node={c} depth={0} filter={filter} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, padding: "7px 10px", borderTop: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        {legend.map((l) => (
          <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--text-tertiary)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
