/**
 * Render smoke test: load each built webview IIFE bundle into jsdom, stub
 * `acquireVsCodeApi`, push a representative model, and assert `#root` gets
 * meaningful content — no thrown errors, no "[object Object]", key text present.
 *
 * This is the CI stand-in for the visual pass (the harness here can't drive the
 * real VS Code webview).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../out/webviews");

interface PostedMsg {
  type: string;
  [k: string]: unknown;
}

function mount(bundle: string, model: unknown): { root: HTMLElement; posted: PostedMsg[] } {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div></body>`, {
    url: "https://example.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window as unknown as Window & typeof globalThis & Record<string, unknown>;
  const posted: PostedMsg[] = [];
  (w as Record<string, unknown>)["acquireVsCodeApi"] = () => ({
    postMessage: (m: PostedMsg) => posted.push(m),
    getState: () => undefined,
    setState: () => {},
  });
  // rAF is used by announce(); make it synchronous-ish.
  w.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof w.requestAnimationFrame;

  const code = readFileSync(join(out, `${bundle}.js`), "utf8");
  w.eval(code);

  // the bundle called mountWebview -> posted {type:"ready"} and registered a
  // message listener. Deliver a state push the way the host would.
  w.dispatchEvent(
    Object.assign(new dom.window.MessageEvent("message", { data: { type: "state", view: bundle, model } }))
  );

  return { root: dom.window.document.getElementById("root") as HTMLElement, posted };
}

test("chat renders the transcript and composer", () => {
  const { root, posted } = mount("chat", {
    connection: "ready",
    taskId: "t1",
    objective: "Add a --json flag",
    state: "implementing",
    terminal: false,
    working: true,
    blocked: false,
    canSubmit: false,
    transcript: [
      { seq: 1, role: "you", text: "Add a --json flag" },
      { seq: 3, role: "agent", text: "Editing src/cli.rs" },
    ],
  });
  assert.ok(posted.some((m) => m.type === "ready"), "posted ready");
  assert.match(root.textContent ?? "", /Add a --json flag/);
  assert.match(root.textContent ?? "", /Editing src\/cli\.rs/);
  assert.ok(root.querySelector("textarea"), "has a composer");
  assert.doesNotMatch(root.textContent ?? "", /\[object Object\]|undefined/);
});

test("task renders plan, files, verification, approval", () => {
  const { root } = mount("task", {
    taskId: "t1",
    objective: "Fix rounding",
    state: "implementing",
    terminal: false,
    planSteps: [{ intent: "Add guard", status: "active", checkpoint: true }],
    checkpoints: [{ stepId: "s1", intent: "Add guard", rollbackBoundary: true }],
    files: [{ path: "src/billing.py", change: "modified" }],
    tests: [{ command: "pytest", outcome: "failed", summary: "1 failed", failureCount: 1 }],
    approval: { prompt: "Run rm -rf build?", tool: "run_command", risk: "destructive" },
    agentCommandCount: 2,
  });
  const txt = root.textContent ?? "";
  assert.match(txt, /Add guard/);
  assert.match(txt, /src\/billing\.py/);
  assert.match(txt, /pytest/);
  assert.match(txt, /Run rm -rf build\?/);
  assert.match(txt, /Approval required/);
  assert.doesNotMatch(txt, /\[object Object\]/);
});

test("timeline renders one expandable row per event with raw JSON", () => {
  const { root } = mount("timeline", {
    rows: [
      { seq: 2, ts: 2, kind: "state_changed", taskId: "t1", degraded: false, summary: "→ IMPLEMENTING", raw: '{"to":"IMPLEMENTING"}' },
      { seq: 1, ts: 1, kind: "task_started", taskId: "t1", degraded: false, summary: "Task started", raw: "{}" },
    ],
  });
  assert.equal(root.querySelectorAll("details").length, 2);
  assert.match(root.textContent ?? "", /state_changed/);
  assert.match(root.querySelector("pre")?.textContent ?? "", /IMPLEMENTING/);
});

test("history renders grouped tasks and posts focusTask on click", () => {
  const { root, posted } = mount("history", {
    focusedTaskId: "t1",
    groups: [
      {
        day: "2026-09-02",
        tasks: [
          { id: "t1", objective: "Task one", state: "implementing", terminal: false, blocked: false, focused: true },
          { id: "t0", objective: "Task zero", state: "completed", terminal: true, blocked: false, focused: false },
        ],
      },
    ],
  });
  assert.match(root.textContent ?? "", /Task one/);
  assert.match(root.textContent ?? "", /2026-09-02/);
  const buttons = root.querySelectorAll("button.hist-item");
  assert.equal(buttons.length, 2);
  (buttons[1] as HTMLButtonElement).click();
  assert.ok(
    posted.some((m) => m.type === "command" && m["name"] === "focusTask"),
    "clicking a history row posts focusTask"
  );
});

test("modelChat renders the transcript and posts createTask on send", () => {
  const { root, posted } = mount("modelChat", {
    connection: "ready",
    inferenceCapable: true,
    activeModel: { role: "primary_coder", displayName: "Qwen2.5 Coder 7B" },
    taskId: "t1",
    objective: "Add a --json flag",
    state: "completed",
    terminal: true,
    working: false,
    blocked: false,
    canSubmit: true,
    transcript: [
      { seq: 1, role: "you", text: "Add a --json flag" },
      { seq: 2, role: "agent", text: "hello there" },
    ],
    approval: null,
  });
  assert.match(root.textContent ?? "", /hello there/);
  assert.match(root.textContent ?? "", /Qwen2\.5 Coder 7B/);
  assert.doesNotMatch(root.textContent ?? "", /\[object Object\]|undefined/);

  const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
  textarea.value = "what is 2+2?";
  const sendBtn = [...root.querySelectorAll("button")].find((b) => b.textContent === "Send") as HTMLButtonElement;
  sendBtn.click();
  assert.ok(
    posted.some((m) => m.type === "command" && m["name"] === "createTask" && (m["args"] as { objective?: string })?.objective === "what is 2+2?"),
    "clicking Send posts createTask with the composer text"
  );
});

test("modelChat with no model bound to primary_coder shows an empty state and an Open Models affordance", () => {
  const { root, posted } = mount("modelChat", {
    connection: "ready",
    inferenceCapable: true,
    activeModel: null,
    taskId: null,
    objective: null,
    state: null,
    terminal: false,
    working: false,
    blocked: false,
    canSubmit: true,
    transcript: [],
    approval: null,
  });
  assert.match(root.textContent ?? "", /No model set up for coding yet/);
  const openBtn = [...root.querySelectorAll("button")].find((b) => b.textContent === "Open Models") as HTMLButtonElement;
  assert.ok(openBtn, "has an Open Models button");
  openBtn.click();
  assert.ok(
    posted.some((m) => m.type === "command" && m["name"] === "openModelManager"),
    "clicking Open Models posts openModelManager"
  );
});

test("modelChat surfaces a pending approval inline and posts resolveApproval", () => {
  const { root, posted } = mount("modelChat", {
    connection: "ready",
    inferenceCapable: true,
    activeModel: { role: "primary_coder", displayName: "Qwen2.5 Coder 7B" },
    taskId: "t1",
    objective: "Add a --json flag",
    state: "waiting_for_permission",
    terminal: false,
    working: false,
    blocked: true,
    canSubmit: false,
    transcript: [{ seq: 1, role: "you", text: "Add a --json flag" }],
    approval: {
      seq: 3,
      prompt: "Run rm -rf build?",
      tool: "run_command",
      category: "filesystem",
      target: "build/",
      risk: "destructive",
      allowForTaskSupported: true,
    },
  });
  assert.match(root.textContent ?? "", /Run rm -rf build\?/);
  const deny = [...root.querySelectorAll("button")].find((b) => b.textContent === "Deny") as HTMLButtonElement;
  deny.click();
  assert.ok(
    posted.some((m) => m.type === "command" && m["name"] === "resolveApproval" && (m["args"] as { allow?: boolean; seq?: number })?.allow === false && (m["args"] as { seq?: number })?.seq === 3),
    "clicking Deny posts resolveApproval with allow: false"
  );
});

test("activity renders narrative lines + degraded notice", () => {
  const { root } = mount("activity", {
    connection: "ready",
    degraded: 2,
    lines: ["Task started", "Editing src/cli.rs", "Tests failed"],
  });
  assert.match(root.textContent ?? "", /Editing src\/cli\.rs/);
  assert.match(root.textContent ?? "", /2 events? could not be read/);
});
