import { useEffect, useRef, useState } from "react";
import {
  Cpu, MemoryStick, Zap, Sparkles, FolderOpen, CheckCircle2,
  Loader2, ArrowRight, Server,
} from "lucide-react";
import { useApp } from "../state/store";
import { useLive } from "../core/liveStore";
import { useOverlayA11y } from "../core/useOverlayA11y";
import { hardware, modelList, WORKSPACE_NAME } from "../data/mock";
import logoFull from "../assets/logo-full.png";
import LiveFirstRun from "./LiveFirstRun";

type Step = "welcome" | "hardware" | "model" | "install" | "workspace" | "verify" | "ready";
const order: Step[] = ["welcome", "hardware", "model", "install", "workspace", "verify", "ready"];

export default function FirstRunView() {
  const available = useLive((s) => s.available);
  if (available) return <LiveFirstRun />;
  return <MockFirstRunView />;
}

function MockFirstRunView() {
  const setRoute = useApp((s) => s.setRoute);
  const [step, setStep] = useState<Step>("welcome");
  const [installPct, setInstallPct] = useState(0);
  const [verifyDone, setVerifyDone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useOverlayA11y(rootRef, () => setRoute("workspace"));

  useEffect(() => {
    if (step !== "install") return;
    setInstallPct(0);
    const id = setInterval(() => {
      setInstallPct((p) => (p >= 100 ? 100 : p + Math.random() * 14));
    }, 220);
    return () => clearInterval(id);
  }, [step]);

  useEffect(() => {
    if (step !== "verify") return;
    setVerifyDone(false);
    const t = setTimeout(() => setVerifyDone(true), 1400);
    return () => clearTimeout(t);
  }, [step]);

  const idx = order.indexOf(step);
  const recommended = modelList.find((m) => m.family === "Qwen3-Coder" && m.installed) ?? modelList[0];

  function next() {
    const n = order[idx + 1];
    if (n) setStep(n);
  }

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label="First-run setup" style={{ position: "fixed", inset: 0, background: "var(--bg-canvas)", zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: "100%", maxWidth: 640, padding: "48px 24px", display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 36 }}>
          {order.map((s, i) => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= idx ? "var(--accent)" : "var(--bg-hover)" }} />
          ))}
        </div>

        {step === "welcome" && (
          <StepShell title="Welcome to Valyria" subtitle="A local-first autonomous software engineer.">
            <img
              src={logoFull}
              alt="Valyria"
              style={{ height: 72, width: "auto", display: "block", marginBottom: 24 }}
            />
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.7 }}>
              Valyria plans, edits, runs and verifies work inside your repositories using a language
              model that runs entirely on this machine. There's no account, no cloud service, and no
              network dependency at runtime — everything below happens locally.
            </p>
            <ul style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              <li>• We'll check what your machine can run</li>
              <li>• Recommend a model that fits, and explain why</li>
              <li>• Install it, with your explicit go-ahead</li>
              <li>• Open a repository and prove the whole stack works</li>
            </ul>
          </StepShell>
        )}

        {step === "hardware" && (
          <StepShell title="Detecting hardware" subtitle="So the model we suggest actually runs well here.">
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              <HwRow icon={<Cpu size={15} />} label={hardware.cpu} sub={`${hardware.cores} cores`} />
              <HwRow icon={<MemoryStick size={15} />} label={`${hardware.ramGb} GB memory`} sub="unified" />
              <HwRow icon={<Zap size={15} />} label={hardware.gpu} sub={hardware.accelerator} />
            </div>
          </StepShell>
        )}

        {step === "model" && (
          <StepShell title="Choose a model" subtitle="Runs comfortably within your available memory.">
            <div style={{ border: "1px solid var(--accent)", background: "var(--accent-soft)", borderRadius: 10, padding: 16, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={15} style={{ color: "var(--accent-strong)" }} />
                <strong style={{ fontSize: "var(--text-md)" }}>{recommended.family}</strong>
                <span className="badge badge--accent">recommended</span>
              </div>
              <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                <span>{recommended.sizeGb} GB on disk</span>
                <span>{recommended.memGb} GB memory</span>
                <span>{recommended.quantization}</span>
                <span>{recommended.license}</span>
              </div>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 10, lineHeight: 1.6 }}>
                Balanced performance class — fits with headroom in {hardware.ramGb} GB unified memory for a
                32k-token context window, on {hardware.accelerator}.
              </p>
            </div>
            <button className="btn btn--ghost btn--sm" style={{ marginTop: 12 }}>See other supported models</button>
          </StepShell>
        )}

        {step === "install" && (
          <StepShell title="Installing" subtitle={`${recommended.family} (${recommended.quantization}) — ${recommended.sizeGb} GB`}>
            <div style={{ marginTop: 16 }}>
              <div style={{ height: 8, background: "var(--bg-hover)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${installPct}%`, background: "var(--accent)", transition: "width 200ms" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--text-tertiary)" }}>
                <span>{(recommended.sizeGb * (installPct / 100)).toFixed(1)} GB / {recommended.sizeGb} GB</span>
                <span>{installPct < 100 ? "verifying checksum as it downloads…" : "done"}</span>
              </div>
            </div>
          </StepShell>
        )}

        {step === "workspace" && (
          <StepShell title="Open a repository" subtitle="Pick the project you want Valyria working in.">
            <button
              className="btn"
              style={{ marginTop: 8, padding: "10px 16px", justifyContent: "center", borderStyle: "dashed" }}
              onClick={next}
            >
              <FolderOpen size={14} /> Open “{WORKSPACE_NAME}”
            </button>
            <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 8 }}>
              Opening a folder is an explicit authorization — Valyria only reads and writes inside it.
            </p>
          </StepShell>
        )}

        {step === "verify" && (
          <StepShell title="Indexing & a harmless test run" subtitle="Proving the stack works end to end.">
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              <VerifyRow label="Indexing repository" done={verifyDone} icon={<Server size={14} />} />
              <VerifyRow label="Starting local model runtime" done={verifyDone} icon={<Cpu size={14} />} />
              <VerifyRow label={'Running task: "list the top-level modules"'} done={verifyDone} icon={<Sparkles size={14} />} />
            </div>
          </StepShell>
        )}

        {step === "ready" && (
          <StepShell title="You're ready" subtitle="Valyria is running fully offline, right here.">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, padding: 14, background: "var(--success-bg)", border: "1px solid var(--success-border)", borderRadius: 10 }}>
              <CheckCircle2 size={20} style={{ color: "var(--success)" }} />
              <div>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 650 }}>Test task completed</div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Found 3 top-level modules: auth, billing, storage.</div>
              </div>
            </div>
          </StepShell>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          {step !== "ready" ? (
            <button className="btn btn--primary" onClick={next}>
              {step === "install" && installPct < 100 ? <Loader2 size={13} className="spin" /> : null}
              Continue <ArrowRight size={14} />
            </button>
          ) : (
            <button className="btn btn--primary" onClick={() => setRoute("workspace")}>
              Start working <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700 }}>{title}</h1>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", marginTop: 6 }}>{subtitle}</p>
      <div style={{ marginTop: 20 }}>{children}</div>
    </div>
  );
}

function HwRow({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
      <span style={{ color: "var(--accent)" }}>{icon}</span>
      <span style={{ fontSize: "var(--text-sm)", fontWeight: 550, flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{sub}</span>
    </div>
  );
}

function VerifyRow({ label, done, icon }: { label: string; done: boolean; icon: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
      <span style={{ color: "var(--text-tertiary)" }}>{icon}</span>
      <span style={{ fontSize: "var(--text-sm)", flex: 1 }}>{label}</span>
      {done ? <CheckCircle2 size={15} style={{ color: "var(--success)" }} /> : <Loader2 size={14} className="spin" style={{ color: "var(--text-tertiary)" }} />}
    </div>
  );
}
