import { useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { goToNextChunk, goToPreviousChunk, unifiedMergeView } from "@codemirror/merge";
import {
  ChevronUp, ChevronDown, FileDiff, GitCompareArrows, Bot,
} from "lucide-react";
import { changedFilesForTask, currentTask } from "@valyria/state";
import { repo, type GitEntry } from "../core/repo";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import { appEditorTheme, countDiffLines, languageFor } from "../core/cm";
import ServedLocally from "../components/ServedLocally";

interface Loaded {
  path: string;
  original: string;
  modified: string;
  added: number;
  removed: number;
  binary: boolean;
}

/** The Phase 4 diff viewer (docs/PLAN.md §4.8): CodeMirror 6 unified merge view,
 *  intra-line highlighting, next/previous change navigation, a changed-file
 *  rail. Served locally from `git` until Core exposes a diff surface (G3); the
 *  ownership column reads "unavailable" because Core's ledger is not on the
 *  wire (G8) — the app never guesses ownership from file-touch order. */
export default function LiveDiffViewer() {
  const selectedFile = useApp((s) => s.selectedFile);
  const setSelectedFile = useApp((s) => s.setSelectedFile);
  const store = useLive((s) => s.store);
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const fsRev = useLive((s) => s.fsRev);
  const fsChangedPaths = useLive((s) => s.fsChangedPaths);

  const [entries, setEntries] = useState<GitEntry[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // Paths the current task touched — annotated on the rail, never used to
  // filter (the reviewer still sees every uncommitted change).
  const agentPaths = useMemo(() => {
    const task = store.tasks[selectedTaskId] ?? currentTask(store);
    if (!task) return new Set<string>();
    return new Set(changedFilesForTask(store, task.id).map((f) => f.path));
  }, [store, selectedTaskId]);

  // The changed-file rail: uncommitted changes, agent-touched first.
  useEffect(() => {
    let cancelled = false;
    repo
      .gitStatus()
      .then((s) => {
        if (cancelled) return;
        const sorted = [...s].sort((a, b) => {
          const aa = agentPaths.has(a.path) ? 0 : 1;
          const bb = agentPaths.has(b.path) ? 0 : 1;
          return aa - bb || a.path.localeCompare(b.path);
        });
        setEntries(sorted);
        if (!selectedFile && sorted[0]) setSelectedFile(sorted[0].path);
      })
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, [fsRev, agentPaths]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load both sides of the diff for the selected file.
  const reloadKey =
    selectedFile && fsChangedPaths.includes(selectedFile) ? fsRev : 0;
  useEffect(() => {
    setError(null);
    if (!selectedFile) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      repo.gitShowHead(selectedFile),
      repo.readFile(selectedFile).then((v) => v, () => null),
      repo.gitDiffFile(selectedFile).catch(() => ""),
    ])
      .then(([original, file, unified]) => {
        if (cancelled) return;
        const binary = file?.encoding === "binary";
        const { added, removed } = countDiffLines(unified);
        setLoaded({
          path: selectedFile,
          original,
          modified: file?.text ?? "",
          added,
          removed,
          binary,
        });
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [selectedFile, reloadKey]);

  // (Re)build the CodeMirror merge view whenever the loaded file changes.
  useEffect(() => {
    if (!host.current || !loaded || loaded.binary) {
      view.current?.destroy();
      view.current = null;
      return;
    }
    view.current?.destroy();
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: loaded.modified,
        extensions: [
          lineNumbers(),
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          languageFor(loaded.path),
          appEditorTheme,
          unifiedMergeView({
            original: loaded.original,
            mergeControls: false,
            gutter: true,
            highlightChanges: true,
            syntaxHighlightDeletions: true,
          }),
        ],
      }),
    });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, [loaded]);

  function jump(dir: 1 | -1) {
    const v = view.current;
    if (!v) return;
    (dir === 1 ? goToNextChunk : goToPreviousChunk)(v);
    v.focus();
  }

  if (error) {
    return (
      <div>
        <ServedLocally detail="git diff · read-only" />
        <div className="panel-empty" style={{ padding: 24 }}>
          <GitCompareArrows size={24} />
          <strong>Could not load the diff</strong>
          <span style={{ color: "var(--danger)" }}>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ServedLocally detail="git diff · read-only · ownership unavailable (G8)" />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          role="listbox"
          aria-label="Changed files"
          style={{ width: 200, flexShrink: 0, borderRight: "1px solid var(--border-subtle)", overflowY: "auto" }}
        >
          {entries.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 11.5, color: "var(--text-tertiary)" }}>
              No uncommitted changes.
            </div>
          )}
          {entries.map((f) => (
            <button
              key={f.path}
              role="option"
              aria-selected={f.path === selectedFile}
              className="no-native-focus"
              onClick={() => setSelectedFile(f.path)}
              style={{
                display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "7px 10px",
                textAlign: "left", borderBottom: "1px solid var(--border-subtle)",
                background: f.path === selectedFile ? "var(--bg-active)" : "transparent",
              }}
            >
              {agentPaths.has(f.path) ? (
                <Bot size={11} style={{ color: "var(--own-agent)", flexShrink: 0 }} aria-label="touched by the agent" />
              ) : (
                <FileDiff size={11} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
              )}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, fontSize: 11.5 }}>
                {f.path.split("/").pop()}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{f.status}</span>
            </button>
          ))}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
            borderBottom: "1px solid var(--border-subtle)", flexShrink: 0,
          }}>
            <span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {loaded?.path ?? "—"}
            </span>
            <span
              className="badge badge--neutral"
              title="Agent / user / pre-existing attribution needs Core's change ledger, which v1 does not expose on the wire (CORE-INTERFACE G8)."
            >
              ownership unavailable
            </span>
            {loaded && (
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
                <span style={{ color: "var(--diff-add-text)" }}>+{loaded.added}</span>{" "}
                <span style={{ color: "var(--diff-del-text)" }}>−{loaded.removed}</span>
              </span>
            )}
            <button className="icon-btn no-native-focus" title="Previous change" aria-label="Previous change" onClick={() => jump(-1)}>
              <ChevronUp size={14} />
            </button>
            <button className="icon-btn no-native-focus" title="Next change" aria-label="Next change" onClick={() => jump(1)}>
              <ChevronDown size={14} />
            </button>
          </div>

          {loaded?.binary ? (
            <div className="panel-empty" style={{ padding: 24 }}>
              <strong>Binary file</strong>
              <span>{loaded.path}</span>
            </div>
          ) : loaded && loaded.added === 0 && loaded.removed === 0 ? (
            <div className="panel-empty" style={{ padding: 24 }}>
              <GitCompareArrows size={22} />
              <strong>No changes</strong>
              <span>{loaded.path} matches HEAD.</span>
            </div>
          ) : (
            <div ref={host} style={{ flex: 1, minHeight: 0, overflow: "auto" }} />
          )}
        </div>
      </div>
    </div>
  );
}
