/**
 * Agent — task entry + the focused task's conversation (PLAN.md §8).
 * Not a chatbot: submitting text becomes `task_create`; the transcript is a
 * projection of that task's events. No model reasoning text (§10).
 */
import { mountWebview, announce } from "../shared/host";
import { h, connBanner, badge } from "../shared/render";
import { CMD, type ChatModel } from "../shared/protocol";
import "./chat.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;
let lastTranscriptLen = 0;

function statusPill(m: ChatModel): HTMLElement | null {
  if (m.blocked) return badge("blocked — waiting for approval", "warn");
  if (m.working) return badge("working…", "ok");
  if (m.terminal && m.state === "completed") return badge("completed", "ok");
  if (m.terminal && m.state === "failed") return badge("failed", "bad");
  if (m.state) return badge(m.state.replace(/_/g, " "), "muted");
  return null;
}

function render(m: ChatModel): void {
  root.replaceChildren();
  const banner = connBanner(m.connection);
  if (banner) root.append(banner);

  // --- composer ---
  const box = h("textarea", {
    class: "vy-input",
    rows: 3,
    "aria-label": "Describe a task for the agent",
    placeholder: "e.g. Add a --json flag to the export command and cover it with a test",
    "data-autofocus": true,
  }) as HTMLTextAreaElement;
  box.disabled = !m.canSubmit;

  const submit = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, "Start task") as HTMLButtonElement;
  submit.disabled = !m.canSubmit;
  const send = () => {
    const text = box.value.trim();
    if (!text || !m.canSubmit) return;
    ctrl?.command(CMD.createTask, { objective: text });
    box.value = "";
    announce("Task submitted");
  };
  submit.addEventListener("click", send);
  box.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
  });

  root.append(h("div", { class: "chat-composer" }, box, h("div", { class: "chat-actions" }, submit)));

  if (!m.canSubmit && !m.taskId) {
    root.append(h("p", { class: "vy-empty" }, m.connection === "ready" ? "" : "Waiting for Core…"));
  }

  // --- transcript ---
  const pill = statusPill(m);
  root.append(
    h(
      "div",
      { class: "chat-head" },
      h("span", { class: "chat-objective", text: m.objective ?? "No task yet" }),
      pill
    )
  );

  const list = h("ol", { class: "chat-log", "aria-label": "Conversation" });
  for (const e of m.transcript) {
    list.append(
      h(
        "li",
        { class: `chat-turn chat-turn--${e.role}` },
        h("span", { class: "chat-role", text: e.role === "you" ? "You" : "Agent" }),
        h("span", { class: "chat-text", text: e.text })
      )
    );
  }
  root.append(list);
  list.scrollTop = list.scrollHeight;

  if (m.transcript.length > lastTranscriptLen) {
    announce(m.transcript[m.transcript.length - 1]?.text ?? "");
  }
  lastTranscriptLen = m.transcript.length;
}

ctrl = mountWebview<ChatModel>({ onState: render });
