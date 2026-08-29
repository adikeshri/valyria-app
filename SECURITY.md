# Security Policy

Valyria App is the desktop client for a **local-first** autonomous software
engineer. Its security model is documented in
[`docs/PLAN.md`](docs/PLAN.md) (§1, §3, §26, §32) and
[`docs/CORE-INTERFACE.md`](docs/CORE-INTERFACE.md) (§3, §4, G10). This file
summarizes what matters for reporting and for reasoning about the trust
boundaries.

## Supported versions

This project is a pre-1.0 preview. Only the latest tagged release
(`app.valyria.desktop` `0.x`) receives security fixes. The bundled Core runtime
is pinned per release in [`core.lock.json`](core.lock.json); Core updates ship
**only** with an app update, and an app update never touches installed model
weights.

## Reporting a vulnerability

Please report privately via **GitHub's private vulnerability reporting** on
`adikeshri/valyria-app` (repo → *Security* → *Report a vulnerability*). If that
is unavailable, open a minimal public issue asking for a private channel — do
not include exploit detail in it.

Expect an acknowledgement within a few days. There is no bounty program.

## Trust boundaries and guarantees

- **Offline. No telemetry, ever.** The app makes no network requests except the
  app-updater check against its own GitHub Releases feed
  ([`tauri.conf.json`](apps/desktop/src-tauri/tauri.conf.json) `plugins.updater`).
  The CI offline job runs the integration suite with networking disabled to keep
  this a property rather than a claim (PLAN §32).
- **No model downloads.** No code path in the app fetches model weights — not in
  the renderer, not in `valyria-bridge`. The bridge depends only on
  `valyria-protocol` + `valyria-types`, enforced by `cargo run -p xtask --
  check-layering`; every weight byte flows Core → disk (INTEGRATION D-INT-3).
- **Filesystem reads are scoped to the authorized workspace root.** Opening a
  directory is an explicit authorization act. `WorkspaceFs::resolve`
  (`crates/valyria-bridge/src/workspace_fs.rs`) rejects absolute paths, `..`, and
  symlink escapes (`canonicalize` + containment re-check). The only path the app
  reads outside its own data dir is the chosen root (PLAN §26, CORE-INTERFACE §3).
- **Git and repository surfaces are read-only** until Core exposes write methods
  (CORE-INTERFACE G3). Stage / commit / branch / discard are rendered disabled
  with the reason.
- **The Core daemon socket.** The app owns
  `$VALYRIA_HOME/run/<workspace_id>/` created `0700`, socket `0600`. The daemon
  itself does not authenticate connecting clients — any local process that can
  reach the socket can drive the agent (CORE-INTERFACE G10). Treat the machine's
  local user boundary as the security boundary.
- **Agent output is never mixed with the human's terminal.** The integrated
  terminal hosts a real shell the user types into; commands the agent ran are a
  separate, read-only view rendered from `tool_*` events. They never share a
  buffer — enforced by `cargo run -p xtask -- check-d7` (PLAN D7).
- **Approvals.** Destructive and network tool calls require a deliberate second
  confirmation. The app refuses to resolve an approval prompt that a newer
  request has superseded (CORE-INTERFACE G2).
- **Windows is tier 3.** The app installs and runs, shows version and
  compatibility information, and refuses to start a session with a specific
  reason — Core has no Windows socket transport yet (CORE-INTERFACE G9, PLAN
  D14).

## Updates

The updater verifies release artifacts against the public key in
`tauri.conf.json` (`plugins.updater.pubkey`); the private key lives only in CI
secrets. A tampered `latest.json` or installer fails signature verification and
is not applied.
