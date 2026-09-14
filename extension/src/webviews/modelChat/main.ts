/**
 * Model Chat — the product's primary surface. A message here becomes a
 * real Core task: the full agent loop (system prompt, tools, plan,
 * verification), not a raw model probe. The left sidebar carries nothing
 * but Models, so task progress, tool activity, and approvals all surface
 * inline here instead of in their own panels.
 */
import { mountWebview, announce } from "../shared/host";
import { h, empty, badge, connBanner } from "../shared/render";
import { CMD, type ModelChatModel } from "../shared/protocol";
import "./modelChat.css";

const root = document.getElementById("root")!;
let ctrl: { command: (n: string, a?: unknown) => void } | undefined;
let lastTranscriptLen = 0;

const HIGH_RISK = new Set(["destructive", "network", "elevated"]);

function statusPill(m: ModelChatModel): HTMLElement | null {
  if (m.blocked) return badge("blocked — waiting for approval", "warn");
  if (m.working) return badge("working…", "ok");
  if (m.terminal && m.state === "completed") return badge("completed", "ok");
  if (m.terminal && m.state === "failed") return badge("failed", "bad");
  if (m.state) return badge(m.state.replace(/_/g, " "), "muted");
  return null;
}

function approvalCard(m: ModelChatModel): HTMLElement | null {
  const ap = m.approval;
  if (!ap) return null;
  const high = ap.risk ? HIGH_RISK.has(ap.risk) : false;
  announce(`Approval required: ${ap.prompt}`);

  const card = h("div", {
    class: `mc-apv${high ? " mc-apv--high" : ""}`,
    role: "group",
    "aria-label": "Approval required",
  });
  card.append(
    h(
      "div",
      { class: "mc-apv-head" },
      h("strong", { text: "Approval required" }),
      ap.risk ? badge(ap.risk, high ? "bad" : "muted") : null
    ),
    h("p", { class: "mc-apv-prompt", text: ap.prompt })
  );

  const meta = h("dl", { class: "mc-apv-meta" });
  const add = (k: string, v: string | null) => {
    if (!v) return;
    meta.append(h("dt", { text: k }), h("dd", { class: "vy-mono", text: v }));
  };
  add("tool", ap.tool);
  add("category", ap.category);
  add("target", ap.target);
  if (meta.childElementCount) card.append(meta);

  const actions = h("div", { class: "mc-apv-actions" });
  const deny = h("button", { class: "vy-btn", type: "button", "data-autofocus": true }, "Deny") as HTMLButtonElement;
  deny.addEventListener("click", () => ctrl?.command(CMD.resolveApproval, { allow: false, seq: ap.seq }));
  const doAllow = (scope: "once" | "task") =>
    ctrl?.command(CMD.resolveApproval, { allow: true, seq: ap.seq, scope });

  if (high) {
    const arm = h("button", { class: "vy-btn", type: "button" }, "Allow…") as HTMLButtonElement;
    arm.addEventListener("click", () => {
      const confirm = h("button", { class: "vy-btn vy-btn--primary mc-apv-confirm", type: "button" }, "Confirm — allow this") as HTMLButtonElement;
      confirm.addEventListener("click", () => doAllow("once"));
      arm.replaceWith(confirm);
    });
    actions.append(deny, arm);
  } else {
    const allow = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, "Allow once") as HTMLButtonElement;
    allow.addEventListener("click", () => doAllow("once"));
    actions.append(deny, allow);
    if (ap.allowForTaskSupported) {
      const forTask = h("button", { class: "vy-btn", type: "button" }, "Allow for task") as HTMLButtonElement;
      forTask.addEventListener("click", () => doAllow("task"));
      actions.append(forTask);
    }
  }
  card.append(actions);
  return card;
}

function render(m: ModelChatModel): void {
  root.replaceChildren();

  const banner = connBanner(m.connection);
  if (banner) root.append(banner);

  if (!m.inferenceCapable) {
    root.append(empty("The running Core does not serve local inference (needs the `model_inference` capability)."));
    return;
  }

  // --- status line: the model picker itself ---
  const status = h("div", { class: "mc-status" });
  if (m.models.length === 0) {
    status.append(h("span", { class: "vy-empty", text: "No models installed yet." }));
    const open = h("button", { class: "vy-btn", type: "button" }, "Open Models") as HTMLButtonElement;
    open.addEventListener("click", () => ctrl?.command(CMD.openModelManager));
    status.append(open);
  } else {
    const sel = h("select", {
      class: "vy-select mc-model-select",
      "aria-label": "Active coding model",
    }) as HTMLSelectElement;
    if (!m.activeModelId) {
      sel.append(h("option", { value: "", disabled: true, selected: true }, "Choose a model…"));
    }
    for (const model of m.models) {
      const label = model.unratedForCoding ? `⚠ ${model.displayName} (not rated for coding)` : model.displayName;
      const opt = h("option", { value: model.id }, label) as HTMLOptionElement;
      if (model.id === m.activeModelId) opt.selected = true;
      sel.append(opt);
    }
    sel.disabled = m.activating;
    sel.addEventListener("change", () => ctrl?.command(CMD.activateModel, { id: sel.value }));
    status.append(sel);
    if (m.activating) status.append(h("span", { class: "vy-empty", text: "Activating…" }));
    // The dropdown's own option text carries the warning for anything you
    // might *switch to*; this repeats it for whatever's active right now,
    // since that's exactly the "why is chat behaving strangely" case —
    // Qwen2.5-Coder 1.5B (tuned for autocomplete, not primary_coder) is
    // the model that motivated this: it hallucinates a tool call for a
    // plain "Hi" instead of just replying.
    const activeModel = m.models.find((x) => x.id === m.activeModelId);
    if (activeModel?.unratedForCoding) {
      status.append(badge("not rated for coding — expect erratic behavior", "warn"));
    }
  }
  const pill = statusPill(m);
  if (pill) status.append(pill);
  root.append(status);

  const apCard = approvalCard(m);
  if (apCard) root.append(apCard);

  // --- transcript ---
  const list = h("ol", { class: "mc-log", "aria-label": "Conversation" });
  if (m.transcript.length === 0) {
    root.append(empty(m.activeModelId ? "Ask it to do something in this repo." : "Pick a coding model above, then ask it to do something in this repo."));
  }
  for (const e of m.transcript) {
    list.append(
      h(
        "li",
        { class: `mc-turn mc-turn--${e.role}` },
        h("span", { class: "mc-role", text: e.role === "you" ? "You" : "Agent" }),
        h("span", { class: "mc-text", text: e.text })
      )
    );
  }
  root.append(list);
  list.scrollTop = list.scrollHeight;
  if (m.transcript.length > lastTranscriptLen) {
    announce(m.transcript[m.transcript.length - 1]?.text ?? "");
  }
  lastTranscriptLen = m.transcript.length;

  // --- composer ---
  const box = h("textarea", {
    class: "vy-input",
    rows: 3,
    "aria-label": "Ask the agent to do something",
    placeholder: "e.g. Add a --json flag to the export command and cover it with a test",
    "data-autofocus": true,
  }) as HTMLTextAreaElement;
  box.disabled = !m.canSubmit;

  const send = h("button", { class: "vy-btn vy-btn--primary", type: "button" }, "Send") as HTMLButtonElement;
  send.disabled = !m.canSubmit;
  const doSend = () => {
    const text = box.value.trim();
    if (!text || !m.canSubmit) return;
    ctrl?.command(CMD.createTask, { objective: text });
    box.value = "";
    announce("Message sent");
  };
  send.addEventListener("click", doSend);
  box.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doSend();
  });

  const actions = h("div", { class: "chat-actions" }, send);
  if (m.working) {
    const stop = h("button", { class: "vy-btn", type: "button" }, "Stop") as HTMLButtonElement;
    stop.addEventListener("click", () => ctrl?.command(CMD.cancelTask, { taskId: m.taskId }));
    actions.append(stop);
  }
  root.append(h("div", { class: "chat-composer" }, box, actions));
}

ctrl = mountWebview<ModelChatModel>({ onState: render });
