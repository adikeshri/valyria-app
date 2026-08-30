import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronRight, ChevronDown, Database, Info, Loader2 } from "lucide-react";
import { bridge, type SearchHit, type SearchResult, type IndexStatus } from "../core/bridge";
import { currentTask, changedFilesForTask } from "@valyria/state";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import { present } from "../core/errors";
import ErrorState from "../components/ErrorState";

/** §4.13 / CORE-INTERFACE G3 — `search_query` is the fused, explained code
 *  search (lexical + symbol + semantic + dependency, §14). Every hit carries
 *  its full score derivation, so "why this file?" is answered from Core's
 *  stored data, never guessed. `index_status` reports the generation the
 *  results were drawn from. The task's changed files seed `anchors`. */
export default function LiveSearchPanel() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reveal = useApp((s) => s.reveal);
  const store = useLive((s) => s.store);
  const selectedTaskId = useApp((s) => s.selectedTaskId);

  const anchors = useMemo(() => {
    const task = store.tasks[selectedTaskId] ?? currentTask(store);
    if (!task) return [] as string[];
    return changedFilesForTask(store, task.id).map((f) => f.path);
  }, [store, selectedTaskId]);

  useEffect(() => {
    bridge.indexStatus().then(setIndex).catch(() => setIndex(null));
  }, []);

  async function run(q: string) {
    const trimmed = q.trim();
    setSubmitted(trimmed);
    if (!trimmed) {
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await bridge.searchQuery(trimmed, [], anchors, 50);
      setResult(r);
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
        style={{ padding: "8px 12px 6px", display: "flex", gap: 6 }}
      >
        <div style={{ position: "relative", flex: 1 }}>
          <Search
            size={12}
            style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }}
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code — symbols, text, meaning"
            className="no-native-focus"
            style={{
              width: "100%", padding: "6px 8px 6px 24px", fontSize: 12,
              border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-sunken)",
            }}
          />
        </div>
        <button className="btn btn--sm" type="submit" disabled={busy || !query.trim()}>
          {busy ? <Loader2 size={12} className="spin" /> : "Search"}
        </button>
      </form>

      <div style={{ padding: "0 12px 6px", display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--text-tertiary)" }}>
        <Database size={11} />
        {index && index.generation != null ? (
          <span>
            index gen {index.generation}
            {index.stage ? ` · ${index.stage}` : ""} · {index.file_count.toLocaleString()} files ·{" "}
            {index.symbol_count.toLocaleString()} symbols
          </span>
        ) : (
          <span>workspace not indexed yet — lexical search still works</span>
        )}
      </div>

      <div className="scroll-y" style={{ flex: 1, borderTop: "1px solid var(--border-subtle)" }}>
        {error ? (
          <div style={{ padding: 12 }}>
            <ErrorState presentation={present(error, { context: "Searching the repository" })} compact />
          </div>
        ) : !result ? (
          <div className="panel-empty" style={{ padding: 24 }}>
            <Search size={22} />
            <span>{submitted ? "No hits." : "Enter a query to search the workspace."}</span>
          </div>
        ) : (
          <>
            <div style={{ padding: "6px 12px", fontSize: 10, color: "var(--text-tertiary)" }}>
              {result.hits.length} hit{result.hits.length === 1 ? "" : "s"} · modes: {result.modes_run.join(", ") || "—"}
              {result.degraded.length > 0 && (
                <div style={{ marginTop: 3, display: "flex", gap: 5, alignItems: "flex-start" }}>
                  <Info size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{result.degraded.join(" · ")}</span>
                </div>
              )}
            </div>
            {result.hits.map((h, i) => (
              <HitRow key={`${h.path}:${h.line ?? 0}:${i}`} hit={h} onOpen={() => reveal({ path: h.path, line: h.line ?? undefined, in: "code" })} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function HitRow({ hit, onOpen }: { hit: SearchHit; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 4, padding: "7px 12px" }}>
        <button
          className="no-native-focus"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Hide scoring" : "Explain score"}
          style={{ marginTop: 1, color: "var(--text-tertiary)", flexShrink: 0 }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          className="no-native-focus"
          onClick={onOpen}
          style={{ flex: 1, minWidth: 0, textAlign: "left" }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {hit.path}{hit.line != null ? `:${hit.line}` : ""}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{hit.score.toFixed(3)}</span>
          </div>
          {hit.symbol_path && (
            <div style={{ fontSize: 10.5, color: "var(--accent-strong)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
              {hit.symbol_path}
            </div>
          )}
          {hit.snippet && (
            <pre style={{
              margin: "4px 0 0", fontSize: 11, lineHeight: 1.4, color: "var(--text-secondary)",
              whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 60, overflow: "hidden",
            }}>
              {hit.snippet}
            </pre>
          )}
        </button>
      </div>

      {open && (
        <div style={{ padding: "0 12px 10px 28px", fontSize: 10.5, color: "var(--text-tertiary)" }}>
          <div style={{ marginBottom: 4 }}>
            retrieval: {hit.explanation.retrieval_paths.join(" → ") || "—"}
          </div>
          {hit.explanation.stage_scores.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              {hit.explanation.stage_scores.map((s, j) => (
                <span key={j} style={{ marginRight: 8 }}>
                  {s.mode} #{s.rank} ({s.raw_score.toFixed(2)})
                </span>
              ))}
            </div>
          )}
          {hit.explanation.features.length > 0 && (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <tbody>
                {hit.explanation.features.map((f, j) => (
                  <tr key={j}>
                    <td style={{ fontFamily: "var(--font-mono)", padding: "1px 6px 1px 0" }}>{f.name}</td>
                    <td style={{ textAlign: "right", padding: "1px 6px", color: "var(--text-secondary)" }}>{f.value.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "1px 6px" }}>×{f.weight.toFixed(2)}</td>
                    <td style={{ textAlign: "right", padding: "1px 0", color: f.contribution >= 0 ? "var(--success)" : "var(--danger)" }}>
                      {f.contribution >= 0 ? "+" : ""}{f.contribution.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
