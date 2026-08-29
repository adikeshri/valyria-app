import { useEffect, useState } from "react";
import { FileText, ShieldCheck, FileQuestion } from "lucide-react";
import { repo } from "../core/repo";

/** §26 — the repository instruction viewer. `VALYRIA.md` / `AGENTS.md` are read
 *  locally (scoped to the authorized root) and shown with the trust position
 *  Core's documented policy assigns them. That position is *policy-derived*, not
 *  a Core-confirmed claim — v1 exposes no method that reports which instruction
 *  files Core actually loaded. */
const KNOWN = [
  {
    path: "VALYRIA.md",
    trust: "authorized",
    note: "Loaded with a system-trust position per Core's policy — its directives are followed as instructions.",
  },
  {
    path: "AGENTS.md",
    trust: "authorized",
    note: "Loaded with a system-trust position per Core's policy.",
  },
  {
    path: ".valyria/VALYRIA.md",
    trust: "authorized",
    note: "Workspace-local instructions, system-trust position per Core's policy.",
  },
];

interface Found {
  path: string;
  trust: string;
  note: string;
  preview: string;
  truncated: boolean;
}

export default function LiveRepoInstructions() {
  const [found, setFound] = useState<Found[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hits: Found[] = [];
      for (const k of KNOWN) {
        try {
          const v = await repo.readFile(k.path);
          if (v.text != null && v.text.trim().length > 0) {
            hits.push({
              ...k,
              preview: v.text.slice(0, 1200),
              truncated: v.truncated || v.text.length > 1200,
            });
          }
        } catch {
          /* not present — skip */
        }
      }
      if (!cancelled) setFound(hits);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!found) {
    return <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>Scanning for instruction files…</p>;
  }

  const missing = KNOWN.filter((k) => !found.some((f) => f.path === k.path));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
        Files the agent treats as repository instructions. The trust position shown is per Core's documented policy —
        the app cannot confirm from the wire which files Core loaded for a given task.
      </p>

      {found.map((f) => (
        <details key={f.path} style={{ border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
          <summary style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", cursor: "pointer", listStyle: "none" }}>
            <FileText size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", flex: 1 }}>{f.path}</span>
            <span className="badge badge--accent"><ShieldCheck size={11} /> {f.trust} (per policy)</span>
          </summary>
          <div style={{ padding: "0 12px 12px" }}>
            <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: "0 0 8px" }}>{f.note}</p>
            <pre style={{
              margin: 0, padding: 10, background: "var(--code-bg)", borderRadius: 6, fontSize: 11.5,
              fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", lineHeight: 1.55, color: "var(--text-secondary)",
              maxHeight: 260, overflow: "auto",
            }}>
              {f.preview}{f.truncated ? "\n…" : ""}
            </pre>
          </div>
        </details>
      ))}

      {found.length === 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
          <FileQuestion size={14} /> No instruction files in this repository.
        </div>
      )}
      {missing.length > 0 && found.length > 0 && (
        <p style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>
          Not present: {missing.map((m) => m.path).join(", ")}
        </p>
      )}
    </div>
  );
}
