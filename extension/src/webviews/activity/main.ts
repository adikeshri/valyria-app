/**
 * Activity — a running narrative of what the agent is doing (PLAN.md §4.6).
 * §10: no model reasoning text (the `activityLine` selector guarantees that;
 * this file only renders strings it is handed).
 */
import { mountWebview, announce, el } from "../shared/host";
import type { ActivityModel } from "../shared/protocol";
import "./activity.css";

const root = document.getElementById("root")!;

const conn = el("div", { id: "conn", "aria-live": "polite" }, "starting…");
const list = el("ol", { id: "log", "aria-label": "Agent activity, most recent last" });
const empty = el("p", { id: "empty" }, "No agent activity yet.");
const degraded = el("p", { id: "degraded", hidden: "" });
root.append(conn, list, empty, degraded);

const BAD = new Set(["degraded", "failed", "incompatible"]);
let lastCount = 0;

function render(m: ActivityModel): void {
  conn.textContent = m.connection;
  conn.className = BAD.has(m.connection) ? "bad" : "";

  list.replaceChildren(...m.lines.map((t) => el("li", {}, t)));
  empty.hidden = m.lines.length > 0;

  if (m.degraded > 0) {
    degraded.hidden = false;
    degraded.textContent = `${m.degraded} event${m.degraded === 1 ? "" : "s"} could not be read — shown as raw in the Timeline.`;
  } else {
    degraded.hidden = true;
  }

  if (m.lines.length > lastCount) {
    announce(m.lines[m.lines.length - 1] ?? "");
  }
  lastCount = m.lines.length;

  list.scrollTop = list.scrollHeight;
}

mountWebview<ActivityModel>({ onState: render });
