/**
 * The D6 capability registry in the extension.
 *
 * Every surface resolves; the pinned Core (`core.lock.json`) lights all of them
 * up; an empty capability set degrades the gated ones to their declared
 * fallback (never "blank").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SURFACE_REQUIREMENTS } from "@valyria/protocol";
import { Capabilities } from "../src/session/capabilities.ts";

const here = dirname(fileURLToPath(import.meta.url));
const lock = JSON.parse(
  readFileSync(join(here, "../../core.lock.json"), "utf8")
) as { capabilities: string[] };

test("every declared surface resolves", () => {
  const caps = new Capabilities();
  for (const r of SURFACE_REQUIREMENTS) {
    const s = caps.resolve(r.surface);
    assert.equal(s.surface, r.surface);
    assert.ok(s.fallback, `${r.surface} has a fallback`);
  }
});

test("an unknown surface is available with no fallback machinery", () => {
  const s = new Capabilities().resolve("does-not-exist");
  assert.equal(s.available, true);
  assert.deepEqual(s.fallback, { kind: "none" });
});

test("the pinned Core capability set makes every surface available", () => {
  const caps = new Capabilities();
  caps.set(lock.capabilities);
  const gated = caps.snapshot().filter((s) => !s.available);
  assert.deepEqual(gated, [], "no surface should be gated against the pinned Core");
});

test("an empty capability set gates exactly the capability-bound surfaces", () => {
  const caps = new Capabilities();
  caps.set([]);
  for (const s of caps.snapshot()) {
    const req = SURFACE_REQUIREMENTS.find((r) => r.surface === s.surface)!;
    if (req.requires === null) {
      assert.equal(s.available, true, `${s.surface} needs nothing → available`);
    } else if (typeof req.requires === "string" && req.requires.startsWith("method:")) {
      assert.equal(s.available, false, `${s.surface} method-gated with no session`);
    } else {
      assert.equal(s.available, false, `${s.surface} needs "${req.requires}" → gated`);
      assert.equal(s.missing, req.requires);
      assert.notEqual(s.fallback.kind, undefined);
    }
  }
});

test("clear() drops the set", () => {
  const caps = new Capabilities();
  caps.set(["repo", "plan"]);
  assert.ok(caps.has("repo"));
  caps.clear();
  assert.equal(caps.has("repo"), false);
  assert.deepEqual(caps.list(), []);
});
