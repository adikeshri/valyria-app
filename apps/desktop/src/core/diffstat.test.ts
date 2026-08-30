// docs/PLAN.md Phase 9 / §9 — counting the +/- lines of a 10,000-line diff is
// trivial next to the 150ms CodeMirror render budget for the same file. This
// pins the pure part; the render itself is a manual check in RELEASING.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { countDiffLines } from "./diffstat.js";

test("ignores file headers, counts content lines", () => {
  const diff = [
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -1,3 +1,4 @@",
    " unchanged",
    "-gone",
    "+added one",
    "+added two",
  ].join("\n");
  assert.deepEqual(countDiffLines(diff), { added: 2, removed: 1 });
});

test("a 10,000-line diff counts in a blink", () => {
  const lines: string[] = ["--- a/big.ts", "+++ b/big.ts", "@@ -1,10000 +1,10000 @@"];
  for (let i = 0; i < 10_000; i++) lines.push(i % 3 === 0 ? `-old ${i}` : `+new ${i}`);
  const diff = lines.join("\n");

  const t0 = performance.now();
  const { added, removed } = countDiffLines(diff);
  const elapsed = performance.now() - t0;

  assert.equal(added + removed, 10_000);
  assert.ok(elapsed < 20, `countDiffLines took ${elapsed.toFixed(1)}ms for 10k lines`);
});
