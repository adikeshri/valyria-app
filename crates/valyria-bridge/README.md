# valyria-bridge

The Rust protocol client that sits between `valyria-bridge-host` (the stdio
front end the Valyria VS Code extension spawns) and a Core (`valyria serve`)
daemon. It depends only on `valyria-protocol` + `valyria-types` from Core —
`xtask check-layering` fails if that ever stops being true, so the wire
contract stays the single coupling point.

## What's in it

| Module | Role |
|---|---|
| `supervisor` | `spawn_or_adopt` — one daemon per workspace: adopt a healthy running one, else clean any stale socket and spawn `valyria serve`. Generates a per-daemon auth token (`0600` in `run/<id>/auth.token`, passed as `--auth-token-file`); on Windows addresses a named pipe instead of a Unix socket. |
| `session` | The `hello` handshake, protocol-major compatibility check, `ConnectionState`. |
| `client` | `CoreClient` — a timeout-bounded, typed wrapper over `SocketClient`. One short-lived connection per call; a `Response::Error` becomes a `BridgeError::Protocol` carrying Core's `code` verbatim. Authenticates every frame with the session token. |
| `event_pump` | One long-lived `events_subscribe` connection, coalesced into `~16 ms` batches with `first_seq`/`last_seq` so the consumer can assert contiguity; re-subscribes from the last applied `seq` on a gap. `start_scoped` filters to one task (G11) — the extension session uses the full stream for crash-recoverable contiguity. |
| `pty` | A shell PTY at the workspace root (D7). Unused by `valyria-bridge-host` — the Code-OSS fork uses the editor's own integrated terminal; kept for a non-VS Code embedder. |
| `workspace_fs` / `git` | Workspace-root-scoped local filesystem and `git` reads, for the surfaces Core exposes no RPC for (directory listing, blob read). |
| `config_writer` | `write_key` — edit a Core-owned `config.toml` leaf. |

## Tests

```bash
cargo test -p valyria-bridge --lib          # unit
cargo test -p valyria-bridge                # + integration tests that spawn a
                                            # real `valyria` binary (self-skip
                                            # without ../valyria or $VALYRIA_BIN)
```
