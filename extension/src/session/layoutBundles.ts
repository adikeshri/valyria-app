/**
 * Pure layout-mode data (docs/UX-DIFFERENTIATION.md, lever C).
 *
 * Deliberately free of any `vscode` import so the bundles can be unit-tested
 * without a running workbench — the same split `store/` uses for its selectors.
 * `LayoutController` (which does touch the config API) lives in `layout.ts`.
 */

export type LayoutMode = "agent" | "editor";

export const LAYOUT_MODES: readonly LayoutMode[] = ["agent", "editor"];

export interface LayoutBundle {
  readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * The `workbench.*` / `window.*` keys each mode owns. Applied at the Workspace
 * target so a user's Global settings are never rewritten, and cleared (set to
 * `undefined`) on the opposite mode so switching is symmetric.
 *
 * Only keys that genuinely *differ* between the two layouts live here. The
 * static Valyria identity defaults (`window.commandCenter`, `menuBarVisibility`,
 * `startupEditor`, the product / file icon themes, the window title voice) are
 * `configurationDefaults` on the code-free `chrome/` built-in so they hold in
 * untrusted workspaces too — see docs/UX-DIFFERENTIATION.md lever B.
 */
export const LAYOUT_BUNDLES: Readonly<Record<LayoutMode, LayoutBundle>> = {
  agent: {
    settings: {
      "workbench.activityBar.location": "hidden",
      "workbench.editor.showTabs": "single",
      "workbench.editor.editorActionsLocation": "hidden",
      "workbench.panel.defaultLocation": "bottom",
      "window.density.editorTabHeight": "compact",
      "breadcrumbs.enabled": false,
    },
  },
  editor: {
    settings: {
      "workbench.activityBar.location": "top",
      "workbench.editor.showTabs": "multiple",
      "workbench.editor.editorActionsLocation": "default",
      "window.density.editorTabHeight": "default",
      "breadcrumbs.enabled": true,
    },
  },
};

/** Keys touched by *either* bundle — the set we clear before applying a mode, so
 *  a key present in one bundle but not the other returns to the user/default. */
export const MANAGED_KEYS: readonly string[] = [
  ...new Set([
    ...Object.keys(LAYOUT_BUNDLES.agent.settings),
    ...Object.keys(LAYOUT_BUNDLES.editor.settings),
  ]),
];

/** Resolve the settings a mode should end at: start from every managed key
 *  undefined, then layer the mode's bundle. Pure. */
export function resolveLayoutSettings(mode: LayoutMode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of MANAGED_KEYS) out[k] = undefined;
  Object.assign(out, LAYOUT_BUNDLES[mode].settings);
  return out;
}
