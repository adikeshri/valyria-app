/**
 * First run (PLAN.md §22 / §4.13). One job: explain that inference is local,
 * point Valyria at a repository, and prove the stack with a harmless read-only
 * task. No model step — the first release runs on Core's built-in offline model.
 */
import { mountWebview } from "../shared/host";
import { h } from "../shared/render";
import { CMD } from "../shared/protocol";
import "./firstrun.css";

interface FirstRunModel {
  connection: string;
  hasRepo: boolean;
  probeState: "idle" | "running" | "done" | "failed";
  probeResult: string | null;
}

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

function render(m: FirstRunModel): void {
  root.replaceChildren();
  const wrap = h("div", { class: "fr-wrap" });

  wrap.append(
    h("h2", { text: "Welcome to Valyria" }),
    h("p", { class: "vy-empty" }, "Valyria plans, edits and verifies code with a model that runs entirely on this machine. No account, no cloud, no network at runtime.")
  );

  const s1 = h(
    "div",
    { class: "fr-step" },
    h("h3", { text: "1. Open a repository" }),
    h("p", { class: "vy-empty" }, "Opening a folder is the authorization — Valyria only reads and writes inside it.")
  );
  const openBtn = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, m.hasRepo ? "Repository open ✓" : "Open a repository…") as HTMLButtonElement;
  openBtn.disabled = m.hasRepo;
  openBtn.addEventListener("click", () => ctrl?.command(CMD.firstRunOpenRepo));
  s1.append(openBtn);
  wrap.append(s1);

  const s2 = h(
    "div",
    { class: "fr-step" },
    h("h3", { text: "2. Prove the stack" }),
    h("p", { class: "vy-empty" }, "Run a harmless, read-only task so you can see the agent, the event stream and verification working end to end.")
  );
  const probeBtn = h("button", { class: "vy-btn", type: "button" }, m.probeState === "running" ? "Running…" : "Run a harmless task") as HTMLButtonElement;
  probeBtn.disabled = !m.hasRepo || m.connection !== "ready" || m.probeState === "running";
  probeBtn.addEventListener("click", () => ctrl?.command(CMD.firstRunProbeTask));
  s2.append(probeBtn);
  if (m.probeResult) s2.append(h("p", { class: "vy-empty", text: m.probeResult }));
  wrap.append(s2);

  const done = h("button", { class: "vy-btn", type: "button" }, "Done") as HTMLButtonElement;
  done.addEventListener("click", () => ctrl?.command(CMD.firstRunDismiss));
  wrap.append(h("div", { class: "fr-actions" }, done));

  root.append(wrap);
}

ctrl = mountWebview<FirstRunModel>({ onState: render });
