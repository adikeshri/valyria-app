/**
 * Model Chat — a plain chat window straight to whatever local model is
 * currently activated, over its own HTTP server. Unlike the Agent panel this
 * is raw model output, for trying a model out before pointing a role at it.
 */
import { mountWebview, announce } from "../shared/host";
import { h, empty, badge } from "../shared/render";
import { CMD, type ModelChatModel } from "../shared/protocol";
import "./modelChat.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;
let lastTranscriptLen = 0;

const roleLabel = (r: string) => r.replace(/_/g, " ");

function turnLabel(role: "user" | "assistant" | "error"): string {
  if (role === "user") return "You";
  if (role === "error") return "Error";
  return "Model";
}

function render(m: ModelChatModel): void {
  root.replaceChildren();

  if (!m.inferenceCapable) {
    root.append(
      empty("The running Core does not serve local inference (needs the `model_inference` capability).")
    );
    return;
  }

  if (m.servers.length === 0) {
    root.append(empty("No model is serving yet."));
    const open = h("button", { class: "vy-btn", type: "button" }, "Open Models") as HTMLButtonElement;
    open.addEventListener("click", () => ctrl?.command(CMD.openModelManager));
    root.append(open);
    return;
  }

  // --- role bar ---
  const bar = h("div", { class: "mc-rolebar" });
  bar.append(h("label", { class: "vy-empty", for: "mc-role" }, "Talking to"));
  const sel = h("select", { id: "mc-role", class: "mc-role-select" }) as HTMLSelectElement;
  for (const s of m.servers) {
    const opt = h("option", { value: s.role }, `${roleLabel(s.role)} · ${s.displayName}`) as HTMLOptionElement;
    if (s.role === m.role) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener("change", () => ctrl?.command(CMD.selectModelChatRole, { role: sel.value }));
  bar.append(sel);
  if (m.sending) bar.append(badge("generating…", "ok"));
  const clear = h("button", { class: "vy-btn mc-clear", type: "button" }, "Clear") as HTMLButtonElement;
  clear.disabled = m.transcript.length === 0 && !m.sending;
  clear.addEventListener("click", () => ctrl?.command(CMD.clearModelChat));
  bar.append(clear);
  root.append(bar);

  // --- transcript ---
  const list = h("ol", { class: "mc-log", "aria-label": "Model conversation" });
  if (m.transcript.length === 0) {
    root.append(empty("Send a message to try this model out."));
  }
  for (const t of m.transcript) {
    list.append(
      h(
        "li",
        { class: `mc-turn mc-turn--${t.role}` },
        h("span", { class: "mc-role", text: turnLabel(t.role) }),
        h("span", { class: "mc-text", text: t.text || (t.pending ? "…" : "") })
      )
    );
  }
  root.append(list);
  list.scrollTop = list.scrollHeight;

  if (m.transcript.length > lastTranscriptLen) {
    const last = m.transcript[m.transcript.length - 1];
    if (last && !last.pending) announce(last.text);
  }
  lastTranscriptLen = m.transcript.length;

  // --- composer ---
  const box = h("textarea", {
    class: "vy-input",
    rows: 3,
    "aria-label": "Message the model",
    placeholder: "Ask it anything — this goes straight to the model, no agent tools involved",
    "data-autofocus": true,
  }) as HTMLTextAreaElement;
  box.disabled = !m.canSend;

  const send = () => {
    const text = box.value.trim();
    if (!text || !m.canSend) return;
    ctrl?.command(CMD.sendModelChatMessage, { text });
    box.value = "";
  };
  const sendBtn = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, "Send") as HTMLButtonElement;
  sendBtn.disabled = !m.canSend;
  sendBtn.addEventListener("click", send);
  box.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
  });

  const actions = h("div", { class: "chat-actions" }, sendBtn);
  if (m.sending) {
    const stop = h("button", { class: "vy-btn", type: "button" }, "Stop") as HTMLButtonElement;
    stop.addEventListener("click", () => ctrl?.command(CMD.stopModelChatGeneration));
    actions.append(stop);
  }
  root.append(h("div", { class: "chat-composer" }, box, actions));
}

ctrl = mountWebview<ModelChatModel>({ onState: render });
