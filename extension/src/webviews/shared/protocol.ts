/**
 * The typed message contract between the extension host and a Valyria webview.
 *
 * The host pushes a *view-model* (the output of `@valyria/state` selectors run
 * in the ext host — PLAN.md D3/D4: the webview holds no logic). The webview
 * emits *intents*: `ready` once, then `command`s the host maps to bridge calls.
 */

/** Host → webview. */
export type HostMessage =
  | { type: "state"; view: string; model: unknown }
  | { type: "focus" }; // host asks the view to take keyboard focus

/** Webview → host. */
export type WebviewMessage =
  | { type: "ready" }
  | { type: "command"; name: string; args?: unknown };

// --- per-view model shapes ------------------------------------------------

export interface ActivityModel {
  connection:
    | "starting"
    | "connecting"
    | "ready"
    | "degraded"
    | "reconnecting"
    | "incompatible"
    | "failed";
  /** humanised narrative, oldest → newest */
  lines: string[];
  /** count of events the decoder could not type (D5) */
  degraded: number;
}
