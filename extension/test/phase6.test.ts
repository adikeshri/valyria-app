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

test("modelsModel: marks the active model from a config binding, gates manage", () => {
  const m = modelsModel({
    models: [
      { id: "qwen3-coder-7b", family: "Qwen3", quantization: "Q4_K_M", size_bytes: 4.3e9, installed: true, license: "Apache-2.0" },
      { id: "llama3-8b", family: "Llama", quantization: "Q5", size_bytes: 5e9, installed: false, license: "Meta" },
    ],
    configEntries: [{ key: "model.code", value: "qwen3-coder-7b", origin: "workspace" }],
    manageCapable: false,
  });
  assert.equal(m.hasList, true);
  assert.equal(m.models.find((x) => x.id === "qwen3-coder-7b")!.active, true);
  assert.equal(m.models.find((x) => x.id === "llama3-8b")!.active, false);
  assert.equal(m.manageCapable, false);
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

test("models render: shows the 'never downloads weights' note; no external URLs", () => {
  const { root } = mount("models", {
    manageCapable: true, hasList: true,
    models: [{ id: "qwen", family: "Qwen3", quantization: "Q4", sizeBytes: 4e9, installed: false, license: "Apache-2.0", active: false }],
    bindings: [],
  });
  assert.match(root.textContent ?? "", /never downloads model weights/i);
  assert.doesNotMatch(root.innerHTML, /https?:\/\//, "no download URLs in the DOM");
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
