import { GitBranch, GitCommitHorizontal, FileDiff } from "lucide-react";
import { gitCommits, modifiedFiles, CURRENT_BRANCH } from "../data/mock";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import LiveGitPanel from "./LiveGitPanel";

export default function GitPanel() {
  const liveSession = useLive((s) => s.session);
  if (liveSession) return <LiveGitPanel />;
  return <MockGitPanel />;
}

function MockGitPanel() {
  const setSelectedFile = useApp((s) => s.setSelectedFile);
  const setDockTab = useApp((s) => s.setDockTab);

  return (
    <div className="scroll-y" style={{ height: "100%", paddingBottom: 8 }}>
      <div style={{ padding: "0 12px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", fontWeight: 600 }}>
          <GitBranch size={13} style={{ color: "var(--accent)" }} />
          {CURRENT_BRANCH}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 3 }}>
          up to date with origin · {modifiedFiles.length} uncommitted changes
        </div>
      </div>

      <div className="section-label" style={{ padding: "6px 12px 4px" }}>Unstaged ({modifiedFiles.length})</div>
      {modifiedFiles.map((f) => (
        <button
          key={f.path}
          className="no-native-focus"
          onClick={() => { setSelectedFile(f.path); setDockTab("diff"); }}
          style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "5px 12px", textAlign: "left", fontSize: "var(--text-sm)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <FileDiff size={12} style={{ color: "var(--warning)", flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.path}</span>
        </button>
      ))}

      <div style={{ padding: "8px 12px" }}>
        <button className="btn btn--sm" disabled style={{ width: "100%", justifyContent: "center" }} title="Write operations respect Core's permission policy — not available in this preview">
          Stage all &amp; commit…
        </button>
      </div>

      <div className="section-label" style={{ padding: "10px 12px 4px" }}>Recent commits</div>
      {gitCommits.map((c) => (
        <div key={c.hash} style={{ display: "flex", gap: 8, padding: "6px 12px" }}>
          <GitCommitHorizontal size={13} style={{ color: "var(--text-tertiary)", marginTop: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message}</div>
            <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
              {c.hash} · {c.author} · {c.relTime}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
