/**
 * Approvals (PLAN.md §4.7). A single pending ask at a time; risk drives the
 * visual treatment; destructive / network operations need a deliberate second
 * click. The `seq` travels with the decision so the host can refuse a prompt a
 * newer `approval_requested` has superseded (G2).
 */
import { mountWebview, announce } from "../shared/host";
import { h, badge, empty } from "../shared/render";
import { CMD, type ApprovalsModel } from "../shared/protocol";
import "./approvals.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

const HIGH_RISK = new Set(["destructive", "network", "elevated"]);

function render(m: ApprovalsModel): void {
  root.replaceChildren();
  const ap = m.approval;
  if (!ap) {
    root.append(empty("No approval pending."));
    return;
  }

  const high = ap.risk ? HIGH_RISK.has(ap.risk) : false;
  announce(`Approval required: ${ap.prompt}`);

  const card = h("div", {
    class: `apv-card${high ? " apv-card--high" : ""}`,
    role: "group",
    "aria-label": "Approval required",
  });

  card.append(
    h(
      "div",
      { class: "apv-head" },
      h("strong", { text: "Approval required" }),
      ap.risk ? badge(ap.risk, high ? "bad" : "muted") : null
    ),
    h("p", { class: "apv-prompt", text: ap.prompt })
  );

  const meta = h("dl", { class: "apv-meta" });
  const add = (k: string, v: string | null) => {
    if (!v) return;
    meta.append(h("dt", { text: k }), h("dd", { class: "vy-mono", text: v }));
  };
  add("tool", ap.tool);
  add("category", ap.category);
  add("target", ap.target);
  if (meta.childElementCount) card.append(meta);

  // --- actions ---
  const actions = h("div", { class: "apv-actions" });
  const deny = h("button", { class: "vy-btn", type: "button", "data-autofocus": true }, "Deny") as HTMLButtonElement;
  deny.addEventListener("click", () => ctrl?.command(CMD.resolveApproval, { allow: false, seq: ap.seq }));

  const doAllow = (scope: "once" | "task") =>
    ctrl?.command(CMD.resolveApproval, { allow: true, seq: ap.seq, scope });

  if (high) {
    // deliberate second interaction
    const arm = h("button", { class: "vy-btn", type: "button" }, "Allow…") as HTMLButtonElement;
    arm.addEventListener("click", () => {
      arm.replaceWith(mkConfirm());
    });
    const mkConfirm = () => {
      const c = h("button", { class: "vy-btn vy-btn--primary apv-confirm", type: "button" }, "Confirm — allow this") as HTMLButtonElement;
      c.addEventListener("click", () => doAllow("once"));
      return c;
    };
    actions.append(deny, arm);
  } else {
    const allow = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, "Allow once") as HTMLButtonElement;
    allow.addEventListener("click", () => doAllow("once"));
    actions.append(deny, allow);
    if (m.allowForTaskSupported) {
      const forTask = h("button", { class: "vy-btn", type: "button" }, "Allow for task") as HTMLButtonElement;
      forTask.addEventListener("click", () => doAllow("task"));
      actions.append(forTask);
    }
  }
  card.append(actions);

  if (!m.allowForTaskSupported) {
    card.append(
      h("p", { class: "vy-empty" }, "“Allow for task” needs Core capability approval_scope.")
    );
  }

  root.append(card);
}

ctrl = mountWebview<ApprovalsModel>({ onState: render });
