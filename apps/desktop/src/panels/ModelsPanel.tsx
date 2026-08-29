import { Download, Trash2, CheckCircle2, Info } from "lucide-react";
import { modelList } from "../data/mock";
import type { ModelSummary } from "../types/domain";

function roleColor(role: ModelSummary["role"]) {
  if (role === "coding") return "badge--accent";
  if (role === "planning") return "badge--info";
  return "badge--neutral";
}

export default function ModelsPanel() {
  return (
    <div className="scroll-y" style={{ height: "100%", paddingBottom: 8 }}>
      <div style={{ padding: "0 12px 8px", fontSize: 11, color: "var(--text-tertiary)" }}>
        {modelList.filter((m) => m.installed).length} installed · {modelList.length} available
      </div>
      {modelList.map((m) => (
        <div key={m.id} style={{ padding: "9px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {m.family}
            </span>
            {m.active && <CheckCircle2 size={13} style={{ color: "var(--success)" }} />}
          </div>
          <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
            <span className={`badge ${roleColor(m.role)}`}>{m.role}</span>
            <span className="badge badge--neutral">{m.quantization}</span>
            <span className="badge badge--neutral">{m.sizeGb} GB</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 7 }}>
            <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{m.memGb} GB memory · {m.license}</span>
            {m.installed ? (
              <button className="btn btn--sm btn--ghost" title="Remove — not available in this preview" disabled>
                <Trash2 size={11} />
              </button>
            ) : (
              <button className="btn btn--sm btn--ghost" title="Install — not available in this preview" disabled>
                <Download size={11} />
              </button>
            )}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "10px 12px", fontSize: 10.5, color: "var(--text-tertiary)" }}>
        <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Install and removal aren't wired to Core yet — this is inventory only. No model is ever downloaded silently.</span>
      </div>
    </div>
  );
}
