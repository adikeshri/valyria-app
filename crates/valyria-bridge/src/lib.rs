//! `valyria-bridge` — the only code in `valyria-app` that speaks the Core
//! protocol.
//!
//! Owns: the socket client (`CoreClient`), the session supervisor
//! (`spawn_or_adopt` — spawn / adopt / health / reap of `valyria serve`), the
//! event pump (`EventPump`), the local-read repository surfaces, and the human
//! PTY host (`PtySession`).
//!
//! **Layering rule (docs/PLAN.md D2):** this crate depends on
//! `valyria-protocol` and `valyria-types` and nothing else from Core.
//! `cargo run -p xtask -- check-layering` fails the build otherwise.

#![forbid(unsafe_code)]

pub mod client;
pub mod config_writer;
pub mod core_binary;
pub mod error;
pub mod event_pump;
pub mod git;
pub mod pty;
pub mod session;
pub mod supervisor;
pub mod watcher;
pub mod workspace;
pub mod workspace_fs;

pub use client::{CoreClient, DEFAULT_CALL_TIMEOUT};
pub use config_writer::{config_path, write_key, ConfigScope};
pub use core_binary::CoreBinary;
pub use error::{BridgeError, Result};
pub use event_pump::{EventBatch, EventPump, PumpMessage};
pub use git::{GitCommit, GitEntry, GitRepo};
pub use pty::{PtyEvent, PtySession};
pub use session::{negotiate, ConnectionState, NegotiatedSession, CLIENT_NAME};
pub use supervisor::{spawn_or_adopt, Origin, Session, SupervisorConfig};
pub use watcher::WorkspaceWatcher;
pub use workspace::{
    ensure_run_dir, meta_path, pid_path, run_dir, socket_path, valyria_home, WorkspaceId,
};
pub use workspace_fs::{DirEntry, FileView, WorkspaceFs};

/// Re-exported so callers name wire types through the bridge, never by
/// depending on `valyria-protocol` directly.
pub use valyria_protocol as protocol;
