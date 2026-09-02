/**
 * Phase 4 — approvals (G2 supersession, risk treatment) + security/autonomy
 * (D8: only sourced lines).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { replay, approvalIsCurrent } from "@valyria/state";
import { JSDOM } from "jsdom";
import { approvalsModel, securityModel } from "../src/store/models.ts";
import type { CoreEvent } from "../src/bridge/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../out/webviews");

const blockedTrace: CoreEvent[] = [
  { seq: 1, task_id: "t1", ts_ms: 1, kind: "task_started", payload: {} },
  { seq: 2, task_id: "t1", ts_ms: 2, kind: "state_changed", payload: { from: "IMPLEMENTING", to: "WAITING_FOR_PERMISSION" } },
  { seq: 3, task_id: "t1", ts_ms: 3, kind: "approval_requested", payload: { prompt: "Run rm -rf build?", tool: "run_command", risk: "destructive", category: "filesystem", target: "build/" } },
];

test("approvalsModel: a pending destructive approval, with metadata", () => {
  const m = approvalsModel(replay(blockedTrace), undefined, true);
  assert.equal(m.taskId, "t1");
  assert.ok(m.approval);
  assert.equal(m.approval!.seq, 3);
  assert.equal(m.approval!.risk, "destructive");
  assert.equal(m.approval!.tool, "run_command");
  assert.equal(m.approval!.target, "build/");
  assert.equal(m.allowForTaskSupported, true);
});

test("approvalsModel: no approval once the task moves on", () => {
  const m = approvalsModel(
    replay([...blockedTrace, { seq: 4, task_id: "t1", ts_ms: 4, kind: "state_changed", payload: { from: "WAITING_FOR_PERMISSION", to: "IMPLEMENTING" } }]),
    undefined,
    false
  );
  assert.equal(m.approval, null);
  assert.equal(m.allowForTaskSupported, false);
});

test("G2 supersession: a newer approval_requested invalidates the old seq", () => {
  const state = replay([
    ...blockedTrace,
    { seq: 4, task_id: "t1", ts_ms: 4, kind: "approval_requested", payload: { prompt: "Actually, delete node_modules?", risk: "destructive" } },
  ]);
  assert.equal(approvalIsCurrent(state, "t1", 3), false, "old prompt is stale");
  assert.equal(approvalIsCurrent(state, "t1", 4), true, "newest prompt is current");
  assert.equal(approvalsModel(state, undefined, true).approval!.seq, 4);
});

test("securityModel: autonomy canChange needs an owned daemon and no active task", () => {
  const base = {
    configEntries: null,
    doctor: null,
    repoInstructions: [],
    session: { permissionMode: "manual", ownsDaemon: true, protocolVersion: "1.10.0", runtimeVersion: "x" },
  };
  assert.equal(securityModel({ ...base, activeTasks: 0 }).autonomy.canChange, true);
  assert.equal(securityModel({ ...base, activeTasks: 1 }).autonomy.canChange, false);
  assert.equal(
    securityModel({ ...base, session: { ...base.session, ownsDaemon: false }, activeTasks: 0 }).autonomy.canChange,
    false
  );
  assert.equal(securityModel({ ...base, session: null, activeTasks: 0 }).autonomy.canChange, false);
});

test("securityModel: unreported keys are 'not reported', never invented (D8)", () => {
  const m = securityModel({
    configEntries: [{ key: "network", value: "denied", origin: "workspace" }],
    doctor: {
      summary: "warn",
      checks: [
        { name: "sandbox.enabled", status: "pass", detail: "seatbelt active" },
        { name: "model.present", status: "warn", detail: "no model", remediation: "install one" },
      ],
    },
    session: null,
    activeTasks: 0,
    repoInstructions: [{ name: "VALYRIA.md", text: "be careful", authorized: true }],
  });
  const net = m.settings.find((s) => s.key === "network")!;
  assert.equal(net.reported, true);
  assert.equal(net.value, "denied");
  const sandbox = m.settings.find((s) => s.key === "sandbox")!;
  assert.equal(sandbox.reported, false);
  assert.equal(sandbox.value, null);
  // doctor checks are filtered to security-relevant names
  assert.equal(m.checks.length, 1);
  assert.equal(m.checks[0]!.name, "sandbox.enabled");
  assert.equal(m.repoInstructions[0]!.authorized, true);
});

// --- render smoke ---

function mount(bundle: string, model: unknown): { root: HTMLElement; posted: Record<string, unknown>[] } {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div></body>`, {
    url: "https://x.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window as unknown as Window & Record<string, unknown>;
  const posted: Record<string, unknown>[] = [];
  (w as Record<string, unknown>)["acquireVsCodeApi"] = () => ({
    postMessage: (mm: Record<string, unknown>) => posted.push(mm),
    getState: () => undefined,
    setState: () => {},
  });
  w.requestAnimationFrame = ((cb: FrameRequestCallback) => (cb(0), 0)) as typeof w.requestAnimationFrame;
  w.eval(readFileSync(join(out, `${bundle}.js`), "utf8"));
  w.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "state", view: bundle, model } }));
  return { root: dom.window.document.getElementById("root") as HTMLElement, posted };
}

test("approvals render: destructive prompt needs a second click to allow", () => {
  const { root, posted } = mount("approvals", {
    taskId: "t1",
    allowForTaskSupported: true,
    approval: { seq: 3, prompt: "Run rm -rf build?", tool: "run_command", category: "fs", target: "build/", risk: "destructive" },
  });
  assert.match(root.textContent ?? "", /Run rm -rf build\?/);
  assert.ok(root.querySelector(".apv-card--high"), "high-risk styling");
  const arm = [...root.querySelectorAll("button")].find((b) => /Allow…/.test(b.textContent ?? ""))!;
  assert.ok(arm, "an arm button, not a direct allow");
  (arm as HTMLButtonElement).click();
  // still nothing resolved — only ready + the arm
  assert.equal(posted.filter((m) => m["name"] === "resolveApproval").length, 0);
  const confirm = [...root.querySelectorAll("button")].find((b) => /Confirm/.test(b.textContent ?? ""))!;
  (confirm as HTMLButtonElement).click();
  const resolved = posted.find((m) => m["name"] === "resolveApproval")!;
  assert.equal((resolved["args"] as Record<string, unknown>)["allow"], true);
  assert.equal((resolved["args"] as Record<string, unknown>)["seq"], 3);
});

test("security render: autonomy radios + not-reported badges", () => {
  const { root, posted } = mount("security", {
    autonomy: {
      mode: "manual",
      canChange: true,
      reason: "Changing this restarts the Core daemon.",
      levels: [
        { id: "manual", label: "Manual", desc: "Approve every mutating action." },
        { id: "assisted", label: "Assisted", desc: "…" },
        { id: "autonomous", label: "Autonomous", desc: "…" },
      ],
    },
    settings: [
      { key: "network", value: "denied", origin: "workspace", reported: true },
      { key: "sandbox", value: null, origin: null, reported: false },
    ],
    checks: [{ name: "sandbox.enabled", status: "pass", detail: "ok", remediation: null }],
    doctorSummary: "pass",
    repoInstructions: [],
    compatible: true,
  });
  const radios = root.querySelectorAll('input[type="radio"][name="autonomy"]');
  assert.equal(radios.length, 3);
  assert.ok((radios[0] as HTMLInputElement).checked, "manual is selected");
  assert.match(root.textContent ?? "", /not reported/);
  (radios[2] as HTMLInputElement).click();
  assert.ok(posted.some((m) => m["name"] === "setAutonomy" && (m["args"] as Record<string, unknown>)["mode"] === "autonomous"));
});
