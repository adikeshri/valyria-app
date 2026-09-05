/**
 * First run (PLAN.md §22 / §4.13). Explain that inference is local, point
 * Valyria at a repository, set up a model, and prove the stack with a
 * harmless read-only task. The model step is skippable — the built-in
 * offline model runs the flow — but it is offered up front now that Core
 * serves the whole install lifecycle.
 */
import { mountWebview } from "../shared/host";
import { h, brandLockup } from "../shared/render";
import { CMD } from "../shared/protocol";
import "./firstrun.css";

interface ModelStep {
  capable: boolean;
  handled: boolean;
  installedCount: number;
  recommendedId: string | null;
  recommendedName: string | null;
  recommendedSizeGb: number | null;
  recommendedFit: string | null;
  install: {
    status: "running" | "completed" | "failed";
    phase: string | null;
    fraction: number | null;
    message: string | null;
    code: string | null;
  } | null;
}

interface FirstRunModel {
  connection: string;
  hasRepo: boolean;
  layoutMode: "agent" | "editor";
  probeState: "idle" | "running" | "done" | "failed";
  probeResult: string | null;
  model: ModelStep;
}

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

function step(n: number, title: string, ...body: (Node | string | null | false)[]): HTMLElement {
  return h("div", { class: "fr-step" }, h("h3", { text: `${n}. ${title}` }), ...body.filter(Boolean) as Node[]);
}

function modelStepEl(m: FirstRunModel): HTMLElement {
  const s = m.model;
  if (!s.capable) {
    return step(
      2,
      "Set up a model",
      h("p", { class: "vy-empty" },
        "The running Core does not serve model management. Valyria will use its built-in offline model.")
    );
  }
  if (s.handled) {
    return step(
      2,
      "Set up a model ✓",
      h("p", { class: "vy-empty" },
        s.installedCount > 0
          ? `${s.installedCount} model${s.installedCount === 1 ? "" : "s"} installed. Manage them any time from the Models view.`
          : "Using the built-in offline model for now — add a real one from the Models view.")
    );
  }

  const body: (Node | null)[] = [
    h("p", { class: "vy-empty" },
      "Valyria plans and edits with a model that runs on this machine. Install one now, or skip and use the built-in offline model."),
  ];

  if (s.install) {
    if (s.install.status === "running") {
      const pct = s.install.fraction != null ? Math.round(s.install.fraction * 100) : null;
      const bar = h("div", { class: "fr-bar", role: "progressbar" });
      const fill = h("div", { class: "fr-bar-fill" });
      if (pct != null) fill.style.width = `${pct}%`;
      bar.append(fill);
      body.push(bar);
      body.push(h("p", { class: "vy-empty", text:
        s.install.phase === "downloading"
          ? `Downloading${pct != null ? ` — ${pct}%` : "…"}`
          : s.install.phase === "verifying"
            ? "Verifying…"
            : s.install.phase === "probing"
              ? "Checking it runs…"
              : "Preparing…" }));
    } else if (s.install.status === "completed") {
      body.push(h("p", { class: "vy-empty", text: "Downloaded. Activate it as your coding model to finish." }));
      const act = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, "Use this model") as HTMLButtonElement;
      act.addEventListener("click", () => ctrl?.command("firstRunActivateModel", { id: s.recommendedId }));
      body.push(act);
    } else {
      const cancelled = s.install.code === "model_store.cancelled";
      body.push(h("p", { class: "vy-empty", text:
        cancelled
          ? "Install cancelled."
          : `Install failed: ${s.install.message ?? s.install.code ?? "Core did not report a reason"}` }));
    }
  }

  if (!s.install || s.install.status === "failed") {
    if (s.recommendedId) {
      const fit = s.recommendedFit === "tight" ? " (tight fit)" : "";
      const size = s.recommendedSizeGb != null ? `, ${s.recommendedSizeGb.toFixed(1)} GB` : "";
      body.push(h("p", { class: "vy-empty", text: `Recommended for this machine: ${s.recommendedName}${size}${fit}.` }));
      const install = h("button", { class: "vy-btn vy-btn--primary", type: "button" },
        s.install?.status === "failed" ? "Try again" : "Install recommended model…") as HTMLButtonElement;
      install.addEventListener("click", () => ctrl?.command("firstRunInstallModel", { id: s.recommendedId }));
      body.push(install);
    } else {
      body.push(h("p", { class: "vy-empty", text: "No catalog model fits this machine for coding — see the Models view for the full list." }));
    }
    const browse = h("button", { class: "vy-btn", type: "button" }, "Browse all models") as HTMLButtonElement;
    browse.addEventListener("click", () => ctrl?.command("firstRunOpenModelManager"));
    body.push(browse);
  }

  const skip = h("button", { class: "vy-btn fr-skip", type: "button" }, "Skip — use the built-in model") as HTMLButtonElement;
  skip.addEventListener("click", () => ctrl?.command("firstRunSkipModel"));
  body.push(skip);

  return step(2, "Set up a model", ...body);
}

function render(m: FirstRunModel): void {
  root.replaceChildren();
  const wrap = h("div", { class: "fr-wrap" });

  wrap.append(
    brandLockup("Local-first autonomous coding agent"),
    h("p", { class: "vy-empty" }, "Valyria plans, edits and verifies code with a model that runs entirely on this machine. No account, no cloud, no network at runtime.")
  );

  const s1 = step(1, "Open a repository",
    h("p", { class: "vy-empty" }, "Opening a folder is the authorization — Valyria only reads and writes inside it."));
  const openBtn = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, m.hasRepo ? "Repository open ✓" : "Open a repository…") as HTMLButtonElement;
  openBtn.disabled = m.hasRepo;
  openBtn.addEventListener("click", () => ctrl?.command(CMD.firstRunOpenRepo));
  s1.append(openBtn);
  wrap.append(s1);

  wrap.append(modelStepEl(m));

  const s3 = step(3, "Prove the stack",
    h("p", { class: "vy-empty" }, "Run a harmless, read-only task so you can see the agent, the event stream and verification working end to end."));
  const probeBtn = h("button", { class: "vy-btn", type: "button" }, m.probeState === "running" ? "Running…" : "Run a harmless task") as HTMLButtonElement;
  probeBtn.disabled = !m.hasRepo || m.connection !== "ready" || m.probeState === "running";
  probeBtn.addEventListener("click", () => ctrl?.command(CMD.firstRunProbeTask));
  s3.append(probeBtn);
  if (m.probeResult) s3.append(h("p", { class: "vy-empty", text: m.probeResult }));
  wrap.append(s3);

  const s4 = step(4, "Choose a layout",
    h("p", { class: "vy-empty" }, "Agent puts the Valyria surfaces at the centre; Editor keeps the familiar VS Code shape. You can switch any time from the status bar."));
  const choose = h("div", { class: "fr-actions" });
  for (const mode of ["agent", "editor"] as const) {
    const b = h(
      "button",
      { class: `vy-btn${m.layoutMode === mode ? " vy-btn--primary" : ""}`, type: "button", "aria-pressed": m.layoutMode === mode },
      mode === "agent" ? "Agent layout" : "Editor layout"
    ) as HTMLButtonElement;
    b.addEventListener("click", () => ctrl?.command("firstRunSetLayout", { mode }));
    choose.append(b);
  }
  s4.append(choose);
  wrap.append(s4);

  const done = h("button", { class: "vy-btn", type: "button" }, "Done") as HTMLButtonElement;
  done.addEventListener("click", () => ctrl?.command(CMD.firstRunDismiss));
  wrap.append(h("div", { class: "fr-actions" }, done));

  root.append(wrap);
}

ctrl = mountWebview<FirstRunModel>({ onState: render });
