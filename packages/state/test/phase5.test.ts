// docs/PLAN.md Phase 5 — the blocked-task selector and the G2 approval
// supersession guard, exercised as pure functions against synthetic events.

import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalIsCurrent, blockedTasks, replay } from "../src/index.js";

const TASK = "task_05APPROVALS00000000000000";

function ev(seq: number, kind: string, payload: Record<string, unknown>, taskId = TASK) {
  return { seq, ts_ms: 1788200000000 + seq, kind, task_id: taskId, payload };
}

/** A task that reaches WAITING_FOR_PERMISSION with one approval outstanding. */
const blocked = [
  ev(1, "task_started", {}),
  ev(2, "state_changed", { from: "IDLE", to: "IMPLEMENTING" }),
  ev(3, "approval_requested", { prompt: "run rm -rf build/", tool: "run_command", risk: "high" }),
  ev(4, "state_changed", { from: "IMPLEMENTING", to: "WAITING_FOR_PERMISSION" }),
];

test("blockedTasks lists a task waiting on a human decision, not a working one", () => {
  const s = replay(blocked);
  assert.deepEqual(blockedTasks(s).map((t) => t.id), [TASK]);

  const working = replay(blocked.slice(0, 2));
  assert.equal(blockedTasks(working).length, 0);
});

test("blockedTasks clears once Core moves the task off WAITING_FOR_PERMISSION", () => {
  const resolved = [...blocked, ev(5, "state_changed", { from: "WAITING_FOR_PERMISSION", to: "IMPLEMENTING" })];
  assert.equal(blockedTasks(replay(resolved)).length, 0);
});

test("approvalIsCurrent tracks the seq the UI last rendered (G2 supersession)", () => {
  const s = replay(blocked);
  assert.equal(approvalIsCurrent(s, TASK, 3), true);

  // A newer approval_requested supersedes seq 3.
  const superseded = replay([
    ...blocked,
    ev(5, "approval_requested", { prompt: "now also touch .env", tool: "write_file", risk: "high" }),
  ]);
  assert.equal(approvalIsCurrent(superseded, TASK, 3), false, "stale prompt must not be answerable");
  assert.equal(approvalIsCurrent(superseded, TASK, 5), true, "the current prompt is");
});

test("approvalIsCurrent is false when there is no pending approval at all", () => {
  assert.equal(approvalIsCurrent(replay([ev(1, "task_started", {})]), TASK, 0), false);
});
