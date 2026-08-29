import { useState } from "react";
import {
  ArrowLeft, Bot, Boxes, ShieldCheck, FolderGit2, Palette,
  Check, Lock, Unlock, Info,
} from "lucide-react";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import { modelList, hardware } from "../data/mock";
import LiveAutonomyControl from "./LiveAutonomyControl";
import LiveSecurityOverview from "./LiveSecurityOverview";
import LiveRepoInstructions from "./LiveRepoInstructions";
import LiveConfigSettings from "./LiveConfigSettings";
import { NOTIFY_CATEGORIES, loadPrefs, savePrefs, type NotifyPrefs } from "../core/notify";

type Section = "agent" | "models" | "security" | "repository" | "application";

const sections: { key: Section; label: string; icon: React.ReactNode }[] = [
  { key: "agent", label: "Agent", icon: <Bot size={14} /> },
  { key: "models", label: "Models", icon: <Boxes size={14} /> },
  { key: "security", label: "Security", icon: <ShieldCheck size={14} /> },
  { key: "repository", label: "Repository", icon: <FolderGit2 size={14} /> },
  { key: "application", label: "Application", icon: <Palette size={14} /> },
];

function Field({ label, origin, children }: { label: string; origin?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{label}</span>
        {origin && <span className="local-tag">from {origin}</span>}
      </div>
      {children}
    </div>
  );
}

function AutonomySetting() {
  const liveSession = useLive((s) => s.session);
  if (liveSession) return <LiveAutonomyControl />;
  return <MockAutonomySetting />;
}

function MockAutonomySetting() {
  const [level, setLevel] = useState<"manual" | "assisted" | "autonomous">("assisted");
  const options: { key: typeof level; title: string; desc: string }[] = [
    { key: "manual", title: "Manual", desc: "Ask before every mutating action." },
    { key: "assisted", title: "Assisted", desc: "Auto-allow reads and safe workspace commands; ask for writes outside plan scope, installs, network and destructive operations." },
    { key: "autonomous", title: "Autonomous", desc: "Auto-allow inside the workspace and plan scope; still asks for destructive operations, network, git history rewrites and out-of-workspace access." },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {options.map((o) => (
        <button
          key={o.key}
          className="no-native-focus"
          onClick={() => setLevel(o.key)}
          style={{
            display: "flex", gap: 10, textAlign: "left", padding: 12, borderRadius: 8,
            border: `1px solid ${level === o.key ? "var(--accent)" : "var(--border)"}`,
            background: level === o.key ? "var(--accent-soft)" : "var(--bg-surface)",
          }}
        >
          <span style={{
            width: 15, height: 15, borderRadius: "50%", flexShrink: 0, marginTop: 2,
            border: `2px solid ${level === o.key ? "var(--accent)" : "var(--border-strong)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {level === o.key && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />}
          </span>
          <span>
            <div style={{ fontSize: "var(--text-sm)", fontWeight: 650 }}>{o.title}</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 2 }}>{o.desc}</div>
          </span>
        </button>
      ))}
      <p style={{ fontSize: 10.5, color: "var(--text-tertiary)", display: "flex", gap: 5, marginTop: 2 }}>
        <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        Changing this restarts the workspace's Core process, and is disabled while a task is running.
      </p>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className="no-native-focus"
      onClick={() => onChange(!checked)}
      style={{ display: "flex", alignItems: "center", gap: 10 }}
    >
      <span style={{
        width: 32, height: 18, borderRadius: 999, background: checked ? "var(--accent)" : "var(--bg-hover)",
        position: "relative", transition: "background 120ms", border: "1px solid var(--border)",
      }}>
        <span style={{
          position: "absolute", top: 1, left: checked ? 15 : 1, width: 14, height: 14, borderRadius: "50%",
          background: "white", transition: "left 120ms", boxShadow: "var(--shadow-sm)",
        }} />
      </span>
      <span style={{ fontSize: "var(--text-sm)" }}>{label}</span>
    </button>
  );
}

function SecurityRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
      {ok ? <Check size={14} style={{ color: "var(--success)" }} /> : <Lock size={14} style={{ color: "var(--text-tertiary)" }} />}
      <span style={{ fontSize: "var(--text-sm)" }}>{label}</span>
    </div>
  );
}

export default function SettingsView() {
  const setRoute = useApp((s) => s.setRoute);
  const liveSession = useLive((s) => s.session);
  const notifications = useApp((s) => s.notificationsEnabled);
  const setNotifications = useApp((s) => s.setNotificationsEnabled);
  const [section, setSection] = useState<Section>("agent");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotifyPrefs>(() => loadPrefs());

  function toggleCategory(key: keyof NotifyPrefs, v: boolean) {
    const next = { ...notifPrefs, [key]: v };
    setNotifPrefs(next);
    savePrefs(next);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-canvas)", zIndex: 100, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}>
        <button className="icon-btn no-native-focus" onClick={() => setRoute("workspace")} title="Back">
          <ArrowLeft size={16} />
        </button>
        <h1 style={{ fontSize: "var(--text-md)", fontWeight: 650 }}>Settings</h1>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <nav style={{ width: 200, flexShrink: 0, borderRight: "1px solid var(--border-subtle)", padding: 10 }}>
          {sections.map((s) => (
            <button
              key={s.key}
              className="no-native-focus"
              onClick={() => setSection(s.key)}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", borderRadius: 6,
                fontSize: "var(--text-sm)", textAlign: "left", marginBottom: 1,
                background: section === s.key ? "var(--bg-active)" : "transparent",
                color: section === s.key ? "var(--accent-strong)" : "var(--text-secondary)",
                fontWeight: section === s.key ? 600 : 500,
              }}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </nav>
        <div className="scroll-y" style={{ flex: 1, padding: "24px 32px" }}>
          <div style={{ maxWidth: 620 }}>
            {section === "agent" && (
              <>
                <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 650, marginBottom: 16 }}>Agent</h2>
                <Field label="Autonomy level"><AutonomySetting /></Field>
                {liveSession ? (
                  <Field label="Runtime config">
                    <LiveConfigSettings />
                  </Field>
                ) : (
                  <>
                    <Field label="Iteration limit" origin="~/.valyria/config.toml">
                      <input className="no-native-focus" type="range" min={4} max={40} defaultValue={20} style={{ width: "100%" }} />
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>20 steps before the driver hands off rather than spinning silently.</div>
                    </Field>
                    <Field label="Mandatory full verification before completion" origin="compiled default">
                      <Toggle checked onChange={() => {}} label="Always run the full suite once, even after targeted tests pass" />
                    </Field>
                  </>
                )}
              </>
            )}
            {section === "models" && (
              <>
                <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 650, marginBottom: 4 }}>Models</h2>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginBottom: 16 }}>Role assignment — which installed model handles which job.</p>
                {(["coding", "planning", "embedding"] as const).map((role) => {
                  const active = modelList.find((m) => m.role === role && m.active);
                  return (
                    <Field key={role} label={role[0].toUpperCase() + role.slice(1)}>
                      <select
                        className="no-native-focus"
                        defaultValue={active?.id}
                        style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-surface)" }}
                      >
                        {modelList.filter((m) => m.role === role && m.installed).map((m) => (
                          <option key={m.id} value={m.id}>{m.family} ({m.quantization}) — {m.sizeGb} GB</option>
                        ))}
                      </select>
                    </Field>
                  );
                })}
                <Field label="Context window">
                  <select className="no-native-focus" defaultValue="32k" style={{ width: 200, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
                    <option value="8k">8,000 tokens</option>
                    <option value="32k">32,000 tokens</option>
                    <option value="64k">64,000 tokens (may not fit {hardware.ramGb} GB)</option>
                  </select>
                </Field>
              </>
            )}
            {section === "security" && (
              <>
                <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 650, marginBottom: 16 }}>Security</h2>
                {liveSession ? (
                  <LiveSecurityOverview />
                ) : (
                  <>
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginBottom: 14 }}>
                      What the agent is authorized to do in this workspace — sourced from Core's policy floor and effective config.
                    </p>
                    <div style={{ padding: 14, background: "var(--bg-sunken)", borderRadius: 8 }}>
                      <div className="section-label" style={{ marginBottom: 4 }}>Workspace</div>
                      <SecurityRow ok label="~/dev/northwind-api" />
                      <div className="section-label" style={{ margin: "12px 0 4px" }}>Filesystem</div>
                      <SecurityRow ok label="Read/write within workspace" />
                      <SecurityRow ok={false} label="Home directory" />
                      <div className="section-label" style={{ margin: "12px 0 4px" }}>Network</div>
                      <SecurityRow ok={false} label="Disabled by default" />
                      <div className="section-label" style={{ margin: "12px 0 4px" }}>Credentials</div>
                      <SecurityRow ok={false} label="Blocked from model context and logs" />
                      <div className="section-label" style={{ margin: "12px 0 4px" }}>Destructive commands</div>
                      <SecurityRow ok={false} label="Blocked — requires explicit approval" />
                    </div>
                  </>
                )}
              </>
            )}
            {section === "repository" && (
              <>
                <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 650, marginBottom: 16 }}>Repository</h2>
                <Field label="Recognized instructions">
                  {liveSession ? (
                    <LiveRepoInstructions />
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--accent-soft)", borderRadius: 6 }}>
                        <Unlock size={13} style={{ color: "var(--accent-strong)" }} />
                        <span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", flex: 1 }}>AGENTS.md</span>
                        <span className="badge badge--accent">authorized</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)", paddingLeft: 4 }}>VALYRIA.md not present in this repository.</div>
                    </div>
                  )}
                </Field>
                <Field label="Indexing">
                  <Toggle checked onChange={() => {}} label="Keep the repository index up to date automatically" />
                </Field>
                <Field label="Language support">
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["Python", "TypeScript", "JavaScript", "Go", "Rust", "Java"].map((l) => (
                      <span key={l} className="badge badge--neutral">{l}</span>
                    ))}
                  </div>
                </Field>
              </>
            )}
            {section === "application" && (
              <>
                <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 650, marginBottom: 16 }}>Application</h2>
                <Field label="Notifications">
                  <Toggle checked={notifications} onChange={setNotifications} label="Show OS notifications for this app" />
                  {notifications && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, paddingLeft: 42 }}>
                      {NOTIFY_CATEGORIES.map((c) => (
                        <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                          <input
                            type="checkbox"
                            className="no-native-focus"
                            checked={notifPrefs[c.key]}
                            onChange={(e) => toggleCategory(c.key, e.target.checked)}
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  )}
                </Field>
                <Field label="Reduced motion">
                  <Toggle checked={reducedMotion} onChange={setReducedMotion} label="Minimize animation throughout the app" />
                </Field>
                <Field label="About">
                  <button
                    className="btn btn--sm"
                    onClick={() => setRoute("about")}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <Info size={12} /> Version, compatibility &amp; updates →
                  </button>
                </Field>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
