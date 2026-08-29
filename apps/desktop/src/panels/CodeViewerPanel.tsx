import { FileCode, Copy, GitCompareArrows } from "lucide-react";
import { fileContents } from "../data/mock";
import { CodeLine } from "../components/CodeLine";
import { useApp } from "../state/store";

export default function CodeViewerPanel() {
  const selectedFile = useApp((s) => s.selectedFile);
  const setDockTab = useApp((s) => s.setDockTab);
  const entry = selectedFile ? fileContents[selectedFile] : undefined;

  if (!selectedFile || !entry) {
    return (
      <div className="panel-empty">
        <FileCode size={28} />
        <strong>No file open</strong>
        <span>Select a file from the Explorer to view its contents.</span>
      </div>
    );
  }

  const lines = entry.code.replace(/\n$/, "").split("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
        borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)", flexShrink: 0,
      }}>
        <FileCode size={13} style={{ color: "var(--text-tertiary)" }} />
        <span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", flex: 1 }}>{selectedFile}</span>
        <button className="btn btn--sm btn--ghost" onClick={() => setDockTab("diff")}>
          <GitCompareArrows size={12} /> View diff
        </button>
        <button className="btn btn--sm btn--ghost" title="Copy"><Copy size={12} /></button>
      </div>
      <div className="scroll-y" style={{ flex: 1, background: "var(--code-bg)" }}>
        <pre style={{ margin: 0, padding: "10px 0", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.65 }}>
          {lines.map((line, idx) => (
            <div key={idx} style={{ display: "flex" }}>
              <span style={{ width: 44, textAlign: "right", paddingRight: 14, color: "var(--code-line-number)", userSelect: "none", flexShrink: 0 }}>
                {idx + 1}
              </span>
              <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1 }}>
                <CodeLine line={line} language={entry.language} />
              </code>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
