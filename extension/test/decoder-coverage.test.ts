/**
 * Decoder coverage for the app's trace corpus (PLAN.md D5).
 *
 * Every event kind that appears in `fixtures/traces/*.jsonl` must (a) be a known
 * kind and (b) decode without falling back to a degraded row. If Core adds a
 * kind and a trace is re-captured with it, this fails until a decoder exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { KNOWN_EVENT_KINDS, decodeEvent } from "@valyria/protocol";
import { Store } from "../src/store/store.ts";
import type { CoreEvent, EventBatch } from "../src/bridge/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tracesDir = join(here, "../../fixtures/traces");
const known = new Set<string>(KNOWN_EVENT_KINDS);

const traceFiles = readdirSync(tracesDir).filter((f) => f.endsWith(".jsonl"));

function load(name: string): CoreEvent[] {
  return readFileSync(join(tracesDir, name), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CoreEvent);
}

test("the corpus is non-empty", () => {
  assert.ok(traceFiles.length > 0, "no fixtures/traces/*.jsonl found");
});

for (const name of traceFiles) {
  const events = load(name);

  test(`${name}: every kind is known`, () => {
    const unknown = [...new Set(events.map((e) => e.kind))].filter((k) => !known.has(k));
    assert.deepEqual(unknown, [], `unknown kinds in ${name}`);
  });

  test(`${name}: every event decodes (no degraded rows)`, () => {
    const bad = events
      .map((e) => decodeEvent(e))
      .filter((d) => !d.ok)
      .map((d) => `seq ${d.seq} kind ${d.kind}: ${"reason" in d ? d.reason : "?"}`);
    assert.deepEqual(bad, [], `undecodable events in ${name}`);
  });

  test(`${name}: the store records no degraded events`, () => {
    const store = new Store({ warn() {} });
    const batch: EventBatch = {
      firstSeq: events[0]!.seq,
      lastSeq: events[events.length - 1]!.seq,
      gapBefore: false,
      events,
    };
    store.ingestBatch(batch);
    assert.equal(store.degradedCount(), 0);
  });
}
