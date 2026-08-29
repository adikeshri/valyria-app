//! `valyria-bridge` — the only code in `valyria-app` that speaks the Core
//! protocol.
//!
//! Owns (as this grows): the socket client, the session supervisor
//! (spawn / adopt / health / reap of `valyria serve`), the event pump, the
//! workspace registry, the config-file writer, and the human PTY host.
//!
//! **Layering rule (docs/PLAN.md D2):** this crate depends on
//! `valyria-protocol` and `valyria-types` and nothing else from Core.
//! `cargo run -p xtask -- check-layering` fails the build otherwise.
//!
//! ## Status
//!
//! Increment 1 (this): workspace identity + socket-path convention, Core
//! binary resolution, and the `hello` handshake with protocol-major
//! compatibility checking. The spawn/adopt/backoff supervisor loop and the
//! batched event pump land next (docs/PLAN.md Phase 1).

#![forbid(unsafe_code)]

pub mod core_binary;
pub mod error;
pub mod session;
pub mod workspace;

pub use core_binary::CoreBinary;
pub use error::{BridgeError, Result};
pub use session::{negotiate, ConnectionState, NegotiatedSession, CLIENT_NAME};
pub use workspace::{
    ensure_run_dir, meta_path, pid_path, run_dir, socket_path, valyria_home, WorkspaceId,
};

/// Re-exported so callers name wire types through the bridge, never by
/// depending on `valyria-protocol` directly.
pub use valyria_protocol as protocol;
