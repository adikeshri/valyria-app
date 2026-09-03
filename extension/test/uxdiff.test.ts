/**
 * UX-differentiation build (docs/UX-DIFFERENTIATION.md).
 *
 *   - the dual-mode layout bundles are coherent and symmetric (lever C)
 *   - the status-bar ticker phrases derive deterministically from the event
 *     tail (lever E)
 *   - the Home / Task Workspace / Review editor-surface models are legible,
 *     never raw JSON, and only show what Core actually reported (lever D)
 *   - each new webview bundle renders in jsdom without throwing
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { replay } from "@valyria/state";
import {
  LAYOUT_BUNDLES,
  MANAGED_KEYS,
  resolveLayoutSettings,
} from "../src/session/layoutBundles.ts";
import {
  homeModel,
  reviewModel,
  tickerModel,
  workspaceModel,
} from "../src/store/models.ts";
import type { CoreEvent } from "../src/bridge/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../out/webviews");
const tracesDir = join(here, "../../fixtures/traces");
const traceFiles = readdirSync(tracesDir).filter((f) => f.endsWith(".jsonl"));

function load(name: string): CoreEvent[] {
  return readFileSync(join(tracesDir, name), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CoreEvent);
}

// --- layout bundles ---------------------------------------------------

test("layout: every managed key is cleared then re-set, so switching is symmetric", () => {
  for (const mode of ["agent", "editor"] as const) {
    const resolved = resolveLayoutSettings(mode);
    // every managed key is present in the resolved set (either a value or undefined)
    for (const k of MANAGED_KEYS) {
      assert.ok(k in resolved, `${mode}: ${k} present in resolved settings`);
    }
    // the mode's own bundle values survive the clear
    for (const [k, v] of Object.entries(LAYOUT_BUNDLES[mode].settings)) {
      assert.deepEqual(resolved[k], v, `${mode}: ${k} kept its bundle value`);
    }
    // keys only in the *other* bundle are cleared to undefined
    const otherOnly = Object.keys(LAYOUT_BUNDLES[mode === "agent" ? "editor" : "agent"].settings)
      .filter((k) => !(k in LAYOUT_BUNDLES[mode].settings));
    for (const k of otherOnly) {
      assert.equal(resolved[k], undefined, `${mode}: ${k} cleared`);
    }
  }
});

test("layout: agent hides the activity bar and single-tabs; editor restores both", () => {
  assert.equal(LAYOUT_BUNDLES.agent.settings["workbench.activityBar.location"], "hidden");
  assert.equal(LAYOUT_BUNDLES.agent.settings["workbench.editor.showTabs"], "single");
  assert.equal(LAYOUT_BUNDLES.editor.settings["workbench.activityBar.location"], "default");
  assert.equal(LAYOUT_BUNDLES.editor.settings["workbench.editor.showTabs"], "multiple");
});

test("layout: neither bundle ever writes a --vscode-* or a Valyria config key", () => {
  for (const mode of ["agent", "editor"] as const) {
    for (const k of Object.keys(LAYOUT_BUNDLES[mode].settings)) {
      assert.ok(/^(workbench|window|breadcrumbs|outline)\./.test(k), `unexpected managed key ${k}`);
    }
  }
});

// --- status-bar ticker ---------------------------------------------

const base = (kind: string, payload: unknown, seq: number): CoreEvent => ({
  seq,
  task_id: "t1",
  ts_ms: seq,
  kind,
  payload,
});

test("ticker: no task → idle, nothing to show", () => {
  const m = tickerModel(replay([]), undefined, "ready");
  assert.equal(m.hasTask, false);
  assert.equal(m.phase, null);
  assert.equal(m.tone, "idle");
});

test("ticker: a pending approval reads 'Blocked: approval'", () => {
  const m = tickerModel(
    replay([
      base("task_started", {}, 1),
      base("state_changed", { from: "IMPLEMENTING", to: "WAITING_FOR_PERMISSION" }, 2),
      base("approval_requested", { prompt: "Run rm -rf build?", risk: "destructive" }, 3),
    ]),
    undefined,
    "ready"
  );
  assert.equal(m.tone, "blocked");
  assert.equal(m.phase, "Blocked: approval");
});

test("ticker: editing shows a live file count", () => {
  const m = tickerModel(
    replay([
      base("task_started", {}, 1),
      base("file_changed", { path: "src/a.rs", change: "modified" }, 2),
      base("file_changed", { path: "src/b.rs", change: "modified" }, 3),
    ]),
    undefined,
    "ready"
  );
  assert.equal(m.tone, "working");
  assert.equal(m.phase, "Editing 2 files");
  assert.equal(m.filesTouched, 2);
});

test("ticker: a running shell command names the program", () => {
  const m = tickerModel(
    replay([
      base("task_started", {}, 1),
      base("tool_started", { tool: "run_command", tool_invocation_id: "i1", input: { program: "cargo", args: ["test"] } }, 2),
    ]),
    undefined,
    "ready"
  );
  assert.equal(m.phase, "Running cargo");
});

test("ticker: a completed task reads 'Task done', a failed one 'Task failed'", () => {
  const done = tickerModel(
    replay([base("task_started", {}, 1), base("task_completed", { outcome: "completed" }, 2)]),
    undefined,
    "ready"
  );
  assert.equal(done.tone, "done");
  const failed = tickerModel(
    replay([base("task_started", {}, 1), base("task_failed", { reason: "boom" }, 2)]),
    undefined,
    "ready"
  );
  assert.equal(failed.tone, "failed");
  assert.equal(failed.phase, "Task failed");
});

for (const name of traceFiles) {
  test(`ticker: ${name} — phase is a short humanised string, never raw JSON`, () => {
    const state = replay(load(name));
    const m = tickerModel(state, undefined, "ready");
    assert.ok(m.hasTask);
    assert.ok(m.phase && m.phase.length > 0);
    assert.doesNotMatch(m.phase, /[{}]|"payload"/);
    assert.ok(m.phase.length <= 40, `phase stays terse: ${m.phase}`);
  });
}

// --- editor-surface models --------------------------------------------

for (const name of traceFiles) {
  const state = replay(load(name));

  test(`home: ${name} — recent lists the terminal task, no raw JSON`, () => {
    const m = homeModel(state, {
      connection: "ready",
      hasRepo: true,
      repoName: "acme",
      activeModel: "qwen",
      networkRuntime: false,
      autonomy: "manual",
      layoutMode: "agent",
    });
    assert.equal(m.canSubmit, true, "a finished trace leaves Home ready for a new task");
    assert.ok(m.recent.length >= 1);
    for (const t of [...m.active, ...m.recent]) {
      assert.doesNotMatch(t.objective ?? "", /[{}]/);
    }
  });

  test(`workspace: ${name} — assembles transcript + plan + files, arrays always`, () => {
    const m = workspaceModel(state, undefined, {
      connection: "ready",
      ownership: {},
      report: null,
    });
    for (const k of ["transcript", "planSteps", "files", "tests", "verified", "unverified"] as const) {
      assert.ok(Array.isArray(m[k]), `${k} is an array`);
    }
    for (const turn of m.transcript) {
      assert.doesNotMatch(turn.text, /[{}]|"payload"/);
    }
    assert.equal(m.terminal, true);
  });

  test(`review: ${name} — files carry Core's ownership verbatim, NOT RUN is explicit`, () => {
    const m = reviewModel(state, undefined, {
      connection: "ready",
      ledgerAvailable: true,
      ownership: { "src/x.rs": "agent_authored" },
      report: { status: "completed", verified: [], unverified: ["lint", "types"] },
    });
    assert.deepEqual(m.unverified, ["lint", "types"]);
    assert.equal(m.reportStatus, "completed");
    for (const f of m.files) {
      assert.ok(f.ownership === null || typeof f.ownership === "string");
    }
  });
}

test("review: without the ledger capability, ownership is null and the surface says so", () => {
  const state = replay([
    { seq: 1, task_id: "t1", ts_ms: 1, kind: "task_started", payload: {} },
    { seq: 2, task_id: "t1", ts_ms: 2, kind: "file_changed", payload: { path: "src/a.rs", change: "modified" } },
  ]);
  const m = reviewModel(state, undefined, {
    connection: "ready",
    ledgerAvailable: false,
    ownership: {},
    report: null,
  });
  assert.equal(m.ledgerAvailable, false);
  assert.equal(m.files[0]!.ownership, null);
});

// --- render smoke (jsdom) --------------------------------------------

function mount(bundle: string, model: unknown): HTMLElement {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div></body>`, {
    url: "https://example.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window as unknown as Window & Record<string, unknown>;
  (w as Record<string, unknown>)["acquireVsCodeApi"] = () => ({
    postMessage: () => {},
    getState: () => undefined,
    setState: () => {},
  });
  w.requestAnimationFrame = ((cb: FrameRequestCallback) => (cb(0), 0)) as typeof w.requestAnimationFrame;
  w.eval(readFileSync(join(out, `${bundle}.js`), "utf8"));
  w.dispatchEvent(new dom.window.MessageEvent("message", { data: { type: "state", view: bundle, model } }));
  return dom.window.document.getElementById("root") as HTMLElement;
}

test("home renders a composer and the task lists", () => {
  const root = mount("home", {
    connection: "ready", hasRepo: true, repoName: "acme", canSubmit: true,
    activeModel: "qwen", networkRuntime: false, autonomy: "manual", layoutMode: "agent",
    active: [], recent: [{ id: "t0", objective: "Fix the bug", state: "completed", terminal: true, blocked: false, filesTouched: 1, when: "2026-09-02" }],
  });
  assert.ok(root.querySelector("textarea"));
  assert.match(root.textContent ?? "", /Fix the bug/);
  assert.doesNotMatch(root.textContent ?? "", /\[object Object\]/);
});

test("workspace renders plan, files, verification and the approval callout", () => {
  const root = mount("workspace", {
    connection: "ready", taskId: "t1", objective: "Add a flag", state: "implementing", terminal: false,
    working: true, blocked: false, canSubmit: false,
    transcript: [{ seq: 1, role: "you", text: "Add a flag" }],
    planSteps: [{ intent: "wire it", status: "active", checkpoint: false }],
    files: [{ path: "src/x.rs", change: "modified", ownership: "agent_authored" }],
    tests: [{ command: "cargo test", outcome: "failed", summary: "1 failed", failureCount: 1 }],
    verified: [], unverified: ["lint"],
    approval: { seq: 3, prompt: "Run cargo test?", tool: "run_command", risk: "standard" },
  });
  assert.match(root.textContent ?? "", /wire it/);
  assert.match(root.textContent ?? "", /NOT RUN/);
  assert.match(root.textContent ?? "", /Run cargo test\?/);
});

test("review renders files with ownership and an Open diff control", () => {
  const root = mount("review", {
    connection: "ready", taskId: "t1", objective: "Add a flag", ledgerAvailable: true, reportStatus: "completed",
    files: [{ path: "src/x.rs", change: "modified", ownership: "concurrent_user_modification" }],
    verified: [], unverified: [], approval: null,
  });
  assert.match(root.textContent ?? "", /also edited by you/);
  assert.ok([...root.querySelectorAll("button")].some((b) => /open diff/i.test(b.textContent ?? "")));
});

test("customdoc renders markdown headings and a code block, plus Open raw", () => {
  const root = mount("customdoc", { kind: "md", name: "plan.md", text: "# Title\n\n- a\n- b\n\n```\nx=1\n```\n" });
  assert.ok(root.querySelector("h1"));
  assert.ok(root.querySelector("pre"));
  assert.ok([...root.querySelectorAll("button")].some((b) => /open raw/i.test(b.textContent ?? "")));
});
