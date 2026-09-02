/**
 * Browser-side webview runtime shared by every Valyria view.
 *
 * A view calls `mountWebview({ onState, restore })` and gets back
 * `{ command, save }`. It never talks to `acquireVsCodeApi` directly.
 *
 * Bundled per-view by esbuild (IIFE) — no imports from `vscode` or Node here.
 */
import type { HostMessage, WebviewMessage } from "./protocol";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

export interface MountOptions<Model> {
  /** Called on every `state` push from the host. */
  onState: (model: Model) => void;
  /** Called once at mount with any persisted per-view state (or undefined). */
  restore?: (state: unknown) => void;
}

export interface WebviewControls {
  /** Send an intent to the host. */
  command: (name: string, args?: unknown) => void;
  /** Persist small per-view UI state (scroll pos, expanded rows, …). */
  save: (state: unknown) => void;
}

const LIVE_REGION_ID = "valyria-live-region";

export function mountWebview<Model>(opts: MountOptions<Model>): WebviewControls {
  const api = acquireVsCodeApi();

  ensureLiveRegion();

  window.addEventListener("message", (e: MessageEvent<HostMessage>) => {
    const msg = e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "state") {
      opts.onState(msg.model as Model);
    } else if (msg.type === "focus") {
      (document.querySelector<HTMLElement>("[data-autofocus]") ?? document.body).focus();
    }
  });

  if (opts.restore) {
    try {
      opts.restore(api.getState());
    } catch {
      /* getState can throw in restricted contexts */
    }
  }

  const post = (m: WebviewMessage) => api.postMessage(m);
  post({ type: "ready" });

  return {
    command: (name, args) => post({ type: "command", name, args }),
    save: (state) => {
      try {
        api.setState(state);
      } catch {
        /* ignore */
      }
    },
  };
}

/** Announce a transient message to assistive tech (aria-live=polite). */
export function announce(text: string): void {
  const region = ensureLiveRegion();
  region.textContent = "";
  // rAF so screen readers pick up the change as a new announcement
  requestAnimationFrame(() => {
    region.textContent = text;
  });
}

function ensureLiveRegion(): HTMLElement {
  let region = document.getElementById(LIVE_REGION_ID);
  if (!region) {
    region = document.createElement("div");
    region.id = LIVE_REGION_ID;
    region.className = "visually-hidden";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("role", "status");
    document.body.appendChild(region);
  }
  return region;
}

/** Small helper: create an element with text + attributes. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}
