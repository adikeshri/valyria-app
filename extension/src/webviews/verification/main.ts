/**
 * Verification Inspector (PLAN.md §35 / D8).
 *
 * Renders `task_report`'s `verified[]` and `unverified[]` verbatim — command,
 * kind, outcome, run_id. A category with no evidence is NOT RUN. There is no
 * code path here to a generic "verified" badge.
 */
import { mountWebview } from "../shared/host";
import { h, section, badge, empty } from "../shared/render";
import { CMD, type VerificationModel } from "../shared/protocol";
import "./verification.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

function render(m: VerificationModel): void {
  root.replaceChildren();

  if (!m.taskId) {
    root.append(empty("No task selected."));
    return;
  }
  if (!m.hasReport) {
    root.append(empty("No report yet."));
    const b = h("button", { class: "vy-btn", type: "button" }, "Fetch report") as HTMLButtonElement;
    b.addEventListener("click", () => ctrl?.command(CMD.refreshVerification));
    root.append(b);
    return;
  }

  root.append(
    h("div", { class: "vf-head" }, h("strong", { text: "Task report" }), m.status ? badge(m.status, m.status === "completed" ? "ok" : "muted") : null)
  );

  root.append(
    section(
      `Verified (${m.verified.length})`,
      m.verified.length
        ? h(
            "ul",
            { class: "vy-list" },
            ...m.verified.map((v) =>
              h(
                "li",
                { class: "vf-claim" },
                badge(v.outcome, v.outcome.toLowerCase() === "pass" ? "ok" : "bad"),
                h("span", { class: "vy-mono", text: v.command }),
                h("span", { class: "vy-empty", text: v.kind }),
                h("span", { class: "vy-empty vy-mono vf-runid", text: v.runId })
              )
            )
          )
        : empty("Nothing verified with evidence.")
    )
  );

  root.append(
    section(
      `Unverified (${m.unverified.length})`,
      m.unverified.length
        ? h("ul", { class: "vy-list" }, ...m.unverified.map((u) => h("li", { class: "vf-unverified" }, badge("NOT RUN", "warn"), h("span", { text: u }))))
        : empty("No unverified claims.")
    )
  );

  const refresh = h("button", { class: "vy-btn", type: "button" }, "Refresh") as HTMLButtonElement;
  refresh.addEventListener("click", () => ctrl?.command(CMD.refreshVerification));
  root.append(refresh);
}

ctrl = mountWebview<VerificationModel>({ onState: render });
