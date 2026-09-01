import { useEffect, useState } from "react";
import { GitBranch, GitCommitHorizontal, FileDiff, Check } from "lucide-react";
import {
  bridge,
  type GitStatus,
  type GitCommitWire,
  type GitBranchWire,
} from "../core/bridge";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import { relTime } from "../core/view";
import { present } from "../core/errors";
import ErrorState from "../components/ErrorState";

/** CORE-INTERFACE G3 — the git read surface is on the wire: `git_status`,
 *  `git_log`, `git_branches`. This panel reads Core's view (which honours the
 *  workspace root and ignore rules) rather than shelling `git` locally. Writes
 *  (stage / commit / branch) are still not exposed — no `git_*` write RPC
 *  exists — so that action stays disabled. */
export default function LiveGitPanel() {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommitWire[]>([]);
  const [branches, setBranches] = useState<GitBranchWire[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reveal = useApp((s) => s.reveal);
  const fsRev = useLive((s) => s.fsRev);
  const now = Date.now();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, l, b] = await Promise.all([
          bridge.coreGitStatus(),
          bridge.coreGitLog(15),
          bridge.coreGitBranches(),
        ]);
        if (cancelled) return;
        setStatus(s);
        setCommits(l.commits);
        setBranches(b.branches);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fsRev]);

  if (error) {
    return <ErrorState presentation={present(error, { context: "Reading git status" })} />;
  }
  if (!status) {
    return (
      <div style={{ padding: 14, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
        Reading git status…
      </div>
    );
  }

  const staged = status.files.filter((f) => f.staged);
  const unstaged = status.files.filter((f) => !f.staged);
  const branchLabel = status.detached ? "(detached)" : status.branch ?? "(unknown)";
  const otherBranches = branches.filter((b) => !b.is_head).slice(0, 8);

  return (
    <div className="scroll-y" style={{ height: "100%", paddingBottom: 8 }}>
      <div style={{ padding: "8px 12px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", fontWeight: 600 }}>
          <GitBranch size={13} style={{ color: "var(--accent)" }} />
          {branchLabel}
          {status.head_commit && (
            <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
              {status.head_commit.slice(0, 8)}
            </span>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 3 }}>
          {status.files.length} uncommitted change{status.files.length === 1 ? "" : "s"} · via Core
        </div>
      </div>

      {staged.length > 0 && (
        <>
          <div className="section-label" style={{ padding: "6px 12px 4px" }}>Staged ({staged.length})</div>
          {staged.map((f) => (
            <ChangeRow key={`s-${f.path}`} path={f.path} kind={f.kind} onOpen={() => reveal({ path: f.path })} />
          ))}
        </>
      )}

      <div className="section-label" style={{ padding: "6px 12px 4px" }}>Unstaged ({unstaged.length})</div>
      {unstaged.length === 0 ? (
        <div style={{ padding: "4px 12px", fontSize: 11, color: "var(--text-tertiary)" }}>Working tree clean.</div>
      ) : (
        unstaged.map((f) => (
          <ChangeRow key={`u-${f.path}`} path={f.path} kind={f.kind} onOpen={() => reveal({ path: f.path })} />
        ))
      )}

      <div style={{ padding: "8px 12px" }}>
        <button
          className="btn btn--sm"
          disabled
          style={{ width: "100%", justifyContent: "center" }}
          title="Stage / commit / branch go through Core's permission policy (§17) and are not on the wire yet — no git_* write RPC exists."
        >
          Stage &amp; commit…
        </button>
      </div>

      <div className="section-label" style={{ padding: "10px 12px 4px" }}>Recent commits</div>
      {commits.map((c) => (
        <div key={c.sha} style={{ display: "flex", gap: 8, padding: "6px 12px" }}>
          <GitCommitHorizontal size={13} style={{ color: "var(--text-tertiary)", marginTop: 2, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.message}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
              {c.sha.slice(0, 8)} · {c.author_name} · {relTime(c.time_unix * 1000, now)}
            </div>
          </div>
        </div>
      ))}

      {otherBranches.length > 0 && (
        <>
          <div className="section-label" style={{ padding: "10px 12px 4px" }}>Branches</div>
          {otherBranches.map((b) => (
            <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", fontSize: "var(--text-sm)" }}>
              <GitBranch size={12} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{b.name}</span>
              <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>{b.commit.slice(0, 8)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ChangeRow({ path, kind, onOpen }: { path: string; kind: string; onOpen: () => void }) {
  return (
    <button
      className="no-native-focus"
      onClick={onOpen}
      style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "5px 12px", textAlign: "left", fontSize: "var(--text-sm)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {kind === "conflicted" ? (
        <FileDiff size={12} style={{ color: "var(--danger)", flexShrink: 0 }} />
      ) : kind === "added" || kind === "untracked" ? (
        <Check size={12} style={{ color: "var(--success)", flexShrink: 0 }} />
      ) : (
        <FileDiff size={12} style={{ color: "var(--warning)", flexShrink: 0 }} />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{path}</span>
      <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{kind}</span>
    </button>
  );
}
