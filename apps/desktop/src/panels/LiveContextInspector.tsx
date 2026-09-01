import { useMemo } from "react";
import { FileText, ShieldCheck, ShieldAlert, GitCommitHorizontal, Bot, FlaskConical, Info } from "lucide-react";
import { currentTask, type EventRow } from "@valyria/state";
import { useLive } from "../core/liveStore";
import { useApp } from "../state/store";

/** §4.13 / CORE-INTERFACE G7 — the working set is on the wire now. Each
 *  `context_retrieved` event is the assembler's output for one step:
 *  `{ items:[{ path, reason, trust_level, tokens, score }], budget_used,
 *  budget_total }`. This panel shows the most recent one for the selected task,
 *  with each item's trust level surfaced verbatim — the app never re-derives
 *  trust, it renders what Core assigned (§34). */

type Trust = "policy" | "instruction" | "evidence" | "repo_data" | "model_output";

const TRUST_META: Record<Trust, { label: string; badge: string; icon: React.ReactNode }> = {
  policy: { label: "Policy", badge: "badge--accent", icon: <ShieldCheck size={12} /> },
  instruction: { label: "Authorized instruction", badge: "badge--accent", icon: <ShieldCheck size={12} /> },
  evidence: { label: "Evidence", badge: "badge--info", icon: <FlaskConical size={12} /> },
  repo_data: { label: "Repository data", badge: "badge--neutral", icon: <FileText size={12} /> },
  model_output: { label: "Model output", badge: "badge--warning", icon: <Bot size={12} /> },
};

interface Item {
  path: string;
  reason: string;
  trust: string;
  tokens: number;
  score: number | null;
}
interface WorkingSet {
  seq: number;
  items: Item[];
  budgetUsed: number;
  budgetTotal: number;
}

function latestWorkingSet(events: EventRow[], taskId: string | null): WorkingSet | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind !== "context_retrieved") continue;
    if (taskId && e.taskId !== taskId) continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const rawItems = Array.isArray(p.items) ? p.items : [];
    const items: Item[] = [];
    for (const r of rawItems) {
      if (!r || typeof r !== "object") continue;
      const it = r as Record<string, unknown>;
      if (typeof it.path !== "string") continue;
      items.push({
        path: it.path,
        reason: typeof it.reason === "string" ? it.reason : "",
        trust: typeof it.trust_level === "string" ? it.trust_level : "repo_data",
        tokens: typeof it.tokens === "number" ? it.tokens : 0,
        score: typeof it.score === "number" ? it.score : null,
      });
    }
    return {
      seq: e.seq,
      items,
      budgetUsed: typeof p.budget_used === "number" ? p.budget_used : items.reduce((n, x) => n + x.tokens, 0),
      budgetTotal: typeof p.budget_total === "number" ? p.budget_total : 0,
    };
  }
  return null;
}

export default function LiveContextInspector() {
  const events = useLive((s) => s.store.events);
  const store = useLive((s) => s.store);
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const reveal = useApp((s) => s.reveal);

  const taskId = selectedTaskId || currentTask(store)?.id || null;
  const ws = useMemo(() => latestWorkingSet(events, taskId), [events, taskId]);

  if (!ws) {
    return (
      <div className="panel-empty" style={{ padding: 24 }}>
        <Info size={22} />
        <strong>No working set yet</strong>
        <span>Core emits a <code>context_retrieved</code> event when the assembler builds one for a step.</span>
      </div>
    );
  }

  const pct = ws.budgetTotal > 0 ? Math.min(100, (ws.budgetUsed / ws.budgetTotal) * 100) : 0;
  const hasModelOutput = ws.items.some((i) => i.trust === "model_output");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "0 12px 8px" }}>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          What Valyria retrieved for the current step — {ws.items.length}{" "}
          {ws.items.length === 1 ? "item" : "items"}, newest assembly.
        </p>
      </div>

      <div className="scroll-y" style={{ flex: 1 }}>
        {ws.items.length === 0 ? (
          <div style={{ padding: "10px 12px", fontSize: 11.5, color: "var(--text-tertiary)" }}>
            The assembler returned an empty working set for this step.
          </div>
        ) : (
          ws.items.map((c, i) => {
            const meta = TRUST_META[c.trust as Trust] ?? {
              label: c.trust,
              badge: "badge--neutral",
              icon: <FileText size={12} />,
            };
            return (
              <button
                key={`${c.path}-${i}`}
                className="no-native-focus"
                onClick={() => reveal({ path: c.path, in: "code", reason: c.reason || "in the working set" })}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {c.reason.includes("history") || c.reason.includes("commit") ? (
                    <GitCommitHorizontal size={12} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                  ) : (
                    <FileText size={12} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.path}
                  </span>
                </div>
                {c.reason && (
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3, paddingLeft: 18 }}>
                    {c.reason}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, paddingLeft: 18 }}>
                  <span className={`badge ${meta.badge}`} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    {meta.icon} {meta.label}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{c.tokens.toLocaleString()} tokens</span>
                  {c.score != null && (
                    <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>· score {c.score.toFixed(2)}</span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      <div style={{ padding: "9px 12px", borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>Budget used</span>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
          {ws.budgetUsed.toLocaleString()} / {ws.budgetTotal.toLocaleString()}
        </span>
      </div>
      <div style={{ height: 4, background: "var(--bg-sunken)", margin: "0 12px 10px", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: pct > 90 ? "var(--warning)" : "var(--accent)" }} />
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "0 12px 12px", fontSize: 10, color: "var(--text-tertiary)" }}>
        {hasModelOutput ? (
          <ShieldAlert size={12} style={{ flexShrink: 0, marginTop: 1, color: "var(--warning)" }} />
        ) : (
          <ShieldCheck size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        )}
        <span>
          Trust levels are Core's (<code>policy</code>, <code>instruction</code>, <code>evidence</code>,{" "}
          <code>repo_data</code>, <code>model_output</code>) — the app renders them, it never re-derives trust.
        </span>
      </div>
    </div>
  );
}
