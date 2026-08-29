import { useState } from "react";
import { Info, RotateCcw } from "lucide-react";
import { activeTasks } from "@valyria/state";
import { useLive } from "../core/liveStore";
import type { PermissionMode } from "../core/bridge";

const OPTIONS: { key: PermissionMode; title: string; desc: string }[] = [
  { key: "manual", title: "Manual", desc: "Ask before every mutating action." },
  {
    key: "assisted",
    title: "Assisted",
    desc: "Auto-allow reads and safe workspace commands; ask for writes outside plan scope, installs, network and destructive operations.",
  },
  {
    key: "autonomous",
    title: "Autonomous",
    desc: "Auto-allow inside the workspace and plan scope; still ask for destructive operations, network, git history rewrites and out-of-workspace access.",
  },
];

/** §25 / CORE-INTERFACE G1 — the autonomy level is a daemon-start parameter
 *  (`valyria serve --permission-mode`). Changing it restarts the workspace
 *  daemon; it is disabled while a task is running, and disabled entirely when
 *  the daemon was adopted from another process (not ours to restart). */
export default function LiveAutonomyControl() {
  const session = useLive((s) => s.session);
  const store = useLive((s) => s.store);
  const restartSession = useLive((s) => s.restartSession);

  const current = session?.permission_mode ?? null;
  const owns = session?.owns_daemon ?? false;
  const running = activeTasks(store).length > 0;

  const [pending, setPending] = useState<PermissionMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const lockReason = !owns
    ? "Core for this workspace was started by another process. Quit it there to change the autonomy level."
    : running
      ? "A task is running. Pause or finish it before changing autonomy — the change restarts Core."
      : current === null
        ? "This daemon didn't record an autonomy level; reopen the workspace to set one."
        : null;

  async function apply(mode: PermissionMode) {
    setBusy(true);
    setErr(null);
    const ok = await restartSession(mode);
    setBusy(false);
    setPending(null);
    if (!ok) setErr(useLive.getState().error ?? "Restart failed.");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {OPTIONS.map((o) => {
        const active = current === o.key;
        return (
          <button
            key={o.key}
            className="no-native-focus"
            disabled={!!lockReason || busy || active}
            onClick={() => setPending(o.key)}
            style={{
              display: "flex", gap: 10, textAlign: "left", padding: 12, borderRadius: 8,
              border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
              background: active ? "var(--accent-soft)" : "var(--bg-surface)",
              opacity: lockReason && !active ? 0.55 : 1,
              cursor: lockReason || active ? "default" : "pointer",
            }}
          >
            <span style={{
              width: 15, height: 15, borderRadius: "50%", flexShrink: 0, marginTop: 2,
              border: `2px solid ${active ? "var(--accent)" : "var(--border-strong)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {active && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />}
            </span>
            <span>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 650 }}>
                {o.title}{active && <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}> · current</span>}
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 2 }}>{o.desc}</div>
            </span>
          </button>
        );
      })}

      <p style={{ fontSize: 10.5, color: "var(--text-tertiary)", display: "flex", gap: 5, marginTop: 2 }}>
        <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        {lockReason ?? "Changing this restarts the workspace's Core process. Any daemon state is rebuilt from the journal."}
      </p>

      {pending && (
        <div style={{ marginTop: 6, padding: 12, background: "var(--bg-sunken)", borderRadius: 8 }}>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 10 }}>
            Restart Core for this workspace in <strong>{pending}</strong> mode? Running tasks are reloaded from the journal;
            the event stream reconnects.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn--primary" disabled={busy} onClick={() => void apply(pending)}>
              <RotateCcw size={13} /> {busy ? "Restarting…" : "Restart Core"}
            </button>
            <button className="btn" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      {err && <div style={{ fontSize: 11.5, color: "var(--danger)" }}>{err}</div>}
    </div>
  );
}
