// Pure unified-diff line counting, split out from cm.ts so it can be
// perf-tested against §9's "10,000-line diff" budget without loading
// CodeMirror.

/** Count `+`/`-` content lines in a unified diff (ignores the `+++`/`---`
 *  file headers and `@@` hunk headers). */
export function countDiffLines(unified: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of unified.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}
