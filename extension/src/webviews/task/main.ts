/**
 * Task — objective, plan + checkpoints, changed files, tests, a pending
 * approval (PLAN.md §4.6, §12). All read from `@valyria/state` projections;
 * this only renders. Rollback/approval actions are wired in later phases.
 */
import { mountWebview } from "../shared/host";
import { h, section, badge, empty, stateLabel } from "../shared/render";
import { CMD, type TaskModel } from "../shared/protocol";
import "./task.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

function outcomeBadge(o: "started" | "passed" | "failed"): HTMLElement {
  return badge(o, o === "passed" ? "ok" : o === "failed" ? "bad" : "muted");
}

function render(m: TaskModel): void {
  root.replaceChildren();

  if (!m.taskId) {
    root.append(empty("No task selected. Start one from the Agent view."));
    return;
  }

  root.append(
    h(
      "div",
      { class: "task-head" },
      h("span", { class: "task-objective", text: m.objective ?? "(objective pending)" }),
      badge(stateLabel(m.state), m.terminal && m.state === "completed" ? "ok" : m.terminal ? "bad" : "muted")
    )
  );

  // --- pending approval (surfaced here too; the Approvals view drives it) ---
  if (m.approval) {
    const box = h(
      "div",
      { class: "task-approval", role: "group", "aria-label": "Approval required" },
      h("strong", { text: "Approval required" }),
      h("p", { class: "vy-mono", text: m.approval.prompt }),
      m.approval.tool ? h("p", { class: "vy-empty", text: `tool: ${m.approval.tool}` }) : null,
      m.approval.risk ? badge(`risk: ${m.approval.risk}`, "warn") : null
    );
    root.append(box);
  }

  // --- plan ---
  root.append(
    section(
      "Plan",
      m.planSteps.length
        ? h(
            "ol",
            { class: "task-plan" },
            ...m.planSteps.map((s) =>
              h(
                "li",
                { class: `task-step task-step--${s.status ?? "pending"}` },
                h("span", { class: "task-step-intent", text: s.intent }),
                s.checkpoint ? badge("checkpoint", "muted") : null,
                s.status ? h("span", { class: "task-step-status", text: s.status }) : null
              )
            )
          )
        : empty("No plan yet.")
    )
  );

  // --- changed files ---
  root.append(
    section(
      `Changed files (${m.files.length})`,
      m.files.length
        ? h(
            "ul",
            { class: "vy-list" },
            ...m.files.map((f) =>
              h(
                "li",
                {},
                h("span", { class: "vy-mono", text: f.path }),
                f.change ? badge(f.change, "muted") : null
              )
            )
          )
        : empty("No files changed yet.")
    )
  );

  // --- checkpoints / rollback (§16) ---
  if (m.checkpoints.length) {
    root.append(
      section(
        "Checkpoints",
        h(
          "ul",
          { class: "vy-list" },
          ...m.checkpoints.map((c) => {
            const li = h(
              "li",
              { class: "task-cp" },
              h("span", { text: c.intent ?? c.stepId ?? "(checkpoint)" }),
              c.rollbackBoundary ? badge("rollback boundary", "muted") : null
            );
            if (c.rollbackReady && c.checkpointId) {
              const b = h("button", { class: "vy-btn", type: "button" }, "Roll back to here") as HTMLButtonElement;
              b.addEventListener("click", () =>
                ctrl?.command(CMD.rollbackTo, { checkpointId: c.checkpointId, intent: c.intent })
              );
              li.append(b);
            } else {
              li.append(
                h("span", { class: "vy-empty", text: c.checkpointId ? "" : "no checkpoint id — rollback unavailable" })
              );
            }
            return li;
          })
        )
      )
    );
  }

  // --- verification ---
  root.append(
    section(
      "Verification",
      m.tests.length
        ? h(
            "ul",
            { class: "vy-list" },
            ...m.tests.map((t) =>
              h(
                "li",
                {},
                outcomeBadge(t.outcome),
                h("span", { class: "vy-mono", text: t.command }),
                t.summary ? h("span", { class: "vy-empty", text: t.summary }) : null,
                ...(t.failures ?? []).flatMap((f) =>
                  f.locations.map((loc) => {
                    const a = h("a", { href: "#", class: "task-loc vy-mono" }, `${loc.path}${loc.line ? `:${loc.line}` : ""}`);
                    a.addEventListener("click", (e) => {
                      e.preventDefault();
                      ctrl?.command(CMD.openFile, { path: loc.path, line: loc.line ?? undefined });
                    });
                    return a;
                  })
                )
              )
            )
          )
        : empty("NOT RUN — no verification evidence yet.")
    )
  );

  if (m.agentCommandCount) {
    root.append(
      h("p", { class: "vy-empty" }, `${m.agentCommandCount} agent command(s) — see the Agent Commands view.`)
    );
  }

  // --- lifecycle actions ---
  if (!m.terminal) {
    const row = h("div", { class: "task-actions" });
    const mk = (label: string, cmd: string) => {
      const b = h("button", { class: "vy-btn", type: "button" }, label) as HTMLButtonElement;
      b.addEventListener("click", () => ctrl?.command(cmd, { taskId: m.taskId }));
      return b;
    };
    if (m.state === "paused") row.append(mk("Resume", CMD.resumeTask));
    else row.append(mk("Pause", CMD.pauseTask));
    row.append(mk("Cancel", CMD.cancelTask));
    root.append(row);
  }
}

ctrl = mountWebview<TaskModel>({ onState: render });
