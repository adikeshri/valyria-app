import { useState } from "react";
import { Paperclip, ArrowUp, Sparkles, Loader2, X, FileCode, GitCompareArrows, Terminal as TerminalIcon } from "lucide-react";
import { currentTask } from "../data/mock";
import ApprovalCard from "../components/ApprovalCard";
import { useApp } from "../state/store";

const attachOptions = [
  { label: "src/auth/service.py", icon: <FileCode size={12} /> },
  { label: "Git changes (4 files)", icon: <GitCompareArrows size={12} /> },
  { label: "Terminal output", icon: <TerminalIcon size={12} /> },
];

export default function ChatPanel() {
  const [draft, setDraft] = useState("");
  const [attached, setAttached] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const approvalOpen = useApp((s) => s.approvalOpen);

  const isWorking = currentTask.state === "running" || currentTask.state === "verifying" || currentTask.state === "repairing";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="scroll-y" style={{ flex: 1, padding: "14px 16px 0" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {currentTask.chat.map((m) => (
            <div key={m.id} style={{ display: "flex", gap: 10, flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
              <div style={{
                width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: m.role === "user" ? "var(--bg-sunken)" : "linear-gradient(135deg, var(--accent), #f2a13c 130%)",
                color: m.role === "user" ? "var(--text-secondary)" : "white",
                fontSize: 11, fontWeight: 700,
              }}>
                {m.role === "user" ? "Y" : <Sparkles size={13} />}
              </div>
              <div style={{
                maxWidth: "82%", padding: "9px 13px", borderRadius: 12,
                background: m.role === "user" ? "var(--accent-soft)" : "var(--bg-surface)",
                border: m.role === "user" ? "1px solid transparent" : "1px solid var(--border-subtle)",
                boxShadow: m.role === "user" ? "none" : "var(--shadow-sm)",
              }}>
                <p style={{ fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>{m.text}</p>
                <span style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 5, display: "block" }}>{m.ts}</span>
              </div>
            </div>
          ))}

          {currentTask.pendingApproval && <ApprovalCard approval={currentTask.pendingApproval} />}

          {isWorking && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-tertiary)", fontSize: "var(--text-sm)", paddingLeft: 36 }}>
              <Loader2 size={13} className="spin" /> Working…
            </div>
          )}
          <div style={{ height: 10 }} />
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "10px 16px 14px", background: "var(--bg-surface)" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {attached.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {attached.map((a) => (
                <span key={a} className="badge badge--neutral" style={{ gap: 5 }}>
                  {a}
                  <button className="no-native-focus" onClick={() => setAttached((s) => s.filter((x) => x !== a))} style={{ display: "flex" }}>
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div style={{
            border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-canvas)",
            padding: "8px 8px 8px 12px", position: "relative",
          }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask Valyria to fix a bug, add a feature, explain the architecture…"
              aria-label="Task objective"
              rows={2}
              className="no-native-focus"
              style={{
                width: "100%", resize: "none", background: "transparent", border: "none",
                fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.5,
              }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
              <div style={{ position: "relative" }}>
                <button className="btn btn--sm btn--ghost" onClick={() => setPickerOpen((o) => !o)}>
                  <Paperclip size={12} /> Add context
                </button>
                {pickerOpen && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", left: 0, width: 220,
                    background: "var(--bg-surface-raised)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "var(--shadow-md)", padding: 4, zIndex: 10,
                  }}>
                    {attachOptions.map((o) => (
                      <button
                        key={o.label}
                        className="no-native-focus"
                        onClick={() => { setAttached((s) => Array.from(new Set([...s, o.label]))); setPickerOpen(false); }}
                        style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "6px 8px", fontSize: "var(--text-xs)", borderRadius: 5, textAlign: "left" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        {o.icon} {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>Assisted mode</span>
                <button className="btn btn--primary btn--icon no-native-focus" title="Send" disabled={!draft.trim()}>
                  <ArrowUp size={14} />
                </button>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 6, textAlign: "center" }}>
            {approvalOpen ? "The agent is paused, waiting on the approval above." : "This becomes a structured task — not a freeform chat."}
          </div>
        </div>
      </div>
    </div>
  );
}
