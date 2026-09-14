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

test("modelChatModel: activeModelId reports whichever installed model is bound to primary_coder", () => {
  const state = replay(load(files[0]!));
  const m = modelChatModel(state, undefined, "ready", {
    inferenceCapable: true,
    models: [model("qwen", ["fast_coder"]), model("llama", ["primary_coder", "planner"])],
    allowForTaskSupported: true,
  });
  assert.equal(m.activeModelId, "llama");
  // Every installed, chat-capable model is a picker candidate — not just
  // the active one.
  assert.deepEqual(
    m.models.map((x) => x.id).sort(),
    ["llama", "qwen"]
  );
});

test("modelChatModel: no model bound to primary_coder means activeModelId is null", () => {
  const state = replay(load(files[0]!));
  const m = modelChatModel(state, undefined, "ready", {
    inferenceCapable: true,
    models: [model("qwen", ["fast_coder"])],
    allowForTaskSupported: true,
  });
  assert.equal(m.activeModelId, null);
});

test("modelChatModel: missing model_inference is reported even with a model bound", () => {
  const state = replay(load(files[0]!));
  const m = modelChatModel(state, undefined, "ready", {
    inferenceCapable: false,
    models: [model("qwen", ["primary_coder"])],
    allowForTaskSupported: true,
  });
  assert.equal(m.inferenceCapable, false);
  assert.equal(m.activeModelId, "qwen");
});

test("modelChatModel: embedder/reranker models are excluded from the picker even when installed", () => {
  const state = replay(load(files[0]!));
  const embedder = { ...model("nomic", []), family: "nomic-embed" };
  const m = modelChatModel(state, undefined, "ready", {
    inferenceCapable: true,
    models: [model("qwen", ["primary_coder"]), embedder],
    allowForTaskSupported: true,
  });
  assert.deepEqual(m.models.map((x) => x.id), ["qwen"]);
});

test("modelChatModel: unratedForCoding flags a model absent from recommend's candidates — the Qwen 1.5B trap", () => {
  // Regression test for a real, reproduced failure: Qwen2.5-Coder 1.5B
  // (role_suitability: fast_coder/autocomplete/summarizer only, no
  // primary_coder score) was activated as the coding model. Every message
  // sent to it — including a plain "Hi" — produced a hallucinated,
  // nonsensical edit_file tool call; denying it (correctly) failed the
  // whole task. Core's own `candidates_for_role` already excludes anything
  // scoring 0, so a model missing from `recommend.candidates` entirely is a
  // real "Core thinks this can't do the job" signal, not just "unranked."
  const state = replay(load(files[0]!));
  const m = modelChatModel(state, undefined, "ready", {
    inferenceCapable: true,
    models: [model("qwen-1.5b", []), model("qwen-7b", ["primary_coder"])],
    allowForTaskSupported: true,
    recommend: {
      role: "primary_coder",
      recommended: { id: "qwen-7b" },
      // qwen-1.5b doesn't appear here at all — suitability 0, filtered out.
      candidates: [{ id: "qwen-7b", fit_kind: "comfortable", suitability: 92 }],
    },
  });
  const oneFive = m.models.find((x) => x.id === "qwen-1.5b")!;
  const seven = m.models.find((x) => x.id === "qwen-7b")!;
  assert.equal(oneFive.unratedForCoding, true);
  assert.equal(seven.unratedForCoding, false);
});

test("modelChatModel: unratedForCoding is false for everyone when recommend is unavailable — unknown, not unsuitable", () => {
  const state = replay(load(files[0]!));
  const m = modelChatModel(state, undefined, "ready", {
    inferenceCapable: true,
    models: [model("qwen-1.5b", [])],
    allowForTaskSupported: true,
    recommend: null,
  });
  assert.equal(m.models[0]!.unratedForCoding, false);
});

test("modelChatModel: activating reflects an in-flight picker request", () => {
  const state = replay(load(files[0]!));
  const m = modelChatModel(state, undefined, "ready", {
    inferenceCapable: true,
    models: [model("qwen", [])],
    allowForTaskSupported: true,
    activating: true,
  });
  assert.equal(m.activating, true);
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
