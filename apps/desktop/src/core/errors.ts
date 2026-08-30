// Error presentation (docs/PLAN.md §3 / PRD §36).
//
// Every user-visible error answers four questions: what happened, whether the
// agent's work stopped, whether the user needs to act, and what to do next.
// `ErrorPresentation` makes all four required, so a bare "Something went wrong"
// is not expressible. Bridge errors carry a stable `[code]` prefix
// (crates/valyria-bridge/src/error.rs `BridgeError::code()`); this module maps
// each code to its answers, with a fallback that still names the code and keeps
// the raw message.

export interface ErrorPresentation {
  /** What happened, in plain language. */
  what: string;
  /** Did the agent's task stop, or is it still running? */
  agentStopped: boolean;
  /** Does the user have to do something for this to resolve? */
  userActionNeeded: boolean;
  /** One concrete next step. */
  whatNext: string;
  /** The bridge error code, when the string carried one. */
  code: string | null;
  /** Whether simply retrying might work (mirrors BridgeError::retryable). */
  retryable: boolean;
}

type Answers = Omit<ErrorPresentation, "code" | "retryable">;

/** Pull a `[bridge.foo.bar]` code off the front of a bridge error string. */
export function parseErrorCode(s: string): string | null {
  return /^\[([a-z0-9._]+)\]/.exec(s)?.[1] ?? null;
}

function stripCode(s: string): string {
  return s.replace(/^\[[a-z0-9._]+\]\s*/, "").trim();
}

/** Codes where retrying the same operation might succeed. */
const RETRYABLE = new Set(["bridge.transport", "bridge.startup_timeout"]);

/** The §36 audit table. One entry per real `BridgeError::code()`. */
const PRESENTATIONS: Record<string, Answers> = {
  "bridge.core_binary.not_found": {
    what: "The Valyria runtime couldn't be found.",
    agentStopped: true,
    userActionNeeded: true,
    whatNext:
      "Set VALYRIA_BIN to a valyria binary, or reinstall the app so its bundled runtime is present.",
  },
  "bridge.core_binary.not_executable": {
    what: "The Valyria runtime binary isn't executable.",
    agentStopped: true,
    userActionNeeded: true,
    whatNext: "Fix the file's permissions, or reinstall the app.",
  },
  "bridge.workspace.bad_root": {
    what: "That folder couldn't be opened as a workspace.",
    agentStopped: true,
    userActionNeeded: true,
    whatNext: "Choose a folder that exists and that you have permission to read.",
  },
  "bridge.run_dir": {
    what: "Valyria couldn't create its run directory.",
    agentStopped: true,
    userActionNeeded: true,
    whatNext: "Check permissions on ~/.valyria (or $VALYRIA_HOME), then try again.",
  },
  "bridge.protocol.mismatch": {
    what: "The Core runtime speaks a protocol this build of the app doesn't support.",
    agentStopped: true,
    userActionNeeded: true,
    whatNext: "Use the Core bundled with this app, or update the app. See About & Compatibility.",
  },
  "bridge.handshake": {
    what: "The Core runtime rejected the connection handshake.",
    agentStopped: true,
    userActionNeeded: false,
    whatNext: "Open the workspace again. If it keeps failing, restart the app.",
  },
  "bridge.transport": {
    what: "The connection to the Core runtime dropped.",
    agentStopped: false,
    userActionNeeded: false,
    whatNext: "The app reconnects automatically — your task keeps running in the background.",
  },
  "bridge.spawn": {
    what: "Couldn't start the Core runtime process.",
    agentStopped: true,
    userActionNeeded: true,
    whatNext: "Check that the runtime binary is present and runnable, then open the workspace again.",
  },
  "bridge.startup_timeout": {
    what: "The Core runtime didn't become reachable in time.",
    agentStopped: true,
    userActionNeeded: false,
    whatNext: "Open the workspace again. If it keeps timing out, check the app's logs.",
  },
  "bridge.protocol.error": {
    what: "The Core runtime reported an error.",
    agentStopped: false,
    userActionNeeded: false,
    whatNext: "See the detail below. Retry if the step looked transient.",
  },
  "bridge.protocol.unexpected": {
    what: "The Core runtime sent a response the app didn't expect.",
    agentStopped: false,
    userActionNeeded: false,
    whatNext:
      "Retry. If it persists, the app and Core versions may be out of step — see About & Compatibility.",
  },
  "bridge.platform.unsupported": {
    what: "Agent sessions aren't available on this platform.",
    agentStopped: true,
    userActionNeeded: false,
    whatNext: "Run tasks on macOS or Linux. See About & Compatibility (Windows is tier 3, G9).",
  },
  "bridge.fs.path_escape": {
    what: "That path is outside the open workspace folder.",
    agentStopped: false,
    userActionNeeded: false,
    whatNext: "Only files inside the authorized workspace can be read here.",
  },
  "bridge.fs.io": {
    what: "Couldn't read that file or folder.",
    agentStopped: false,
    userActionNeeded: false,
    whatNext: "Check it still exists and is readable, then refresh.",
  },
  "bridge.git": {
    what: "A git command failed for this workspace.",
    agentStopped: false,
    userActionNeeded: false,
    whatNext: "Check the workspace is a git repository and that git is installed.",
  },
  "bridge.fs.watch": {
    what: "Couldn't watch the workspace for file changes.",
    agentStopped: false,
    userActionNeeded: false,
    whatNext: "External edits may not refresh on their own — reopen the workspace to retry.",
  },
  "bridge.config.write": {
    what: "Couldn't save that setting to Core's config file.",
    agentStopped: false,
    userActionNeeded: true,
    whatNext: "Check permissions on the config file, then try the change again.",
  },
  "bridge.pty.spawn": {
    what: "Couldn't start a shell for the terminal.",
    agentStopped: false,
    userActionNeeded: false,
    whatNext: "Make sure a shell ($SHELL, or /bin/sh) is available, then reopen the terminal.",
  },
  "bridge.pty.io": {
    what: "The terminal connection failed.",
    agentStopped: false,
    userActionNeeded: false,
    whatNext: "Close and reopen the terminal tab.",
  },
  "bridge.no_session": {
    what: "No workspace is open.",
    agentStopped: false,
    userActionNeeded: true,
    whatNext: "Open a workspace folder first.",
  },
  "bridge.autonomy.bad_mode": {
    what: "That autonomy level isn't recognized.",
    agentStopped: false,
    userActionNeeded: true,
    whatNext: "Choose Manual, Assisted, or Autonomous.",
  },
  "bridge.autonomy.not_owned": {
    what: "Core for this workspace was started by another process.",
    agentStopped: false,
    userActionNeeded: true,
    whatNext: "Quit that process to change the autonomy level from here.",
  },
};

/**
 * Turn any thrown value into a complete `ErrorPresentation`. Known bridge codes
 * use the audit table; anything else falls back to a form that still states
 * what failed, names the code if there is one, and keeps the raw detail —
 * never a bare generic.
 */
export function present(err: unknown, opts?: { context?: string }): ErrorPresentation {
  const raw = err instanceof Error ? err.message : String(err);
  const code = parseErrorCode(raw);
  const entry = code ? PRESENTATIONS[code] : undefined;

  if (entry) {
    return { ...entry, code, retryable: code ? RETRYABLE.has(code) : false };
  }

  const detail = stripCode(raw);
  const ctx = opts?.context ? `${opts.context} didn't complete` : "The operation didn't complete";
  return {
    what: detail ? `${ctx}: ${detail}` : `${ctx}.`,
    agentStopped: false,
    userActionNeeded: false,
    whatNext: code
      ? `Try again. If it keeps happening, note the code ${code} and check the app's logs.`
      : "Try again. If it keeps happening, check the app's logs.",
    code,
    retryable: code ? RETRYABLE.has(code) : false,
  };
}

/** For tests / the check gate: the set of codes the table covers. */
export const KNOWN_ERROR_CODES = Object.keys(PRESENTATIONS);
