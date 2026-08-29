//! Bridge error taxonomy. Every variant carries a stable `code()` string so a
//! log line and a UI `ErrorPresentation` (docs/PLAN.md §3) can be keyed to it.

use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    #[error(
        "no Core binary found: checked settings override, $VALYRIA_BIN, and the bundled sidecar"
    )]
    CoreBinaryNotFound,

    #[error("Core binary at {path} is not executable")]
    CoreBinaryNotExecutable { path: PathBuf },

    #[error("could not resolve a canonical path for workspace root {root}: {source}")]
    WorkspaceRoot {
        root: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("could not prepare the run directory {dir}: {source}")]
    RunDir {
        dir: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("Core spoke protocol {got}; this app was built against {expected} (core.lock.json)")]
    ProtocolMismatch { expected: String, got: String },

    #[error("the `hello` handshake failed: {0}")]
    Handshake(String),

    #[error("transport error talking to Core: {0}")]
    Transport(String),
}

impl BridgeError {
    /// Stable, machine-readable code for logs and the error-presentation table.
    pub fn code(&self) -> &'static str {
        match self {
            BridgeError::CoreBinaryNotFound => "bridge.core_binary.not_found",
            BridgeError::CoreBinaryNotExecutable { .. } => "bridge.core_binary.not_executable",
            BridgeError::WorkspaceRoot { .. } => "bridge.workspace.bad_root",
            BridgeError::RunDir { .. } => "bridge.run_dir",
            BridgeError::ProtocolMismatch { .. } => "bridge.protocol.mismatch",
            BridgeError::Handshake(_) => "bridge.handshake",
            BridgeError::Transport(_) => "bridge.transport",
        }
    }
}

pub type Result<T> = std::result::Result<T, BridgeError>;
