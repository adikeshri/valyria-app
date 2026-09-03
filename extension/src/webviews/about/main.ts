/**
 * About / Compatibility (PLAN.md §40 / CORE-INTERFACE §4).
 *
 * App + bridge-host + Core runtime + protocol versions, the negotiated
 * capabilities, per-surface availability, installed models, and the
 * compatibility verdict. On Windows it also carries the tier-3 notice (G9).
 */
import { mountWebview } from "../shared/host";
import { h, section, badge, empty, brandLockup } from "../shared/render";
import type { AboutModel } from "../shared/protocol";
import "./about.css";

const root = document.getElementById("root")!;

function render(m: AboutModel): void {
  root.replaceChildren();

  root.append(brandLockup("Local-first autonomous coding agent"));

  if (m.windowsTier3) {
    root.append(
      h(
        "div",
        { class: "ab-tier3", role: "alert" },
        h("strong", { text: "Windows: tier 3." }),
        h("p", { text: "Core's daemon transport and sandbox are not available on Windows yet (CORE-INTERFACE G9). This build installs and reports versions, but will not start an agent session." })
      )
    );
  }

  const dl = h("dl", { class: "ab-grid" });
  const row = (k: string, v: string) => dl.append(h("dt", { text: k }), h("dd", { text: v }));
  row("App", m.appName);
  row("Platform", m.platform);
  row("Bridge host", m.bridgeHost);
  row("Protocol (built against)", m.expectedProtocol);
  row("Connection", m.connection);
  if (m.session) {
    row("Core protocol", m.session.protocolVersion);
    row("Core runtime", m.session.runtimeVersion || "?");
    row("Daemon", `${m.session.origin}${m.session.ownsDaemon ? "" : " (adopted)"}${m.session.authenticated ? " · authenticated" : ""}`);
    row("Autonomy", m.session.permissionMode ?? "n/a");
    row("Workspace", m.session.workspaceRoot);
  }
  root.append(section("Versions", dl));

  const vClass =
    m.compatibility === "compatible" ? "ab-verdict--compatible" : m.compatibility === "incompatible" ? "ab-verdict--incompatible" : "";
  root.append(
    section("Compatibility", h("p", { class: `ab-verdict ${vClass}`, text: m.compatibility }))
  );

  root.append(
    section(
      `Capabilities (${m.capabilities.length})`,
      m.capabilities.length
        ? h("div", {}, ...m.capabilities.map((c) => badge(c, "muted")))
        : empty("None negotiated (no session).")
    )
  );

  root.append(
    section(
      "Surfaces",
      h(
        "ul",
        { class: "vy-list" },
        ...m.surfaces.map((s) =>
          h(
            "li",
            { class: "ab-surf" },
            badge(s.available ? "on" : "gated", s.available ? "ok" : "warn"),
            h("span", { text: s.surface }),
            s.missing ? h("span", { class: "vy-empty", text: `needs ${s.missing}${s.gap ? ` (${s.gap})` : ""}` }) : null
          )
        )
      )
    )
  );

  root.append(
    section(
      `Models (${m.models.length})`,
      m.models.length
        ? h("ul", { class: "vy-list" }, ...m.models.map((mo) =>
            h("li", {}, h("span", { class: "vy-mono", text: mo.id }), mo.active ? badge("active", "ok") : mo.installed ? badge("installed", "muted") : badge("not installed", "muted"))
          ))
        : empty("No model inventory.")
    )
  );
}

mountWebview<AboutModel>({ onState: render });
