/**
 * History — every task the workspace has seen, grouped by day (PLAN.md §4.16).
 * Clicking a task focuses it in the Agent / Task / Timeline views.
 */
import { mountWebview } from "../shared/host";
import { h, badge, empty } from "../shared/render";
import { CMD, type HistoryModel } from "../shared/protocol";
import "./history.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

function render(m: HistoryModel): void {
  root.replaceChildren();
  if (m.groups.length === 0) {
    root.append(empty("No tasks yet."));
    return;
  }
  for (const g of m.groups) {
    root.append(h("h2", { class: "vy-section-title", text: g.day }));
    const list = h("ul", { class: "hist-list" });
    for (const t of g.tasks) {
      const b = h(
        "button",
        {
          class: `hist-item${t.focused ? " hist-item--focused" : ""}`,
          type: "button",
          "aria-pressed": t.focused,
        },
        h("span", { class: "hist-obj", text: t.objective ?? t.id }),
        t.blocked
          ? badge("blocked", "warn")
          : t.terminal
            ? badge(t.state, t.state === "completed" ? "ok" : "bad")
            : badge(t.state.replace(/_/g, " "), "muted")
      ) as HTMLButtonElement;
      b.addEventListener("click", () => ctrl?.command(CMD.focusTask, { taskId: t.id }));
      list.append(h("li", {}, b));
    }
    root.append(list);
  }
}

ctrl = mountWebview<HistoryModel>({ onState: render });
