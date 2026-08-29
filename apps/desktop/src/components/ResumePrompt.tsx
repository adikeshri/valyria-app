import { RotateCcw, Eye, Trash2, X } from "lucide-react";
import { activeTasks } from "@valyria/state";
import { useLive } from "../core/liveStore";
import { useApp } from "../state/store";

/** On launch, any task left in a non-terminal state gets the PLAN §4.16
 *  Resume / Inspect / Discard prompt. State recovery is entirely Core's
 *  (`task_resume` / `task_cancel`); the app only asks. */
export default function ResumePrompt() {
  const session = useLive((s) => s.session);
  const store = useLive((s) => s.store);
  const dismissed = useLive((s) => s.resumePromptDismissed);
  const dismiss = useLive((s) => s.dismissResumePrompt);
  const resumeTask = useLive((s) => s.resumeTask);
  const cancelTask = useLive((s) => s.cancelTask);
  const setSelectedTaskId = useApp((s) => s.setSelectedTaskId);
  const setCenterTab = useApp((s) => s.setCenterTab);

  if (!session || dismissed) return null;
  const pending = activeTasks(store);
  if (pending.length === 0) return null;

  return (
    <div style={{
      borderBottom: "1px solid var(--warning-border)",
      background: "var(--warning-bg)",
      padding: "8px 14px",
      fontSize: "var(--text-sm)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: pending.length ? 6 : 0 }}>
        <strong style={{ flex: 1 }}>
          {pending.length} task{pending.length === 1 ? "" : "s"} still running from a previous session
        </strong>
        <button className="no-native-focus" title="Dismiss" onClick={dismiss} style={{ color: "var(--text-tertiary)" }}>
          <X size={14} />
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {pending.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t.objective ?? t.id} <span style={{ color: "var(--text-tertiary)" }}>· {t.state}</span>
            </span>
            <button className="btn btn--sm" onClick={() => void resumeTask(t.id)}><RotateCcw size={12} /> Resume</button>
            <button className="btn btn--sm btn--ghost" onClick={() => { setSelectedTaskId(t.id); setCenterTab("task"); dismiss(); }}><Eye size={12} /> Inspect</button>
            <button className="btn btn--sm btn--danger" onClick={() => void cancelTask(t.id)}><Trash2 size={12} /> Discard</button>
          </div>
        ))}
      </div>
    </div>
  );
}
