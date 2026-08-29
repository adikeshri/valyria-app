import { useEffect, useState } from "react";
import { Download, Trash2, CheckCircle2, Info, HardDriveDownload } from "lucide-react";
import { bridge, type ModelSummary } from "../core/bridge";

const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

/** §4.13 — the Model Manager is an **inventory** view over `model_list`
 *  (`id, family, quantization, size_bytes, installed, license`). Install /
 *  remove / activate are not on the wire (CORE-INTERFACE G5) and the app has no
 *  code path that downloads a model (docs/INTEGRATION.md D-INT-3) — those
 *  buttons are disabled with that reason. */
export default function LiveModelsPanel() {
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bridge
      .modelList()
      .then((r) => !cancelled && setModels(r.models))
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return <div style={{ padding: 16, fontSize: "var(--text-sm)", color: "var(--danger)" }}>{err}</div>;
  }
  if (!models) {
    return <div style={{ padding: 16, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>Loading inventory…</div>;
  }

  const installed = models.filter((m) => m.installed).length;

  return (
    <div className="scroll-y" style={{ height: "100%", paddingBottom: 8 }}>
      <div style={{ padding: "0 12px 8px", fontSize: 11, color: "var(--text-tertiary)" }}>
        {installed} installed · {models.length} in Core's registry
      </div>

      {models.length === 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)" }}>
          <HardDriveDownload size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>No models installed. You're on Core's built-in offline model — enough to run the flow. Real model install isn't on the protocol yet (G5).</span>
        </div>
      )}

      {models.map((m) => (
        <div key={m.id} style={{ padding: "9px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {m.family}
            </span>
            {m.installed && <CheckCircle2 size={13} style={{ color: "var(--success)" }} aria-label="installed" />}
          </div>
          <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
            <span className="badge badge--neutral">{m.quantization}</span>
            <span className="badge badge--neutral">{gib(m.size_bytes)} GiB</span>
            <span className="badge badge--neutral">{m.license}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 7 }}>
            <span style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>{m.id}</span>
            <button
              className="btn btn--sm btn--ghost"
              disabled
              title="Core v1 has no model install / remove / activate on the wire (CORE-INTERFACE G5). The app never downloads a model."
            >
              {m.installed ? <Trash2 size={11} /> : <Download size={11} />}
            </button>
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "10px 12px", fontSize: 10.5, color: "var(--text-tertiary)" }}>
        <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Inventory only — install, removal and role assignment aren't on the protocol yet (G5). No model is ever downloaded by the app.</span>
      </div>
    </div>
  );
}
