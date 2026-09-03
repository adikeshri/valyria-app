#!/usr/bin/env node
/**
 * Regenerate the README screenshots of the Valyria editor-area surfaces
 * (Home / Task Workspace / Review) — docs/assets/valyria-*.png.
 *
 * Each surface's built webview bundle (extension/out/webviews/<name>.js) is
 * loaded in headless Chromium with the shared design tokens and a representative
 * view-model, then the rendered `#root` is captured. This is the *real* UI, not
 * a mockup.
 *
 * Prereqs:
 *   - `npm --prefix extension run compile`  (produces out/webviews/*)
 *   - `scripts/install-deps.sh`             (vscode/ deps incl. playwright-core
 *                                             + a cached Chromium)
 *
 * Run:  node scripts/gen-screenshots.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wv = join(root, "extension", "out", "webviews");
const assets = join(root, "docs", "assets");
const require = createRequire(join(root, "vscode", "node_modules", "x"));

if (!existsSync(join(wv, "home.js"))) {
  console.error("Build the webviews first:  npm --prefix extension run compile");
  process.exit(1);
}

// --- find a Chromium the way playwright would ------------------------------
function findChromium() {
  const base =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    join(process.env.HOME || "", "Library", "Caches", "ms-playwright");
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base)
    .filter((d) => d.startsWith("chromium"))
    .sort()
    .reverse();
  for (const d of dirs) {
    for (const rel of [
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
      "chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "chrome-headless-shell-mac-x64/chrome-headless-shell",
      "chrome-linux/chrome",
      "chrome-headless-shell-linux/chrome-headless-shell",
    ]) {
      const p = join(base, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const { chromium } = require("playwright-core");
const executablePath = findChromium();
if (!executablePath) {
  console.error("No cached Chromium found — run `scripts/install-deps.sh` (it installs playwright).");
  process.exit(1);
}

// --- representative models ------------------------------------------------
const MODELS = {
  home: {
    connection: "ready", hasRepo: true, repoName: "valyria-app", canSubmit: true,
    activeModel: "qwen3-coder-7b", networkRuntime: false, autonomy: "manual", layoutMode: "agent",
    active: [
      { id: "t2", objective: "Add a --json flag to the export command and cover it with a test", state: "implementing", terminal: false, blocked: false, filesTouched: 3, when: "2026-09-03" },
    ],
    recent: [
      { id: "t1", objective: "Fix the flaky retry backoff in the sync worker", state: "completed", terminal: true, blocked: false, filesTouched: 2, when: "2026-09-03" },
      { id: "t0", objective: "Document the plugin capability registry", state: "completed", terminal: true, blocked: false, filesTouched: 1, when: "2026-09-02" },
    ],
  },
  workspace: {
    connection: "ready", taskId: "t2", objective: "Add a --json flag to the export command and cover it with a test",
    state: "verifying", terminal: false, working: true, blocked: false, canSubmit: false,
    transcript: [
      { seq: 1, role: "you", text: "Add a --json flag to the export command and cover it with a test" },
      { seq: 2, role: "agent", text: "Planned 4 steps" },
      { seq: 5, role: "agent", text: "Edited src/cli/export.rs" },
      { seq: 9, role: "agent", text: "Added tests/export_json.rs" },
      { seq: 12, role: "agent", text: "Ran cargo test — 34 passed" },
    ],
    planSteps: [
      { intent: "Parse --json in the export arg group", status: "done", checkpoint: true },
      { intent: "Serialize the report as JSON", status: "done", checkpoint: false },
      { intent: "Cover the flag with an integration test", status: "done", checkpoint: true },
      { intent: "Run the full test suite", status: "active", checkpoint: false },
    ],
    files: [
      { path: "src/cli/export.rs", change: "modified", ownership: "agent_authored" },
      { path: "src/report/json.rs", change: "added", ownership: "agent_authored" },
      { path: "tests/export_json.rs", change: "added", ownership: "agent_authored" },
    ],
    tests: [{ command: "cargo test", outcome: "passed", summary: "34 passed, 0 failed", failureCount: 0 }],
    verified: [{ kind: "integration test", command: "cargo test", outcome: "Pass" }],
    unverified: ["type check", "lint"], approval: null,
  },
  review: {
    connection: "ready", taskId: "t2", objective: "Add a --json flag to the export command and cover it with a test",
    ledgerAvailable: true, reportStatus: "completed",
    files: [
      { path: "src/cli/export.rs", change: "modified", ownership: "agent_authored" },
      { path: "src/report/json.rs", change: "added", ownership: "agent_authored" },
      { path: "tests/export_json.rs", change: "added", ownership: "agent_authored" },
      { path: "src/report/mod.rs", change: "modified", ownership: "concurrent_user_modification" },
    ],
    verified: [{ kind: "integration test", command: "cargo test", outcome: "Pass" }],
    unverified: ["type check", "lint"],
    approval: { seq: 14, prompt: "Write src/report/json.rs (new file, 88 lines)", tool: "write_file", risk: "standard" },
  },
};
const WIDTH = { home: 820, workspace: 940, review: 940 };

const tokens = readFileSync(join(wv, "tokens.css"), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "valyria-shots-"));

const browser = await chromium.launch({ executablePath });
try {
  for (const [name, model] of Object.entries(MODELS)) {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf8"><style>
${tokens}
${readFileSync(join(wv, `${name}.css`), "utf8")}
html,body{background:#0d0d12}
</style></head><body class="vscode-dark"><div id="root"></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState:()=>undefined,setState(){}});</script>
<script>${readFileSync(join(wv, `${name}.js`), "utf8")}</script>
<script>window.dispatchEvent(new MessageEvent("message",{data:{type:"state",view:${JSON.stringify(name)},model:${JSON.stringify(model)}}}));</script>
</body></html>`;
    const file = join(tmp, `${name}.html`);
    writeFileSync(file, html);

    const page = await browser.newPage({ viewport: { width: WIDTH[name], height: 800 }, deviceScaleFactor: 2 });
    await page.goto(`file://${file}`);
    await page.waitForTimeout(400);
    const h = await page.evaluate(() => Math.ceil(document.getElementById("root").getBoundingClientRect().bottom + 18));
    await page.setViewportSize({ width: WIDTH[name], height: h });
    await page.waitForTimeout(80);
    const out = join(assets, `valyria-${name}.png`);
    await page.screenshot({ path: out });
    console.log(`  ✓ ${out}  (${WIDTH[name]}×${h})`);
    await page.close();
  }
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
