/**
 * Context Inspector (PLAN.md §34, gap G7). Ships **disabled with an
 * explanation** until Core emits `context_retrieved`. Built and trace-tested so
 * it lights up on the first Core release that does.
 */
import { mountWebview } from "../shared/host";
import { h, badge, empty } from "../shared/render";
import type { ContextModel } from "../shared/protocol";
import "./context.css";

const root = document.getElementById("root")!;

function render(m: ContextModel): void {
  root.replaceChildren();

  if (!m.available) {
    root.append(
      h(
        "div",
        { class: "ctx-disabled" },
        h("strong", { text: "Context provenance is unavailable." }),
        h("p", { text: "Core does not emit context_retrieved events yet (CORE-INTERFACE G7). This view lights up automatically once it does — the extension never infers provenance." })
      )
    );
    return;
  }

  if (!m.taskId || m.items.length === 0) {
    root.append(empty("No context retrieved for this task yet."));
    return;
  }

  root.append(
    h(
      "ul",
      { class: "vy-list" },
      ...m.items.map((it) =>
        h(
          "li",
          { class: "ctx-row" },
          it.trust ? badge(it.trust, it.trust === "trusted" ? "ok" : "warn") : null,
          h("span", { class: "vy-mono", text: it.path ?? it.source ?? "?" }),
          it.tokens != null ? h("span", { class: "vy-empty", text: `${it.tokens} tok` }) : null
        )
      )
    )
  );
}

mountWebview<ContextModel>({ onState: render });
