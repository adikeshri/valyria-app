// docs/MODEL-SETUP-PLAN.md — the model-install projection folded from the
// workspace-global `model_install_progress` / `_completed` / `_failed` events
// (task_id: null). Trace-replayable like every other projection (D4).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBatch,
  emptyStore,
  modelInstall,
  modelInstalls,
  modelInstallsRunning,
  replay,
} from "../src/index.js";

const ID = "qwen2.5-coder-7b-instruct-q4_k_m";

function ev(seq: number, kind: string, payload: Record<string, unknown>) {
  return { seq, ts_ms: 1_788_400_000_000 + seq, kind, task_id: null, payload };
}

test("progress events fold into a running install with a fraction", () => {
  const s = replay([
    ev(1, "model_install_progress", { id: ID, phase: "downloading", downloaded_bytes: 0, total_bytes: 1000 }),
    ev(2, "model_install_progress", { id: ID, phase: "downloading", downloaded_bytes: 250, total_bytes: 1000 }),
    ev(3, "model_install_progress", { id: ID, phase: "verifying", downloaded_bytes: 1000, total_bytes: 1000 }),
  ]);
  const m = modelInstall(s, ID);
  assert.ok(m);
  assert.equal(m.status, "running");
  assert.equal(m.phase, "verifying");
  assert.equal(m.downloadedBytes, 1000);
  assert.equal(m.totalBytes, 1000);
  assert.deepEqual(modelInstallsRunning(s), [ID]);
});

test("a completed event marks the install done at seq order", () => {
  const s = replay([
    ev(1, "model_install_progress", { id: ID, phase: "downloading", downloaded_bytes: 500, total_bytes: 1000 }),
    ev(2, "model_install_completed", { id: ID, size_bytes: 1000 }),
  ]);
  const m = modelInstall(s, ID);
  assert.equal(m?.status, "completed");
  assert.equal(m?.downloadedBytes, 1000);
  assert.deepEqual(modelInstallsRunning(s), []);
});

test("a failed event carries the code and message; cancel is just a code", () => {
  const s = replay([
    ev(1, "model_install_progress", { id: ID, phase: "downloading", downloaded_bytes: 10, total_bytes: 1000 }),
    ev(2, "model_install_failed", { id: ID, code: "model_store.cancelled", message: "download of ... was cancelled" }),
  ]);
  const m = modelInstall(s, ID);
  assert.equal(m?.status, "failed");
  assert.equal(m?.code, "model_store.cancelled");
  assert.match(m?.message ?? "", /cancelled/);
});

test("installs for two models are tracked independently, newest-first", () => {
  const other = "llama-3.1-8b-instruct-q4_k_m";
  const s = replay([
    ev(1, "model_install_progress", { id: ID, phase: "downloading", downloaded_bytes: 1, total_bytes: 2 }),
    ev(2, "model_install_progress", { id: other, phase: "downloading", downloaded_bytes: 1, total_bytes: 2 }),
    ev(3, "model_install_completed", { id: ID, size_bytes: 2 }),
  ]);
  const all = modelInstalls(s);
  assert.equal(all.length, 2);
  assert.equal(all[0]!.id, ID, "sorted by lastSeq desc");
  assert.equal(modelInstall(s, other)?.status, "running");
});

test("model-install events never create a task projection", () => {
  const s = replay([
    ev(1, "model_install_progress", { id: ID, phase: "downloading", downloaded_bytes: 0, total_bytes: 1 }),
  ]);
  assert.deepEqual(Object.keys(s.tasks), []);
  assert.equal(s.lastSeq, 1);
});

test("a resume replay with overlap stays idempotent", () => {
  const trace = [
    ev(1, "model_install_progress", { id: ID, phase: "downloading", downloaded_bytes: 5, total_bytes: 10 }),
    ev(2, "model_install_completed", { id: ID, size_bytes: 10 }),
  ];
  const once = replay(trace);
  const twice = applyBatch(once, trace); // full overlap
  assert.deepEqual(twice.modelInstalls, once.modelInstalls);
});

test("a thin-but-valid payload folds with safe defaults; a payload with no id is ignored", () => {
  const s = replay([
    ev(1, "model_install_progress", { phase: "downloading" }), // no id — ignored
    ev(2, "model_install_progress", { id: ID }), // decodes (all fields optional)
  ]);
  const m = modelInstall(s, ID);
  assert.ok(m);
  assert.equal(m.status, "running");
  assert.equal(m.phase, null);
  assert.equal(m.downloadedBytes, 0);
  assert.equal(m.totalBytes, 0);
  assert.equal(emptyStore().modelInstalls[ID], undefined);
});

test("a payload the decoder rejects (wrong types) never folds — it degrades", () => {
  const s = replay([
    ev(1, "model_install_progress", { id: ID, total_bytes: null }), // null !== number
  ]);
  assert.equal(modelInstall(s, ID), undefined);
  assert.equal(s.events[0]!.degraded, true);
});
