import { useState } from "react";
import { useLive } from "../core/liveStore";
import { present } from "../core/errors";
import ErrorState from "./ErrorState";

const LS_KEY = "valyria.lastWorkspaceRoot";

/** A thin strip for pointing the app at a workspace root and spawning / adopting
 *  its Core daemon. Shown only in the desktop shell, and only until a session is
 *  live. A real folder picker replaces the text field once the dialog plugin
 *  lands. */
export default function ConnectBar() {
  const available = useLive((s) => s.available);
  const session = useLive((s) => s.session);
  const connection = useLive((s) => s.connection);
  const error = useLive((s) => s.error);
  const openWorkspace = useLive((s) => s.openWorkspace);

  const [root, setRoot] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY) ?? "";
    } catch {
      return "";
    }
  });

  if (!available || session) return null;

  const busy = connection === "connecting";
  const failure = connection === "failed" && error ? present(error, { context: "Opening the workspace" }) : null;

  const submit = () => {
    const v = root.trim();
    if (!v) return;
    try {
      localStorage.setItem(LS_KEY, v);
    } catch {
      /* private mode */
    }
    void openWorkspace(v);
  };

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--bg-sunken)",
        fontSize: "var(--text-xs)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px" }}>
      <span style={{ color: "var(--text-tertiary)" }}>Workspace</span>
      <input
        aria-label="Workspace root path"
        value={root}
        placeholder="/absolute/path/to/a/git/repo"
        spellCheck={false}
        onChange={(e) => setRoot(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        style={{
          flex: 1,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          padding: "4px 8px",
          border: "1px solid var(--border-strong)",
          borderRadius: 6,
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
        }}
      />
      <button className="no-native-focus" disabled={busy} onClick={submit} style={{ padding: "4px 12px", borderRadius: 6 }}>
        {busy ? "Starting Core…" : "Open"}
      </button>
      </div>
      {failure && (
        <div style={{ padding: "0 14px 8px" }}>
          <ErrorState presentation={failure} compact />
        </div>
      )}
    </div>
  );
}
