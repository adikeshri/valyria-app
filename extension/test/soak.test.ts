/**
 * Phase 11 — soak: a long task keeps the projections cheap and correct
 * (PLAN.md §9 event-ingest budget; §44 "long tasks never block").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store/store.ts";
import { chatModel, taskModel, timelineModel, agentCommandsModel } from "../src/store/models.ts";
import type { CoreEvent, EventBatch } from "../src/bridge/protocol.ts";

const N = 20_000;

function synth(): CoreEvent[] {
  const ev: CoreEvent[] = [
    { seq: 1, task_id: "soak", ts_ms: 0, kind: "task_started", payload: { objective: "A very long task" } },
  ];
  for (let i = 2; i <= N; i++) {
    const k = i % 5;
    ev.push(
      k === 0
        ? { seq: i, task_id: "soak", ts_ms: i, kind: "tool_started", payload: { tool: "run_command", tool_invocation_id: `inv${i}`, input: { program: "cargo", args: ["check"] } } }
        : k === 1
          ? { seq: i, task_id: "soak", ts_ms: i, kind: "tool_completed", payload: { tool: "run_command", tool_invocation_id: `inv${i - 1}`, success: true, exit_code: 0, stdout: "ok", stderr: "", duration_ms: 5 } }
          : k === 2
            ? { seq: i, task_id: "soak", ts_ms: i, kind: "file_changed", payload: { path: `src/mod${i % 50}.rs`, change: "modified" } }
            : k === 3
              ? { seq: i, task_id: "soak", ts_ms: i, kind: "model_completed", payload: { finish_reason: "Stop", text: "secret reasoning that must never surface" } }
              : { seq: i, task_id: "soak", ts_ms: i, kind: "state_changed", payload: { from: "IMPLEMENTING", to: "IMPLEMENTING" } }
    );
  }
  return ev;
}

test(`soak: ${N} events ingest and re-model in well under a second`, () => {
  const events = synth();
  const store = new Store({ warn() {} });

  const t0 = performance.now();
  // deliver in 512-event batches, like the pump
  for (let i = 0; i < events.length; i += 512) {
    const slice = events.slice(i, i + 512);
    const batch: EventBatch = {
      firstSeq: slice[0]!.seq,
      lastSeq: slice[slice.length - 1]!.seq,
      gapBefore: false,
      events: slice,
    };
    store.ingestBatch(batch);
  }
  const ingest = performance.now() - t0;

  const t1 = performance.now();
  const chat = chatModel(store.getState(), undefined, "ready");
  const task = taskModel(store.getState(), undefined, true);
  const tl = timelineModel(store.getState());
  const cmds = agentCommandsModel(store.getState(), undefined);
  const model = performance.now() - t1;

  assert.equal(store.lastSeq, N);
  assert.equal(tl.rows.length, N);
  // file_changed fires on i ≡ 2 (mod 5), path src/mod{i%50}.rs → 10 distinct.
  assert.equal(task.files.length, 10, "distinct paths folded, not one row per touch");
  assert.ok(cmds.commands.length > 0);
  // §10: no model reasoning text anywhere in the conversational projection
  for (const turn of chat.transcript) {
    assert.doesNotMatch(turn.text, /secret reasoning/);
  }
  // generous CI budget
  assert.ok(ingest < 2000, `ingest took ${ingest.toFixed(0)}ms`);
  assert.ok(model < 500, `re-model took ${model.toFixed(0)}ms`);
});

test("soak: a terminal task stops accumulating approval/notification work", () => {
  const store = new Store({ warn() {} });
  store.ingestBatch({
    firstSeq: 1, lastSeq: 3, gapBefore: false,
    events: [
      { seq: 1, task_id: "t", ts_ms: 1, kind: "task_started", payload: {} },
      { seq: 2, task_id: "t", ts_ms: 2, kind: "state_changed", payload: { from: "VERIFYING", to: "COMPLETED" } },
      { seq: 3, task_id: "t", ts_ms: 3, kind: "task_completed", payload: {} },
    ],
  });
  const m = chatModel(store.getState(), undefined, "ready");
  assert.equal(m.terminal, true);
  assert.equal(m.working, false);
  assert.equal(m.blocked, false);
  assert.equal(m.canSubmit, true);
});
