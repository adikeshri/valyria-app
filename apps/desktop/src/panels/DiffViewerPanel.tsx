import { useMemo, useRef } from "react";
import { diffLines } from "diff";
import { ChevronUp, ChevronDown, FileDiff, GitCompareArrows } from "lucide-react";
import { diffs, modifiedFiles } from "../data/mock";
import { CodeLine } from "../components/CodeLine";
import { useApp } from "../state/store";

export default function DiffViewerPanel() {
  const selectedFile = useApp((s) => s.selectedFile);
  const setSelectedFile = useApp((s) => s.setSelectedFile);
  const containerRef = useRef<HTMLDivElement>(null);

  const file = selectedFile && diffs[selectedFile] ? selectedFile : modifiedFiles[0]?.path;
  const entry = file ? diffs[file] : undefined;
  const meta = modifiedFiles.find((f) => f.path === file);

  const chunks = useMemo(() => {
    if (!entry) return [];
    return diffLines(entry.before, entry.after);
  }, [entry]);

  const rows = useMemo(() => {
    const out: { type: "add" | "del" | "ctx"; text: string; oldNo?: number; newNo?: number }[] = [];
    let oldNo = 1, newNo = 1;
    for (const c of chunks) {
      const lines = c.value.replace(/\n$/, "").split("\n");
      for (const l of lines) {
        if (c.added) out.push({ type: "add", text: l, newNo: newNo++ });
        else if (c.removed) out.push({ type: "del", text: l, oldNo: oldNo++ });
        else out.push({ type: "ctx", text: l, oldNo: oldNo++, newNo: newNo++ });
      }
    }
    return out;
  }, [chunks]);

  const changeIndices = rows.reduce<number[]>((acc, r, i) => (r.type !== "ctx" ? [...acc, i] : acc), []);

  function jump(dir: 1 | -1) {
    const el = containerRef.current;
    if (!el || changeIndices.length === 0) return;
    const rowEls = el.querySelectorAll("[data-row]");
    const current = el.scrollTop;
    const targets = changeIndices.map((i) => (rowEls[i] as HTMLElement)?.offsetTop ?? 0);
    const next = dir === 1 ? targets.find((t) => t > current + 4) : [...targets].reverse().find((t) => t < current - 4);
    if (next !== undefined) el.scrollTo({ top: next - 8, behavior: "smooth" });
  }

  if (!entry) {
    return (
      <div className="panel-empty">
        <GitCompareArrows size={28} />
        <strong>No changes to show</strong>
        <span>Select a modified file to see its diff.</span>
      </div>
    );
  }

  const added = rows.filter((r) => r.type === "add").length;
  const removed = rows.filter((r) => r.type === "del").length;

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div style={{ width: 190, flexShrink: 0, borderRight: "1px solid var(--border-subtle)", overflowY: "auto" }}>
        {modifiedFiles.map((f) => (
          <button
            key={f.path}
            className="no-native-focus"
            onClick={() => setSelectedFile(f.path)}
            style={{
              display: "flex", flexDirection: "column", gap: 2, width: "100%", padding: "7px 10px", textAlign: "left",
              background: f.path === file ? "var(--bg-active)" : "transparent", borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }}>
              <FileDiff size={11} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path.split("/").pop()}</span>
            </span>
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", paddingLeft: 16 }}>
              <span style={{ color: "var(--diff-add-text)" }}>+{f.additions}</span>{" "}
              <span style={{ color: "var(--diff-del-text)" }}>−{f.deletions}</span>
            </span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
          <span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file}</span>
          {meta && <span className={`badge ${meta.ownership === "agent" ? "badge--agent" : meta.ownership === "user" ? "badge--user" : "badge--existing"}`}>{meta.ownership}</span>}
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
            <span style={{ color: "var(--diff-add-text)" }}>+{added}</span>{" "}
            <span style={{ color: "var(--diff-del-text)" }}>−{removed}</span>
          </span>
          <button className="icon-btn no-native-focus" title="Previous change" onClick={() => jump(-1)}><ChevronUp size={14} /></button>
          <button className="icon-btn no-native-focus" title="Next change" onClick={() => jump(1)}><ChevronDown size={14} /></button>
        </div>
        <div ref={containerRef} className="scroll-y" style={{ flex: 1, background: "var(--code-bg)" }}>
          <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.6 }}>
            {rows.map((r, i) => (
              <div
                key={i}
                data-row
                style={{
                  display: "flex",
                  background: r.type === "add" ? "var(--diff-add-bg)" : r.type === "del" ? "var(--diff-del-bg)" : "transparent",
                  borderLeft: `2px solid ${r.type === "add" ? "var(--diff-add-border)" : r.type === "del" ? "var(--diff-del-border)" : "transparent"}`,
                }}
              >
                <span style={{ width: 36, textAlign: "right", paddingRight: 6, color: "var(--code-line-number)", userSelect: "none", flexShrink: 0 }}>{r.oldNo ?? ""}</span>
                <span style={{ width: 36, textAlign: "right", paddingRight: 10, color: "var(--code-line-number)", userSelect: "none", flexShrink: 0 }}>{r.newNo ?? ""}</span>
                <span style={{ width: 14, flexShrink: 0, color: r.type === "add" ? "var(--diff-add-text)" : r.type === "del" ? "var(--diff-del-text)" : "var(--text-tertiary)" }}>
                  {r.type === "add" ? "+" : r.type === "del" ? "−" : ""}
                </span>
                <code style={{
                  whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1, paddingRight: 12,
                  color: r.type === "add" ? "var(--diff-add-text)" : r.type === "del" ? "var(--diff-del-text)" : "var(--text-primary)",
                }}>
                  <CodeLine line={r.text || " "} language={entry.language} />
                </code>
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  );
}
