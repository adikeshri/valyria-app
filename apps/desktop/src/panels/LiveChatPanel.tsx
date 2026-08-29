import { useState } from "react";
import { ArrowUp, Sparkles, Loader2 } from "lucide-react";
import { activityLine, currentTask, timelineRows } from "@valyria/state";
import { useLive } from "../core/liveStore";
import { isActive, hhmm } from "../core/view";
import LiveApprovalCard from "../components/LiveApprovalCard";

/** Chat is a task-entry surface, not a chatbot (PLAN §4.5). A submitted message
 *  becomes `task_create { objective }` and the conversation view is a
 *  projection of that task's events. No local prompt assembly. */
export default function LiveChatPanel() {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const store = useLive((s) => s.store);
  const createTask = useLive((s) => s.createTask);

  const task = currentTask(store);
  const events = task
    ? timelineRows(store).filter((e) => e.taskId === task.id).reverse()
    : [];
  const working = task ? isActive(task.state) : false;

  const send = async () => {
    const objective = draft.trim();
    if (!objective || submitting) return;
    setSubmitting(true);
    setDraft("");
    await createTask(objective);
    setSubmitting(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="scroll-y" style={{ flex: 1, padding: "14px 16px 0" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {task && (
            <Bubble role="user" text={task.objective ?? "(objective pending)"} ts="" />
          )}

          {events.map((e) => (
            <div key={e.seq} style={{ paddingLeft: 36, fontSize: "var(--text-sm)", color: e.degraded ? "var(--text-tertiary)" : "var(--text-secondary)", display: "flex", gap: 8, alignItems: "baseline" }}>
              <span>{e.degraded ? e.kind.replace(/_/g, " ") : activityLine(e)}</span>
              <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{hhmm(e.ts)}</span>
            </div>
          ))}

          {task && <LiveApprovalCard taskId={task.id} />}

          {working && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-tertiary)", fontSize: "var(--text-sm)", paddingLeft: 36 }}>
              <Loader2 size={13} className="spin" />
              {task && task.state === "waiting_for_permission" ? "Paused — waiting on the approval above." : "Working…"}
            </div>
          )}

          {!task && (
            <div className="panel-empty" style={{ padding: 20 }}>
              <Sparkles size={20} style={{ color: "var(--accent)" }} />
              <strong>Start a task</strong>
              <span>Describe a change and Valyria will plan, edit, run and verify it.</span>
            </div>
          )}
          <div style={{ height: 10 }} />
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "10px 16px 14px", background: "var(--bg-surface)" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-canvas)", padding: "8px 8px 8px 12px" }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
              }}
              placeholder="Ask Valyria to fix a bug, add a feature, explain the architecture…  (⌘↵ to send)"
              aria-label="Task objective"
              rows={2}
              className="no-native-focus"
              style={{ width: "100%", resize: "none", background: "transparent", border: "none", fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.5 }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: 4, gap: 8 }}>
              <button className="btn btn--primary btn--icon no-native-focus" title="Send (⌘↵)" disabled={!draft.trim() || submitting} onClick={() => void send()}>
                {submitting ? <Loader2 size={14} className="spin" /> : <ArrowUp size={14} />}
              </button>
            </div>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 6, textAlign: "center" }}>
            This becomes a structured task — the exact text sent is what you typed.
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, text, ts }: { role: "user" | "agent"; text: string; ts: string }) {
  return (
    <div style={{ display: "flex", gap: 10, flexDirection: role === "user" ? "row-reverse" : "row" }}>
      <div style={{
        width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: role === "user" ? "var(--bg-sunken)" : "linear-gradient(135deg, var(--accent), #f2a13c 130%)",
        color: role === "user" ? "var(--text-secondary)" : "white", fontSize: 11, fontWeight: 700,
      }}>
        {role === "user" ? "Y" : <Sparkles size={13} />}
      </div>
      <div style={{
        maxWidth: "82%", padding: "9px 13px", borderRadius: 12,
        background: role === "user" ? "var(--accent-soft)" : "var(--bg-surface)",
        border: role === "user" ? "1px solid transparent" : "1px solid var(--border-subtle)",
      }}>
        <p style={{ fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>{text}</p>
        {ts && <span style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 5, display: "block" }}>{ts}</span>}
      </div>
    </div>
  );
}
