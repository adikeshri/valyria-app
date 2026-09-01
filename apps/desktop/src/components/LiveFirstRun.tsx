import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Sparkles, FolderOpen, CheckCircle2, Loader2, ArrowRight, Check,
  AlertTriangle, XCircle, HelpCircle, Server,
} from "lucide-react";
import { currentTask, eventsForTask } from "@valyria/state";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import { bridge, type DoctorCheck } from "../core/bridge";
import { useOverlayA11y } from "../core/useOverlayA11y";
import logoFull from "../assets/logo-full.png";

export const FIRST_RUN_LS_KEY = "valyria.seenFirstRun";

type Step = "welcome" | "environment" | "workspace" | "prove" | "ready";
const order: Step[] = ["welcome", "environment", "workspace", "prove", "ready"];

/** §4.13 / docs/INTEGRATION.md §5 — the runtime needs nothing installed. This
 *  wizard runs Core's real `doctor_run`, opens a repository (an explicit
 *  authorization act), and runs one harmless read-only task to prove the stack
 *  works end to end. There is **no model-install step** — the first release
 *  ships on Core's built-in offline model (D-INT-2), and the app never
 *  downloads a model (D-INT-3). */
export default function LiveFirstRun() {
  const setRoute = useApp((s) => s.setRoute);
  const session = useLive((s) => s.session);
  const openWorkspace = useLive((s) => s.openWorkspace);
  const createTask = useLive((s) => s.createTask);
  const store = useLive((s) => s.store);
  const connection = useLive((s) => s.connection);

  const [step, setStep] = useState<Step>("welcome");
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [root, setRoot] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [rec, setRec] = useState<import("../core/bridge").ModelCandidate | null | undefined>(
    undefined,
  );
  const [installing, setInstalling] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  useOverlayA11y(rootRef, () => finish());

  const idx = order.indexOf(step);
  function finish() {
    try {
      localStorage.setItem(FIRST_RUN_LS_KEY, "1");
    } catch {
      /* ignore */
    }
    setRoute("workspace");
  }

  // Environment step: run doctor once a session exists.
  useEffect(() => {
    if (step !== "environment" || !session || checks) return;
    bridge.doctorRun().then((r) => setChecks(r.checks)).catch(() => setChecks([]));
  }, [step, session, checks]);

  // Prove step: kick off the harmless task.
  useEffect(() => {
    if (step !== "prove" || !session || taskId) return;
    void createTask("Summarize the top-level modules of this repository.").then((id) => setTaskId(id));
  }, [step, session, taskId, createTask]);

  // Ready step: ask Core which model fits this machine (G4). Its scoring,
  // not a heuristic — the wizard only renders the answer.
  useEffect(() => {
    if (step !== "ready" || !session || rec !== undefined) return;
    void bridge
      .modelRecommend("primary_coder")
      .then((r) => setRec(r.recommended ?? r.candidates[0] ?? null))
      .catch(() => setRec(null));
  }, [step, session, rec]);

  const provedTask = useMemo(() => {
    if (!taskId) return null;
    return store.tasks[taskId] ?? currentTask(store) ?? null;
  }, [store, taskId]);
  const proved = provedTask?.state === "completed";

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label="First-run setup" style={{ position: "fixed", inset: 0, background: "var(--bg-canvas)", zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: "100%", maxWidth: 640, padding: "48px 24px", display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 36 }}>
          {order.map((s, i) => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= idx ? "var(--accent)" : "var(--bg-hover)" }} />
          ))}
        </div>

        {step === "welcome" && (
          <Shell title="Welcome to Valyria" subtitle="A local-first autonomous software engineer.">
            <img src={logoFull} alt="Valyria" style={{ height: 72, width: "auto", display: "block", marginBottom: 24 }} />
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.7 }}>
              The Valyria runtime is already inside this app — no toolchain, no package manager, no download. It runs
              entirely on this machine.
            </p>
            <ul style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              <li>• Check the environment with Core's own diagnostics</li>
              <li>• Open a repository — an explicit authorization</li>
              <li>• Run one harmless task to prove the whole stack works</li>
            </ul>
            <p style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 14 }}>
              You'll start on Core's built-in offline model. Adding a real model is a later, deliberate step from the
              Models tab.
            </p>
          </Shell>
        )}

        {step === "environment" && (
          <Shell title="Environment check" subtitle="Core's own diagnostics — nothing to install.">
            {!session ? (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                Open a workspace first — the checks run against its Core daemon. Skip ahead and come back.
              </p>
            ) : !checks ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
                <Loader2 size={14} className="spin" /> Running checks…
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {checks.map((c) => (
                  <div key={c.name} style={{ display: "flex", gap: 10, padding: "9px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
                    <span style={{ marginTop: 1 }}>{icon(c.status)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "var(--text-sm)", fontWeight: 550 }}>{c.name}</div>
                      {c.detail && <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{c.detail}</div>}
                      {c.remediation && <div style={{ fontSize: 11, color: "var(--warning)" }}>{c.remediation}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Shell>
        )}

        {step === "workspace" && (
          <Shell title="Open a repository" subtitle="Valyria only reads and writes inside the folder you choose.">
            <button
              className="btn btn--primary"
              disabled={connection === "connecting"}
              onClick={async () => {
                const picked = await open({ directory: true, multiple: false, title: "Open a repository" });
                if (typeof picked === "string") {
                  setRoot(picked);
                  void openWorkspace(picked);
                }
              }}
            >
              <FolderOpen size={14} /> {connection === "connecting" ? "Starting Core…" : session ? "Choose a different folder" : "Choose folder…"}
            </button>
            <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: "10px 0 4px" }}>or paste a path</p>
            <input
              aria-label="Workspace root path"
              value={root}
              placeholder="/absolute/path/to/a/git/repo"
              spellCheck={false}
              onChange={(e) => setRoot(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && root.trim() && void openWorkspace(root.trim())}
              style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12, padding: "8px 10px", border: "1px solid var(--border-strong)", borderRadius: 6, background: "var(--bg-surface)", color: "var(--text-primary)" }}
            />
            <button
              className="btn"
              style={{ marginTop: 10 }}
              disabled={!root.trim() || connection === "connecting"}
              onClick={() => void openWorkspace(root.trim())}
            >
              {connection === "connecting" ? "Starting Core…" : session ? "Reopen" : "Open this path"}
            </button>
            {session && (
              <p style={{ fontSize: 11.5, color: "var(--success)", marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <Check size={13} /> Connected to Core {session.runtime_version} · {session.origin}
              </p>
            )}
          </Shell>
        )}

        {step === "prove" && (
          <Shell title="A harmless test run" subtitle="Proving the stack works end to end.">
            {!session ? (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>Open a workspace first.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Row label={'Task: "summarize the top-level modules"'} done={!!provedTask} icon={<Sparkles size={14} />} />
                <Row label="Streaming events from Core" done={(provedTask?.lastSeq ?? 0) > 0} icon={<Server size={14} />} />
                <Row label="Task completed" done={proved} icon={<CheckCircle2 size={14} />} />
                {provedTask?.state === "failed" && (
                  <p style={{ fontSize: 11.5, color: "var(--danger)" }}>
                    The test task failed — check the Activity feed. The runtime is reachable, but something in the task
                    didn't complete.
                  </p>
                )}
                {proved && (
                  <p style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
                    {eventsForTask(store, provedTask!.id).length} events streamed, gapless.
                  </p>
                )}
              </div>
            )}
          </Shell>
        )}

        {step === "ready" && (
          <Shell title="You're ready" subtitle="Valyria is running fully offline, right here.">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, padding: 14, background: "var(--success-bg)", border: "1px solid var(--success-border)", borderRadius: 10 }}>
              <CheckCircle2 size={20} style={{ color: "var(--success)" }} />
              <div>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 650 }}>Runtime verified</div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  {session ? `Core ${session.runtime_version}, protocol ${session.protocol_version}` : "Ready when a workspace is open."}
                </div>
              </div>
            </div>

            {rec === undefined && (
              <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-tertiary)" }}>
                Checking which model fits this machine…
              </div>
            )}
            {rec === null && (
              <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-tertiary)" }}>
                Core has no model recommendation for this machine — you can add one later from the
                Models tab.
              </div>
            )}
            {rec && (
              <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border-subtle)", borderRadius: 10 }}>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
                  Recommended: {rec.display_name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3 }}>
                  {rec.fit_kind === "comfortable"
                    ? "Fits comfortably"
                    : rec.fit_kind === "tight"
                      ? `Fits, but tight (${rec.fit_detail ?? ""})`
                      : "Would not fit this machine"}{" "}
                  · {(rec.size_bytes / 1024 ** 3).toFixed(1)} GiB · {rec.license_name} · suitability{" "}
                  {rec.suitability}/100
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 4 }}>
                  Core scores this against your hardware — it isn't a guess the app made.
                </div>
                <button
                  className="btn btn--sm btn--primary"
                  style={{ marginTop: 8 }}
                  disabled={installing || rec.installed || rec.fit_kind === "will_not_fit"}
                  onClick={() => {
                    setInstalling(true);
                    void bridge
                      .modelInstall(rec.id)
                      .catch(() => {})
                      .finally(() => setInstalling(false));
                  }}
                >
                  {rec.installed
                    ? "Installed"
                    : installing
                      ? "Starting download…"
                      : "Install now (Core downloads it)"}
                </button>
              </div>
            )}
          </Shell>
        )}

        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 24 }}>
          <button className="btn btn--ghost" onClick={finish}>Skip setup</button>
          {step !== "ready" ? (
            <button
              className="btn btn--primary"
              disabled={step === "prove" && !!provedTask && !proved && provedTask.state !== "failed"}
              onClick={() => setStep(order[idx + 1] ?? "ready")}
            >
              Continue <ArrowRight size={14} />
            </button>
          ) : (
            <button className="btn btn--primary" onClick={finish}>Start working <ArrowRight size={14} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700 }}>{title}</h1>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", marginTop: 6 }}>{subtitle}</p>
      <div style={{ marginTop: 20 }}>{children}</div>
    </div>
  );
}

function Row({ label, done, icon }: { label: string; done: boolean; icon: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
      <span style={{ color: "var(--text-tertiary)" }}>{icon}</span>
      <span style={{ fontSize: "var(--text-sm)", flex: 1 }}>{label}</span>
      {done ? <CheckCircle2 size={15} style={{ color: "var(--success)" }} /> : <Loader2 size={14} className="spin" style={{ color: "var(--text-tertiary)" }} />}
    </div>
  );
}

function icon(status: string) {
  switch (status) {
    case "pass":
      return <Check size={14} style={{ color: "var(--success)" }} />;
    case "warn":
      return <AlertTriangle size={14} style={{ color: "var(--warning)" }} />;
    case "fail":
      return <XCircle size={14} style={{ color: "var(--danger)" }} />;
    default:
      return <HelpCircle size={14} style={{ color: "var(--text-tertiary)" }} />;
  }
}
