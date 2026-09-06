/**
 * Phase 6 — models (inventory only), hardware (probe + G4 gating), settings
 * (D13 grouping), context inspector (G7 disabled), offline marker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { replay } from "@valyria/state";
import { JSDOM } from "jsdom";
import {
  contextModel,
  hardwareModel,
  modelsModel,
  settingsModel,
} from "../src/store/models.ts";
import type { CoreEvent } from "../src/bridge/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../out/webviews");

test("modelsModel: active roles from model/list, fit + recommendation from model/recommend", () => {
  const m = modelsModel({
    models: [
      { id: "qwen3-coder-7b", family: "Qwen3", display_name: "Qwen3 Coder 7B", quantization: "Q4_K_M", parameters_b: 7, context_length: 32768, size_bytes: 4.3e9, installed: true, license: "Apache-2.0", active_roles: ["primary_coder", "planner"] },
      { id: "llama3-8b", family: "Llama", display_name: "Llama 3 8B", quantization: "Q5", parameters_b: 8, context_length: 8192, size_bytes: 5e9, installed: false, license: "Llama-3.1-Community", active_roles: [] },
    ],
    recommend: {
      role: "primary_coder",
      recommended: { id: "qwen3-coder-7b" },
      candidates: [
        { id: "qwen3-coder-7b", fit_kind: "comfortable", suitability: 92 },
        { id: "llama3-8b", fit_kind: "will_not_fit", fit_detail: "insufficient_ram" },
      ],
    },
    installs: [],
    role: "primary_coder",
    manageCapable: true,
    hardwareCapable: true,
  });
  assert.equal(m.hasList, true);
  assert.equal(m.role, "primary_coder");
  assert.equal(m.recommendedId, "qwen3-coder-7b");
  const qwen = m.models.find((x) => x.id === "qwen3-coder-7b")!;
  assert.deepEqual(qwen.activeRoles, ["planner", "primary_coder"]);
  assert.equal(qwen.recommended, true);
  assert.equal(qwen.fit, "comfortable");
  const llama = m.models.find((x) => x.id === "llama3-8b")!;
  assert.equal(llama.fit, "will_not_fit");
  assert.equal(llama.fitDetail, "insufficient_ram");
  // recommended first, then non-fitting last
  assert.equal(m.models[0]!.id, "qwen3-coder-7b");
  assert.equal(m.models.at(-1)!.id, "llama3-8b");
  // role bindings summary
  assert.deepEqual(
    m.bindings.map((b) => `${b.role}:${b.modelId}`).sort(),
    ["planner:qwen3-coder-7b", "primary_coder:qwen3-coder-7b"]
  );
});

test("modelsModel: a live install projection is attached to its model row", () => {
  const m = modelsModel({
    models: [{ id: "qwen", family: "Qwen", display_name: "Qwen", quantization: "Q4", parameters_b: 7, context_length: 32768, size_bytes: 4e9, installed: false, license: "Apache-2.0", active_roles: [] }],
    recommend: null,
    installs: [
      { id: "qwen", phase: "downloading", downloadedBytes: 1e9, totalBytes: 4e9, status: "running", code: null, message: null },
    ],
    role: "primary_coder",
    manageCapable: true,
    hardwareCapable: false,
  });
  const row = m.models[0]!;
  assert.equal(row.install?.status, "running");
  assert.equal(row.install?.fraction, 0.25);
});

test("modelsModel: manage + hardware capability gating is passed through", () => {
  const m = modelsModel({ models: [], recommend: null, installs: [], role: "primary_coder", manageCapable: false, hardwareCapable: false });
  assert.equal(m.manageCapable, false);
  assert.equal(m.hardwareCapable, false);
  assert.equal(m.hasList, true);
});

test("hardwareModel: absent fields are null (not zero), recommendation gated on G4", () => {
  const m = hardwareModel({
    probe: {
      os: "macos",
      os_version: "15.0",
      arch: "arm64",
      cpu: { brand: "Apple M2", physical_cores: 8, logical_cores: 8 },
      ram_total_bytes: 17179869184,
      ram_available_bytes: 8e9,
      gpus: [{ name: "Apple M2", vendor: "Apple", vram_bytes: null }],
      unified_memory: true,
      accelerator_present: null, // not probed
      disk_available_bytes: 2e11,
    },
    recommend: null,
    hardwareCapable: false,
  });
  assert.equal(m.hasProbe, true);
  assert.equal(m.unifiedMemory, true);
  assert.equal(m.acceleratorPresent, null, "None -> null, distinct from 'absent'");
  assert.equal(m.ramTotalBytes, 17179869184);
  assert.equal(m.recommendation, null);
  assert.equal(m.hardwareCapable, false);
});

test("hardwareModel: recommendation candidates carry fit_kind, size and installed", () => {
  const m = hardwareModel({
    probe: null,
    recommend: {
      role: "primary_coder",
      recommended: { id: "qwen" },
      candidates: [
        { id: "qwen", display_name: "Qwen 7B", size_bytes: 4e9, fit_kind: "comfortable", suitability: 92, installed: true },
        { id: "big", display_name: "Big 70B", size_bytes: 4e10, fit_kind: "will_not_fit", fit_detail: "insufficient_ram", installed: false },
      ],
    },
    hardwareCapable: true,
  });
  assert.ok(m.recommendation);
  assert.equal(m.recommendation!.recommendedId, "qwen");
  const [c0, c1] = m.recommendation!.candidates;
  assert.equal(c0!.fitKind, "comfortable");
  assert.equal(c0!.installed, true);
  assert.equal(c0!.displayName, "Qwen 7B");
  assert.equal(c1!.fitKind, "will_not_fit");
  assert.equal(c1!.fitDetail, "insufficient_ram");
});

test("settingsModel: groups by prefix, only lists keys Core returned", () => {
  const m = settingsModel({
    entries: [
      { key: "permission.mode", value: "manual", origin: "default" },
      { key: "model.code", value: "qwen", origin: "workspace" },
      { key: "network", value: "denied", origin: "workspace" },
      { key: "index.max_files", value: "100000", origin: "default" },
      { key: "log.level", value: "info", origin: "default" },
    ],
  });
  assert.equal(m.hasConfig, true);
  const titles = m.sections.map((s) => s.title);
  assert.ok(titles.includes("Agent") && titles.includes("Models") && titles.includes("Security"));
  const allKeys = m.sections.flatMap((s) => s.rows.map((r) => r.key));
  assert.deepEqual(allKeys.sort(), ["index.max_files", "log.level", "model.code", "network", "permission.mode"]);
  // every row appears exactly once
  assert.equal(new Set(allKeys).size, allKeys.length);
});

test("contextModel: disabled with an explanation until the capability exists (G7)", () => {
  const noCase = contextModel(replay([{ seq: 1, task_id: "t1", ts_ms: 1, kind: "task_started", payload: {} }]), undefined, false);
  assert.equal(noCase.available, false);
  assert.deepEqual(noCase.items, []);

  const withCap = contextModel(
    replay([
      { seq: 1, task_id: "t1", ts_ms: 1, kind: "task_started", payload: {} },
      { seq: 2, task_id: "t1", ts_ms: 2, kind: "context_retrieved", payload: { source: "index", path: "src/auth.rs", trust: "trusted", tokens: 812 } },
    ]),
    undefined,
    true
  );
  assert.equal(withCap.available, true);
  assert.equal(withCap.items.length, 1);
  assert.equal(withCap.items[0]!.path, "src/auth.rs");
  assert.equal(withCap.items[0]!.trust, "trusted");
});

// --- render smoke ---

function mount(bundle: string, model: unknown) {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div></body>`, {
    url: "https://x.test/", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const w = dom.window as unknown as Window & Record<string, unknown>;
  const posted: Record<string, unknown>[] = [];
  (w as Record<string, unknown>)["acquireVsCodeApi"] = () => ({ postMessage: (m: Record<string, unknown>) => posted.push(m), getState: () => undefined, setState: () => {} });
  w.requestAnimationFrame = ((cb: FrameRequestCallback) => (cb(0), 0)) as typeof w.requestAnimationFrame;
  w.eval(readFileSync(join(out, `${bundle}.js`), "utf8"));
  w.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "state", view: bundle, model } }));
  return { root: dom.window.document.getElementById("root") as HTMLElement, posted };
}

test("models render: shows the 'never downloads weights' note; no external URLs; install + progress affordances", () => {
  const { root, posted } = mount("models", {
    manageCapable: true, hardwareCapable: true, hasList: true,
    role: "primary_coder",
    roles: ["primary_coder", "fast_coder", "planner", "reviewer", "embedder", "reranker", "autocomplete", "summarizer"],
    recommendedId: "qwen",
    models: [
      {
        id: "qwen", displayName: "Qwen3 Coder 7B", family: "Qwen3", quantization: "Q4_K_M",
        parametersB: 7, contextLength: 32768, sizeBytes: 4e9, installed: false, license: "Apache-2.0",
        activeRoles: [], fit: "comfortable", fitDetail: null, suitability: 92, recommended: true, install: null,
      },
      {
        id: "big", displayName: "Big 70B", family: "Big", quantization: "Q4_K_M",
        parametersB: 70, contextLength: 8192, sizeBytes: 4e10, installed: false, license: "MIT",
        activeRoles: [], fit: "will_not_fit", fitDetail: "insufficient_ram", suitability: 40, recommended: false,
        install: { id: "big", phase: "downloading", downloadedBytes: 1e10, totalBytes: 4e10, status: "running", code: null, message: null, fraction: 0.25 },
      },
    ],
    bindings: [],
  });
  assert.match(root.textContent ?? "", /never downloads model weights/i);
  assert.doesNotMatch(root.innerHTML, /https?:\/\//, "no download URLs in the DOM");
  assert.match(root.textContent ?? "", /recommended/i);
  assert.ok(root.querySelector("[role=progressbar]"), "an in-flight install shows a progress bar");

  // The Install button posts an installModel intent (host owns the license flow).
  const installBtn = [...root.querySelectorAll("button")].find((b) => /install/i.test(b.textContent ?? ""));
  assert.ok(installBtn);
  installBtn!.dispatchEvent(new (root.ownerDocument.defaultView as unknown as typeof window).MouseEvent("click"));
  assert.ok(posted.some((m) => m["name"] === "installModel" && (m["args"] as Record<string, unknown>)["id"] === "qwen"));

  // The running install offers Cancel.
  const cancelBtn = [...root.querySelectorAll("button")].find((b) => /cancel/i.test(b.textContent ?? ""));
  assert.ok(cancelBtn);
  cancelBtn!.dispatchEvent(new (root.ownerDocument.defaultView as unknown as typeof window).MouseEvent("click"));
  assert.ok(posted.some((m) => m["name"] === "cancelModelInstall" && (m["args"] as Record<string, unknown>)["id"] === "big"));
});

test("context render: the disabled explanation names G7", () => {
  const { root } = mount("context", { available: false, taskId: null, items: [] });
  assert.match(root.textContent ?? "", /G7/);
  assert.match(root.textContent ?? "", /unavailable/i);
});

test("settings render: an editable field posts writeConfig on Enter", () => {
  const { root, posted } = mount("settings", {
    hasConfig: true,
    sections: [{ title: "Agent", rows: [{ key: "permission.mode", value: "manual", origin: "default", editable: true }] }],
  });
  const input = root.querySelector("input") as HTMLInputElement;
  assert.ok(input);
  input.value = "assisted";
  input.dispatchEvent(new (root.ownerDocument.defaultView as unknown as typeof window).KeyboardEvent("keydown", { key: "Enter" }));
  assert.ok(posted.some((m) => m["name"] === "writeConfig" && (m["args"] as Record<string, unknown>)["value"] === "assisted"));
});
