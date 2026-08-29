import { useEffect, useState } from "react";
import { GitBranch, GitCommitHorizontal, FileDiff } from "lucide-react";
import { repo, type GitCommit, type GitEntry } from "../core/repo";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import ServedLocally from "../components/ServedLocally";

export default function LiveGitPanel() {
  const [branch, setBranch] = useState("");
  const [entries, setEntries] = useState<GitEntry[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [notRepo, setNotRepo] = useState(false);
  const reveal = useApp((s) => s.reveal);
  const fsRev = useLive((s) => s.fsRev);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, s, l] = await Promise.all([
          repo.gitBranch(),
          repo.gitStatus(),
          repo.gitLog(15),
        ]);
        if (cancelled) return;
        setBranch(b);
        setEntries(s);
        setCommits(l);
        setNotRepo(b === "" && s.length === 0 && l.length === 0);
      } catch {
        if (!cancelled) setNotRepo(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fsRev]);

  if (notRepo) {
    return (
      <div>
        <ServedLocally detail="git" />
        <div className="panel-empty" style={{ padding: 24 }}>
          <GitBranch size={22} />
          <strong>Not a git repository</strong>
          <span>The open workspace has no git history to show.</span>
        </div>
      </div>
    );
  }

  const unstaged = entries.filter((e) => !e.staged);
  const staged = entries.filter((e) => e.staged);

  return (
    <div className="scroll-y" style={{ height: "100%", paddingBottom: 8 }}>
      <ServedLocally detail="git · read-only" />
      <div style={{ padding: "8px 12px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", fontWeight: 600 }}>
          <GitBranch size={13} style={{ color: "var(--accent)" }} />
          {branch || "(detached)"}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 3 }}>
          {entries.length} uncommitted change{entries.length === 1 ? "" : "s"}
        </div>
      </div>

      {staged.length > 0 && (
        <>
          <div className="section-label" style={{ padding: "6px 12px 4px" }}>Staged ({staged.length})</div>
          {staged.map((f) => (
            <ChangeRow key={`s-${f.path}`} f={f} onOpen={() => reveal({ path: f.path })} />
          ))}
        </>
      )}

      <div className="section-label" style={{ padding: "6px 12px 4px" }}>Unstaged ({unstaged.length})</div>
      {unstaged.map((f) => (
        <ChangeRow key={`u-${f.path}`} f={f} onOpen={() => reveal({ path: f.path })} />
      ))}

      <div style={{ padding: "8px 12px" }}>
        <button
          className="btn btn--sm"
          disabled
          style={{ width: "100%", justifyContent: "center" }}
          title="Stage, commit, branch and discard go through Core's permission policy (§17) — not available until Core exposes git writes (G3)."
        >
          Stage &amp; commit…
        </button>
      </div>

      <div className="section-label" style={{ padding: "10px 12px 4px" }}>Recent commits</div>
      {commits.map((c) => (
        <div key={c.hash} style={{ display: "flex", gap: 8, padding: "6px 12px" }}>
          <GitCommitHorizontal size={13} style={{ color: "var(--text-tertiary)", marginTop: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.subject}</div>
            <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
              {c.short_hash} · {c.author} · {c.rel_time}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChangeRow({ f, onOpen }: { f: GitEntry; onOpen: () => void }) {
  return (
    <button
      className="no-native-focus"
      onClick={onOpen}
      style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "5px 12px", textAlign: "left", fontSize: "var(--text-sm)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <FileDiff size={12} style={{ color: "var(--warning)", flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.path}</span>
      <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{f.status}</span>
    </button>
  );
}
