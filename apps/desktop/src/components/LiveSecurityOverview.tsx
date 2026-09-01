import { useEffect, useState } from "react";
import { Check, AlertTriangle, XCircle, HelpCircle, ShieldCheck } from "lucide-react";
import { bridge, type ConfigEntry, type DoctorCheck, type SessionInfo } from "../core/bridge";
import { present } from "../core/errors";
import ErrorState from "./ErrorState";

/** §26 — the security overview is rendered from `doctor_run` (sandbox,
 *  permission config, …) plus `config_show` entries, and states plainly which
 *  lines Core enforces and which it does not report. A checkmark the app cannot
 *  source from Core is not drawn (D8). */
export default function LiveSecurityOverview() {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [entries, setEntries] = useState<ConfigEntry[] | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([bridge.doctorRun(), bridge.configShow(), bridge.sessionStatus()])
      .then(([d, c, s]) => {
        if (cancelled) return;
        setChecks(d.checks);
        setEntries(c.entries);
        setSession(s);
      })
      .catch((e) => !cancelled && setErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return <ErrorState presentation={present(err, { context: "Loading the security overview" })} />;
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

      <div style={{ padding: 14, background: "var(--bg-sunken)", borderRadius: 8, marginBottom: 12 }}>
        <div className="section-label" style={{ marginBottom: 6 }}>Client ↔ Core connection</div>
        <div style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: "var(--text-sm)" }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}>
            {session?.authenticated ? (
              <ShieldCheck size={14} style={{ color: "var(--success)" }} />
            ) : (
              <AlertTriangle size={14} style={{ color: "var(--warning)" }} />
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <div>
              {session?.authenticated
                ? "Authenticated — every frame carries this session's per-instance token (G10)"
                : session
                  ? "Unauthenticated — Core for this workspace was started without a token; connection is guarded only by the socket's file permissions and peer-uid check"
                  : "No session open"}
            </div>
            {session && (
              <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                Peer-uid checked by Core · {session.origin} daemon · socket{" "}
                <code style={{ fontFamily: "var(--font-mono)" }}>{session.socket_path}</code>
              </div>
            )}
          </div>
        </div>
      </div>

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
        The socket is peer-uid restricted by Core (only the user that started the daemon may connect), and this
        session also authenticates every frame with a per-daemon token written <code>0600</code> at spawn
        (CORE-INTERFACE G10).
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
