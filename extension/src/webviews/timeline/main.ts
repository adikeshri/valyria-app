/**
 * Timeline — every event, newest first, each expandable to its decoded payload
 * as raw JSON (PLAN.md §4.6). Degraded rows (D5) are marked, never hidden.
 */
import { mountWebview } from "../shared/host";
import { h, badge, empty } from "../shared/render";
import type { TimelineModel, TimelineRow } from "../shared/protocol";
import "./timeline.css";

const root = document.getElementById("root")!;
const open = new Set<number>();

function row(r: TimelineRow): HTMLElement {
  const isOpen = open.has(r.seq);
  const details = h("details", { class: "tl-row" }) as HTMLDetailsElement;
  details.open = isOpen;
  details.addEventListener("toggle", () => {
    if (details.open) open.add(r.seq);
    else open.delete(r.seq);
  });

  const summary = h(
    "summary",
    { class: "tl-summary" },
    h("span", { class: "tl-seq vy-mono", text: `#${r.seq}` }),
    h("span", { class: "tl-kind", text: r.kind }),
    h("span", { class: "tl-text", text: r.summary }),
    r.degraded ? badge("raw", "warn") : null
  );
  const pre = h("pre", { class: "tl-raw vy-mono" }, r.raw);
  details.append(summary, pre);
  return details;
}

function render(m: TimelineModel): void {
  root.replaceChildren();
  if (m.rows.length === 0) {
    root.append(empty("No events yet."));
    return;
  }
  root.append(h("div", { class: "tl-list" }, ...m.rows.map(row)));
}

mountWebview<TimelineModel>({
  onState: render,
  restore: (s) => {
    if (Array.isArray(s)) for (const n of s) open.add(Number(n));
  },
});
