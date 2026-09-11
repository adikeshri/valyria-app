/**
 * Model Manager (PLAN.md §20 / docs/MODEL-SETUP-PLAN.md). Choose and set up a
 * model from the editor: a hardware-scored shortlist for a role, a license
 * acceptance prompt (host-side), live install progress off the event stream,
 * and per-role activation.
 *
 * The extension has NO download path for weights — Install / Cancel / Activate
 * / Remove are intents the host forwards to Core (gated on `model_manage`).
 */
import { mountWebview } from "../shared/host";
import { h, section, badge, empty } from "../shared/render";
import {
  CMD,
  type ModelsModel,
  type ModelRow,
  type ModelInstallRow,
  type ModelServerRow,
} from "../shared/protocol";
import "./models.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

const gb = (b: number) => `${(b / 1e9).toFixed(b >= 1e9 ? 1 : 2)} GB`;
const roleLabel = (r: string) => r.replace(/_/g, " ");

function fitChip(m: ModelRow): HTMLElement | null {
  if (!m.fit) return null;
  const kind = m.fit === "comfortable" ? "ok" : m.fit === "tight" ? "warn" : "bad";
  const label =
    m.fit === "comfortable" ? "fits" : m.fit === "tight" ? "tight fit" : "won't fit";
  return badge(m.fitDetail && m.fit === "will_not_fit" ? `${label} · ${m.fitDetail}` : label, kind);
}

/** A per-role managed server's live state — `Starting…` / `Ready · :port`
 *  / `Failed — reason` / `Stopped`, next to the role it's serving. */
function serverChip(s: ModelServerRow): HTMLElement {
  const role = roleLabel(s.role);
  if (s.state === "starting") return badge(`${role}: starting…`, "muted");
  if (s.state === "ready") return badge(`${role}: ready · :${s.port ?? "?"}`, "ok");
  if (s.state === "stopped") return badge(`${role}: stopped`, "muted");
  return badge(`${role}: failed — ${s.message ?? s.code ?? "no detail reported"}`, "bad");
}

function progress(inst: ModelInstallRow): HTMLElement {
  const wrap = h("div", { class: "mdl-install" });
  if (inst.status === "running") {
    const pct = inst.fraction != null ? Math.round(inst.fraction * 100) : null;
    const bar = h("div", { class: "mdl-bar", role: "progressbar", "aria-label": "install progress" });
    const fill = h("div", { class: "mdl-bar-fill" });
    if (pct != null) fill.style.width = `${pct}%`;
    else fill.classList.add("mdl-bar-fill--indeterminate");
    bar.append(fill);
    const label =
      inst.phase === "downloading" && inst.totalBytes > 0
        ? `Downloading ${gb(inst.downloadedBytes)} / ${gb(inst.totalBytes)}${pct != null ? ` (${pct}%)` : ""}`
        : inst.phase === "verifying"
          ? "Verifying integrity…"
          : inst.phase === "probing"
            ? "Loading once to check it runs…"
            : "Preparing…";
    wrap.append(bar, h("span", { class: "vy-empty", text: label }));
    const cancel = h("button", { class: "vy-btn vy-btn--sm", type: "button" }, "Cancel") as HTMLButtonElement;
    cancel.addEventListener("click", () => ctrl?.command(CMD.cancelModelInstall, { id: inst.id }));
    wrap.append(cancel);
  } else if (inst.status === "completed") {
    wrap.append(badge("installed", "ok"), h("span", { class: "vy-empty", text: "Ready to activate." }));
  } else {
    const cancelled = inst.code === "model_store.cancelled";
    wrap.append(
      badge(cancelled ? "cancelled" : "failed", cancelled ? "muted" : "bad"),
      h("span", { class: "vy-empty", text: inst.message ?? inst.code ?? "Install did not finish." })
    );
  }
  return wrap;
}

function modelCard(m: ModelRow, model: ModelsModel): HTMLElement {
  const card = h("li", { class: "mdl-card" });

  const head = h("div", { class: "mdl-head" });
  head.append(h("span", { class: "mdl-name", text: m.displayName }));
  if (m.recommended) head.append(badge("recommended", "ok"));
  if (m.installed && !m.install) head.append(badge("installed", "muted"));
  const fc = fitChip(m);
  if (fc) head.append(fc);
  if (model.inferenceCapable) {
    // The live server chip supersedes the plain "serving X" badge once
    // the stream has actually seen a lifecycle event for the role.
    const chippedRoles = new Set(m.servers.map((s) => s.role));
    for (const r of m.activeRoles) {
      if (!chippedRoles.has(r)) head.append(badge(`serving ${roleLabel(r)}`, "ok"));
    }
    for (const s of m.servers) head.append(serverChip(s));
  } else {
    for (const r of m.activeRoles) head.append(badge(`serving ${roleLabel(r)}`, "ok"));
  }
  card.append(head);

  const meta = [
    m.parametersB ? `${m.parametersB}B params` : null,
    m.quantization,
    m.contextLength ? `${(m.contextLength / 1024).toFixed(0)}K ctx` : null,
    gb(m.sizeBytes),
    m.license,
  ].filter(Boolean).join(" · ");
  card.append(h("div", { class: "mdl-meta vy-empty", text: meta }));

  if (m.install) card.append(progress(m.install));

  if (model.manageCapable) {
    const actions = h("div", { class: "mdl-actions" });
    const installing = m.install?.status === "running";
    const installed = m.installed || m.install?.status === "completed";

    if (!installed && !installing) {
      const b = h("button", { class: "vy-btn vy-btn--sm", type: "button" }, "Install…") as HTMLButtonElement;
      b.addEventListener("click", () => ctrl?.command(CMD.installModel, { id: m.id }));
      actions.append(b);
    }

    if (installed) {
      const sel = h("select", { class: "mdl-role-select", "aria-label": "role to activate for" }) as HTMLSelectElement;
      for (const r of model.roles) {
        const opt = h("option", { value: r }, roleLabel(r)) as HTMLOptionElement;
        if (r === model.role) opt.selected = true;
        sel.append(opt);
      }
      const act = h("button", { class: "vy-btn vy-btn--sm", type: "button" }, "Activate") as HTMLButtonElement;
      act.addEventListener("click", () => ctrl?.command(CMD.activateModel, { id: m.id, role: sel.value }));
      actions.append(sel, act);

      const failedForSelectedRole = m.servers.find(
        (s) => s.role === model.role && s.state === "failed"
      );
      if (failedForSelectedRole) {
        const restart = h(
          "button",
          { class: "vy-btn vy-btn--sm", type: "button" },
          "Restart server"
        ) as HTMLButtonElement;
        restart.addEventListener("click", () =>
          ctrl?.command(CMD.restartServer, { id: m.id, role: model.role })
        );
        actions.append(restart);
      }

      const rm = h("button", { class: "vy-btn vy-btn--sm", type: "button" }, "Remove") as HTMLButtonElement;
      rm.addEventListener("click", () => ctrl?.command(CMD.removeModel, { id: m.id }));
      actions.append(rm);
    }

    if (actions.childElementCount) card.append(actions);
  }

  return card;
}

function render(model: ModelsModel): void {
  root.replaceChildren();

  root.append(
    h("p", { class: "vy-empty mdl-note" },
      "Valyria never downloads model weights — Core does, locally and only after you accept the license.")
  );

  // Role selector — the shortlist and recommendation are scoped to it.
  const roleBar = h("div", { class: "mdl-rolebar" });
  roleBar.append(h("label", { class: "vy-empty", for: "mdl-role" }, "Set up a model for"));
  const roleSel = h("select", { id: "mdl-role", class: "mdl-role-select" }) as HTMLSelectElement;
  for (const r of model.roles) {
    const opt = h("option", { value: r }, roleLabel(r)) as HTMLOptionElement;
    if (r === model.role) opt.selected = true;
    roleSel.append(opt);
  }
  roleSel.addEventListener("change", () => ctrl?.command(CMD.setModelRole, { role: roleSel.value }));
  roleBar.append(roleSel);
  root.append(roleBar);

  if (!model.manageCapable) {
    root.append(empty("The running Core does not serve model management (needs the `model_manage` capability)."));
  }
  if (model.engineInstall && model.engineInstall.status !== "completed") {
    root.append(
      section("Inference engine (llama.cpp)", progress(model.engineInstall))
    );
  }
  if (!model.hardwareCapable) {
    root.append(empty("Core is not scoring hardware fit — the shortlist is unranked. Sizes below are the guide."));
  }

  if (!model.hasList) {
    root.append(empty("Model list unavailable."));
  } else if (model.models.length === 0) {
    root.append(empty("The catalog is empty."));
  } else {
    root.append(
      section(
        `Models for “${roleLabel(model.role)}”`,
        h("ul", { class: "mdl-list" }, ...model.models.map((m) => modelCard(m, model)))
      )
    );
  }

  if (model.bindings.length) {
    root.append(
      section(
        "Active role bindings",
        h("ul", { class: "vy-list" }, ...model.bindings.map((b) =>
          h("li", {}, h("span", { class: "vy-mono", text: roleLabel(b.role) }), h("span", { class: "vy-empty", text: "→" }), h("span", { class: "vy-mono", text: b.modelId }))
        ))
      )
    );
  }

  const refresh = h("button", { class: "vy-btn", type: "button" }, "Refresh") as HTMLButtonElement;
  refresh.addEventListener("click", () => ctrl?.command(CMD.refreshModels));
  root.append(refresh);
}

ctrl = mountWebview<ModelsModel>({ onState: render });
