import { useEffect, useState } from "react";
import { FileCode, Copy, GitCompareArrows } from "lucide-react";
import { fileContents } from "../data/mock";
import { CodeLine } from "../components/CodeLine";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import { repo } from "../core/repo";
import ServedLocally from "../components/ServedLocally";

function langFromPath(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    rs: "rust", py: "python", go: "go", java: "java", json: "json",
    md: "markdown", toml: "toml", yaml: "yaml", yml: "yaml", sh: "bash",
    css: "css", html: "html",
  };
  return map[ext] ?? "text";
}

interface Loaded {
  path: string;
  code: string;
  language: string;
  local: boolean;
  binary?: boolean;
  truncated?: boolean;
}

export default function CodeViewerPanel() {
  const selectedFile = useApp((s) => s.selectedFile);
  const setDockTab = useApp((s) => s.setDockTab);
  const liveSession = useLive((s) => s.session);
  const fsRev = useLive((s) => s.fsRev);
  const fsChangedPaths = useLive((s) => s.fsChangedPaths);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-read the open file when the watcher reports it changed on disk.
  const reloadKey =
    liveSession && selectedFile && fsChangedPaths.includes(selectedFile) ? fsRev : 0;

  useEffect(() => {
    setError(null);
    if (!selectedFile) {
      setLoaded(null);
      return;
    }
    if (liveSession) {
      let cancelled = false;
      repo
        .readFile(selectedFile)
        .then((v) => {
          if (cancelled) return;
          setLoaded({
            path: selectedFile,
            code: v.text ?? "",
            language: langFromPath(selectedFile),
            local: true,
            binary: v.encoding === "binary",
            truncated: v.truncated,
          });
        })
        .catch((e) => !cancelled && setError(String(e)));
      return () => {
        cancelled = true;
      };
    }
    const entry = fileContents[selectedFile];
    setLoaded(entry ? { path: selectedFile, code: entry.code, language: entry.language, local: false } : null);
  }, [selectedFile, liveSession, reloadKey]);

  if (!selectedFile || (!loaded && !error)) {
    return (
      <div className="panel-empty">
        <FileCode size={28} />
        <strong>No file open</strong>
        <span>Select a file from the Explorer to view its contents.</span>
      </div>
    );
  }

  const lines = (loaded?.code ?? "").replace(/\n$/, "").split("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {loaded?.local && <ServedLocally detail="file contents" />}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
        borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)", flexShrink: 0,
      }}>
        <FileCode size={13} style={{ color: "var(--text-tertiary)" }} />
        <span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", flex: 1 }}>{selectedFile}</span>
        {loaded?.truncated && <span className="badge badge--warning">truncated</span>}
        <button className="btn btn--sm btn--ghost" onClick={() => setDockTab("diff")}>
          <GitCompareArrows size={12} /> View diff
        </button>
        <button className="btn btn--sm btn--ghost" title="Copy"><Copy size={12} /></button>
      </div>
      {error ? (
        <div style={{ padding: 16, color: "var(--danger)", fontSize: "var(--text-sm)" }}>{error}</div>
      ) : loaded?.binary ? (
        <div className="panel-empty"><strong>Binary file</strong><span>{loaded.path}</span></div>
      ) : (
        <div className="scroll-y" style={{ flex: 1, background: "var(--code-bg)" }}>
          <pre style={{ margin: 0, padding: "10px 0", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.65 }}>
            {lines.map((line, idx) => (
              <div key={idx} style={{ display: "flex" }}>
                <span style={{ width: 44, textAlign: "right", paddingRight: 14, color: "var(--code-line-number)", userSelect: "none", flexShrink: 0 }}>
                  {idx + 1}
                </span>
                <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1 }}>
                  <CodeLine line={line} language={loaded?.language ?? "text"} />
                </code>
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}
