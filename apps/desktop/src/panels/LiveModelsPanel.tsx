import { useEffect, useMemo, useState } from "react";
import { Download, Trash2, CheckCircle2, Info, HardDriveDownload, Loader2, Zap } from "lucide-react";
import { bridge, type ModelSummary } from "../core/bridge";
import { useLive } from "../core/liveStore";
import { present } from "../core/errors";
import ErrorState from "../components/ErrorState";

const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

interface InstallState {
  phase: string;
  downloaded: number;
  total: number;
}

/** §4.13 / CORE-INTERFACE G5 — the model lifecycle is on the wire now:
 *  `model_install` (progress via `model_install_*` events), `model_remove`,
 *  `model_activate`, `model_inspect`. The app still never downloads a byte
 *  itself — every weight flows Core → disk (docs/INTEGRATION.md D-INT-3). */
export default function LiveModelsPanel() {
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [reloadTick, setReloadTick] = useState(0);
  const events = useLive((s) => s.store.events);

  useEffect(() => {
    let cancelled = false;
    bridge
      .modelList()
      .then((r) => !cancelled && setModels(r.models))
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  // Fold the model_install_* events into a per-id state.
  const { progress, failures } = useMemo(() => {
    const progress: Record<string, InstallState> = {};
    const failures: Record<string, string> = {};
    let completed = false;
    for (const e of events) {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      const id = typeof p.id === "string" ? p.id : null;
      if (!id) continue;
      if (e.kind === "model_install_progress") {
        progress[id] = {
          phase: String(p.phase ?? "downloading"),
          downloaded: Number(p.downloaded_bytes ?? 0),
          total: Number(p.total_bytes ?? 0),
        };
        delete failures[id];
      } else if (e.kind === "model_install_completed") {
        delete progress[id];
        completed = true;
      } else if (e.kind === "model_install_failed") {
        delete progress[id];
        failures[id] = `${p.code ?? "install failed"}: ${p.message ?? ""}`;
      }
    }
    // A completion in the stream means the inventory changed — reload once.
    if (completed) queueMicrotask(() => setReloadTick((t) => t + 1));
    return { progress, failures };
  }, [events]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy((b) => ({ ...b, [id]: true }));
    setErr(null);
    try {
      await fn();
      setReloadTick((t) => t + 1);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  if (err) {
    return <ErrorState presentation={present(err, { context: "Managing models" })} />;
  }
  if (!models) {
    return (
      <div style={{ padding: 16, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
        Loading inventory…
      </div>
    );
  }

  const installed = models.filter((m) => m.installed).length;

  return (
    <div className="scroll-y" style={{ height: "100%", paddingBottom: 8 }}>
      <div style={{ padding: "0 12px 8px", fontSize: 11, color: "var(--text-tertiary)" }}>
        {installed} installed · {models.length} in Core's registry
      </div>

      {models.length === 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "10px 12px",
            fontSize: 11.5,
            color: "var(--text-secondary)",
          }}
        >
          <HardDriveDownload size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            No models in the catalog. You're on Core's built-in offline model — enough to run the
            flow.
          </span>
        </div>
      )}

      {models.map((m) => {
        const prog = progress[m.id];
        const fail = failures[m.id];
        const pct = prog && prog.total > 0 ? Math.round((prog.downloaded / prog.total) * 100) : 0;
        return (
          <div
            key={m.id}
            style={{ padding: "9px 12px", borderBottom: "1px solid var(--border-subtle)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {m.family}
              </span>
              {m.installed && (
                <CheckCircle2
                  size={13}
                  style={{ color: "var(--success)" }}
                  aria-label="installed"
                />
              )}
            </div>
            <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
              <span className="badge badge--neutral">{m.quantization}</span>
              <span className="badge badge--neutral">{gib(m.size_bytes)} GiB</span>
              <span className="badge badge--neutral">{m.license}</span>
            </div>

            {prog && (
              <div style={{ marginTop: 7 }}>
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: "var(--border-subtle)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      background: "var(--accent)",
                      transition: "width 120ms linear",
                    }}
                  />
                </div>
                <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 3 }}>
                  {prog.phase} · {gib(prog.downloaded)} / {gib(prog.total)} GiB
                </div>
              </div>
            )}
            {fail && (
              <div style={{ fontSize: 10.5, color: "var(--danger)", marginTop: 6 }}>{fail}</div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 7,
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--text-tertiary)",
                  fontFamily: "var(--font-mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {m.id}
              </span>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {m.installed ? (
                  <>
                    <button
                      className="btn btn--sm btn--ghost"
                      disabled={busy[m.id]}
                      title="Bind this model to the primary_coder role (model_activate)"
                      onClick={() => run(m.id, () => bridge.modelActivate(m.id, "primary_coder"))}
                    >
                      <Zap size={11} /> Activate
                    </button>
                    <button
                      className="btn btn--sm btn--ghost"
                      disabled={busy[m.id]}
                      title="Remove this model's weights (model_remove)"
                      onClick={() => run(m.id, () => bridge.modelRemove(m.id))}
                    >
                      {busy[m.id] ? <Loader2 size={11} className="spin" /> : <Trash2 size={11} />}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn--sm btn--ghost"
                    disabled={busy[m.id] || !!prog}
                    title="Download and verify this model (model_install). Core fetches it — the app never does."
                    onClick={() => run(m.id, () => bridge.modelInstall(m.id))}
                  >
                    {prog ? <Loader2 size={11} className="spin" /> : <Download size={11} />} Install
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "flex-start",
          padding: "10px 12px",
          fontSize: 10.5,
          color: "var(--text-tertiary)",
        }}
      >
        <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Install / remove / activate are served by Core (`valyria-model-store`). Every weight byte
          flows Core → disk; the app has no download path of its own.
        </span>
      </div>
    </div>
  );
}
