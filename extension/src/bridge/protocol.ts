/**
 * The JSON-RPC surface of `valyria-bridge-host`.
 *
 * This is the exact contract the Tauri renderer had with `src-tauri/bridge_host.rs`,
 * re-expressed as JSON-RPC 2.0 over stdio. Requests are 1:1 with the old
 * `#[tauri::command]`s; notifications replace the old `app.emit("core://…")`.
 *
 * Wire framing: LSP-style `Content-Length` headers, UTF-8 JSON bodies.
 *
 * Payloads are intentionally loose here (`unknown` / index types). The typed,
 * zod-decoded shapes live in `@valyria/protocol`; this file only needs the
 * method names and the request argument shapes.
 */

export interface SessionInfo {
  workspaceRoot: string;
  workspaceId: string;
  socketPath: string;
  origin: "spawned" | "adopted";
  protocolVersion: string;
  runtimeVersion: string;
  capabilities: string[];
  permissionMode: string | null;
  ownsDaemon: boolean;
  authenticated: boolean;
}

export type ConnectionState =
  | "starting"
  | "connecting"
  | "ready"
  | "degraded"
  | "reconnecting"
  | "incompatible"
  | "failed";

/** Batched Core events, coalesced by the host (~16ms), carrying seq bounds. */
export interface EventBatch {
  firstSeq: number;
  lastSeq: number;
  /** Set when firstSeq is not exactly one past the previous batch's lastSeq. */
  gapBefore: boolean;
  events: CoreEvent[];
}

/** The raw wire event (valyria_protocol::WireEvent) — snake_case, exactly what
 *  `@valyria/state`'s decoder consumes. Loose-typed by design (PLAN.md D5). */
export interface CoreEvent {
  seq: number;
  task_id: string | null;
  ts_ms: number;
  kind: string;
  payload: unknown;
}

/** Request methods: name -> [params, result]. */
export interface Requests {
  // --- session / supervisor ---
  "session/open": [
    { workspaceRoot: string; permissionMode?: string | null; appliedThrough?: number },
    SessionInfo,
  ];
  "session/restart": [{ permissionMode: string }, SessionInfo];
  "session/status": [Record<string, never>, SessionInfo | null];
  "session/close": [Record<string, never>, null];
  "about/info": [Record<string, never>, Record<string, unknown>];

  // --- tasks ---
  "task/create": [{ objective: string; mode?: string | null }, { taskId: string }];
  "task/list": [Record<string, never>, unknown];
  "task/status": [{ taskId: string }, unknown];
  "task/plan": [{ taskId: string }, unknown];
  "task/report": [{ taskId: string }, unknown];
  "task/rollback": [{ taskId: string; checkpointId: string }, unknown];
  "task/pause": [{ taskId: string }, null];
  "task/resume": [{ taskId: string }, null];
  "task/cancel": [{ taskId: string }, null];

  // --- approvals ---
  "permission/resolve": [{ taskId: string; allow: boolean }, null];
  "permission/resolveScoped": [
    { taskId: string; allow: boolean; scope: "once" | "task" },
    null
  ];

  // --- config / doctor ---
  "config/show": [Record<string, never>, unknown];
  "config/write": [{ key: string; value: string; scope: "workspace" | "user" }, unknown];
  "config/set": [{ key: string; value: string; scope?: string }, unknown];
  "doctor/run": [Record<string, never>, unknown];

  // --- workspace / index / search (Core surfaces; G3) ---
  "workspace/status": [Record<string, never>, unknown];
  "search/query": [{ query: string; mode?: string }, unknown];
  "index/status": [Record<string, never>, unknown];
  "index/build": [Record<string, never>, unknown];

  // --- git (Core, G3) ---
  "git/status": [Record<string, never>, unknown];
  "git/diff": [{ path?: string }, unknown];
  "git/log": [{ limit?: number }, unknown];
  "git/branches": [Record<string, never>, unknown];

  // --- models / hardware (G4/G5) ---
  "model/list": [Record<string, never>, unknown];
  "model/recommend": [{ role?: string }, unknown];
  "model/install": [{ id: string }, unknown];
  "model/remove": [{ id: string }, unknown];
  "model/activate": [{ id: string }, unknown];
  "model/inspect": [{ id: string }, unknown];
  "hardware/probe": [Record<string, never>, unknown];

  // --- ledger (G8) ---
  "ledger/changes": [{ taskId: string }, unknown];

  // NOTE: no PTY methods. The integrated terminal is now Code-OSS's own
  // (upstream). The read-only agent-command view is rendered from tool_* events
  // (D7), not a PTY.
}

/** Notification methods the host pushes: name -> params. */
export interface Notifications {
  "core/eventBatch": EventBatch;
  "core/reconnected": { resumeFrom: number };
  "core/closed": { lastSeq: number };
  "core/fsChanged": { paths: string[] };
  "core/connectionState": { state: ConnectionState; detail?: string };
  "core/log": { level: "trace" | "debug" | "info" | "warn" | "error"; message: string };
}

export type RequestMethod = keyof Requests;
export type NotificationMethod = keyof Notifications;
