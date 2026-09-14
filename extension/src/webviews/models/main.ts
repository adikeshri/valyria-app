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

/** "0.27799999713897705" (a raw f64 from Core) -> "278M" / "7B" / "1.5B". */
function formatParams(b: number): string {
  if (b < 1) return `${Math.round(b * 1000)}M`;
  const rounded = Math.round(b * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}B`;
}

/** A message that fits inline renders as plain text; a long diagnostic
 *  chain (nested "X failed: Y" causes, URLs, hashes) collapses behind a
 *  one-line summary instead of dominating the card. */
const ERROR_INLINE_LIMIT = 88;
function errorBlock(message: string): HTMLElement {
  if (message.length <= ERROR_INLINE_LIMIT) {
    return h("p", { class: "mdl-err-text" }, message);
  }
  const details = h("details", { class: "mdl-err" }) as HTMLDetailsElement;
  details.append(
    h("summary", { class: "mdl-err-summary" }, `${message.slice(0, ERROR_INLINE_LIMIT)}…`),
    h("pre", { class: "mdl-err-raw" }, message)
  );
  return details;
}

function fitChip(m: ModelRow): HTMLElement | null {
  if (!m.fit) return null;
  const kind = m.fit === "comfortable" ? "ok" : m.fit === "tight" ? "warn" : "bad";
  const label =
    m.fit === "comfortable" ? "fits" : m.fit === "tight" ? "tight fit" : "won't fit";
  return badge(m.fitDetail && m.fit === "will_not_fit" ? `${label} · ${m.fitDetail}` : label, kind);
}

/** A per-role managed server's live state — `Starting…` / `Ready · :port`
 *  / `Failed` / `Stopped`, next to the role it's serving. The failure
 *  reason is never inlined here — a pill is the wrong shape for a
 *  diagnostic message; `modelCard` renders it as an `errorBlock` instead. */
function serverChip(s: ModelServerRow): HTMLElement {
  const role = roleLabel(s.role);
  if (s.state === "starting") return badge(`${role}: starting…`, "muted");
  if (s.state === "ready") return badge(`${role}: ready · :${s.port ?? "?"}`, "ok");
  if (s.state === "stopped") return badge(`${role}: stopped`, "muted");
  return badge(`${role}: failed`, "bad");
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
      errorBlock(inst.message ?? inst.code ?? "Install did not finish.")
    );
  }
  return wrap;
}

function modelCard(m: ModelRow, model: ModelsModel): HTMLElement {
  const card = h("li", { class: `mdl-card${m.recommended ? " mdl-card--recommended" : ""}` });
  const installing = m.install?.status === "running";

  card.append(h("div", { class: "mdl-titlerow" }, h("span", { class: "mdl-name", text: m.displayName })));

  // Status chips always live on their own row, under the name — never
  // sharing a line with it. A long title or a long fit detail no longer
  // fight for space or wrap unpredictably into each other.
  const chips = h("div", { class: "mdl-chips" });
  if (m.recommended) chips.append(badge("recommended", "ok"));
  if (m.installed && !m.install) chips.append(badge("installed", "muted"));
  const fc = fitChip(m);
  if (fc) chips.append(fc);
  // A server chip describes a *previous* activation attempt. While a fresh
  // install is running, that history is about to be superseded — showing
  // e.g. "primary coder: stopped" next to "downloading 24%" reads as a
  // contradiction, not a status update, so it's withheld until the install
  // itself resolves.
  if (!installing) {
    if (model.inferenceCapable) {
      const chippedRoles = new Set(m.servers.map((s) => s.role));
      for (const r of m.activeRoles) {
        if (!chippedRoles.has(r)) chips.append(badge(`serving ${roleLabel(r)}`, "ok"));
      }
      for (const s of m.servers) chips.append(serverChip(s));
    } else {
      for (const r of m.activeRoles) chips.append(badge(`serving ${roleLabel(r)}`, "ok"));
    }
  }
  if (chips.childElementCount) card.append(chips);

  const meta = [
    m.parametersB ? `${formatParams(m.parametersB)} params` : null,
    m.quantization,
    m.contextLength ? `${(m.contextLength / 1024).toFixed(0)}K ctx` : null,
    gb(m.sizeBytes),
    m.license,
  ].filter(Boolean).join(" · ");
  card.append(h("div", { class: "mdl-meta", text: meta }));

  if (m.install) card.append(progress(m.install));

  // A failed server's reason gets its own line, not squeezed into the
  // `serverChip` pill above (a pill is the wrong shape for a diagnostic
  // message, and `model/activate`'s own failure never repeats it). Same
  // "superseded by a fresh install" rule as the chip itself.
  if (!installing) {
    for (const s of m.servers) {
      if (s.state === "failed") {
        card.append(errorBlock(`${roleLabel(s.role)}: ${s.message ?? s.code ?? "no detail reported"}`));
      }
    }
  }

  if (model.manageCapable) {
    const actions = h("div", { class: "mdl-actions" });
    const installed = m.installed || m.install?.status === "completed";

    if (!installed && !installing) {
      const b = h(
        "button",
        { class: "vy-btn vy-btn--sm vy-btn--primary", type: "button" },
        "Install"
      ) as HTMLButtonElement;
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
      // `model/activate` blocks for as long as the server takes to answer
      // /health (tens of seconds) — disable while pending so a re-click
      // can't boot a second llama-server for the same role and starve both.
      const act = h(
        "button",
        { class: "vy-btn vy-btn--sm vy-btn--primary", type: "button" },
        m.actionPending ? "Activating…" : "Activate"
      ) as HTMLButtonElement;
      act.disabled = m.actionPending;
      act.addEventListener("click", () => ctrl?.command(CMD.activateModel, { id: m.id, role: sel.value }));
      actions.append(sel, act);

      const failedForSelectedRole = m.servers.find(
        (s) => s.role === model.role && s.state === "failed"
      );
      if (failedForSelectedRole) {
        const restart = h(
          "button",
          { class: "vy-btn vy-btn--sm", type: "button" },
          m.actionPending ? "Restarting…" : "Restart server"
        ) as HTMLButtonElement;
        restart.disabled = m.actionPending;
        restart.addEventListener("click", () =>
          ctrl?.command(CMD.restartServer, { id: m.id, role: model.role })
        );
        actions.append(restart);
      }

      const rm = h(
        "button",
        { class: "vy-btn vy-btn--sm vy-btn--ghost", type: "button" },
        "Remove"
      ) as HTMLButtonElement;
      rm.disabled = m.actionPending;
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
