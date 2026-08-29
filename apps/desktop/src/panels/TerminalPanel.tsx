import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { User, Sparkles, TerminalSquare } from "lucide-react";
import { WORKSPACE_NAME, terminalUserLines } from "../data/mock";
import { useApp, type TerminalSub } from "../state/store";
import { useLive } from "../core/liveStore";
import LiveTerminalPanel from "./LiveTerminalPanel";
import LiveAgentCommands from "./LiveAgentCommands";

type Sub = TerminalSub;

const MOCK_RESPONSES: Record<string, string[]> = {
  "git status": terminalUserLines.slice(1),
  ls: ["AGENTS.md   README.md   pyproject.toml   src   tests"],
  "ls -la": ["drwxr-xr-x  src", "drwxr-xr-x  tests", "-rw-r--r--  AGENTS.md", "-rw-r--r--  pyproject.toml"],
  pwd: [`/Users/you/dev/${WORKSPACE_NAME}`],
  clear: [],
};

function MockHumanTerminal() {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const lineBuf = useRef("");

  useEffect(() => {
    if (!ref.current || termRef.current) return;
    const term = new XTerm({
      convertEol: true,
      fontFamily: "SF Mono, JetBrains Mono, ui-monospace, Menlo, monospace",
      fontSize: 12.5,
      cursorBlink: true,
      theme: {
        background: getComputedStyle(document.documentElement).getPropertyValue("--term-bg").trim() || "#0a0a0e",
        foreground: getComputedStyle(document.documentElement).getPropertyValue("--term-fg").trim() || "#e8e8ee",
        cursor: "#e08a4a",
      },
      scrollback: 2000,
    });
    term.open(ref.current);
    termRef.current = term;

    const prompt = () => term.write(`\r\n\x1b[38;2;15;157;140m${WORKSPACE_NAME}\x1b[0m \x1b[2m❯\x1b[0m `);
    term.writeln(`Valyria integrated terminal — ${WORKSPACE_NAME}`);
    term.writeln("Sample shell (no workspace open). Commands you run here are yours, not the agent's.");
    prompt();

    term.onData((data) => {
      const code = data.charCodeAt(0);
      if (data === "\r") {
        const cmd = lineBuf.current.trim();
        lineBuf.current = "";
        if (cmd === "clear") {
          term.clear();
          prompt();
          return;
        }
        const out = MOCK_RESPONSES[cmd];
        if (out) {
          out.forEach((l) => term.write(`\r\n${l}`));
        } else if (cmd) {
          term.write(`\r\nzsh: command not available in this preview: ${cmd}`);
        }
        prompt();
      } else if (code === 127) {
        if (lineBuf.current.length > 0) {
          lineBuf.current = lineBuf.current.slice(0, -1);
          term.write("\b \b");
        }
      } else if (code < 32) {
        // ignore other control chars in this mock shell
      } else {
        lineBuf.current += data;
        term.write(data);
      }
    });

    const resize = () => {
      const cols = Math.max(20, Math.floor((ref.current?.clientWidth ?? 600) / 7.3));
      const rows = Math.max(6, Math.floor((ref.current?.clientHeight ?? 200) / 18));
      term.resize(cols, rows);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(ref.current);
    return () => { ro.disconnect(); term.dispose(); termRef.current = null; };
  }, []);

  return <div ref={ref} style={{ height: "100%", padding: "6px 4px 0 8px" }} />;
}

function MockAgentCommandLog() {
  const commands = [
    { cmd: "ruff format --check src tests", output: "4 files already formatted", ok: true },
    { cmd: "ruff check src tests", output: "All checks passed!", ok: true },
    { cmd: "pytest tests/auth -q", output: "............\n12 passed in 1.84s", ok: true },
  ];
  return (
    <div className="scroll-y" style={{ height: "100%", padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-tertiary)", fontSize: 11, marginBottom: 10 }}>
        <Sparkles size={12} /> Read-only — commands the agent ran as tool invocations, not your shell.
      </div>
      {commands.map((c, i) => (
        <div key={i} style={{ marginBottom: 12, paddingLeft: 10, borderLeft: "2px solid var(--accent)" }}>
          <div style={{ color: "var(--accent-strong)" }}>$ {c.cmd}</div>
          <div style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{c.output}</div>
        </div>
      ))}
    </div>
  );
}

const SUBS: { key: Sub; label: string; icon: React.ReactNode; accent: string }[] = [
  { key: "human", label: "Your Terminal", icon: <User size={12} />, accent: "var(--own-user)" },
  { key: "agent", label: "Agent Commands", icon: <TerminalSquare size={12} />, accent: "var(--accent-strong)" },
];

/** The dock Terminal panel. The human/agent split is a real tablist — it is the
 *  one place in the app where confusing the two panes is a security problem
 *  (D7), so it gets roles and arrow-key navigation the other dock strips don't.
 *  Each sub-tab dispatches to its live surface when a workspace is open, and to
 *  a sample one otherwise (the Phase 2–6 mock/Live pattern). */
export default function TerminalPanel() {
  const sub = useApp((s) => s.terminalSub);
  const setSub = useApp((s) => s.setTerminalSub);
  const liveSession = useLive((s) => s.session);
  const tabsRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = SUBS.findIndex((s) => s.key === sub);
    const next = e.key === "ArrowRight" ? (i + 1) % SUBS.length : (i - 1 + SUBS.length) % SUBS.length;
    setSub(SUBS[next]!.key);
    tabsRef.current?.querySelector<HTMLButtonElement>(`#term-tab-${SUBS[next]!.key}`)?.focus();
  };

  const focusTabs = () =>
    tabsRef.current?.querySelector<HTMLButtonElement>(`#term-tab-${sub}`)?.focus();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--term-bg)" }}>
      <div
        ref={tabsRef}
        role="tablist"
        aria-label="Terminal panes"
        onKeyDown={onKeyDown}
        style={{ display: "flex", gap: 2, padding: "6px 8px 0", flexShrink: 0 }}
      >
        {SUBS.map((s) => {
          const active = sub === s.key;
          return (
            <button
              key={s.key}
              id={`term-tab-${s.key}`}
              role="tab"
              aria-selected={active}
              aria-controls={`term-panel-${s.key}`}
              tabIndex={active ? 0 : -1}
              className="no-native-focus"
              onClick={() => setSub(s.key)}
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "6px 6px 0 0",
                fontSize: 11.5, fontWeight: 600,
                background: active ? "var(--bg-surface)" : "transparent",
                color: active ? s.accent : "var(--text-tertiary)",
              }}
            >
              {s.icon} {s.label}
            </button>
          );
        })}
      </div>
      <div
        id={`term-panel-${sub}`}
        role="tabpanel"
        aria-labelledby={`term-tab-${sub}`}
        style={{ flex: 1, minHeight: 0, background: sub === "human" ? "var(--term-bg)" : "var(--bg-surface)" }}
      >
        {sub === "human" ? (
          liveSession ? <LiveTerminalPanel onEscape={focusTabs} /> : <MockHumanTerminal />
        ) : liveSession ? (
          <LiveAgentCommands />
        ) : (
          <MockAgentCommandLog />
        )}
      </div>
    </div>
  );
}
