/**
 * The Phase 3 view-model builders, replayed against the recorded traces.
 * The bar: legible end-to-end, no raw JSON on the happy path (PLAN.md §8/§10),
 * timeline is total, history lists the task.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { replay } from "@valyria/state";
import { chatModel, taskModel, timelineModel, historyModel } from "../src/store/models.ts";
import type { CoreEvent } from "../src/bridge/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tracesDir = join(here, "../../fixtures/traces");
const files = readdirSync(tracesDir).filter((f) => f.endsWith(".jsonl"));

function load(name: string): CoreEvent[] {
  return readFileSync(join(tracesDir, name), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CoreEvent);
}

for (const name of files) {
  const events = load(name);
  const state = replay(events);
  const taskId = events[0]!.task_id!;

  test(`${name}: chatModel — objective first, no raw JSON, terminal at end`, () => {
    const m = chatModel(state, undefined, "ready");
    assert.equal(m.taskId, taskId);
    assert.equal(m.terminal, true, "trace ends in a terminal state");
    assert.equal(m.working, false);
    assert.ok(m.transcript.length > 0);
    // The fixtures' task_started payloads carry no objective; when one is
    // present it must lead the transcript as the "you" turn.
    if (m.objective) {
      assert.equal(m.transcript[0]!.role, "you", "objective leads the transcript");
      assert.equal(m.transcript[0]!.text, m.objective);
    }
    for (const turn of m.transcript) {
      assert.doesNotMatch(turn.text, /[{}]|"payload"/, `transcript stays humanised: ${turn.text}`);
    }
    // completed task → can start another
    assert.equal(m.canSubmit, true);
  });

  test(`${name}: taskModel — objective + state, files/tests only if the trace had them`, () => {
    const m = taskModel(state, undefined);
    assert.equal(m.taskId, taskId);
    assert.equal(m.terminal, true);
    assert.ok(typeof m.state === "string");
    // structural: every list is an array
    for (const key of ["planSteps", "checkpoints", "files", "tests"] as const) {
      assert.ok(Array.isArray(m[key]), `${key} is an array`);
    }
  });

  test(`${name}: timelineModel — one row per event, raw parses as JSON`, () => {
    const m = timelineModel(state);
    assert.equal(m.rows.length, events.length);
    // newest first
    assert.ok(m.rows[0]!.seq >= m.rows[m.rows.length - 1]!.seq);
    for (const r of m.rows) {
      assert.doesNotThrow(() => JSON.parse(r.raw), `row #${r.seq} raw is valid JSON`);
      assert.equal(r.degraded, false, `row #${r.seq} decoded`);
    }
  });

  test(`${name}: historyModel — lists the task, grouped by day`, () => {
    const m = historyModel(state, undefined);
    assert.ok(m.groups.length >= 1);
    const all = m.groups.flatMap((g) => g.tasks);
    assert.ok(all.some((t) => t.id === taskId), "task appears in history");
    assert.equal(m.focusedTaskId, taskId);
  });
}

test("seeded-bug-fix has a plan and changed files in taskModel", () => {
  const state = replay(load("seeded-bug-fix.jsonl"));
  const m = taskModel(state, undefined);
  assert.ok(m.planSteps.length > 0, "plan_created produced steps");
  assert.ok(m.files.length > 0, "file_changed produced rows");
  assert.ok(m.tests.length > 0, "test_* produced verification rows");
});

test("chatModel leads with the objective when task_started carries one", () => {
  const state = replay([
    { seq: 1, task_id: "t1", ts_ms: 1, kind: "task_started", payload: { objective: "Add a --json flag" } },
    { seq: 2, task_id: "t1", ts_ms: 2, kind: "state_changed", payload: { from: "IDLE", to: "PLANNING" } },
    { seq: 3, task_id: "t1", ts_ms: 3, kind: "tool_started", payload: { tool: "edit_file", path: "src/cli.rs" } },
  ]);
  const m = chatModel(state, undefined, "ready");
  assert.equal(m.objective, "Add a --json flag");
  assert.equal(m.transcript[0]!.role, "you");
  assert.equal(m.transcript[0]!.text, "Add a --json flag");
  assert.equal(m.working, true, "non-terminal, not blocked → working");
  assert.equal(m.canSubmit, false, "a task is in flight");
});

test("chatModel: waiting_for_permission → blocked, not working", () => {
  const state = replay([
    { seq: 1, task_id: "t1", ts_ms: 1, kind: "task_started", payload: {} },
    { seq: 2, task_id: "t1", ts_ms: 2, kind: "state_changed", payload: { from: "IMPLEMENTING", to: "WAITING_FOR_PERMISSION" } },
    { seq: 3, task_id: "t1", ts_ms: 3, kind: "approval_requested", payload: { prompt: "Run rm -rf build?", risk: "destructive" } },
  ]);
  const m = chatModel(state, undefined, "ready");
  assert.equal(m.blocked, true);
  assert.equal(m.working, false);
  assert.equal(m.canSubmit, false);
  const tm = taskModel(state, undefined);
  assert.ok(tm.approval);
  assert.equal(tm.approval!.risk, "destructive");
});

test("focus can pin a non-current task", () => {
  const state = replay(load(files[0]!));
  const taskId = load(files[0]!)[0]!.task_id!;
  const m = taskModel(state, taskId);
  assert.equal(m.taskId, taskId);
  // an unknown pin falls back to current
  const fallback = taskModel(state, "task_does_not_exist");
  assert.equal(fallback.taskId, taskId);
});
