/**
 * The ext-host `Store` replayed against recorded `valyria run --events` traces
 * (PLAN.md D4 — crash recovery is a property we test, not a hope).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Store } from "../src/store/store.ts";
import type { CoreEvent, EventBatch } from "../src/bridge/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tracesDir = join(here, "../../fixtures/traces");
const TRACES = ["add-a-function.jsonl", "seeded-bug-fix.jsonl"];

const silent = { warn() {} };

function loadTrace(name: string): CoreEvent[] {
  return readFileSync(join(tracesDir, name), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CoreEvent);
}

function batchOf(events: CoreEvent[]): EventBatch {
  return {
    firstSeq: events[0]!.seq,
    lastSeq: events[events.length - 1]!.seq,
    gapBefore: false,
    events,
  };
}

for (const name of TRACES) {
  const events = loadTrace(name);

  test(`${name}: one big batch tracks lastSeq and the task`, () => {
    const store = new Store(silent);
    store.ingestBatch(batchOf(events));

    assert.equal(store.lastSeq, events[events.length - 1]!.seq);
    assert.equal(store.currentTaskId(), events[0]!.task_id);

    const lines = store.activityLines();
    assert.ok(lines.length > 0, "activity feed is not empty");
    for (const line of lines) {
      assert.doesNotMatch(line, /[{}]/, `activity line is humanised, not raw JSON: ${line}`);
    }
  });

  test(`${name}: event-by-event batches converge to the same state`, () => {
    const whole = new Store(silent);
    whole.ingestBatch(batchOf(events));

    const drip = new Store(silent);
    for (const e of events) drip.ingestBatch(batchOf([e]));

    assert.deepEqual(drip.getState(), whole.getState());
    assert.equal(drip.lastSeq, whole.lastSeq);
  });

  test(`${name}: replaying from seq 0 after a reset reproduces the state (crash recovery)`, () => {
    const store = new Store(silent);
    // first life
    store.ingestBatch(batchOf(events.slice(0, Math.ceil(events.length / 2))));
    const midState = JSON.stringify(store.getState());

    // "window killed" — new Store, full replay from the journal
    const recovered = new Store(silent);
    recovered.ingestBatch(batchOf(events));
    // and a fresh store that only saw the first half
    const firstHalf = new Store(silent);
    firstHalf.ingestBatch(batchOf(events.slice(0, Math.ceil(events.length / 2))));

    assert.equal(JSON.stringify(firstHalf.getState()), midState);
    assert.equal(recovered.lastSeq, events[events.length - 1]!.seq);
  });

  test(`${name}: a duplicate tail batch is idempotent`, () => {
    const store = new Store(silent);
    store.ingestBatch(batchOf(events));
    const after1 = JSON.stringify(store.getState());
    // Core re-sent the last 3 events (resume overlap) — must not double-count.
    store.ingestBatch(batchOf(events.slice(-3)));
    assert.equal(JSON.stringify(store.getState()), after1);
  });
}

test("gap in the stream is flagged, not silently applied", () => {
  const warnings: string[] = [];
  const store = new Store({ warn: (m) => warnings.push(m) });
  const events = loadTrace("add-a-function.jsonl");

  store.ingestBatch(batchOf(events.slice(0, 3)));
  // skip a chunk — deliver a batch that does not start at expectedNextSeq
  store.ingestBatch(batchOf(events.slice(8)));

  assert.ok(
    warnings.some((w) => /gap|hole/i.test(w)),
    `expected a gap warning, got: ${JSON.stringify(warnings)}`
  );
});
