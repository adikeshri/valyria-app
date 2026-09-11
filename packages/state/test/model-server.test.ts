// Protocol 1.12.0 (real local inference): the per-role model-server
// projection folded from the workspace-global `model_server_starting` /
// `_ready` / `_failed` / `_stopped` events, and the engine-install
// projection folded from `engine_install_progress` / `_completed` /
// `_failed` (Core downloading its own `llama-server`). Trace-replayable
// like every other projection (D4).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBatch,
  emptyStore,
  engineInstalls,
  modelServerForRole,
  modelServers,
  modelServersForModel,
  replay,
} from "../src/index.js";

const ROLE = "primary_coder";
const MODEL_ID = "qwen2.5-coder-1.5b-instruct-q8_0";

function ev(seq: number, kind: string, payload: Record<string, unknown>) {
  return { seq, ts_ms: 1_788_400_000_000 + seq, kind, task_id: null, payload };
}

test("starting then ready carries the role, model id, and port", () => {
  const s = replay([
    ev(1, "model_server_starting", { role: ROLE, id: MODEL_ID }),
    ev(2, "model_server_ready", { role: ROLE, id: MODEL_ID, port: 51423 }),
  ]);
  const server = modelServerForRole(s, ROLE);
  assert.ok(server);
  assert.equal(server.state, "ready");
  assert.equal(server.modelId, MODEL_ID);
  assert.equal(server.port, 51423);
  assert.equal(server.code, null);
});

test("a failed event carries the code and message and clears the port", () => {
  const s = replay([
    ev(1, "model_server_starting", { role: ROLE, id: MODEL_ID }),
    ev(2, "model_server_failed", {
      role: ROLE,
      id: MODEL_ID,
      code: "llamacpp.not_ready",
      message: "llama-server did not become ready within 120s",
    }),
  ]);
  const server = modelServerForRole(s, ROLE);
  assert.equal(server?.state, "failed");
  assert.equal(server?.port, null);
  assert.equal(server?.code, "llamacpp.not_ready");
  assert.match(server?.message ?? "", /did not become ready/);
  // the model id survives from the earlier `starting` event even though
  // `failed`'s own payload also names it
  assert.equal(server?.modelId, MODEL_ID);
});

test("stopped carries the reason in message and clears the port", () => {
  const s = replay([
    ev(1, "model_server_ready", { role: ROLE, id: MODEL_ID, port: 51423 }),
    ev(2, "model_server_stopped", { role: ROLE, id: MODEL_ID, reason: "model_removed" }),
  ]);
  const server = modelServerForRole(s, ROLE);
  assert.equal(server?.state, "stopped");
  assert.equal(server?.port, null);
  assert.equal(server?.message, "model_removed");
});

test("roles are tracked independently, newest-first", () => {
  const other = "fast_coder";
  const s = replay([
    ev(1, "model_server_starting", { role: ROLE, id: MODEL_ID }),
    ev(2, "model_server_starting", { role: other, id: "qwen2.5-coder-1.5b-instruct-q8_0" }),
    ev(3, "model_server_ready", { role: ROLE, id: MODEL_ID, port: 1 }),
  ]);
  const all = modelServers(s);
  assert.equal(all.length, 2);
  assert.equal(all[0]!.role, ROLE, "sorted by lastSeq desc");
  assert.equal(modelServerForRole(s, other)?.state, "starting");
});

test("modelServersForModel finds every role serving the same model id", () => {
  const s = replay([
    ev(1, "model_server_ready", { role: "primary_coder", id: MODEL_ID, port: 1 }),
    ev(2, "model_server_ready", { role: "fast_coder", id: MODEL_ID, port: 2 }),
    ev(3, "model_server_ready", { role: "planner", id: "a-different-model", port: 3 }),
  ]);
  const roles = modelServersForModel(s, MODEL_ID)
    .map((r) => r.role)
    .sort();
  assert.deepEqual(roles, ["fast_coder", "primary_coder"]);
});

test("model-server events never create a task projection", () => {
  const s = replay([ev(1, "model_server_starting", { role: ROLE, id: MODEL_ID })]);
  assert.deepEqual(Object.keys(s.tasks), []);
  assert.equal(s.lastSeq, 1);
});

test("a resume replay with overlap stays idempotent", () => {
  const trace = [
    ev(1, "model_server_starting", { role: ROLE, id: MODEL_ID }),
    ev(2, "model_server_ready", { role: ROLE, id: MODEL_ID, port: 7 }),
  ];
  const once = replay(trace);
  const twice = applyBatch(once, trace); // full overlap
  assert.deepEqual(twice.modelServers, once.modelServers);
});

test("a payload with no role is ignored", () => {
  const s = replay([ev(1, "model_server_starting", { id: MODEL_ID })]);
  assert.equal(Object.keys(s.modelServers).length, 0);
  assert.equal(emptyStore().modelServers[ROLE], undefined);
});

test("engine installs fold the same way as model installs, keyed by component", () => {
  const s = replay([
    ev(1, "engine_install_progress", {
      component: "llama.cpp",
      version: "b10901",
      phase: "downloading",
      downloaded_bytes: 0,
      total_bytes: 100,
    }),
    ev(2, "engine_install_progress", {
      component: "llama.cpp",
      version: "b10901",
      phase: "downloading",
      downloaded_bytes: 100,
      total_bytes: 100,
    }),
    ev(3, "engine_install_completed", { component: "llama.cpp", version: "b10901" }),
  ]);
  const all = engineInstalls(s);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.id, "llama.cpp");
  assert.equal(all[0]!.status, "completed");
  assert.equal(all[0]!.downloadedBytes, 100);
});

test("an engine install failure carries the code and message", () => {
  const s = replay([
    ev(1, "engine_install_failed", {
      component: "llama.cpp",
      version: "b10901",
      code: "engine_store.integrity_mismatch",
      message: "integrity check failed",
    }),
  ]);
  const all = engineInstalls(s);
  assert.equal(all[0]!.status, "failed");
  assert.equal(all[0]!.code, "engine_store.integrity_mismatch");
});
