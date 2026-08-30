import { Bot, CircleDashed, Loader2 } from "lucide-react";
import { agentCommandsForTask, currentTask, type AgentCommand } from "@valyria/state";
import { useLive } from "../core/liveStore";
import { useApp } from "../state/store";

/** The Phase 7 agent-command view (docs/PLAN.md §4.10 / D7): a read-only
 *  projection of `tool_started` / `tool_completed` for the selected task. It is
 *  a plain list — never an xterm, never the human shell's buffer, and it
 *  imports none of the terminal plumbing. `xtask check-d7` enforces that. */
export default function LiveAgentCommands() {
  const store = useLive((s) => s.store);
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const task = store.tasks[selectedTaskId] ?? currentTask(store);
  const cmds = task ? agentCommandsForTask(store, task.id) : [];

  return (
    <div
      className="scroll-y"
      style={{ height: "100%", background: "var(--bg-surface)" }}
      role="region"
      aria-label="Commands the agent ran"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 14px",
          fontSize: 11,
          color: "var(--text-tertiary)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <Bot size={12} style={{ color: "var(--term-agent-strip)" }} />
        Read-only — commands the agent ran as tool invocations, not your shell.
      </div>

      {!task ? (
        <Empty label="No task selected" hint="Run a task to see the commands the agent ran." />
      ) : cmds.length === 0 ? (
        <Empty
          label="No commands yet"
          hint="Core has emitted no shell tool calls for this task."
        />
      ) : (
        <div style={{ padding: "8px 0" }}>
          {cmds.map((c) => (
            <CommandRow key={c.seq} cmd={c} />
          ))}
          <p style={{ padding: "6px 14px 2px", fontSize: 10, color: "var(--text-tertiary)" }}>
            {cmds.some((c) => c.invocationId)
              ? "Paired by Core's tool_invocation_id; stdout / stderr / exit code are Core's structured fields (CORE-INTERFACE G14)."
              : "This task predates structured tool results — pairing and output split are best-effort off the pre-formatted blob (CORE-INTERFACE G14)."}
          </p>
        </div>
      )}
    </div>
  );
}

function CommandRow({ cmd }: { cmd: AgentCommand }) {
  const line = [cmd.program, ...cmd.args].join(" ").trim() || "(command not reported)";
  return (
    <div
      style={{
        margin: "0 0 10px",
        padding: "2px 14px 2px 12px",
        borderLeft: "2px solid var(--term-agent-strip)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--accent-strong)", flex: 1, wordBreak: "break-all" }}>
          $ {line}
        </span>
        <Status cmd={cmd} />
      </div>
      {cmd.raw != null ? (
        <Pre text={cmd.raw} />
      ) : (
        <>
          {cmd.stdout ? <Pre text={cmd.stdout} /> : null}
          {cmd.stderr ? <Pre text={cmd.stderr} tone="err" /> : null}
        </>
      )}
    </div>
  );
}

function Status({ cmd }: { cmd: AgentCommand }) {
  if (cmd.pending) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-tertiary)", fontSize: 10 }}>
        <Loader2 size={11} className="spin" /> running
      </span>
    );
  }
  const ok = cmd.succeeded !== false && (cmd.exitCode == null || cmd.exitCode === 0);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {cmd.durationMs != null && (
        <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{fmtDuration(cmd.durationMs)}</span>
      )}
      <span className={`badge ${ok ? "badge--success" : "badge--danger"}`} style={{ fontSize: 10 }}>
        {cmd.exitCode != null ? `exit ${cmd.exitCode}` : ok ? "ok" : "failed"}
      </span>
    </span>
  );
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function Pre({ text, tone }: { text: string; tone?: "err" }) {
  return (
    <pre
      style={{
        margin: "6px 0 0",
        padding: "8px 10px",
        background: "var(--code-bg)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 6,
        fontSize: 11.5,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: tone === "err" ? "var(--danger)" : "var(--text-secondary)",
      }}
    >
      {text}
    </pre>
  );
}

function Empty({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="panel-empty" style={{ padding: 24 }}>
      <CircleDashed size={22} />
      <strong>{label}</strong>
      <span>{hint}</span>
    </div>
  );
}
