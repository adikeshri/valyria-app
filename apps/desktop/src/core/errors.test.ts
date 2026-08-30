// docs/PLAN.md Phase 9 — the §36 error-presentation table. node:test + tsx,
// the same shape as packages/*/test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_ERROR_CODES, parseErrorCode, present } from "./errors.js";

test("every table entry answers all four §36 questions", () => {
  for (const code of KNOWN_ERROR_CODES) {
    const p = present(`[${code}] some detail from Core`);
    assert.equal(p.code, code);
    assert.ok(p.what.length > 0, `${code}: empty 'what'`);
    assert.ok(p.whatNext.length > 0, `${code}: empty 'whatNext'`);
    assert.equal(typeof p.agentStopped, "boolean");
    assert.equal(typeof p.userActionNeeded, "boolean");
    // 'what' must not just echo a generic
    assert.doesNotMatch(p.what, /something went wrong|an error occurred/i);
  }
});

test("a known code ignores the raw message and uses the curated copy", () => {
  const p = present("[bridge.startup_timeout] Core did not become reachable within 20000ms");
  assert.equal(p.code, "bridge.startup_timeout");
  assert.match(p.what, /didn't become reachable/i);
  assert.equal(p.agentStopped, true);
  assert.equal(p.retryable, true);
});

test("transport error: agent keeps working, retryable", () => {
  const p = present("[bridge.transport] connection reset");
  assert.equal(p.agentStopped, false);
  assert.equal(p.retryable, true);
  assert.match(p.whatNext, /reconnect/i);
});

test("an unknown code still names the code and keeps the detail", () => {
  const p = present("[bridge.brand_new_thing] the widget exploded", { context: "Saving" });
  assert.equal(p.code, "bridge.brand_new_thing");
  assert.match(p.what, /Saving didn't complete/);
  assert.match(p.what, /the widget exploded/);
  assert.match(p.whatNext, /bridge\.brand_new_thing/);
});

test("a plain Error with no code degrades cleanly, never generic", () => {
  const p = present(new Error("fetch failed"));
  assert.equal(p.code, null);
  assert.match(p.what, /didn't complete: fetch failed/);
  assert.doesNotMatch(p.what, /something went wrong/i);
  assert.ok(p.whatNext.length > 0);
});

test("parseErrorCode", () => {
  assert.equal(parseErrorCode("[bridge.fs.io] nope"), "bridge.fs.io");
  assert.equal(parseErrorCode("no brackets here"), null);
  assert.equal(parseErrorCode("[Not A Code] x"), null);
});
