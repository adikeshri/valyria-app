// docs/PLAN.md Phase 9 / §9 — "Event ingest sustained: 5,000 events/s with no
// dropped frames". The renderer's frame pacing is a manual check (RELEASING.md
// + the bridge soak test); this pins that the *pure fold* clears the rate with
// room to spare, and that a 50k-event run stays gapless and consistent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBatch, currentTask, emptyStore, timelineRows } from "../src/index.js";

const TASK = "task_09PERF0000000000000000000";

function ev(seq: number, kind: string, payload: Record<string, unknown>) {
  return { seq, ts_ms: 1788400000000 + seq, kind, task_id: TASK, payload };
}

test("50k events fold at well over 5,000 events/s, gapless", () => {
  const N = 50_000;
  const batch: unknown[] = [ev(1, "task_started", {})];
  for (let seq = 2; seq <= N; seq++) {
    // a realistic mix: mostly tool churn, occasional state change
    if (seq % 250 === 0) batch.push(ev(seq, "state_changed", { from: "IMPLEMENTING", to: "IMPLEMENTING" }));
    else if (seq % 2 === 0) batch.push(ev(seq, "tool_started", { tool: "read_file", input: { path: `f${seq}.ts` } }));
    else batch.push(ev(seq, "tool_completed", { success: true }));
  }

  const t0 = performance.now();
  const store = applyBatch(emptyStore(), batch);
  const elapsed = performance.now() - t0;
  const rate = N / (elapsed / 1000);

  assert.equal(store.lastSeq, N);
  assert.equal(store.gapDetected, false);
  assert.equal(store.events.length, N);
  assert.equal(currentTask(store)?.id, TASK);
  assert.equal(timelineRows(store)[0]?.seq, N); // newest first, contiguous
  assert.ok(rate > 5_000, `fold rate was ${rate.toFixed(0)} events/s (${elapsed.toFixed(0)}ms for ${N})`);
});
