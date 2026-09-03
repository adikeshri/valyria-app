/**
 * Agent Commands (PLAN.md §4.10 / D7).
 *
 * A read-only projection of the shell commands the *agent* ran, from
 * `tool_started` / `tool_completed`. It shares the panel area with the
 * integrated terminal but NEVER its buffer — every row is badged "agent".
 */
import { mountWebview } from "../shared/host";
import { h, badge, empty } from "../shared/render";
import type { AgentCommandsModel } from "../shared/protocol";
import "./commands.css";

const root = document.getElementById("root")!;
const open = new Set<number>();

function render(m: AgentCommandsModel): void {
  root.replaceChildren();
  if (!m.taskId || m.commands.length === 0) {
    root.append(empty("The agent has not run any commands."));
    return;
  }
  const list = h("div", { class: "cmd-list", "aria-label": "Agent-run commands" });
  for (const c of m.commands) {
    const line = `${c.program}${c.args.length ? " " + c.args.join(" ") : ""}`;
    const status = c.pending
      ? badge("running", "muted")
      : c.succeeded === false || (c.exitCode ?? 0) !== 0
        ? badge(`exit ${c.exitCode ?? "?"}`, "bad")
        : badge("ok", "ok");

    const d = h("details", { class: "cmd-row" }) as HTMLDetailsElement;
    d.open = open.has(c.seq);
    d.addEventListener("toggle", () => (d.open ? open.add(c.seq) : open.delete(c.seq)));
    d.append(
      h(
        "summary",
        { class: "cmd-summary" },
        badge("agent", "muted"),
        status,
        h("span", { class: "cmd-cmd vy-mono", text: line }),
        c.durationMs != null ? h("span", { class: "vy-empty", text: `${c.durationMs}ms` }) : null
      )
    );
    const body = c.raw ?? [c.stdout, c.stderr].filter(Boolean).join("\n--- stderr ---\n");
    d.append(h("pre", { class: "cmd-out vy-mono", text: body || "(no output)" }));
    list.append(d);
  }
  root.append(list);
}

mountWebview<AgentCommandsModel>({
  onState: render,
  restore: (s) => Array.isArray(s) && s.forEach((n) => open.add(Number(n))),
});
