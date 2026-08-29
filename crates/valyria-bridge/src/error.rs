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

    #[error("could not spawn `{bin} serve`: {source}")]
    Spawn {
        bin: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("Core did not become reachable within {waited_ms}ms of spawning")]
    StartupTimeout { waited_ms: u128 },

    #[error("Core returned an error [{code}]: {message}")]
    Protocol {
        code: String,
        message: String,
        retryable: bool,
    },

    #[error("unexpected response from Core: {0}")]
    UnexpectedResponse(String),

    #[error("path {rel:?} escapes the workspace root")]
    PathEscape { rel: String },

    #[error("filesystem error at {path}: {source}")]
    Fs {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("git error: {0}")]
    Git(String),

    #[error("filesystem watch error: {0}")]
    Watch(String),

    #[error("config file error: {0}")]
    Config(String),

    #[error("could not start a shell: {0}")]
    PtySpawn(String),

    #[error("terminal I/O error: {0}")]
    PtyIo(String),
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
            BridgeError::Spawn { .. } => "bridge.spawn",
            BridgeError::StartupTimeout { .. } => "bridge.startup_timeout",
            BridgeError::Protocol { .. } => "bridge.protocol.error",
            BridgeError::UnexpectedResponse(_) => "bridge.protocol.unexpected",
            BridgeError::PathEscape { .. } => "bridge.fs.path_escape",
            BridgeError::Fs { .. } => "bridge.fs.io",
            BridgeError::Git(_) => "bridge.git",
            BridgeError::Watch(_) => "bridge.fs.watch",
            BridgeError::Config(_) => "bridge.config.write",
            BridgeError::PtySpawn(_) => "bridge.pty.spawn",
            BridgeError::PtyIo(_) => "bridge.pty.io",
        }
    }

    /// Whether retrying the operation might succeed (mirrors `WireError.retryable`).
    pub fn retryable(&self) -> bool {
        match self {
            BridgeError::Transport(_) | BridgeError::StartupTimeout { .. } => true,
            BridgeError::Protocol { retryable, .. } => *retryable,
            _ => false,
        }
    }
}

pub type Result<T> = std::result::Result<T, BridgeError>;
