// docs/PLAN.md Phase 4 — the changed-file rail and test-result folds, plus the
// checkpoint-boundary selector, replayed against a hand-authored seeded-bug-fix
// trace. Payload shapes mirror Core's (valyria-agent driver.rs VERIFY_RESULT,
// plan_created steps); the trace is synthetic because v1's fake model never
// runs a verification step (so `capture_trace` can't record one).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyBatch,
  changedFilesForTask,
  checkpointsForTask,
  currentTask,
  replay,
  testResultsForTask,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const trace: unknown[] = readFileSync(
  join(here, "../../../fixtures/traces/seeded-bug-fix.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

const TASK = "task_01M4SEEDBUGFIX0000000000A1";

test("the whole trace folds into one completed task, gapless", () => {
  const s = replay(trace);
  assert.equal(s.gapDetected, false);
  assert.equal(s.lastSeq, 29);
  assert.equal(currentTask(s)?.state, "completed");
});

test("changed-file rail: one row for the twice-edited file, ordered by first touch", () => {
  const files = changedFilesForTask(replay(trace), TASK);
  assert.deepEqual(
    files.map((f) => f.path),
    ["src/billing.py"],
  );
  const [f] = files;
  assert.equal(f?.change, "modified");
  assert.equal(f?.firstSeq, 11); // the first edit_file tool_started
  assert.equal(f?.lastSeq, 23); // the second file_changed
});

test("changed-file rail carries no ownership field (G8 — never guessed)", () => {
  const [f] = changedFilesForTask(replay(trace), TASK);
  assert.ok(f);
  assert.equal(Object.prototype.hasOwnProperty.call(f, "ownership"), false);
});

test("test results: one run per command, latest event wins (failed → passed)", () => {
  const runs = testResultsForTask(replay(trace), TASK);
  assert.equal(runs.length, 1);
  const [r] = runs;
  assert.equal(r?.command, "pytest tests/test_billing.py");
  assert.equal(r?.outcome, "passed"); // seq 27 supersedes the seq 17 failure
  assert.equal(r?.runId, "vrun_01M4SEEDBUGFIXRUN00000002");
  assert.equal(r?.failureCount, 0);
});

test("mid-run resume sees the failing state, then the fix", () => {
  const upToFailure = replay(trace.slice(0, 17)); // through seq 17 test_failed
  assert.equal(testResultsForTask(upToFailure, TASK)[0]?.outcome, "failed");
  const resumed = applyBatch(upToFailure, trace); // Core replays inclusively
  assert.equal(testResultsForTask(resumed, TASK)[0]?.outcome, "passed");
  assert.equal(resumed.lastSeq, 29);
});

test("checkpoint boundaries come from the plan payload; step id is not a checkpoint_id (G13)", () => {
  const cps = checkpointsForTask(replay(trace), TASK);
  assert.equal(cps.length, 1);
  assert.equal(cps[0]?.stepId, "step_fix_backoff");
  assert.equal(cps[0]?.rollbackBoundary, true);
});
