/**
 * Phase 8 — About / Compatibility model + render, incl. the Windows tier-3
 * notice (G9).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { aboutModel } from "../src/store/models.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../out/webviews");

const base = {
  appName: "Valyria 1.135.0",
  platform: "darwin arm64",
  windowsTier3: false,
  connection: "ready" as const,
  about: { bridgeHost: "0.1.0", expectedProtocol: "1.10.0", compatibility: "compatible" },
  session: {
    protocolVersion: "1.10.0",
    runtimeVersion: "0.9.3",
    origin: "spawned",
    ownsDaemon: true,
    authenticated: true,
    permissionMode: "manual",
    workspaceRoot: "/repo",
  },
  capabilities: ["repo", "plan", "ledger"],
  surfaces: [{ surface: "diff-viewer", available: false, missing: "ledger", gap: "G8" }],
  models: [{ id: "qwen", installed: true }],
  activeModelIds: new Set(["qwen"]),
};

test("aboutModel: assembles versions, verdict, sorted caps, active model", () => {
  const m = aboutModel(base);
  assert.equal(m.bridgeHost, "0.1.0");
  assert.equal(m.expectedProtocol, "1.10.0");
  assert.equal(m.compatibility, "compatible");
  assert.deepEqual(m.capabilities, ["ledger", "plan", "repo"]);
  assert.equal(m.models[0]!.active, true);
  assert.equal(m.windowsTier3, false);
});

test("aboutModel: no session → 'no session' verdict, empty caps", () => {
  const m = aboutModel({ ...base, about: null, session: null, capabilities: [], activeModelIds: new Set() });
  assert.equal(m.compatibility, "no session");
  assert.deepEqual(m.capabilities, []);
});

test("about render: Windows tier-3 shows a G9 alert and still reports versions", () => {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div></body>`, {
    url: "https://x.test/", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const w = dom.window as unknown as Window & Record<string, unknown>;
  (w as Record<string, unknown>)["acquireVsCodeApi"] = () => ({ postMessage() {}, getState: () => undefined, setState() {} });
  w.requestAnimationFrame = ((cb: FrameRequestCallback) => (cb(0), 0)) as typeof w.requestAnimationFrame;
  w.eval(readFileSync(join(out, "about.js"), "utf8"));
  w.dispatchEvent(
    new dom.window.MessageEvent("message", {
      data: {
        type: "state",
        view: "about",
        model: aboutModel({ ...base, windowsTier3: true, platform: "win32 x64" }),
      },
    })
  );
  const root = dom.window.document.getElementById("root") as HTMLElement;
  assert.ok(root.querySelector(".ab-tier3"), "tier-3 banner present");
  assert.match(root.textContent ?? "", /G9/);
  assert.match(root.textContent ?? "", /1\.10\.0/, "still reports the protocol version");
});
