import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Folder, FolderOpen, FileCode, RefreshCw } from "lucide-react";
import { repo, type DirEntry } from "../core/repo";
import { useApp } from "../state/store";
import ServedLocally from "../components/ServedLocally";

function statusColor(s?: string) {
  switch (s) {
    case "modified":
    case "renamed":
      return "var(--warning)";
    case "added":
    case "untracked":
      return "var(--success)";
    case "deleted":
      return "var(--danger)";
    case "conflicted":
      return "var(--danger)";
    default:
      return undefined;
  }
}

export default function LiveFileTree() {
  // children[dirPath] = entries; "" is the root
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set([""]));
  const [status, setStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const loading = useRef<Set<string>>(new Set());

  const setSelectedFile = useApp((s) => s.setSelectedFile);
  const setCenterTab = useApp((s) => s.setCenterTab);
  const selectedFile = useApp((s) => s.selectedFile);

  const loadDir = useCallback(async (path: string) => {
    if (loading.current.has(path)) return;
    loading.current.add(path);
    try {
      const entries = await repo.listDir(path);
      setChildren((c) => ({ ...c, [path]: entries }));
    } catch (e) {
      setError(String(e));
    } finally {
      loading.current.delete(path);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const entries = await repo.gitStatus();
      setStatus(Object.fromEntries(entries.map((e) => [e.path, e.status])));
    } catch {
      /* not a git repo — leave decorations empty */
    }
  }, []);

  useEffect(() => {
    void loadDir("");
    void refreshStatus();
  }, [loadDir, refreshStatus]);

  const toggle = (path: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!children[path]) void loadDir(path);
      }
      return next;
    });
  };

  const row = (entry: DirEntry, depth: number): React.ReactNode => {
    const isOpen = open.has(entry.path);
    const pad = 8 + depth * 14;
    if (entry.kind === "dir") {
      return (
        <div key={entry.path}>
          <button
            className="no-native-focus"
            onClick={() => toggle(entry.path)}
            style={rowStyle(pad, false)}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <ChevronRight size={12} style={{ transform: isOpen ? "rotate(90deg)" : "none", flexShrink: 0, color: "var(--text-tertiary)" }} />
            {isOpen ? <FolderOpen size={13} style={{ color: "var(--text-tertiary)" }} /> : <Folder size={13} style={{ color: "var(--text-tertiary)" }} />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
          </button>
          {isOpen && (children[entry.path] ?? []).map((c) => row(c, depth + 1))}
          {isOpen && !children[entry.path] && (
            <div style={{ paddingLeft: pad + 26, fontSize: 11, color: "var(--text-tertiary)" }}>…</div>
          )}
        </div>
      );
    }
    const active = selectedFile === entry.path;
    const color = statusColor(status[entry.path]);
    return (
      <button
        key={entry.path}
        className="no-native-focus"
        title={entry.path}
        onClick={() => { setSelectedFile(entry.path); setCenterTab("code"); }}
        style={{ ...rowStyle(pad + 17, active), background: active ? "var(--bg-active)" : "transparent" }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
      >
        <FileCode size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{entry.name}</span>
        {color && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ServedLocally detail="filesystem + git status" />
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 10px" }}>
        <button
          className="no-native-focus"
          title="Reload tree and git status"
          onClick={() => { setChildren({}); loading.current.clear(); void loadDir(""); void refreshStatus(); }}
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-tertiary)" }}
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      <div className="scroll-y" style={{ flex: 1, paddingBottom: 8 }}>
        {error && <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--danger)" }}>{error}</div>}
        {(children[""] ?? []).map((c) => row(c, 0))}
      </div>
    </div>
  );
}

function rowStyle(paddingLeft: number, active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 5,
    width: "100%",
    padding: "3px 10px",
    paddingLeft,
    fontSize: "var(--text-sm)",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    textAlign: "left",
    borderRadius: 5,
  };
}
