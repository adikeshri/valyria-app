/**
 * Phase 5 — verification inspector (D8), agent-command view (D7), rollback
 * readiness (G13), failure-location navigation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { replay } from "@valyria/state";
import { JSDOM } from "jsdom";
import {
  agentCommandsModel,
  taskModel,
  verificationModel,
} from "../src/store/models.ts";
import type { CoreEvent } from "../src/bridge/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../out/webviews");

// --- verificationModel (D8: verbatim, NOT RUN, no invented "verified") ---

test("verificationModel: no report yet → hasReport false, NOT RUN everywhere", () => {
  const m = verificationModel({ taskId: "t1", report: null });
  assert.equal(m.hasReport, false);
  assert.deepEqual(m.verified, []);
  assert.deepEqual(m.unverified, []);
});

test("verificationModel: renders verified[]/unverified[] exactly as Core sent them", () => {
  const m = verificationModel({
    taskId: "t1",
    report: {
      status: "completed",
      verified: [{ kind: "test", command: "pytest", outcome: "Pass", run_id: "vrun_1" }],
      unverified: ["type check", "lint"],
    },
  });
  assert.equal(m.hasReport, true);
  assert.equal(m.verified.length, 1);
  assert.equal(m.verified[0]!.runId, "vrun_1");
  assert.deepEqual(m.unverified, ["type check", "lint"]);
});

// --- agentCommandsModel (D7: from tool_* only) ---

const cmdTrace: CoreEvent[] = [
  { seq: 1, task_id: "t1", ts_ms: 1, kind: "task_started", payload: {} },
  { seq: 2, task_id: "t1", ts_ms: 2, kind: "tool_started", payload: { tool: "run_command", tool_invocation_id: "inv1", input: { program: "cargo", args: ["test"] } } },
  { seq: 3, task_id: "t1", ts_ms: 3, kind: "tool_completed", payload: { tool: "run_command", tool_invocation_id: "inv1", success: false, exit_code: 101, stdout: "running 3 tests", stderr: "test foo ... FAILED", duration_ms: 1200 } },
];

test("agentCommandsModel: pairs a shell start+complete, keeps exit + output", () => {
  const m = agentCommandsModel(replay(cmdTrace), undefined);
  assert.equal(m.commands.length, 1);
  const c = m.commands[0]!;
  assert.equal(c.program, "cargo");
  assert.deepEqual(c.args, ["test"]);
  assert.equal(c.exitCode, 101);
  assert.equal(c.succeeded, false);
  assert.equal(c.pending, false);
  assert.match(c.stderr ?? "", /FAILED/);
});

// --- taskModel checkpoints / rollback readiness (G13) ---

const planTrace: CoreEvent[] = [
  { seq: 1, task_id: "t1", ts_ms: 1, kind: "task_started", payload: {} },
  { seq: 2, task_id: "t1", ts_ms: 2, kind: "plan_created", payload: { revision: 1, steps: [
    { id: "s1", intent: "Add the flag", checkpoint: false },
    { id: "s2", intent: "Serialize as JSON", checkpoint: true, rollback_boundary: true },
  ] } },
  { seq: 3, task_id: "t1", ts_ms: 3, kind: "plan_checkpoint", payload: { step_id: "s2", checkpoint_id: "cp_abc" } },
  { seq: 4, task_id: "t1", ts_ms: 4, kind: "test_failed", payload: { command: "cargo test", summary: "1 failed", failure_count: 1,
    failures: [{ kind: "test_failure", message: "assertion failed", failing_test: "json_roundtrip", location: [{ path: "src/cli.rs", line: 42 }] }] } },
];

test("taskModel: a checkpoint with an id is rollback-ready only with the capability", () => {
  const state = replay(planTrace);
  const withCap = taskModel(state, undefined, true);
  const cp = withCap.checkpoints.find((c) => c.checkpointId === "cp_abc");
  assert.ok(cp, "checkpoint id threaded from plan_checkpoint");
  assert.equal(cp!.rollbackReady, true);

  const noCap = taskModel(state, undefined, false);
  assert.equal(noCap.checkpoints.find((c) => c.checkpointId === "cp_abc")!.rollbackReady, false);
});

test("taskModel: test failures carry file:line locations for navigation", () => {
  const m = taskModel(replay(planTrace), undefined, false);
  const failing = m.tests.find((t) => t.outcome === "failed");
  assert.ok(failing, "a failed run");
  const locs = failing!.failures.flatMap((f) => f.locations);
  assert.deepEqual(locs, [{ path: "src/cli.rs", line: 42 }]);
});

// --- render smoke ---

function mount(bundle: string, model: unknown) {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div></body>`, {
    url: "https://x.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window as unknown as Window & Record<string, unknown>;
  const posted: Record<string, unknown>[] = [];
  (w as Record<string, unknown>)["acquireVsCodeApi"] = () => ({
    postMessage: (m: Record<string, unknown>) => posted.push(m),
    getState: () => undefined,
    setState: () => {},
  });
  w.requestAnimationFrame = ((cb: FrameRequestCallback) => (cb(0), 0)) as typeof w.requestAnimationFrame;
  w.eval(readFileSync(join(out, `${bundle}.js`), "utf8"));
  w.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "state", view: bundle, model } }));
  return { root: dom.window.document.getElementById("root") as HTMLElement, posted, dom };
}

test("verification render: verbatim claims + NOT RUN for unverified", () => {
  const { root } = mount("verification", {
    taskId: "t1",
    status: "completed",
    verified: [{ kind: "test", command: "pytest tests/", outcome: "Pass", runId: "vrun_9" }],
    unverified: ["type check"],
    hasReport: true,
  });
  const txt = root.textContent ?? "";
  assert.match(txt, /pytest tests\//);
  assert.match(txt, /vrun_9/);
  assert.match(txt, /NOT RUN/);
  assert.match(txt, /type check/);
});

test("agent-commands render: every row is badged 'agent', read-only", () => {
  const { root, posted } = mount("commands", {
    taskId: "t1",
    commands: [
      { seq: 2, program: "cargo", args: ["test"], exitCode: 101, stdout: "x", stderr: "FAILED", raw: null, succeeded: false, durationMs: 1200, pending: false },
    ],
  });
  assert.match(root.textContent ?? "", /cargo test/);
  assert.match(root.textContent ?? "", /agent/);
  assert.match(root.textContent ?? "", /exit 101/);
  // no command is ever posted from this view
  assert.equal(posted.filter((m) => m["type"] === "command").length, 0);
});

test("task render: a ready checkpoint shows 'Roll back to here' and posts rollbackTo", () => {
  const { root, posted } = mount("task", {
    taskId: "t1",
    objective: "x",
    state: "implementing",
    terminal: false,
    planSteps: [],
    checkpoints: [
      { stepId: "s2", intent: "Serialize as JSON", rollbackBoundary: true, checkpointId: "cp_abc", rollbackReady: true },
    ],
    files: [],
    tests: [],
    approval: null,
  });
  const btn = [...root.querySelectorAll("button")].find((b) => /Roll back to here/.test(b.textContent ?? ""));
  assert.ok(btn, "rollback button present");
  (btn as HTMLButtonElement).click();
  const msg = posted.find((m) => m["name"] === "rollbackTo");
  assert.ok(msg);
  assert.equal((msg!["args"] as Record<string, unknown>)["checkpointId"], "cp_abc");
});
