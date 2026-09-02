/**
 * Security & autonomy (PLAN.md §25, §26).
 *  - autonomy control: a daemon-start parameter (G1), so the switch restarts
 *    Core and is disabled while a task runs.
 *  - security overview: only lines Core actually reports (`config_show` +
 *    `doctor_run`); a key it doesn't return renders as "not reported", never a
 *    checkmark we invented (D8).
 *  - repository instructions: VALYRIA.md / AGENTS.md, marked authorized.
 */
import { mountWebview } from "../shared/host";
import { h, section, badge, empty } from "../shared/render";
import { CMD, type SecurityModel } from "../shared/protocol";
import "./security.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

function statusBadge(status: string) {
  return badge(status, status === "pass" ? "ok" : status === "warn" ? "warn" : "bad");
}

function render(m: SecurityModel): void {
  root.replaceChildren();

  // --- autonomy ---
  const a = m.autonomy;
  const radios = h("div", { class: "sec-levels" });
  for (const lvl of a.levels) {
    const id = `autonomy-${lvl.id}`;
    const input = h("input", {
      type: "radio",
      name: "autonomy",
      id,
      value: lvl.id,
    }) as HTMLInputElement;
    input.checked = a.mode === lvl.id;
    input.disabled = !a.canChange;
    input.addEventListener("change", () => {
      if (input.checked) ctrl?.command(CMD.setAutonomy, { mode: lvl.id });
    });
    radios.append(
      h(
        "label",
        { class: "sec-level", for: id },
        input,
        h("span", { class: "sec-level-label", text: lvl.label }),
        h("span", { class: "sec-level-desc", text: lvl.desc })
      )
    );
  }
  root.append(section("Agent autonomy", radios, h("p", { class: "vy-empty", text: a.reason })));

  // --- config-reported security settings ---
  root.append(
    section(
      "Policy (as Core reports it)",
      h(
        "ul",
        { class: "vy-list" },
        ...m.settings.map((s) =>
          h(
            "li",
            {},
            h("span", { class: "vy-mono", text: s.key }),
            s.reported
              ? h("span", {}, h("span", { class: "vy-mono", text: s.value ?? "" }), badge(s.origin ?? "", "muted"))
              : badge("not reported", "muted")
          )
        )
      )
    )
  );

  // --- doctor checks ---
  root.append(
    section(
      m.doctorSummary ? `Environment checks — ${m.doctorSummary}` : "Environment checks",
      m.checks.length
        ? h(
            "ul",
            { class: "vy-list" },
            ...m.checks.map((c) =>
              h(
                "li",
                { class: "sec-check" },
                statusBadge(c.status),
                h("span", { text: c.name }),
                h("span", { class: "vy-empty", text: c.detail }),
                c.remediation ? h("span", { class: "sec-fix vy-empty", text: `→ ${c.remediation}` }) : null
              )
            )
          )
        : empty("No sandbox / permission checks reported.")
    )
  );

  // --- repo instructions ---
  root.append(
    section(
      "Repository instructions",
      m.repoInstructions.length
        ? h(
            "div",
            { class: "sec-instr" },
            ...m.repoInstructions.map((f) =>
              h(
                "details",
                {},
                h(
                  "summary",
                  {},
                  h("span", { class: "vy-mono", text: f.name }),
                  badge(f.authorized ? "authorized" : "ordinary", f.authorized ? "ok" : "muted")
                ),
                h("pre", { class: "sec-instr-body vy-mono", text: f.text })
              )
            )
          )
        : empty("No VALYRIA.md / AGENTS.md in the repository root.")
    )
  );

  const refresh = h("button", { class: "vy-btn", type: "button" }, "Refresh") as HTMLButtonElement;
  refresh.addEventListener("click", () => ctrl?.command(CMD.refreshSecurity));
  root.append(refresh);
}

ctrl = mountWebview<SecurityModel>({ onState: render });
