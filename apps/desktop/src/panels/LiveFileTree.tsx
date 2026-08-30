import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, Folder, FolderOpen, FileCode, RefreshCw, Search, X } from "lucide-react";
import { repo, type DirEntry } from "../core/repo";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import { present } from "../core/errors";
import { flattenTree } from "../core/tree";
import ServedLocally from "../components/ServedLocally";
import ErrorState from "../components/ErrorState";

const ROW_H = 24;

function statusColor(s?: string) {
  switch (s) {
    case "modified":
    case "renamed":
      return "var(--warning)";
    case "added":
    case "untracked":
      return "var(--success)";
    case "deleted":
    case "conflicted":
      return "var(--danger)";
    default:
      return undefined;
  }
}


export default function LiveFileTree() {
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set([""]));
  const [status, setStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[] | null>(null);
  const loading = useRef<Set<string>>(new Set());

  const reveal = useApp((s) => s.reveal);
  const selectedFile = useApp((s) => s.selectedFile);
  const fsRev = useLive((s) => s.fsRev);

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
      /* not a git repo */
    }
  }, []);

  // initial load
  useEffect(() => {
    void loadDir("");
    void refreshStatus();
  }, [loadDir, refreshStatus]);

  // external change → reload every dir we've already loaded + git status
  useEffect(() => {
    if (fsRev === 0) return;
    void refreshStatus();
    for (const p of Object.keys(children)) void loadDir(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsRev]);

  // debounced filename search
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      repo.search(q, 300).then(setResults).catch((e) => setError(String(e)));
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const toggle = (path: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!children[path]) void loadDir(path);
      }
      return next;
    });
  };

  const flat = useMemo(() => flattenTree(children, open), [children, open]);

  const searchRows = results ?? [];
  const inSearch = results !== null;
  const count = inSearch ? searchRows.length : flat.length;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ServedLocally detail={inSearch ? "filename match only" : "filesystem + git status"} />
      <div style={{ padding: "6px 10px 4px", position: "relative" }}>
        <Search size={13} style={{ position: "absolute", left: 18, top: 13, color: "var(--text-tertiary)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files by name"
          aria-label="Search files by name"
          className="no-native-focus"
          style={{
            width: "100%", padding: "5px 26px 5px 28px", borderRadius: 6,
            border: "1px solid var(--border)", background: "var(--bg-canvas)",
            fontSize: "var(--text-sm)", color: "var(--text-primary)",
          }}
        />
        {query ? (
          <button className="no-native-focus" onClick={() => setQuery("")} style={{ position: "absolute", right: 16, top: 11, color: "var(--text-tertiary)" }}>
            <X size={13} />
          </button>
        ) : (
          <button
            className="no-native-focus"
            title="Reload"
            onClick={() => { setChildren({}); loading.current.clear(); void loadDir(""); void refreshStatus(); }}
            style={{ position: "absolute", right: 16, top: 11, color: "var(--text-tertiary)" }}
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: "6px 12px" }}>
          <ErrorState presentation={present(error, { context: "Reading the workspace" })} compact />
        </div>
      )}
      {inSearch && (
        <div style={{ padding: "2px 12px", fontSize: 10.5, color: "var(--text-tertiary)" }}>
          {searchRows.length} match{searchRows.length === 1 ? "" : "es"}{searchRows.length >= 300 ? " (capped)" : ""}
        </div>
      )}

      <div ref={scrollRef} className="scroll-y" style={{ flex: 1, paddingBottom: 8 }}>
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((vi) => {
            const style: React.CSSProperties = {
              position: "absolute", top: 0, left: 0, width: "100%",
              transform: `translateY(${vi.start}px)`, height: ROW_H,
            };
            if (inSearch) {
              const path = searchRows[vi.index]!;
              const active = selectedFile === path;
              return (
                <button
                  key={path}
                  className="no-native-focus"
                  title={path}
                  onClick={() => reveal({ path, in: "code" })}
                  style={{ ...style, ...rowStyle(14, active), background: active ? "var(--bg-active)" : "transparent" }}
                >
                  <FileCode size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{path}</span>
                  {statusColor(status[path]) && <Dot color={statusColor(status[path])!} />}
                </button>
              );
            }
            const { entry, depth } = flat[vi.index]!;
            const pad = 8 + depth * 14;
            if (entry.kind === "dir") {
              const isOpen = open.has(entry.path);
              return (
                <button
                  key={entry.path}
                  className="no-native-focus"
                  onClick={() => toggle(entry.path)}
                  style={{ ...style, ...rowStyle(pad, false) }}
                >
                  <ChevronRight size={12} style={{ transform: isOpen ? "rotate(90deg)" : "none", flexShrink: 0, color: "var(--text-tertiary)" }} />
                  {isOpen ? <FolderOpen size={13} style={{ color: "var(--text-tertiary)" }} /> : <Folder size={13} style={{ color: "var(--text-tertiary)" }} />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                </button>
              );
            }
            const active = selectedFile === entry.path;
            return (
              <button
                key={entry.path}
                className="no-native-focus"
                title={entry.path}
                onClick={() => reveal({ path: entry.path, in: "code" })}
                style={{ ...style, ...rowStyle(pad + 17, active), background: active ? "var(--bg-active)" : "transparent" }}
              >
                <FileCode size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{entry.name}</span>
                {statusColor(status[entry.path]) && <Dot color={statusColor(status[entry.path])!} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />;
}

function rowStyle(paddingLeft: number, active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "0 10px",
    paddingLeft,
    fontSize: "var(--text-sm)",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    textAlign: "left",
    borderRadius: 5,
  };
}
