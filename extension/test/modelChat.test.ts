/**
 * Model Chat's view-model — which servers are reachable, which role is
 * selected (explicit or auto-picked), and gating (`model_inference`,
 * `sending`). Pure projection, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { modelChatModel } from "../src/store/models.ts";

test("modelChatModel: only ready, ported servers are chattable", () => {
  const m = modelChatModel({
    inferenceCapable: true,
    servers: [
      { role: "primary_coder", modelId: "qwen", state: "ready", port: 5111, code: null, message: null },
      { role: "planner", modelId: "qwen", state: "starting", port: null, code: null, message: null },
      { role: "reviewer", modelId: "llama", state: "failed", port: null, code: "x", message: "boom" },
    ],
    models: [{ id: "qwen", display_name: "Qwen3 Coder" }],
    role: null,
    transcripts: {},
    sending: false,
  });
  assert.deepEqual(
    m.servers.map((s) => s.role),
    ["primary_coder"]
  );
  assert.equal(m.servers[0]!.displayName, "Qwen3 Coder");
});

test("modelChatModel: embedder and reranker are ready but not chattable — no chat template, 500s on completions", () => {
  const m = modelChatModel({
    inferenceCapable: true,
    servers: [
      { role: "embedder", modelId: "nomic-embed-text-v1.5", state: "ready", port: 64028, code: null, message: null },
      { role: "reranker", modelId: "bge-reranker", state: "ready", port: 64029, code: null, message: null },
    ],
    models: null,
    role: null,
    transcripts: {},
    sending: false,
  });
  assert.deepEqual(m.servers, []);
  assert.equal(m.role, null);
  assert.equal(m.canSend, false);
});

test("modelChatModel: an embedding model bound to a chat role (e.g. primary_coder) is still excluded", () => {
  // Reproduces a real Model Manager state: the Model Manager lets you bind
  // any installed model to any role, so `role_suitability: { embedder: 90 }`
  // in Core's catalog doesn't stop someone from binding nomic-embed onto
  // primary_coder. The role name alone (`NON_CHAT_ROLES`) can't catch this —
  // it has to be caught from the model's own family/id.
  const m = modelChatModel({
    inferenceCapable: true,
    servers: [
      { role: "primary_coder", modelId: "nomic-embed-text-v1.5", state: "ready", port: 65499, code: null, message: null },
    ],
    models: [
      {
        id: "nomic-embed-text-v1.5",
        family: "nomic-embed",
        display_name: "Nomic Embed Text v1.5",
        quantization: "f16",
        size_bytes: 274290560,
        installed: true,
        license: "Apache-2.0",
      },
    ],
    role: null,
    transcripts: {},
    sending: false,
  });
  assert.deepEqual(m.servers, []);
  assert.equal(m.canSend, false);
});

test("modelChatModel: auto-picks primary_coder over other ready roles", () => {
  const m = modelChatModel({
    inferenceCapable: true,
    servers: [
      { role: "fast_coder", modelId: "a", state: "ready", port: 1, code: null, message: null },
      { role: "primary_coder", modelId: "b", state: "ready", port: 2, code: null, message: null },
    ],
    models: null,
    role: null,
    transcripts: {},
    sending: false,
  });
  assert.equal(m.role, "primary_coder");
});

test("modelChatModel: falls back off a stale explicit role that's no longer serving", () => {
  const m = modelChatModel({
    inferenceCapable: true,
    servers: [{ role: "fast_coder", modelId: "a", state: "ready", port: 1, code: null, message: null }],
    models: null,
    role: "primary_coder", // was serving, no longer is
    transcripts: {},
    sending: false,
  });
  assert.equal(m.role, "fast_coder");
});

test("modelChatModel: transcript follows the resolved role; canSend gates on capability + sending", () => {
  const m = modelChatModel({
    inferenceCapable: true,
    servers: [{ role: "fast_coder", modelId: "a", state: "ready", port: 1, code: null, message: null }],
    models: null,
    role: "fast_coder",
    transcripts: {
      fast_coder: [{ id: "t1", role: "user", text: "hi", pending: false }],
      primary_coder: [{ id: "t2", role: "user", text: "wrong role", pending: false }],
    },
    sending: false,
  });
  assert.deepEqual(m.transcript.map((t) => t.id), ["t1"]);
  assert.equal(m.canSend, true);
});

test("modelChatModel: no chattable servers means null role, empty transcript, cannot send", () => {
  const m = modelChatModel({
    inferenceCapable: true,
    servers: [],
    models: null,
    role: null,
    transcripts: {},
    sending: false,
  });
  assert.equal(m.role, null);
  assert.deepEqual(m.transcript, []);
  assert.equal(m.canSend, false);
});

test("modelChatModel: missing model_inference blocks sending even with a ready server", () => {
  const m = modelChatModel({
    inferenceCapable: false,
    servers: [{ role: "primary_coder", modelId: "a", state: "ready", port: 1, code: null, message: null }],
    models: null,
    role: null,
    transcripts: {},
    sending: false,
  });
  assert.equal(m.canSend, false);
});

test("modelChatModel: a message mid-flight blocks sending another", () => {
  const m = modelChatModel({
    inferenceCapable: true,
    servers: [{ role: "primary_coder", modelId: "a", state: "ready", port: 1, code: null, message: null }],
    models: null,
    role: null,
    transcripts: {},
    sending: true,
  });
  assert.equal(m.canSend, false);
});
