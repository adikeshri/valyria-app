import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck, AlertTriangle, RefreshCw, CheckCircle2 } from "lucide-react";
import { compatVerdict, type CompatVerdict } from "@valyria/protocol";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import { bridge, inTauri, type AboutInfo, type ModelSummary } from "../core/bridge";
import { checkForUpdate, installUpdate, type UpdateStatus } from "../core/updater";

/** The Phase 8 About / Compatibility surface (docs/PLAN.md §4.18): app + Core
 *  versions, negotiated protocol and capabilities, the CORE-INTERFACE §4
 *  verdict, and the app updater. Also the Windows tier-3 screen and the
 *  hard-block screen — a `blocker` in the live store routes here. */
export default function AboutView() {
  const setRoute = useApp((s) => s.setRoute);
  const session = useLive((s) => s.session);
  const blocker = useLive((s) => s.blocker);

  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [update, setUpdate] = useState<UpdateStatus>({ kind: "idle" });

  useEffect(() => {
    if (!inTauri) return;
    bridge.aboutInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    if (!session) {
      setModels(null);
      return;
    }
    bridge.modelList().then((r) => setModels(r.models)).catch(() => setModels(null));
  }, [session]);

  const expectedProtocol = info?.expected_protocol ?? "1.0.0";
  const verdict: CompatVerdict = compatVerdict(
    expectedProtocol,
    session ? { protocol_version: session.protocol_version, capabilities: session.capabilities } : null,
  );

  async function onCheck() {
    setUpdate({ kind: "checking" });
    setUpdate(await checkForUpdate());
  }
  async function onInstall() {
    setUpdate(await installUpdate(setUpdate));
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-canvas)", zIndex: 100, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}>
        <button className="icon-btn no-native-focus" onClick={() => setRoute("workspace")} title="Back">
          <ArrowLeft size={16} />
        </button>
        <h1 style={{ fontSize: "var(--text-md)", fontWeight: 650 }}>About &amp; Compatibility</h1>
      </div>

      <div className="scroll-y" style={{ flex: 1, padding: "24px 32px" }}>
        <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 4 }}>
          {blocker && <BlockerBanner code={blocker.code} message={blocker.message} expected={expectedProtocol} />}

          <Verdict verdict={verdict} />

          <Section title="This app">
            <Row k="Version" v={info?.app_version ?? "—"} />
            <Row k="Platform" v={info ? `${info.os} · ${info.arch}` : "—"} />
            <Row
              k="Sessions"
              v={
                info?.sessions_supported === false
                  ? "not available on this platform (CORE-INTERFACE G9)"
                  : "supported"
              }
              warn={info?.sessions_supported === false}
            />
            <Row k="Expected protocol" v={expectedProtocol} />
          </Section>

          <Section title="Bundled Core runtime">
            {info?.core_provenance ? (
              <>
                <Row k="Revision" v={shortSha(info.core_provenance.core_sha)} mono />
                <Row k="Ref" v={info.core_provenance.core_ref ?? "—"} mono />
                <Row k="Target" v={info.core_provenance.target ?? "—"} mono />
                <Row k="Built" v={info.core_provenance.built_at ?? "—"} />
              </>
            ) : (
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                Development build — no bundled runtime. The app resolves Core from{" "}
                <span style={{ fontFamily: "var(--font-mono)" }}>$VALYRIA_BIN</span> or a sidecar next to the executable.
              </p>
            )}
          </Section>

          <Section title="Connected Core">
            {session ? (
              <>
                <Row k="Runtime version" v={session.runtime_version || "—"} mono />
                <Row k="Protocol" v={session.protocol_version} mono />
                <Row k="Origin" v={session.origin === "adopted" ? "adopted (started elsewhere)" : "spawned by this app"} />
                <div style={{ padding: "10px 0 4px" }}>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginBottom: 6 }}>
                    Negotiated capabilities
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {session.capabilities.length === 0 && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>none reported</span>}
                    {session.capabilities.map((c) => (
                      <span key={c} className="badge badge--neutral" style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>{c}</span>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                Not connected. Open a workspace to negotiate with the Core runtime.
              </p>
            )}
          </Section>

          <Section title="Installed models">
            {!session ? (
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Open a workspace to list installed models.</p>
            ) : models && models.length > 0 ? (
              models.map((m) => (
                <Row key={m.id} k={m.id} v={`${m.family} · ${m.quantization}`} mono />
              ))
            ) : (
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                None installed — running on Core's built-in offline model. An app update never changes installed weights.
              </p>
            )}
          </Section>

          <Section title="Updates">
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginBottom: 10 }}>
              Checks this app's releases. The bundled Core runtime updates only with the app; installed model weights are never touched.
            </p>
            <UpdateControl status={update} onCheck={onCheck} onInstall={onInstall} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function shortSha(sha?: string): string {
  return sha ? sha.slice(0, 12) : "—";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <h2 style={{ fontSize: "var(--text-sm)", fontWeight: 650, marginBottom: 10 }}>{title}</h2>
      {children}
    </div>
  );
}

function Row({ k, v, mono, warn }: { k: string; v: string; mono?: boolean; warn?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "3px 0", fontSize: "var(--text-xs)" }}>
      <span style={{ color: "var(--text-tertiary)" }}>{k}</span>
      <span
        style={{
          color: warn ? "var(--warning)" : "var(--text-secondary)",
          fontFamily: mono ? "var(--font-mono)" : "inherit",
          textAlign: "right",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function Verdict({ verdict }: { verdict: CompatVerdict }) {
  const color =
    verdict.level === "blocked" ? "var(--danger)" : verdict.level === "reduced" ? "var(--warning)" : "var(--success)";
  const Icon = verdict.level === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "12px 14px",
        margin: "8px 0",
        borderRadius: 8,
        border: `1px solid ${color}`,
        background: "var(--bg-surface)",
      }}
    >
      <Icon size={16} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <div>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 650, color }}>{verdict.headline}</div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.6 }}>
          {verdict.detail}
        </div>
      </div>
    </div>
  );
}

function BlockerBanner({ code, message, expected }: { code: string; message: string; expected: string }) {
  const gotMatch = /protocol (\d+\.\d+\.\d+)/.exec(message);
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        gap: 10,
        padding: "14px 16px",
        margin: "8px 0",
        borderRadius: 8,
        border: "1px solid var(--danger)",
        background: "var(--danger-bg)",
      }}
    >
      <ShieldCheck size={18} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
      <div>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 650, color: "var(--danger)" }}>
          {code === "bridge.platform.unsupported" ? "Sessions unavailable on this platform" : "Incompatible Core runtime"}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.6 }}>
          {message}
        </div>
        {code === "bridge.protocol.mismatch" && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.6 }}>
            This build expects protocol <strong>{expected}</strong>
            {gotMatch ? <> and reached a Core speaking <strong>{gotMatch[1]}</strong></> : null}. Use the Core bundled
            with this app, or install an app build that matches. See{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>docs/CORE-INTERFACE.md §4</span>.
          </div>
        )}
      </div>
    </div>
  );
}

function UpdateControl({
  status,
  onCheck,
  onInstall,
}: {
  status: UpdateStatus;
  onCheck: () => void;
  onInstall: () => void;
}) {
  if (status.kind === "available") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>
          Version <strong>{status.version}</strong> is available.
        </span>
        <button className="btn btn--sm btn--primary" onClick={onInstall}>Download &amp; restart</button>
      </div>
    );
  }
  const label =
    status.kind === "checking"
      ? "Checking…"
      : status.kind === "downloading"
        ? "Downloading…"
        : "Check for updates";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button
        className="btn btn--sm"
        onClick={onCheck}
        disabled={status.kind === "checking" || status.kind === "downloading"}
      >
        <RefreshCw size={12} /> {label}
      </button>
      {status.kind === "up-to-date" && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--success)" }}>You're on the latest version.</span>
      )}
      {status.kind === "error" && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }} title={status.message}>
          {status.message}
        </span>
      )}
    </div>
  );
}
