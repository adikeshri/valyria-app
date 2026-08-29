import { FileText, GitCommitHorizontal, ShieldCheck, Info } from "lucide-react";
import { contextItems, currentTask } from "../data/mock";
import type { ContextItem } from "../types/domain";

const trustLabel: Record<ContextItem["trust"], string> = {
  authorized_instruction: "Authorized instruction",
  repository: "Repository",
  historical: "Historical",
};
const trustColor: Record<ContextItem["trust"], string> = {
  authorized_instruction: "badge--accent",
  repository: "badge--neutral",
  historical: "badge--info",
};

export default function ContextInspectorPanel() {
  const totalTokens = contextItems.reduce((n, c) => n + c.tokens, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "0 12px 10px" }}>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          What Valyria used to work on <strong>{currentTask.objective.toLowerCase()}</strong>
        </p>
      </div>
      <div className="scroll-y" style={{ flex: 1 }}>
        {contextItems.map((c) => (
          <div key={c.path} style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {c.trust === "historical" ? <GitCommitHorizontal size={12} style={{ color: "var(--text-tertiary)" }} /> : <FileText size={12} style={{ color: "var(--text-tertiary)" }} />}
              <span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.path}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3, paddingLeft: 18 }}>{c.reason}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, paddingLeft: 18 }}>
              <span className={`badge ${trustColor[c.trust]}`}>{trustLabel[c.trust]}</span>
              <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{c.tokens} tokens</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "9px 12px", borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>Budget used</span>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>{totalTokens.toLocaleString()} / 32,000</span>
      </div>
      <div style={{ height: 4, background: "var(--bg-sunken)", margin: "0 12px 10px", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, (totalTokens / 32000) * 100)}%`, background: "var(--accent)" }} />
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "0 12px 12px", fontSize: 10, color: "var(--text-tertiary)" }}>
        <ShieldCheck size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Only AGENTS.md holds a system-trust position; everything else is fenced repository data.</span>
      </div>
    </div>
  );
}

export function SymbolsStub() {
  return (
    <div className="panel-empty">
      <Info size={22} />
      <strong>Symbol search unavailable</strong>
      <span>Requires the repository index surface, not yet exposed by Core — see docs/CORE-INTERFACE.md (G3).</span>
    </div>
  );
}
