import { useState } from "react";
import { CheckCircle2, XCircle, CircleDashed, ChevronRight, FileCode } from "lucide-react";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import LiveTestPanel from "./LiveTestPanel";

interface TestRow {
  name: string;
  status: "passed" | "failed" | "skipped" | "not_run";
  file: string;
  duration?: string;
  trace?: string;
}

const rows: TestRow[] = [
  { name: "test_refresh_session_returns_new_pair", status: "passed", file: "tests/auth/test_service.py", duration: "12ms" },
  { name: "test_concurrent_refresh_does_not_duplicate_session", status: "passed", file: "tests/auth/test_service.py", duration: "9ms" },
  { name: "test_expired_session_raises", status: "passed", file: "tests/auth/test_service.py", duration: "4ms" },
  { name: "test_token_pair_issue_seq_increments", status: "passed", file: "tests/auth/test_tokens.py", duration: "3ms" },
  {
    name: "test_webhook_retry_uses_backoff",
    status: "failed",
    file: "tests/test_billing.py",
    duration: "210ms",
    trace: `AssertionError: expected 3 retry attempts, got 1
  at tests/test_billing.py:47 in test_webhook_retry_uses_backoff
      45 |     client.deliver(webhook, attempts=3)
      46 |     assert mock_send.call_count == 3
    > 47 |     assert client.last_backoff_ms > 0
E   AssertionError: assert 0 > 0

not part of this task — pre-existing failure, unrelated to refresh_session()`,
  },
  { name: "test_invoice_pdf_renders", status: "skipped", file: "tests/test_billing.py" },
  { name: "test_full_suite_integration", status: "not_run", file: "tests/integration" },
];

const groups: { key: TestRow["status"]; label: string; icon: React.ReactNode; color: string }[] = [
  { key: "passed", label: "Passed", icon: <CheckCircle2 size={13} />, color: "var(--success)" },
  { key: "failed", label: "Failed", icon: <XCircle size={13} />, color: "var(--danger)" },
  { key: "skipped", label: "Skipped", icon: <CircleDashed size={13} />, color: "var(--text-tertiary)" },
  { key: "not_run", label: "Not run", icon: <CircleDashed size={13} />, color: "var(--text-tertiary)" },
];

export default function TestPanel() {
  const liveSession = useLive((s) => s.session);
  if (liveSession) return <LiveTestPanel />;
  return <MockTestPanel />;
}

function MockTestPanel() {
  const [openTrace, setOpenTrace] = useState<string | null>("test_webhook_retry_uses_backoff");
  const reveal = useApp((s) => s.reveal);
  const setSelectedFile = useApp((s) => s.setSelectedFile);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div style={{ width: 300, flexShrink: 0, borderRight: "1px solid var(--border-subtle)", overflowY: "auto" }}>
        {groups.map((g) => {
          const items = rows.filter((r) => r.status === g.key);
          if (items.length === 0) return null;
          return (
            <div key={g.key}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "var(--bg-sunken)", color: g.color, fontSize: 11, fontWeight: 700 }}>
                {g.icon} {g.label} ({items.length})
              </div>
              {items.map((r) => (
                <button
                  key={r.name}
                  className="no-native-focus"
                  onClick={() => { setOpenTrace(r.name); if (r.trace) setSelectedFile(r.file); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 12px 6px 22px", textAlign: "left",
                    background: openTrace === r.name ? "var(--bg-active)" : "transparent",
                  }}
                >
                  <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                  {r.duration && <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{r.duration}</span>}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="scroll-y" style={{ flex: 1, padding: 16 }}>
        {(() => {
          const row = rows.find((r) => r.name === openTrace);
          if (!row) return <div className="panel-empty"><CircleDashed size={24} /><span>Select a test to see its output.</span></div>;
          return (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 600 }}>{row.name}</span>
                <span className={`badge ${row.status === "passed" ? "badge--success" : row.status === "failed" ? "badge--danger" : "badge--neutral"}`}>{row.status}</span>
              </div>
              <button
                className="no-native-focus"
                onClick={() => reveal({ path: row.file, reason: `implicated by ${row.name}` })}
                style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, color: "var(--text-tertiary)", fontSize: 11.5 }}
              >
                <FileCode size={11} /> {row.file} <ChevronRight size={11} />
              </button>
              {row.trace ? (
                <pre style={{
                  marginTop: 12, padding: 12, background: "var(--code-bg)", border: "1px solid var(--danger-border)",
                  borderRadius: 8, fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.6,
                }}>{row.trace}</pre>
              ) : (
                <p style={{ marginTop: 12, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>No output captured for this run.</p>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
