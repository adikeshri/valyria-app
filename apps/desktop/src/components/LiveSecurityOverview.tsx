import { useEffect, useState } from "react";
import { Check, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { bridge, type ConfigEntry, type DoctorCheck } from "../core/bridge";

/** §26 — the security overview is rendered from `doctor_run` (sandbox,
 *  permission config, …) plus `config_show` entries, and states plainly which
 *  lines Core enforces and which it does not report. A checkmark the app cannot
 *  source from Core is not drawn (D8). */
export default function LiveSecurityOverview() {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [entries, setEntries] = useState<ConfigEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([bridge.doctorRun(), bridge.configShow()])
      .then(([d, c]) => {
        if (cancelled) return;
        setChecks(d.checks);
        setEntries(c.entries);
      })
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return <p style={{ fontSize: "var(--text-sm)", color: "var(--danger)" }}>{err}</p>;
  }
  if (!checks || !entries) {
    return <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>Loading Core's checks…</p>;
  }

  // Surface the security-relevant checks first; keep the rest visible too.
  const securityNames = /sandbox|permission|network|credential|secret|path|escape/i;
  const security = checks.filter((c) => securityNames.test(c.name));
  const other = checks.filter((c) => !securityNames.test(c.name));

  const policyKeys = /permission|sandbox|network|autonomy|secret|redact/i;
  const policyEntries = entries.filter((e) => policyKeys.test(e.key));

  return (
    <div>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginBottom: 14 }}>
        Every row is sourced from Core — <code>doctor_run</code> for the checks, <code>config_show</code> for the
        policy values. Rows Core does not report are marked, not guessed.
      </p>

      <div style={{ padding: 14, background: "var(--bg-sunken)", borderRadius: 8 }}>
        <div className="section-label" style={{ marginBottom: 6 }}>Environment checks (Core-enforced)</div>
        {[...security, ...other].map((c) => (
          <CheckRow key={c.name} check={c} />
        ))}
      </div>

      {policyEntries.length > 0 && (
        <div style={{ padding: 14, background: "var(--bg-sunken)", borderRadius: 8, marginTop: 12 }}>
          <div className="section-label" style={{ marginBottom: 6 }}>Effective policy</div>
          {policyEntries.map((e) => (
            <div key={e.key} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "5px 0", fontSize: "var(--text-sm)" }}>
              <span style={{ fontFamily: "var(--font-mono)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{e.key}</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{e.value}</span>
              <span className="local-tag">from {e.origin}</span>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 12 }}>
        The app connects to Core over a Unix socket it cannot yet authenticate (CORE-INTERFACE G10). Confinement is
        the socket's file permissions.
      </p>
    </div>
  );
}

function CheckRow({ check }: { check: DoctorCheck }) {
  const icon =
    check.status === "pass" ? <Check size={14} style={{ color: "var(--success)" }} />
    : check.status === "warn" ? <AlertTriangle size={14} style={{ color: "var(--warning)" }} />
    : check.status === "fail" ? <XCircle size={14} style={{ color: "var(--danger)" }} />
    : <HelpCircle size={14} style={{ color: "var(--text-tertiary)" }} />;
  return (
    <div style={{ display: "flex", gap: 8, padding: "6px 0" }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)" }}>{check.name}</div>
        {check.detail && (
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{check.detail}</div>
        )}
        {check.remediation && (
          <div style={{ fontSize: 11, color: "var(--warning)" }}>{check.remediation}</div>
        )}
      </div>
    </div>
  );
}
