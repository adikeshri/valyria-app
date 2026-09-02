/**
 * Model Manager (PLAN.md §20). Inventory only. Install / remove / activate go
 * through Core (gated on `model_manage`) — the extension has NO download path
 * for weights (§20, §38).
 */
import { mountWebview } from "../shared/host";
import { h, section, badge, empty } from "../shared/render";
import { CMD, type ModelsModel } from "../shared/protocol";
import "./models.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

const gb = (b: number) => `${(b / 1e9).toFixed(1)} GB`;

function render(m: ModelsModel): void {
  root.replaceChildren();
  root.append(
    h("p", { class: "vy-empty mdl-note" }, "Valyria never downloads model weights — Core does, locally and only with your go-ahead.")
  );

  if (!m.hasList) {
    root.append(empty("Model list unavailable."));
    return;
  }

  const rows = m.models.map((mo) => {
    const li = h(
      "li",
      { class: "mdl-row" },
      h("span", { class: "mdl-id vy-mono", text: mo.id }),
      badge(mo.family, "muted"),
      badge(mo.quantization, "muted"),
      h("span", { class: "vy-empty", text: gb(mo.sizeBytes) }),
      h("span", { class: "vy-empty", text: mo.license }),
      mo.active ? badge("active", "ok") : mo.installed ? badge("installed", "muted") : badge("not installed", "muted")
    );
    if (m.manageCapable) {
      const act = h("div", { class: "mdl-actions" });
      const btn = (label: string, action: string) => {
        const b = h("button", { class: "vy-btn", type: "button" }, label) as HTMLButtonElement;
        b.addEventListener("click", () => ctrl?.command(CMD.manageModel, { id: mo.id, action }));
        return b;
      };
      if (!mo.installed) act.append(btn("Install", "install"));
      else {
        if (!mo.active) act.append(btn("Activate", "activate"));
        act.append(btn("Remove", "remove"));
      }
      li.append(act);
    }
    return li;
  });

  root.append(section("Models", rows.length ? h("ul", { class: "vy-list" }, ...rows) : empty("No models.")));

  if (!m.manageCapable) {
    root.append(h("p", { class: "vy-empty" }, "Install / remove / activate need Core capability model_manage (G5)."));
  }

  if (m.bindings.length) {
    root.append(
      section(
        "Role bindings (from config)",
        h("ul", { class: "vy-list" }, ...m.bindings.map((b) =>
          h("li", {}, h("span", { class: "vy-mono", text: b.key }), h("span", { class: "vy-mono", text: b.value }), badge(b.origin, "muted"))
        ))
      )
    );
  }

  const refresh = h("button", { class: "vy-btn", type: "button" }, "Refresh") as HTMLButtonElement;
  refresh.addEventListener("click", () => ctrl?.command(CMD.refreshModels));
  root.append(refresh);
}

ctrl = mountWebview<ModelsModel>({ onState: render });
