/**
 * Hardware view (PLAN.md §21). Probe fields Core doesn't report render as
 * "not probed". The model *recommendation* is Core's `fit()` scoring (G4);
 * each candidate links into the Model Manager to install it.
 */
import { mountWebview } from "../shared/host";
import { h, section, badge, empty } from "../shared/render";
import { CMD, type HardwareModel } from "../shared/protocol";
import "./hardware.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

const gb = (b: number | null) => (b == null ? null : `${(b / 1e9).toFixed(1)} GB`);
const unprobed = () => h("span", { class: "hw-unprobed", text: "not probed" });

function row(dl: HTMLElement, k: string, v: string | null): void {
  dl.append(h("dt", { text: k }), h("dd", {}, v ?? unprobed()));
}

function render(m: HardwareModel): void {
  root.replaceChildren();

  if (!m.hasProbe) {
    root.append(empty("No hardware probe yet."));
  } else {
    const dl = h("dl", { class: "hw-grid" });
    row(dl, "OS", m.os);
    row(dl, "Arch", m.arch);
    row(dl, "CPU", m.cpu?.brand ?? null);
    row(dl, "Cores", m.cpu ? `${m.cpu.physicalCores ?? "?"} physical / ${m.cpu.logicalCores ?? "?"} logical` : null);
    row(dl, "RAM", gb(m.ramTotalBytes));
    row(dl, "RAM available", gb(m.ramAvailableBytes));
    row(dl, "Disk available", gb(m.diskAvailableBytes));
    row(dl, "Unified memory", m.unifiedMemory == null ? null : m.unifiedMemory ? "yes" : "no");
    row(
      dl,
      "Accelerator",
      m.acceleratorPresent == null ? null : m.acceleratorPresent ? "present" : "absent"
    );
    root.append(section("This machine", dl));

    if (m.gpus.length) {
      root.append(
        section(
          "GPUs",
          h("ul", { class: "vy-list" }, ...m.gpus.map((g) =>
            h("li", {}, h("span", { text: g.name }), g.vendor ? badge(g.vendor, "muted") : null, g.vramBytes ? badge(gb(g.vramBytes) ?? "", "muted") : null)
          ))
        )
      );
    }
  }

  // --- recommendation ---
  if (m.recommendation) {
    const r = m.recommendation;
    const gbn = (b: number | null) => (b == null ? "" : `${(b / 1e9).toFixed(1)} GB`);
    const chip = (k: string) =>
      k === "comfortable"
        ? badge("fits", "ok")
        : k === "tight"
          ? badge("tight fit", "warn")
          : badge("won't fit", "bad");
    root.append(
      section(
        `Model fit for “${r.role.replace(/_/g, " ")}”`,
        r.recommendedId
          ? h("p", { class: "vy-empty" }, `Recommended: `, h("span", { class: "vy-mono", text: r.recommendedId }))
          : h("p", { class: "vy-empty" }, "Nothing in the catalog fits this machine for that role."),
        h("ul", { class: "vy-list" }, ...r.candidates.map((c) => {
          const li = h(
            "li",
            { class: "hw-cand" },
            chip(c.fitKind),
            h("span", { class: "vy-mono", text: c.displayName }),
            h("span", { class: "vy-empty", text: [gbn(c.sizeBytes), c.installed ? "installed" : null].filter(Boolean).join(" · ") })
          );
          if (!c.installed) {
            const b = h("button", { class: "vy-btn", type: "button" }, "Set up…") as HTMLButtonElement;
            b.addEventListener("click", () => ctrl?.command("installModel", { id: c.id }));
            li.append(b);
          }
          return li;
        }))
      )
    );
  } else if (!m.hardwareCapable) {
    root.append(
      section(
        "Model fit",
        h("p", { class: "vy-empty" }, "Core is not scoring model fit. Pick a model in the Model Manager using the RAM figures above."),
      )
    );
  }

  const refresh = h("button", { class: "vy-btn", type: "button" }, "Refresh") as HTMLButtonElement;
  refresh.addEventListener("click", () => ctrl?.command(CMD.refreshHardware));
  root.append(refresh);
}

ctrl = mountWebview<HardwareModel>({ onState: render });
