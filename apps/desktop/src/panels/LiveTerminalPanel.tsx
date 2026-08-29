import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { AlertTriangle } from "lucide-react";
import { pty } from "../core/pty";
import { useApp } from "../state/store";

/** The Phase 7 human terminal (docs/PLAN.md §4.10 / §18): a real shell hosted
 *  in valyria-bridge, bound to the authorized workspace root. This is the ONLY
 *  file allowed to import `@xterm/xterm` besides the mock — the agent-command
 *  view is a plain list and never shares a buffer with it (D7, enforced by
 *  `xtask check-d7`). Unmounting (a dock tab switch) tears down the xterm but
 *  leaves the shell running; `pty.open` replays scrollback on the next mount. */

const FONT_SIZE = 12.5;

function mono(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
    '"SF Mono", ui-monospace, Menlo, monospace'
  );
}

function readTermTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--term-bg", "#17171d"),
    foreground: v("--term-fg", "#e8e8ee"),
    cursor: v("--term-user-strip", "#0f9d8c"),
    selectionBackground: v("--code-selection", "rgba(98, 62, 245, 0.16)"),
  };
}

/** Measure one monospace cell so cols/rows track the real font, not a magic
 *  divisor. xterm's own FitAddon is still on an xterm-5 peer range, so this
 *  stays dependency-free. */
function measureCell(fontFamily: string, px: number): { w: number; h: number } {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;top:-9999px;left:-9999px;visibility:hidden;white-space:pre;font-family:${fontFamily};font-size:${px}px`;
  probe.textContent = "M".repeat(64);
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 64;
  document.body.removeChild(probe);
  return { w: w || px * 0.6, h: Math.ceil(px) };
}

export default function LiveTerminalPanel({ onEscape }: { onEscape?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const cellRef = useRef<{ w: number; h: number } | null>(null);
  const lastEscRef = useRef(0);
  const theme = useApp((s) => s.theme);
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || termRef.current) return;
    let disposed = false;
    const unsubs: Array<() => void> = [];
    const family = mono();

    const term = new XTerm({
      convertEol: false, // a real PTY emits its own CRLF
      fontFamily: family,
      fontSize: FONT_SIZE,
      cursorBlink: true,
      theme: readTermTheme(),
      scrollback: 5000,
    });
    term.open(host);
    termRef.current = term;
    cellRef.current = measureCell(family, FONT_SIZE);

    const applySize = (): { cols: number; rows: number } => {
      const { w, h } = cellRef.current!;
      const cols = Math.max(2, Math.floor(host.clientWidth / w));
      const rows = Math.max(1, Math.floor(host.clientHeight / h));
      if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
      return { cols, rows };
    };

    void (async () => {
      const { cols, rows } = applySize();
      try {
        const snapshot = await pty.open(cols, rows);
        if (disposed) return;
        if (snapshot) term.write(snapshot);
        term.focus();
      } catch (e) {
        if (!disposed) setError(String(e));
        return;
      }
      unsubs.push(await pty.onOutput((chunk) => term.write(chunk)));
      unsubs.push(
        await pty.onExit((code) => {
          term.write(`\r\n\x1b[2m[shell exited${code == null ? "" : ` (${code})`}]\x1b[0m\r\n`);
          setExited(true);
        }),
      );
    })();

    const dataSub = term.onData((d) => {
      // Double-Escape leaves the terminal for the tab strip (D10) without
      // stealing a single Escape from vim / less running inside the shell.
      if (d === "\x1b") {
        const now = Date.now();
        if (now - lastEscRef.current < 450) {
          lastEscRef.current = 0;
          onEscape?.();
          return;
        }
        lastEscRef.current = now;
      }
      void pty.write(d);
    });

    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const { cols, rows } = applySize();
        void pty.resize(cols, rows);
      });
    });
    ro.observe(host);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      dataSub.dispose();
      unsubs.forEach((u) => u());
      term.dispose();
      termRef.current = null;
      // No pty.close(): the shell outlives this panel.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // xterm snapshots colors at construction; re-read them when the theme flips
  // (explicit toggle or a system light/dark change under "system").
  useEffect(() => {
    const apply = () => {
      if (termRef.current) termRef.current.options.theme = readTermTheme();
    };
    const id = requestAnimationFrame(apply);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => {
      cancelAnimationFrame(id);
      mq.removeEventListener("change", apply);
    };
  }, [theme]);

  if (error) {
    return (
      <div className="panel-empty" style={{ padding: 24 }}>
        <AlertTriangle size={22} style={{ color: "var(--danger)" }} />
        <strong>Could not start a shell</strong>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{error}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        ref={hostRef}
        role="application"
        aria-label="Workspace shell — a real terminal you type into"
        tabIndex={0}
        style={{ flex: 1, minHeight: 0, padding: "6px 4px 0 8px", background: "var(--term-bg)" }}
      />
      <div
        style={{
          flexShrink: 0,
          padding: "3px 10px",
          fontSize: 10,
          color: "var(--text-tertiary)",
          background: "var(--term-bg)",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        {exited ? "Shell ended — switch away and back to start a new one. " : ""}
        Your shell · press Esc twice to return to the tabs
      </div>
    </div>
  );
}
