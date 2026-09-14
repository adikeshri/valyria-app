/**
 * Model Manager (PLAN.md §20 / docs/MODEL-SETUP-PLAN.md). Browse the
 * catalog, install/remove weights, and pick the active coding model, all
 * from the editor — a hardware-scored shortlist, live install progress off
 * the event stream, and a license acceptance prompt (host-side).
 *
 * There is exactly one thing to activate a model *for* (see
 * `store/models.ts`'s note on `DEFAULT_MODEL_ROLE`), so this surface has no
 * role picker — a model is either the active coding model or it isn't.
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

/** `suitability` is null either because hardware scoring is off entirely
 *  (`!hardwareCapable` — true for every model, meaningless here) or because
 *  Core's own catalog gives this model no `role_suitability` entry for
 *  coding at all — `candidates_for_role` filters out anything scoring 0, so
 *  it never even reaches `model/recommend`'s candidate list. That second
 *  case is a real, specific warning: this model may be perfectly good at
 *  autocomplete or summarizing, but Core itself doesn't think it can drive
 *  the agent loop — e.g. Qwen2.5-Coder 1.5B (tuned for `fast_coder` /
 *  `autocomplete`) has no `primary_coder` score, and activating it anyway
 *  produces exactly the "hallucinates a nonsense tool call for `Hi`" failure
 *  this comment is here to prevent silently repeating. */
function unscoredForCoding(m: ModelRow, model: ModelsModel): boolean {
  return model.hardwareCapable && m.chatCapable && m.suitability === null;
}

/** The active model's server, live off the event stream — `Starting…` /
 *  `Ready · :port` / `Failed` / `Stopped`. The failure reason is never
 *  inlined here — a pill is the wrong shape for a diagnostic message;
 *  `modelCard` renders it as an `errorBlock` instead. */
function serverChip(s: ModelServerRow): HTMLElement {
  if (s.state === "starting") return badge("starting…", "muted");
  if (s.state === "ready") return badge(`ready · :${s.port ?? "?"}`, "ok");
  if (s.state === "stopped") return badge("stopped", "muted");
  return badge("failed", "bad");
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
    wrap.append(badge("installed", "ok"), h("span", { class: "vy-empty", text: "Ready to use." }));
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
  else if (unscoredForCoding(m, model)) chips.append(badge("not rated for coding", "warn"));
  // The server chip describes a *previous* activation attempt. While a
  // fresh install is running, that history is about to be superseded —
  // showing e.g. "stopped" next to "downloading 24%" reads as a
  // contradiction, not a status update, so it's withheld until the install
  // itself resolves.
  if (!installing) {
    if (m.active) chips.append(badge("active", "ok"));
    if (model.inferenceCapable) {
      for (const s of m.servers) chips.append(serverChip(s));
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
        card.append(errorBlock(s.message ?? s.code ?? "no detail reported"));
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
      // Not chat-capable (embedder/reranker) — installable, but there's
      // nothing to activate it *for* yet.
      if (m.chatCapable && !m.active) {
        // A model with no coding suitability score at all still *can* be
        // activated (maybe you know something the catalog doesn't), but it
        // doesn't get the confident primary-accent treatment steering
        // everyone else toward it — see `unscoredForCoding`.
        const unscored = unscoredForCoding(m, model);
        // `model/activate` blocks for as long as the server takes to answer
        // /health (tens of seconds) — disable while pending so a re-click
        // can't boot a second llama-server and starve both.
        const act = h(
          "button",
          {
            class: `vy-btn vy-btn--sm${unscored ? "" : " vy-btn--primary"}`,
            type: "button",
            title: unscored
              ? "Core's catalog doesn't rate this model for coding — it may perform poorly or behave unpredictably as the active model."
              : undefined,
          },
          m.actionPending ? "Activating…" : "Use for coding"
        ) as HTMLButtonElement;
        act.disabled = m.actionPending;
        act.addEventListener("click", () => ctrl?.command(CMD.activateModel, { id: m.id }));
        actions.append(act);
      }

      if (m.active && m.servers.some((s) => s.state === "failed")) {
        const restart = h(
          "button",
          { class: "vy-btn vy-btn--sm", type: "button" },
          m.actionPending ? "Restarting…" : "Restart server"
        ) as HTMLButtonElement;
        restart.disabled = m.actionPending;
        restart.addEventListener("click", () => ctrl?.command(CMD.restartServer, { id: m.id }));
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
      section("Models", h("ul", { class: "mdl-list" }, ...model.models.map((m) => modelCard(m, model))))
    );
  }

  const refresh = h("button", { class: "vy-btn", type: "button" }, "Refresh") as HTMLButtonElement;
  refresh.addEventListener("click", () => ctrl?.command(CMD.refreshModels));
  root.append(refresh);
}

ctrl = mountWebview<ModelsModel>({ onState: render });
