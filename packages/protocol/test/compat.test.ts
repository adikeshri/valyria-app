// docs/PLAN.md Phase 8 — the compatibility verdict from CORE-INTERFACE §4's
// table, as a pure function. Same node:test + tsx shape as decoders.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compatVerdict, KNOWN_CAPABILITIES } from "../src/capabilities.js";

const EXPECTED = "1.0.0";
const ALL = [...KNOWN_CAPABILITIES];

test("no session yet → ok / not connected", () => {
  const v = compatVerdict(EXPECTED, null);
  assert.equal(v.level, "ok");
  assert.match(v.headline, /not connected/i);
});

test("same protocol → ok / compatible", () => {
  const v = compatVerdict(EXPECTED, { protocol_version: "1.0.0", capabilities: ALL });
  assert.equal(v.level, "ok");
  assert.match(v.detail, /1\.0\.0/);
});

test("major mismatch → blocked, names both versions", () => {
  const v = compatVerdict(EXPECTED, { protocol_version: "2.3.0", capabilities: ALL });
  assert.equal(v.level, "blocked");
  assert.match(v.detail, /2\.3\.0/);
  assert.match(v.detail, /1\.0\.0/);
});

test("unparseable protocol → blocked (treated as a different major)", () => {
  const v = compatVerdict(EXPECTED, { protocol_version: "nightly", capabilities: ALL });
  assert.equal(v.level, "blocked");
});

test("Core minor ahead → ok (newer Core, unknown fields ignored)", () => {
  const v = compatVerdict(EXPECTED, { protocol_version: "1.4.0", capabilities: ALL });
  assert.equal(v.level, "ok");
  assert.match(v.detail, /ignored/i);
});

test("Core minor behind → reduced, lists the missing capabilities", () => {
  const v = compatVerdict("1.2.0", {
    protocol_version: "1.0.0",
    capabilities: ["plan", "doctor"],
  });
  assert.equal(v.level, "reduced");
  assert.match(v.detail, /rollback/);
  assert.match(v.detail, /storage/);
});

test("Core minor behind but all capabilities present → reduced with an all-present note", () => {
  const v = compatVerdict("1.2.0", { protocol_version: "1.0.0", capabilities: ALL });
  assert.equal(v.level, "reduced");
  assert.match(v.detail, /all advertised capabilities are present/i);
});
