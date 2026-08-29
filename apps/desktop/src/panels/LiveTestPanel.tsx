import { useEffect, useState } from "react";
import {
  CheckCircle2, XCircle, Loader2, CircleDashed, FileCode, ChevronRight,
} from "lucide-react";
import {
  currentTask, eventsForTask, testResultsForTask, type EventRow, type TestRunProjection,
} from "@valyria/state";
import { useLive } from "../core/liveStore";
import { useApp } from "../state/store";

/** The Phase 4 test panel (docs/PLAN.md §4.11): passed / failed / not-run built
 *  from `test_*` events, each failure expandable to Core's captured output and a
 *  jump to the implicated file. No verdict the app invents — a category with no
 *  run reads NOT RUN. */
export default function LiveTestPanel() {
  const store = useLive((s) => s.store);
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const setSelectedFile = useApp((s) => s.setSelectedFile);
  const setDockTab = useApp((s) => s.setDockTab);

  const task = store.tasks[selectedTaskId] ?? currentTask(store);
  const runs = task ? testResultsForTask(store, task.id) : [];
  const events = task ? eventsForTask(store, task.id) : [];

  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const firstFail = runs.find((r) => r.outcome === "failed");
    setOpen((cur) => cur ?? firstFail?.command ?? null);
  }, [runs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) {
    return (
      <div className="panel-empty" style={{ padding: 24 }}>
        <CircleDashed size={22} />
        <strong>No task selected</strong>
        <span>Run a task to see its test activity.</span>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="panel-empty" style={{ padding: 24 }}>
        <CircleDashed size={22} />
        <strong>NOT RUN</strong>
        <span>Core has emitted no verification runs for this task.</span>
      </div>
    );
  }

  const passed = runs.filter((r) => r.outcome === "passed");
  const failed = runs.filter((r) => r.outcome === "failed");
  const running = runs.filter((r) => r.outcome === "started");
  const openRun = runs.find((r) => r.command === open);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <div style={{ width: 320, flexShrink: 0, borderRight: "1px solid var(--border-subtle)", overflowY: "auto" }}>
        <Summary passed={passed.length} failed={failed.length} running={running.length} />
        <Group label="Failed" color="var(--danger)" icon={<XCircle size={13} />} runs={failed} open={open} onOpen={setOpen} />
        <Group label="Passed" color="var(--success)" icon={<CheckCircle2 size={13} />} runs={passed} open={open} onOpen={setOpen} />
        <Group label="Running" color="var(--text-tertiary)" icon={<Loader2 size={13} className="spin" />} runs={running} open={open} onOpen={setOpen} />
      </div>

      <div className="scroll-y" style={{ flex: 1, padding: 16 }}>
        {!openRun ? (
          <div className="panel-empty"><CircleDashed size={22} /><span>Select a run to see its output.</span></div>
        ) : (
          <RunDetail
            run={openRun}
            events={events}
            onJumpFile={(p) => { setSelectedFile(p); setDockTab("diff"); }}
          />
        )}
      </div>
    </div>
  );
}

function Summary({ passed, failed, running }: { passed: number; failed: number; running: number }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "9px 12px", borderBottom: "1px solid var(--border-subtle)", fontSize: 11.5 }}>
      <span style={{ color: "var(--success)" }}>{passed} passed</span>
      <span style={{ color: failed ? "var(--danger)" : "var(--text-tertiary)" }}>{failed} failed</span>
      {running > 0 && <span style={{ color: "var(--text-tertiary)" }}>{running} running</span>}
    </div>
  );
}

function Group({
  label, color, icon, runs, open, onOpen,
}: {
  label: string; color: string; icon: React.ReactNode;
  runs: TestRunProjection[]; open: string | null; onOpen: (c: string) => void;
}) {
  if (runs.length === 0) return null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "var(--bg-sunken)", color, fontSize: 11, fontWeight: 700 }}>
        {icon} {label} ({runs.length})
      </div>
      {runs.map((r) => (
        <button
          key={r.command}
          className="no-native-focus"
          onClick={() => onOpen(r.command)}
          style={{
            display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 12px 6px 22px",
            textAlign: "left", background: open === r.command ? "var(--bg-active)" : "transparent",
          }}
        >
          <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.command}
          </span>
          {r.failureCount != null && r.failureCount > 0 && (
            <span style={{ fontSize: 10, color: "var(--danger)" }}>{r.failureCount}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function RunDetail({
  run, events, onJumpFile,
}: {
  run: TestRunProjection; events: EventRow[]; onJumpFile: (p: string) => void;
}) {
  // Core carries a short `digest` on the VERIFY_RESULT payload; surface it
  // verbatim. The full started-event rationale gives context.
  const started = events.find(
    (e) => e.kind === "test_started" && (e.payload as { command?: string })?.command === run.command,
  );
  const outcomeEvent = events.find(
    (e) =>
      (e.kind === "test_passed" || e.kind === "test_failed" || e.kind === "verification_evidence") &&
      (e.payload as { command?: string })?.command === run.command,
  );
  const digest = (outcomeEvent?.payload as { digest?: string })?.digest;
  const rationale = (started?.payload as { rationale?: string })?.rationale;
  const impliedFile = fileFromEvents(events);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", fontWeight: 600 }}>{run.command}</span>
        <span className={`badge ${run.outcome === "passed" ? "badge--success" : run.outcome === "failed" ? "badge--danger" : "badge--neutral"}`}>
          {run.outcome === "passed" ? "PASS" : run.outcome === "failed" ? "FAIL" : "RUNNING"}
        </span>
        {run.runId && <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>{run.runId}</span>}
      </div>

      {impliedFile && (
        <button
          className="no-native-focus"
          onClick={() => onJumpFile(impliedFile)}
          style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, color: "var(--text-tertiary)", fontSize: 11.5 }}
        >
          <FileCode size={11} /> {impliedFile} <ChevronRight size={11} />
        </button>
      )}

      {digest ? (
        <pre style={{
          marginTop: 12, padding: 12, background: "var(--code-bg)",
          border: `1px solid ${run.outcome === "failed" ? "var(--danger-border)" : "var(--border-subtle)"}`,
          borderRadius: 8, fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-secondary)",
          whiteSpace: "pre-wrap", lineHeight: 1.6,
        }}>{digest}</pre>
      ) : (
        <p style={{ marginTop: 12, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
          Core captured no output digest for this run.
        </p>
      )}

      {rationale && (
        <p style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-tertiary)" }}>
          Why this ran: {rationale}
        </p>
      )}
    </div>
  );
}

/** Last write/edit target in the task — the file a failure most likely implicates. */
function fileFromEvents(events: EventRow[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "file_changed") {
      const p = (e.payload as { path?: unknown })?.path;
      if (typeof p === "string") return p;
    }
  }
  return null;
}
