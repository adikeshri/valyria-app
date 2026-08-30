// CodeMirror 6 wiring for the read-only code + diff surfaces (docs/PLAN.md
// D12: CodeMirror 6 for code and diffs, not Monaco — the app is a viewer, Core
// owns editing). Kept tiny: a language resolver and a theme that defers to the
// app's CSS variables so light/dark just work (D10).

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";

/** Language support for the extensions we can highlight; `[]` otherwise
 *  (plain text still renders, just unhighlighted). */
export function languageFor(path: string): Extension {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return javascript({ typescript: true, jsx: ext === "tsx" });
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript({ jsx: ext === "jsx" });
    case "py":
    case "pyi":
      return python();
    case "rs":
      return rust();
    default:
      return [];
  }
}

/** Paint CodeMirror with the app's tokens so it tracks the viewer's theme.
 *  Colours are all `var(--…)` from packages/ui, so there is no separate dark
 *  block to keep in sync. */
export const appEditorTheme: Extension = EditorView.theme({
  "&": {
    backgroundColor: "var(--code-bg)",
    color: "var(--text-primary)",
    fontSize: "12.5px",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
  },
  ".cm-gutters": {
    backgroundColor: "var(--code-bg)",
    color: "var(--code-line-number)",
    border: "none",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
  // @codemirror/merge change surfaces → the app's diff tokens.
  ".cm-changedLine": { backgroundColor: "var(--diff-add-bg)" },
  ".cm-deletedChunk": { backgroundColor: "var(--diff-del-bg)" },
  ".cm-changedText": {
    backgroundColor: "var(--diff-add-border)",
    outline: "none",
  },
  ".cm-deletedChunk .cm-deletedText": {
    backgroundColor: "var(--diff-del-border)",
  },
  ".cm-changeGutter": { width: "3px", backgroundColor: "transparent" },
});

export { countDiffLines } from "./diffstat";
