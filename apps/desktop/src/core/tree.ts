// Pure file-tree flattening for the virtualized explorer (docs/PLAN.md §4.4).
// Extracted from LiveFileTree so it can be perf-tested against §9's
// "100k-file tree" budget without a browser.

import type { DirEntry } from "./repo";

export interface FlatRow {
  entry: DirEntry;
  depth: number;
}

/**
 * Depth-first flatten of a lazily-loaded directory map into the visible rows.
 * `children[dir]` is the entries loaded for `dir` (`""` is the root); a
 * directory contributes its children only when its path is in `open`.
 */
export function flattenTree(
  children: Readonly<Record<string, DirEntry[]>>,
  open: ReadonlySet<string>,
): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of children[dir] ?? []) {
      out.push({ entry: e, depth });
      if (e.kind === "dir" && open.has(e.path)) walk(e.path, depth + 1);
    }
  };
  walk("", 0);
  return out;
}
