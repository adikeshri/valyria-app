// The human PTY — a real shell the user types into, hosted in valyria-bridge
// and bound to the authorized workspace root (docs/PLAN.md §4.10,
// bridge_host.rs `pty_*`).
//
// This is a local surface (CORE-INTERFACE §3: "render a PTY the human types
// into"), NOT a way to run commands as the agent (D7). The read-only
// "Agent Commands" view is a projection of `tool_*` events and must never
// import this module — enforced by `xtask check-d7`.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const pty = {
  /** Open (or re-attach to) the workspace shell. Returns its replayed
   *  scrollback — the panel writes it into a fresh xterm on mount. */
  open: (cols: number, rows: number) => invoke<string>("pty_open", { cols, rows }),
  /** Raw keystroke bytes from `term.onData`. */
  write: (data: string) => invoke<null>("pty_write", { data }),
  resize: (cols: number, rows: number) => invoke<null>("pty_resize", { cols, rows }),
  /** End the shell. Not called on unmount — the dock unmounts the panel on
   *  every tab switch and the shell must survive that. */
  close: () => invoke<null>("pty_close"),

  onOutput: (cb: (chunk: string) => void): Promise<UnlistenFn> =>
    listen<string>("core://pty-output", (e) => cb(e.payload)),
  /** The shell process ended; payload is its exit code when known. */
  onExit: (cb: (code: number | null) => void): Promise<UnlistenFn> =>
    listen<number | null>("core://pty-exit", (e) => cb(e.payload)),
};
