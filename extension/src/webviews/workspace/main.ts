/**
 * Task Workspace (docs/UX-DIFFERENTIATION.md, lever D) — the focused task as one
 * editor-area document: conversation, plan, changed files, verification, and any
 * pending approval. Same selectors as the sidebar Agent / Task views, one layout.
 */
import { mountWebview, announce } from "../shared/host";
import { h, section, badge, connBanner, stateLabel } from "../shared/render";
import { CMD, type WorkspaceModel } from "../shared/protocol";
import "./workspace.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;
let lastTranscript = 0;

function statusPill(m: WorkspaceModel): HTMLElement | null {
  if (m.blocked) return badge("blocked — waiting for approval", "warn");
  if (m.working) return badge("working…", "ok");
  if (m.terminal && m.state === "completed") return badge("completed", "ok");
  if (m.terminal && m.state === "failed") return badge("failed", "bad");
  if (m.state) return badge(stateLabel(m.state), "muted");
  return null;
}

function ownershipBadge(o: string | null): HTMLElement | null {
  if (!o) return null;
  if (o === "agent_authored") return badge("agent", "muted");
  if (o === "concurrent_user_modification") return badge("also edited by you", "warn");
  if (o === "pre_existing") return badge("pre-existing", "muted");
  return badge(o.replace(/_/g, " "), "muted");
}

function render(m: WorkspaceModel): void {
  root.replaceChildren();
  const banner = connBanner(m.connection);
  if (banner) root.append(banner);

  // --- header ---
  root.append(
    h(
      "div",
      { class: "ws-head" },
      h("span", { class: "ws-obj", text: m.objective ?? "No task in focus" }),
      statusPill(m),
      ...(m.taskId && !m.terminal
        ? (["pauseTask", "resumeTask", "cancelTask"] as const).map((c) => {
            const label = c === "pauseTask" ? "Pause" : c === "resumeTask" ? "Resume" : "Cancel";
            const b = h("button", { class: "vy-btn", type: "button" }, label) as HTMLButtonElement;
            b.addEventListener("click", () => ctrl?.command(CMD[c], {}));
            return b;
          })
        : [])
    )
  );

  // --- new-task composer (only when idle) ---
  if (m.canSubmit) {
    const box = h("textarea", {
      class: "vy-input",
      rows: 2,
      "aria-label": "Describe a task for the agent",
      placeholder: m.taskId ? "Start another task…" : "Describe a change for the agent…",
      "data-autofocus": true,
    }) as HTMLTextAreaElement;
    const b = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, "Start task") as HTMLButtonElement;
    const send = () => {
      const t = box.value.trim();
      if (!t) return;
      ctrl?.command(CMD.createTask, { objective: t });
      box.value = "";
      announce("Task submitted");
    };
    b.addEventListener("click", send);
    box.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
    });
    root.append(h("div", { class: "ws-composer" }, box, h("div", { class: "ws-composer-row" }, b)));
  }

  // --- approval callout ---
  if (m.approval) {
    const a = m.approval;
    const high = a.risk === "destructive" || a.risk === "network" || a.risk === "elevated";
    const allow = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, "Allow once") as HTMLButtonElement;
    const allowTask = h("button", { class: "vy-btn", type: "button" }, "Allow for task") as HTMLButtonElement;
    const deny = h("button", { class: "vy-btn", type: "button" }, "Deny") as HTMLButtonElement;
    allow.addEventListener("click", () => ctrl?.command(CMD.resolveApproval, { allow: true, seq: a.seq, scope: "once" }));
    allowTask.addEventListener("click", () => ctrl?.command(CMD.resolveApproval, { allow: true, seq: a.seq, scope: "task" }));
    deny.addEventListener("click", () => ctrl?.command(CMD.resolveApproval, { allow: false, seq: a.seq }));
    root.append(
      h(
        "div",
        { class: `ws-approval${high ? " ws-approval--high" : ""}`, role: "alertdialog", "aria-label": "Approval requested" },
        h("p", { class: "ws-approval-prompt", text: a.prompt }),
        h(
          "p",
          { class: "ws-approval-meta" },
          a.tool ? badge(a.tool, "muted") : null,
          a.risk ? badge(a.risk, high ? "bad" : "muted") : null
        ),
        h("div", { class: "ws-approval-actions" }, allow, allowTask, deny)
      )
    );
  }

  // --- plan ---
  if (m.planSteps.length) {
    const ol = h("ol", { class: "ws-plan", "aria-label": "Plan" });
    for (const s of m.planSteps) {
      ol.append(
        h(
          "li",
          { class: `ws-plan-step ws-plan-step--${s.status ?? "pending"}` },
          h("span", { class: "ws-plan-intent", text: s.intent }),
          s.checkpoint ? badge("checkpoint", "muted") : null,
          s.status ? badge(stateLabel(s.status), s.status === "done" ? "ok" : "muted") : null
        )
      );
    }
    root.append(section("Plan", ol));
  }

  // --- changed files ---
  if (m.files.length) {
    const list = h("ul", { class: "vy-list", "aria-label": "Changed files" });
    for (const f of m.files) {
      const openBtn = h("button", { class: "ws-filebtn", type: "button", title: "Open diff" }, f.path) as HTMLButtonElement;
      openBtn.addEventListener("click", () => ctrl?.command(CMD.openDiff, { path: f.path }));
      list.append(
        h(
          "li",
          { class: "ws-file" },
          openBtn,
          f.change ? badge(f.change, f.change === "deleted" ? "bad" : "muted") : null,
          ownershipBadge(f.ownership)
        )
      );
    }
    root.append(section(`Changed files (${m.files.length})`, list));
  }

  // --- tests ---
  if (m.tests.length) {
    const list = h("ul", { class: "vy-list", "aria-label": "Test runs" });
    for (const t of m.tests) {
      list.append(
        h(
          "li",
          { class: "ws-test" },
          h("span", { class: "vy-mono", text: t.command }),
          badge(t.outcome, t.outcome === "passed" ? "ok" : t.outcome === "failed" ? "bad" : "muted"),
          t.summary ? h("span", { class: "ws-test-sum", text: t.summary }) : null
        )
      );
    }
    root.append(section("Tests", list));
  }

  // --- verification ---
  if (m.verified.length || m.unverified.length) {
    const list = h("ul", { class: "vy-list", "aria-label": "Verification" });
    for (const v of m.verified) {
      list.append(
        h("li", { class: "ws-verify" }, badge(v.outcome, "ok"), h("span", { class: "vy-mono", text: v.command }), h("span", { text: v.kind }))
      );
    }
    for (const u of m.unverified) {
      list.append(h("li", { class: "ws-verify" }, badge("NOT RUN", "warn"), h("span", { text: u })));
    }
    root.append(section("Verification", list));
  }

  // --- transcript ---
  const log = h("ol", { class: "ws-log", "aria-label": "Conversation" });
  for (const e of m.transcript) {
    log.append(
      h(
        "li",
        { class: `ws-turn ws-turn--${e.role}` },
        h("span", { class: "ws-role", text: e.role === "you" ? "You" : "Agent" }),
        h("span", { class: "ws-text", text: e.text })
      )
    );
  }
  root.append(section("Conversation", log));
  log.scrollTop = log.scrollHeight;
  if (m.transcript.length > lastTranscript) {
    announce(m.transcript[m.transcript.length - 1]?.text ?? "");
  }
  lastTranscript = m.transcript.length;

  // --- footer ---
  const rev = h("button", { class: "vy-btn", type: "button" }, "Review changes ›") as HTMLButtonElement;
  rev.addEventListener("click", () => ctrl?.command(CMD.openSurface, { surface: "review" }));
  root.append(h("div", { class: "ws-footer" }, rev));
}

ctrl = mountWebview<WorkspaceModel>({ onState: render });
