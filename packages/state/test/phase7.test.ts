// docs/PLAN.md Phase 7 — the agent-command projection that backs the read-only
// "Agent Commands" view (§4.10 / D7). Against the real captured trace for the
// happy path, and synthetic events for the tolerance cases the fixture cannot
// cover (an unpaired start, a malformed `rendered` blob).
//
// §9's "5,000 events/s with no dropped frames" is a renderer concern (frame
// pacing during ingest) and is verified in the bridge soak test, not here. What
// this file guards is that the new selector stays linear over a large store.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { agentCommandsForTask, applyBatch, emptyStore, replay } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const trace: unknown[] = readFileSync(
  join(here, "../../../fixtures/traces/add-a-function.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

const TASK = "task_01M1752Y79RYQA59ERXZPY3R9P";

function ev(seq: number, kind: string, payload: Record<string, unknown>, taskId = TASK) {
  return { seq, ts_ms: 1788020000000 + seq, kind, task_id: taskId, payload };
}

test("picks out only the shell command from the captured trace", () => {
  const cmds = agentCommandsForTask(replay(trace), TASK);
  // seq 8 read_file and seq 12 edit_file are tools too, but not shell commands.
  assert.equal(cmds.length, 1);
  const [c] = cmds;
  assert.equal(c?.seq, 16);
  assert.equal(c?.program, "cat");
  assert.deepEqual(c?.args, ["src/lib.rs"]);
  assert.equal(c?.pending, false);
});

test("parses Core's rendered envelope into exit code, stdout and stderr", () => {
  const [c] = agentCommandsForTask(replay(trace), TASK);
  assert.equal(c?.exitCode, 0);
  assert.equal(c?.succeeded, true);
  assert.ok(c?.stdout?.includes("pub fn add(a: i32, b: i32)"), "stdout carries the file body");
  assert.equal(c?.stderr, "");
  assert.equal(c?.raw, null, "a clean parse leaves raw unset");
});

test("a malformed rendered blob is kept verbatim in raw, never dropped", () => {
  const s = replay([
    ev(1, "task_started", {}),
    ev(2, "tool_started", { tool: "run_command", input: { program: "make", args: ["build"] } }),
    ev(3, "tool_completed", { success: false, rendered: "ld: symbol not found\nmake: *** [build] Error 1\n" }),
  ]);
  const [c] = agentCommandsForTask(s, TASK);
  assert.equal(c?.program, "make");
  assert.equal(c?.succeeded, false);
  assert.equal(c?.stdout, null);
  assert.equal(c?.exitCode, null);
  assert.equal(c?.raw, "ld: symbol not found\nmake: *** [build] Error 1\n");
});

test("an unpaired tool_started stays pending — it never borrows a later result", () => {
  const s = replay([
    ev(1, "task_started", {}),
    ev(2, "tool_started", { tool: "bash", input: { program: "sleep", args: ["30"] } }),
    // a different tool completes next; it must not attach to the sleep above
    ev(3, "tool_started", { tool: "read_file", input: { path: "src/lib.rs" } }),
    ev(4, "tool_completed", { tool: "read_file", success: true, rendered: "…" }),
  ]);
  const [c] = agentCommandsForTask(s, TASK);
  assert.equal(c?.program, "sleep");
  assert.equal(c?.pending, true);
  assert.equal(c?.succeeded, null);
  assert.equal(c?.stdout, null);
  assert.equal(c?.raw, null);
});

test("degraded / non-object input does not throw and yields empty program+args", () => {
  const s = replay([
    ev(1, "task_started", {}),
    ev(2, "tool_started", { tool: "shell", input: "raw string" }),
    ev(3, "tool_completed", { success: true, rendered: "--- stdout ---\nok\n--- stderr ---\n" }),
  ]);
  const cmds = agentCommandsForTask(s, TASK);
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0]?.program, "");
  assert.deepEqual(cmds[0]?.args, []);
  assert.equal(cmds[0]?.stdout, "ok\n");
});

test("the selector stays linear over a large store", () => {
  // Large enough that an accidental O(n²) (e.g. re-scanning events per command)
  // blows the budget; small enough that building the store stays a unit test.
  const N = 20_000;
  const batch: unknown[] = [ev(1, "task_started", {})];
  for (let i = 0; i < N / 2; i++) {
    const base = 2 + i * 2;
    batch.push(
      ev(base, "tool_started", { tool: "run_command", input: { program: "echo", args: [String(i)] } }),
      ev(base + 1, "tool_completed", {
        success: true,
        rendered: `exit=Some(0) reason=Exited\n--- stdout ---\n${i}\n--- stderr ---\n`,
      }),
    );
  }
  const store = applyBatch(emptyStore(), batch);

  const t0 = performance.now();
  const cmds = agentCommandsForTask(store, TASK);
  const elapsed = performance.now() - t0;

  assert.equal(cmds.length, N / 2);
  assert.ok(elapsed < 250, `selector took ${elapsed.toFixed(0)}ms over ${N} events`);
});
