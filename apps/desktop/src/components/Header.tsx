import { GitBranch, Cpu, WifiOff, Moon, Sun, Monitor, Settings, Command, ChevronDown } from "lucide-react";
import { useApp } from "../state/store";
import { WORKSPACE_NAME, CURRENT_BRANCH, hardware, currentTask } from "../data/mock";
import { modelList } from "../data/mock";
import logoMark from "../assets/logo-mark.png";

const activeModel = modelList.find((m) => m.active && m.role === "coding")!;

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
  const connection = useApp((s) => s.connection);

  return (
    <header className="header">
      <div className="brand">
        <img src={logoMark} alt="" aria-hidden className="brand-mark" />
        <span>Valyria</span>
      </div>

      <div className="header-divider" />

      <button className="workspace-chip no-native-focus" onClick={() => setRoute("workspace")}>
        <strong>{WORKSPACE_NAME}</strong>
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

      <button className="status-chip no-native-focus" onClick={() => setRoute("settings")} title={`Active model: ${activeModel.family}`}>
        <span className={`dot ${connection === "ready" ? "dot--success" : "dot--warning"}`} />
        <strong>{activeModel.family}</strong>
      </button>

      <button className="status-chip no-native-focus" onClick={() => setRoute("workspace")} title={hardware.gpu}>
        <Cpu size={12} style={{ color: "var(--text-tertiary)" }} />
        <span>{hardware.ramGb} GB unified</span>
      </button>

      {currentTask.state === "waiting_for_permission" && (
        <span className="badge badge--warning">1 approval waiting</span>
      )}

      <div className="header-divider" />

      <button className="icon-btn no-native-focus" title="Command palette (⌘K)" onClick={() => setCommandPaletteOpen(true)}>
        <Command size={15} />
      </button>
      <ThemeToggle />
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
