import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, MessageSquare, GitCompareArrows, TerminalSquare, FlaskConical,
  Boxes, ShieldCheck, Settings, Sparkles, ListChecks,
} from "lucide-react";
import { useApp } from "../state/store";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

export default function CommandPalette() {
  const open = useApp((s) => s.commandPaletteOpen);
  const setOpen = useApp((s) => s.setCommandPaletteOpen);
  const setRoute = useApp((s) => s.setRoute);
  const setCenterTab = useApp((s) => s.setCenterTab);
  const setDockTab = useApp((s) => s.setDockTab);
  const setSidebarSection = useApp((s) => s.setSidebarSection);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Cmd[] = useMemo(() => [
    { id: "chat", label: "Go to Agent chat", icon: <MessageSquare size={14} />, run: () => setCenterTab("chat") },
    { id: "task", label: "Go to Task panel", icon: <ListChecks size={14} />, run: () => setCenterTab("task") },
    { id: "diff", label: "Show diff", icon: <GitCompareArrows size={14} />, run: () => setDockTab("diff") },
    { id: "tests", label: "Show tests", icon: <FlaskConical size={14} />, run: () => setDockTab("tests") },
    { id: "terminal", label: "Open terminal", icon: <TerminalSquare size={14} />, run: () => setDockTab("terminal") },
    { id: "models", label: "Open Model Manager", icon: <Boxes size={14} />, run: () => setSidebarSection("models") },
    { id: "settings-security", label: "Open Security settings", icon: <ShieldCheck size={14} />, run: () => setRoute("settings") },
    { id: "settings", label: "Open Settings", icon: <Settings size={14} />, run: () => setRoute("settings") },
    { id: "first-run", label: "Replay first-run experience", icon: <Sparkles size={14} />, run: () => setRoute("first-run") },
  ], [setCenterTab, setDockTab, setSidebarSection, setRoute]);

  const filtered = commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); filtered[active]?.run(); setOpen(false); }
  }

  return (
    <div
      role="presentation"
      onClick={() => setOpen(false)}
      style={{ position: "fixed", inset: 0, background: "var(--bg-overlay)", zIndex: 300, display: "flex", justifyContent: "center", paddingTop: "12vh" }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480, maxHeight: "60vh", background: "var(--bg-surface-raised)", borderRadius: 12, boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
          <Search size={15} style={{ color: "var(--text-tertiary)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            aria-label="Command"
            className="no-native-focus"
            style={{ flex: 1, background: "transparent", border: "none", fontSize: "var(--text-sm)" }}
          />
          <kbd style={{ fontSize: 10, color: "var(--text-tertiary)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px" }}>Esc</kbd>
        </div>
        <div className="scroll-y" style={{ padding: 6 }}>
          {filtered.length === 0 && <div style={{ padding: 14, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>No matching commands.</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className="no-native-focus"
              onClick={() => { c.run(); setOpen(false); }}
              onMouseEnter={() => setActive(i)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px", borderRadius: 7,
                fontSize: "var(--text-sm)", textAlign: "left",
                background: active === i ? "var(--bg-active)" : "transparent",
                color: active === i ? "var(--accent-strong)" : "var(--text-primary)",
              }}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
