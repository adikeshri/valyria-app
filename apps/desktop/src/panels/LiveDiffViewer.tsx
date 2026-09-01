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
import { bridge, type LedgerChange } from "../core/bridge";
import { appEditorTheme, countDiffLines, languageFor } from "../core/cm";
import { present } from "../core/errors";
import ServedLocally from "../components/ServedLocally";
import ErrorState from "../components/ErrorState";

/** CORE-INTERFACE G8 — Core's change ledger classifies every touched path.
 *  The app renders the classification; it never guesses ownership from
 *  file-touch order. */
const OWNERSHIP_META: Record<string, { label: string; badge: string }> = {
  agent_authored: { label: "agent", badge: "badge--agent" },
  pre_existing: { label: "pre-existing", badge: "badge--existing" },
  concurrent_user_modification: { label: "you (concurrent)", badge: "badge--user" },
  unknown: { label: "unclassified", badge: "badge--neutral" },
};

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
 *  rail. The diff bytes are still served locally from `git` (read-only), but the
 *  ownership column now comes from Core's change ledger (`ledger_changes`, G8):
 *  agent-authored / pre-existing / concurrent-user, straight from Core — the app
 *  never infers it from touch order. A path with no ledger entry (e.g. one you
 *  edited outside a task) shows "not classified". */
export default function LiveDiffViewer() {
  const selectedFile = useApp((s) => s.selectedFile);
  const setSelectedFile = useApp((s) => s.setSelectedFile);
  const revealed = useApp((s) => s.revealed);
  const store = useLive((s) => s.store);
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const fsRev = useLive((s) => s.fsRev);
  const fsChangedPaths = useLive((s) => s.fsChangedPaths);

  const [entries, setEntries] = useState<GitEntry[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Map<string, LedgerChange>>(new Map());

  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  const effectiveTask = store.tasks[selectedTaskId] ?? currentTask(store);
  const effectiveTaskId = effectiveTask?.id ?? null;
  const taskLastSeq = effectiveTask?.lastSeq ?? 0;

  // Paths the current task touched — annotated on the rail, never used to
  // filter (the reviewer still sees every uncommitted change).
  const agentPaths = useMemo(() => {
    if (!effectiveTaskId) return new Set<string>();
    return new Set(changedFilesForTask(store, effectiveTaskId).map((f) => f.path));
  }, [store, effectiveTaskId]);

  // G8: Core's change ledger for the selected task — the authoritative
  // per-path ownership. Re-fetched as the task advances.
  useEffect(() => {
    if (!effectiveTaskId) {
      setLedger(new Map());
      return;
    }
    let cancelled = false;
    bridge
      .ledgerChanges(effectiveTaskId)
      .then((r) => {
        if (cancelled) return;
        const m = new Map<string, LedgerChange>();
        for (const c of r.changes) m.set(c.path, c);
        setLedger(m);
      })
      .catch(() => !cancelled && setLedger(new Map()));
    return () => {
      cancelled = true;
    };
  }, [effectiveTaskId, taskLastSeq]);

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

  // A cross-panel jump that carried a line (e.g. from a test failure) scrolls
  // the diff there once this file's view is built.
  useEffect(() => {
    const v = view.current;
    if (!v || !revealed?.line || revealed.path !== loaded?.path) return;
    const lineNo = Math.min(Math.max(1, revealed.line), v.state.doc.lines);
    const pos = v.state.doc.line(lineNo).from;
    v.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
  }, [revealed, loaded]);

  if (error) {
    return (
      <div>
        <ServedLocally detail="git diff · read-only" />
        <ErrorState presentation={present(error, { context: "Loading the diff" })} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ServedLocally detail="diff bytes local (Core exposes no blob read) · ownership from Core's ledger (G8)" />
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
              {(() => {
                const cls = ledger.get(f.path)?.classification;
                if (cls === "agent_authored")
                  return <Bot size={11} style={{ color: "var(--own-agent)", flexShrink: 0 }} aria-label="agent-authored (Core ledger)" />;
                if (cls === "concurrent_user_modification")
                  return <FileDiff size={11} style={{ color: "var(--own-user)", flexShrink: 0 }} aria-label="modified by you during the task (Core ledger)" />;
                if (agentPaths.has(f.path))
                  return <Bot size={11} style={{ color: "var(--own-agent)", flexShrink: 0 }} aria-label="touched by the agent" />;
                return <FileDiff size={11} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />;
              })()}
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
            {(() => {
              const entry = loaded ? ledger.get(loaded.path) : undefined;
              const meta = entry ? OWNERSHIP_META[entry.classification] ?? OWNERSHIP_META.unknown : null;
              if (!meta) {
                return (
                  <span
                    className="badge badge--neutral"
                    title="Core's change ledger has no entry for this path — it was not touched inside a task."
                  >
                    not classified
                  </span>
                );
              }
              return (
                <span
                  className={`badge ${meta.badge}`}
                  title={`Core's change ledger classifies ${loaded?.path} as ${entry!.classification} (${entry!.kind}${entry!.step_id ? `, step ${entry!.step_id}` : ""}).`}
                >
                  {meta.label}
                </span>
              );
            })()}
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
