// docs/PLAN.md Phase 9 / §9 — the file-tree flatten stays well inside the
// "workspace open → explorer usable, 100k files < 2s" budget. This measures
// only the pure flatten; the 2s budget also covers I/O the test can't model,
// so the bar here is deliberately tight.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenTree } from "./tree.js";
import type { DirEntry } from "./repo.js";

function dir(path: string): DirEntry {
  return { path, name: path.split("/").pop() ?? path, kind: "dir" } as DirEntry;
}
function file(path: string): DirEntry {
  return { path, name: path.split("/").pop() ?? path, kind: "file" } as DirEntry;
}

test("flattenTree is correct for a small expanded tree", () => {
  const children: Record<string, DirEntry[]> = {
    "": [dir("src"), file("README.md")],
    src: [file("src/a.ts"), dir("src/nested")],
    "src/nested": [file("src/nested/b.ts")],
  };
  const open = new Set(["src", "src/nested"]);
  const rows = flattenTree(children, open);
  assert.deepEqual(
    rows.map((r) => `${r.depth}:${r.entry.path}`),
    ["0:src", "1:src/a.ts", "1:src/nested", "2:src/nested/b.ts", "0:README.md"],
  );
});

test("a collapsed directory contributes nothing below it", () => {
  const children: Record<string, DirEntry[]> = {
    "": [dir("src")],
    src: [file("src/a.ts")],
  };
  const rows = flattenTree(children, new Set()); // src collapsed
  assert.deepEqual(rows.map((r) => r.entry.path), ["src"]);
});

test("100k entries flatten in well under the frame budget", () => {
  const N_DIRS = 200;
  const FILES_PER = 500; // 100,000 files + 200 dirs
  const children: Record<string, DirEntry[]> = {
    "": Array.from({ length: N_DIRS }, (_, i) => dir(`d${i}`)),
  };
  const open = new Set<string>();
  for (let i = 0; i < N_DIRS; i++) {
    open.add(`d${i}`);
    children[`d${i}`] = Array.from({ length: FILES_PER }, (_, j) => file(`d${i}/f${j}.ts`));
  }

  const t0 = performance.now();
  const rows = flattenTree(children, open);
  const elapsed = performance.now() - t0;

  assert.equal(rows.length, N_DIRS + N_DIRS * FILES_PER);
  assert.ok(elapsed < 50, `flattenTree took ${elapsed.toFixed(0)}ms for ${rows.length} rows`);
});
