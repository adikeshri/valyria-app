import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  KNOWN_EVENT_KINDS,
  coverageReport,
  decodeEvent,
  hasDecoder,
} from "../src/events/registry.js";

const here = dirname(fileURLToPath(import.meta.url));

const vendoredKinds = readFileSync(
  join(here, "../schemas/event-kinds.txt"),
  "utf8",
)
  .trim()
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

function loadTrace(name: string): { kind: string }[] {
  return readFileSync(join(here, "../../../fixtures/traces/", name), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

const trace = loadTrace("add-a-function.jsonl");
const bugFixTrace = loadTrace("seeded-bug-fix.jsonl");

test("KNOWN_EVENT_KINDS matches Core's pinned kind list exactly", () => {
  assert.deepEqual([...KNOWN_EVENT_KINDS].sort(), [...vendoredKinds].sort());
});

test("every known kind has a decoder tightened past z.unknown()", () => {
  for (const { kind, tightened } of coverageReport()) {
    assert.ok(tightened, `no decoder for ${kind}`);
  }
});

test("every event in the captured trace decodes ok", () => {
  for (const raw of trace) {
    const d = decodeEvent(raw);
    assert.equal(d.ok, true, `${(raw as { kind: string }).kind} -> ${JSON.stringify(d)}`);
  }
});

test("every event in the seeded-bug-fix trace decodes ok (test_* + verification_evidence)", () => {
  for (const raw of bugFixTrace) {
    const d = decodeEvent(raw);
    assert.equal(d.ok, true, `${(raw as { kind: string }).kind} -> ${JSON.stringify(d)}`);
  }
  // the fold-relevant fields survive decoding
  const failed = bugFixTrace.find((e) => e.kind === "test_failed")!;
  const d = decodeEvent(failed);
  assert.equal(d.ok, true);
  if (d.ok) {
    const p = d.payload as { command?: string; failure_count?: number; run_id?: string };
    assert.equal(p.command, "pytest tests/test_billing.py");
    assert.equal(p.failure_count, 1);
    assert.ok(p.run_id?.startsWith("vrun_"));
  }
});

test("an unknown kind degrades, does not throw", () => {
  const d = decodeEvent({ kind: "totally_new_kind", seq: 1, ts_ms: 0, payload: {} });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "unknown_kind");
  assert.equal(hasDecoder("totally_new_kind"), false);
});

test("a non-object payload degrades to bad_payload with the raw kept", () => {
  const d = decodeEvent({ kind: "state_changed", seq: 2, ts_ms: 0, payload: "oops" });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "bad_payload");
  if (!d.ok) assert.equal(d.raw, "oops");
});

test("a renamed field is kept via passthrough, event still ok", () => {
  const d = decodeEvent({
    kind: "tool_started",
    seq: 3,
    ts_ms: 0,
    task_id: "t",
    payload: { tool: "read_file", brand_new_field: 7 },
  });
  assert.equal(d.ok, true);
  if (d.ok) {
    assert.equal((d.payload as { tool: string }).tool, "read_file");
    assert.equal((d.payload as { brand_new_field: number }).brand_new_field, 7);
  }
});
