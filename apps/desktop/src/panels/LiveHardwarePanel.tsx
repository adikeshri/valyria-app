import { useEffect, useState } from "react";
import { Check, AlertTriangle, XCircle, HelpCircle, Cpu } from "lucide-react";
import { bridge, type DoctorCheck } from "../core/bridge";
import { present } from "../core/errors";
import ErrorState from "../components/ErrorState";

/** §4.13 / CORE-INTERFACE G4 — v1 has no structured hardware surface and no
 *  `model_recommend`. This view renders what `doctor_run` reports (disk, model
 *  store, sandbox) and marks CPU / memory / GPU **"not reported by Core"** —
 *  it never invents a spec or a recommendation. */
export default function LiveHardwarePanel() {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bridge
      .doctorRun()
      .then((r) => !cancelled && setChecks(r.checks))
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return <ErrorState presentation={present(err, { context: "Running Core's checks" })} />;
  }
  if (!checks) {
    return <div style={{ padding: 14, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>Running Core's checks…</div>;
  }

  return (
    <div className="scroll-y" style={{ height: "100%", padding: "8px 0 12px" }}>
      <div className="section-label" style={{ padding: "4px 12px" }}>Reported by Core (doctor_run)</div>
      {checks.map((c) => (
        <div key={c.name} style={{ display: "flex", gap: 8, padding: "6px 12px" }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}>{statusIcon(c.status)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-sm)" }}>{c.name}</div>
            {c.detail && <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{c.detail}</div>}
            {c.remediation && <div style={{ fontSize: 11, color: "var(--warning)" }}>{c.remediation}</div>}
          </div>
        </div>
      ))}

      <div className="section-label" style={{ padding: "12px 12px 4px" }}>Not reported by Core</div>
      <div style={{ padding: "0 12px" }}>
        {["CPU", "Memory", "GPU", "VRAM", "Accelerator"].map((label) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
            <HelpCircle size={13} style={{ flexShrink: 0 }} />
            <span style={{ width: 90 }}>{label}</span>
            <span>—</span>
          </div>
        ))}
        <p style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 6, display: "flex", gap: 5 }}>
          <Cpu size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          Core v1 exposes no structured hardware probe (CORE-INTERFACE G4). Until it does, there's no spec to show and
          no model recommendation to make.
        </p>
      </div>
    </div>
  );
}

function statusIcon(status: string) {
  switch (status) {
    case "pass":
      return <Check size={14} style={{ color: "var(--success)" }} />;
    case "warn":
      return <AlertTriangle size={14} style={{ color: "var(--warning)" }} />;
    case "fail":
      return <XCircle size={14} style={{ color: "var(--danger)" }} />;
    default:
      return <HelpCircle size={14} style={{ color: "var(--text-tertiary)" }} />;
  }
}
