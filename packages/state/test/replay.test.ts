import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyBatch,
  currentTask,
  replay,
  timelineRows,
  activityLine,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const trace: unknown[] = readFileSync(
  join(here, "../../../fixtures/traces/add-a-function.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

test("folds the whole trace into one completed task, gapless", () => {
  const s = replay(trace);
  assert.equal(s.gapDetected, false);
  assert.equal(s.lastSeq, 22);
  assert.equal(s.events.length, 22);
  const t = currentTask(s);
  assert.equal(t?.terminal, true);
  assert.equal(t?.state, "completed");
});

test("is idempotent when the trace is replayed with full overlap (resume)", () => {
  const once = replay(trace);
  const twice = applyBatch(once, trace);
  assert.equal(twice.lastSeq, once.lastSeq);
  assert.equal(twice.events.length, once.events.length);
});

test("resumes from a mid cursor to the exact tail", () => {
  const full = replay(trace);
  const from = { ...full, events: full.events.slice(0, 10), lastSeq: 10 };
  const resumed = applyBatch(from, trace); // Core replays inclusively; dupes ignored
  assert.equal(resumed.lastSeq, 22);
  assert.deepEqual(
    resumed.events.map((e) => e.seq),
    Array.from({ length: 22 }, (_, i) => i + 1),
  );
});

test("timeline is newest-first, complete, and not degraded", () => {
  const rows = timelineRows(replay(trace));
  assert.equal(rows[0]?.seq, 22);
  assert.equal(rows.at(-1)?.seq, 1);
  assert.ok(rows.every((r) => !r.degraded));
});

test("flags a hole when an event is dropped", () => {
  const holed = trace.filter((e) => (e as { seq: number }).seq !== 10);
  assert.equal(replay(holed).gapDetected, true);
});

test("activity narrative yields a non-empty line for every event kind", () => {
  for (const r of timelineRows(replay(trace))) {
    const line = activityLine(r);
    assert.equal(typeof line, "string");
    assert.ok(line.length > 0);
  }
});
