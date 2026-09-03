/**
 * Valyria Home (docs/UX-DIFFERENTIATION.md, lever D) — the editor tab you land
 * on. A task prompt, active + recent tasks, the runtime marker. This is what
 * replaces the Code-OSS Welcome page (`workbench.startupEditor: none` + an
 * opener in extension.ts).
 *
 * No agent logic: the composer emits `createTask`; every row is a projection.
 */
import { mountWebview, announce } from "../shared/host";
import { h, brandLockup, section, badge, connBanner } from "../shared/render";
import { CMD, type HomeModel, type HomeTask } from "../shared/protocol";
import "./home.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;

function taskRow(t: HomeTask, kind: "active" | "recent"): HTMLElement {
  const tone = t.blocked
    ? "warn"
    : t.state === "failed"
      ? "bad"
      : t.state === "completed"
        ? "ok"
        : "muted";
  const open = h(
    "button",
    { class: "vy-btn", type: "button" },
    kind === "active" ? "Open workspace" : "Open"
  ) as HTMLButtonElement;
  open.addEventListener("click", () => {
    ctrl?.command(CMD.focusTask, { taskId: t.id });
    ctrl?.command(CMD.openSurface, { surface: "workspace" });
  });
  return h(
    "li",
    { class: "home-task" },
    h(
      "div",
      { class: "home-task-main" },
      h("span", { class: "home-task-obj", text: t.objective ?? t.id }),
      h(
        "div",
        { class: "home-task-meta" },
        badge(t.state.replace(/_/g, " "), tone),
        t.filesTouched > 0
          ? h("span", { class: "vy-badge vy-badge--muted", text: `${t.filesTouched} file${t.filesTouched === 1 ? "" : "s"}` })
          : null,
        kind === "recent" ? h("span", { class: "home-task-when", text: t.when }) : null
      )
    ),
    open
  );
}

function render(m: HomeModel): void {
  root.replaceChildren();
  root.append(brandLockup("A local-first autonomous engineer"));

  const banner = connBanner(m.connection);
  if (banner) root.append(banner);

  // --- composer ---
  const box = h("textarea", {
    class: "vy-input home-composer-input",
    rows: 3,
    "aria-label": "Describe a task for the agent",
    placeholder: "Describe a change — e.g. Add a --json flag to the export command and cover it with a test",
    "data-autofocus": true,
  }) as HTMLTextAreaElement;
  box.disabled = !m.canSubmit;
  const submit = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, "Start task") as HTMLButtonElement;
  submit.disabled = !m.canSubmit;
  const send = () => {
    const text = box.value.trim();
    if (!text || !m.canSubmit) return;
    ctrl?.command(CMD.createTask, { objective: text });
    ctrl?.command(CMD.openSurface, { surface: "workspace" });
    box.value = "";
    announce("Task submitted");
  };
  submit.addEventListener("click", send);
  box.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
  });
  root.append(
    h(
      "div",
      { class: "home-composer" },
      box,
      h(
        "div",
        { class: "home-composer-row" },
        h(
          "span",
          { class: "home-hint" },
          m.canSubmit ? "⌘↵ to start" : m.connection === "ready" ? "A task is already running" : "Waiting for Core…"
        ),
        submit
      )
    )
  );

  if (!m.hasRepo) {
    root.append(
      h("p", { class: "vy-empty" }, "No repository open. Opening a folder is the authorization — the agent only reads and writes inside it.")
    );
  }

  // --- runtime marker ---
  root.append(
    h(
      "div",
      { class: "home-runtime" },
      h("span", { class: `vy-badge ${m.networkRuntime ? "vy-badge--warn" : "vy-badge--ok"}` }, m.networkRuntime ? "Network runtime" : "Local · Offline"),
      m.activeModel ? h("span", { class: "vy-badge vy-badge--muted", text: `Model: ${m.activeModel}` }) : null,
      m.autonomy ? h("span", { class: "vy-badge vy-badge--muted", text: `Autonomy: ${m.autonomy}` }) : null,
      (() => {
        const b = h("button", { class: "home-linkbtn", type: "button" }, `Layout: ${m.layoutMode}`) as HTMLButtonElement;
        b.addEventListener("click", () =>
          ctrl?.command(CMD.setLayoutMode, { mode: m.layoutMode === "agent" ? "editor" : "agent" })
        );
        return b;
      })()
    )
  );

  // --- active ---
  if (m.active.length) {
    const list = h("ul", { class: "vy-list home-tasks", "aria-label": "Active tasks" });
    for (const t of m.active) list.append(taskRow(t, "active"));
    root.append(section("Active", list));
  }

  // --- recent ---
  const recentList = h("ul", { class: "vy-list home-tasks", "aria-label": "Recent tasks" });
  if (m.recent.length) {
    for (const t of m.recent) recentList.append(taskRow(t, "recent"));
    root.append(section("Recent", recentList));
  } else if (!m.active.length) {
    root.append(section("Recent", h("p", { class: "vy-empty" }, "No tasks yet. Describe one above.")));
  }

  // --- quick actions ---
  const review = h("button", { class: "vy-btn", type: "button" }, "Review changes") as HTMLButtonElement;
  review.addEventListener("click", () => ctrl?.command(CMD.openSurface, { surface: "review" }));
  root.append(h("div", { class: "home-actions" }, review));
}

ctrl = mountWebview<HomeModel>({ onState: render });
