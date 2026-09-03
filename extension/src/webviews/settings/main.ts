/**
 * Settings (PLAN.md §24 / D13). Renders `config_show` grouped into the five
 * sections, each row showing value **and origin**. An edit writes Core's own
 * config.toml and the host immediately re-reads `config_show`, so what you see
 * is always Core's re-resolved effective value — never our optimistic write.
 * We only ever write a key Core already reported.
 */
import { mountWebview } from "../shared/host";
import { h, section, badge, empty } from "../shared/render";
import { CMD, type SettingsModel } from "../shared/protocol";
import "./settings.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

function render(m: SettingsModel): void {
  root.replaceChildren();
  if (!m.hasConfig) {
    root.append(empty("Configuration unavailable — connect to Core."));
    return;
  }

  for (const sec of m.sections) {
    root.append(
      section(
        sec.title,
        h(
          "div",
          {},
          ...sec.rows.map((r) => {
            const val = h("div", { class: "set-val" });
            if (r.editable) {
              const input = h("input", { class: "vy-input", value: r.value, "aria-label": r.key }) as HTMLInputElement;
              input.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && input.value !== r.value) {
                  ctrl?.command(CMD.writeConfig, { key: r.key, value: input.value });
                }
              });
              val.append(input);
            } else {
              val.append(h("span", { class: "vy-mono", text: r.value }));
            }
            val.append(badge(r.origin, "muted"));
            return h("div", { class: "set-row" }, h("span", { class: "set-key", text: r.key }), val);
          })
        )
      )
    );
  }

  root.append(h("p", { class: "vy-empty" }, "Press Enter in a field to write. Only keys Core reports here can be written."));
}

ctrl = mountWebview<SettingsModel>({ onState: render });
