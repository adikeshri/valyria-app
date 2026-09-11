/**
 * Model Chat — the product's primary surface. A message here is a real
 * Core task (`task/create`), so its view-model is `chatModel` plus a
 * read-only "which model is doing the work" line and an inline approval
 * (the sidebar has no separate Approvals panel to show one in anymore).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { replay } from "@valyria/state";
import { modelChatModel } from "../src/store/models.ts";
import type { CoreEvent } from "../src/bridge/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tracesDir = join(here, "../../fixtures/traces");
const files = readdirSync(tracesDir).filter((f) => f.endsWith(".jsonl"));

function load(name: string): CoreEvent[] {
  return readFileSync(join(tracesDir, name), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CoreEvent);
}

const model = (id: string, activeRoles: string[]) => ({
  id,
  family: "qwen2.5-coder",
  display_name: `Model ${id}`,
  quantization: "q4_k_m",
  size_bytes: 4e9,
  installed: true,
  license: "Apache-2.0",
  active_roles: activeRoles,
});

for (const name of files) {
  const state = replay(load(name));

  test(`${name}: modelChatModel mirrors chatModel's task/transcript/canSubmit`, () => {
    const m = modelChatModel(state, undefined, "ready", {
      inferenceCapable: true,
      models: null,
      allowForTaskSupported: true,
    });
    assert.ok(m.taskId);
    assert.equal(m.terminal, true);
    assert.ok(m.transcript.length > 0);
    assert.equal(m.canSubmit, true);
    assert.equal(m.approval, null);
  });
}

test("modelChatModel: activeModel reports whichever model is bound to primary_coder", () => {
  const state = replay(load(files[0]!));
  const m = modelChatModel(state, undefined, "ready", {
    inferenceCapable: true,
    models: [model("qwen", ["fast_coder"]), model("llama", ["primary_coder", "planner"])],
    allowForTaskSupported: true,
  });
  assert.deepEqual(m.activeModel, { role: "primary_coder", displayName: "Model llama" });
});

test("modelChatModel: no model bound to primary_coder means activeModel is null", () => {
  const state = replay(load(files[0]!));
  const m = modelChatModel(state, undefined, "ready", {
    inferenceCapable: true,
    models: [model("qwen", ["fast_coder"])],
    allowForTaskSupported: true,
  });
  assert.equal(m.activeModel, null);
});

test("modelChatModel: missing model_inference is reported even with a model bound", () => {
  const state = replay(load(files[0]!));
  const m = modelChatModel(state, undefined, "ready", {
    inferenceCapable: false,
    models: [model("qwen", ["primary_coder"])],
    allowForTaskSupported: true,
  });
  assert.equal(m.inferenceCapable, false);
  assert.deepEqual(m.activeModel, { role: "primary_coder", displayName: "Model qwen" });
});

const blockedTrace: CoreEvent[] = [
  { seq: 1, task_id: "t1", ts_ms: 1, kind: "task_started", payload: { objective: "add a flag" } },
  { seq: 2, task_id: "t1", ts_ms: 2, kind: "state_changed", payload: { from: "IMPLEMENTING", to: "WAITING_FOR_PERMISSION" } },
  {
    seq: 3,
    task_id: "t1",
    ts_ms: 3,
    kind: "approval_requested",
    payload: { prompt: "Run rm -rf build?", tool: "run_command", risk: "destructive", category: "filesystem", target: "build/" },
  },
];

test("modelChatModel: a pending approval surfaces inline and blocks canSubmit", () => {
  const m = modelChatModel(replay(blockedTrace), undefined, "ready", {
    inferenceCapable: true,
    models: null,
    allowForTaskSupported: true,
  });
  assert.equal(m.blocked, true);
  assert.equal(m.canSubmit, false);
  assert.ok(m.approval);
  assert.equal(m.approval!.seq, 3);
  assert.equal(m.approval!.risk, "destructive");
  assert.equal(m.approval!.tool, "run_command");
  assert.equal(m.approval!.target, "build/");
  assert.equal(m.approval!.allowForTaskSupported, true);
});

test("modelChatModel: allowForTaskSupported is passed through, not invented", () => {
  const m = modelChatModel(replay(blockedTrace), undefined, "ready", {
    inferenceCapable: true,
    models: null,
    allowForTaskSupported: false,
  });
  assert.equal(m.approval!.allowForTaskSupported, false);
});
