import { useEffect, useState } from "react";
import { GitBranch, Cpu, WifiOff, Moon, Sun, Monitor, Settings, Command, ChevronDown, Info } from "lucide-react";
import { blockedTasks } from "@valyria/state";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import { WORKSPACE_NAME, CURRENT_BRANCH, hardware, currentTask } from "../data/mock";
import { modelList } from "../data/mock";
import { bridge } from "../core/bridge";
import logoMark from "../assets/logo-mark.png";

const mockActiveModel = modelList.find((m) => m.active && m.role === "coding")!;

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

function ThemeToggle() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const options: { key: typeof theme; icon: React.ReactNode; label: string }[] = [
    { key: "light", icon: <Sun size={13} />, label: "Light" },
    { key: "dark", icon: <Moon size={13} />, label: "Dark" },
    { key: "system", icon: <Monitor size={13} />, label: "System" },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" style={{ display: "flex", gap: 1, background: "var(--bg-hover)", borderRadius: 7, padding: 2 }}>
      {options.map((o) => (
        <button
          key={o.key}
          role="radio"
          aria-checked={theme === o.key}
          title={o.label}
          className="icon-btn no-native-focus"
          style={{
            width: 24,
            height: 24,
            background: theme === o.key ? "var(--bg-surface)" : "transparent",
            color: theme === o.key ? "var(--text-primary)" : "var(--text-tertiary)",
            boxShadow: theme === o.key ? "var(--shadow-sm)" : "none",
          }}
          onClick={() => setTheme(o.key)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

export default function Header() {
  const setRoute = useApp((s) => s.setRoute);
  const route = useApp((s) => s.route);
  const setCommandPaletteOpen = useApp((s) => s.setCommandPaletteOpen);
  const mockConnection = useApp((s) => s.connection);
  const liveSession = useLive((s) => s.session);
  const liveConnection = useLive((s) => s.connection);
  const liveStore = useLive((s) => s.store);
  // Once a real session exists, the header tells the truth about it.
  const connection = liveSession ? liveConnection : mockConnection;
  const runtimeVersion = liveSession?.runtime_version;

  // Active model: v1 has no "active" flag on model_list, so the honest best we
  // can do live is name the sole installed model, else say it's not reported.
  const [liveModelName, setLiveModelName] = useState<string | null>(null);
  useEffect(() => {
    if (!liveSession) return;
    let cancelled = false;
    bridge
      .modelList()
      .then((r) => {
        if (cancelled) return;
        const inst = r.models.filter((m) => m.installed);
        setLiveModelName(inst.length === 1 ? inst[0]!.family : inst.length === 0 ? "offline model" : `${inst.length} models`);
      })
      .catch(() => !cancelled && setLiveModelName(null));
    return () => { cancelled = true; };
  }, [liveSession]);

  const modelLabel = liveSession ? (liveModelName ?? "model: not reported") : mockActiveModel.family;
  const blockedCount = liveSession ? blockedTasks(liveStore).length : currentTask.state === "waiting_for_permission" ? 1 : 0;

  return (
    <header className="header">
      <div className="brand">
        <img src={logoMark} alt="" aria-hidden className="brand-mark" />
        <span>Valyria</span>
      </div>

      <div className="header-divider" />

      <button className="workspace-chip no-native-focus" onClick={() => setRoute("workspace")}>
        <strong>{liveSession ? basename(liveSession.workspace_root) : WORKSPACE_NAME}</strong>
        <span className="branch"><GitBranch size={11} />{CURRENT_BRANCH}</span>
        <ChevronDown size={12} style={{ color: "var(--text-tertiary)" }} />
      </button>

      <div className="header-spacer" />

      <button
        className="status-chip no-native-focus"
        onClick={() => { setRoute("workspace"); }}
        title="Local · Offline — no remote AI service is used"
      >
        <WifiOff size={12} style={{ color: "var(--text-tertiary)" }} />
        <span>Local · Offline</span>
      </button>

      <button
        className="status-chip no-native-focus"
        onClick={() => setRoute("settings")}
        title={runtimeVersion ? `Core ${runtimeVersion} · ${connection}` : `Active model: ${modelLabel}`}
      >
        <span className={`dot ${connection === "ready" ? "dot--success" : "dot--warning"}`} />
        <strong>{modelLabel}</strong>
      </button>

      {!liveSession && (
        <button className="status-chip no-native-focus" onClick={() => setRoute("workspace")} title={hardware.gpu}>
          <Cpu size={12} style={{ color: "var(--text-tertiary)" }} />
          <span>{hardware.ramGb} GB unified</span>
        </button>
      )}

      {blockedCount > 0 && (
        <span className="badge badge--warning">{blockedCount} approval{blockedCount === 1 ? "" : "s"} waiting</span>
      )}

      <div className="header-divider" />

      <button className="icon-btn no-native-focus" title="Command palette (⌘K)" onClick={() => setCommandPaletteOpen(true)}>
        <Command size={15} />
      </button>
      <ThemeToggle />
      <button
        className={`icon-btn no-native-focus ${route === "about" ? "active" : ""}`}
        title="About & compatibility"
        onClick={() => setRoute("about")}
      >
        <Info size={15} />
      </button>
      <button
        className={`icon-btn no-native-focus ${route === "settings" ? "active" : ""}`}
        title="Settings"
        onClick={() => setRoute("settings")}
      >
        <Settings size={15} />
      </button>
    </header>
  );
}
