//! Workspace identity and the transport-address convention.
//!
//! Core defines **no** transport-address convention (CORE-INTERFACE §1) — the
//! app owns one. One Core daemon per workspace, keyed by a hash of the
//! canonical workspace root, under `$VALYRIA_HOME/run/<workspace_id>/`:
//!
//! ```text
//! $VALYRIA_HOME/run/<workspace_id>/
//!   sock       0600  the Unix-domain socket `valyria serve` binds (unix only)
//!   pid        0600  the daemon pid, for liveness checks before adoption
//!   meta.json  0600  { root, runtime_version, started_at_ms }
//!   auth.token 0600  the per-daemon client-auth token (G10)
//! ```
//!
//! On Windows there is no socket file — the transport is a named pipe
//! `\\.\pipe\valyria-<workspace_id>` (CORE-INTERFACE G9), and `socket_path`
//! returns that name. The rest of `run/<id>/` is unchanged.

use std::path::{Path, PathBuf};

use crate::error::{BridgeError, Result};

/// A stable identifier for a workspace: a hash of its canonical root path.
///
/// Rendered as 16 lowercase hex chars. Not cryptographic — it only needs to be
/// stable and filesystem-safe so two opens of the same directory resolve to the
/// same daemon.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WorkspaceId(String);

impl WorkspaceId {
    /// Canonicalize `root` and hash it. Fails if the path does not exist or
    /// cannot be canonicalized — opening a workspace is an explicit act and a
    /// missing root is a real error, not something to paper over.
    pub fn from_root(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref();
        let canonical = root
            .canonicalize()
            .map_err(|source| BridgeError::WorkspaceRoot {
                root: root.to_path_buf(),
                source,
            })?;
        Ok(Self::from_canonical(&canonical))
    }

    /// Hash an already-canonical path. Split out for tests.
    fn from_canonical(canonical: &Path) -> Self {
        let bytes = canonical.as_os_str().to_string_lossy();
        WorkspaceId(fnv1a_hex(bytes.as_bytes()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// `$VALYRIA_HOME`, or `~/.valyria` when it is unset — Core's own default home.
pub fn valyria_home() -> PathBuf {
    if let Some(explicit) = std::env::var_os("VALYRIA_HOME") {
        return PathBuf::from(explicit);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".valyria")
}

/// Per-workspace run directory. Created `0700` on first use.
pub fn run_dir(id: &WorkspaceId) -> PathBuf {
    valyria_home().join("run").join(id.as_str())
}

/// The address `valyria serve` binds and clients connect to for this
/// workspace: a Unix-domain socket under `run/<id>/` on unix, a named pipe
/// `\\.\pipe\valyria-<id>` on Windows (CORE-INTERFACE G9). Core's
/// `SocketClient` and `daemon::serve` both accept the value verbatim on their
/// respective platforms.
#[cfg(unix)]
pub fn socket_path(id: &WorkspaceId) -> PathBuf {
    run_dir(id).join("sock")
}

#[cfg(windows)]
pub fn socket_path(id: &WorkspaceId) -> PathBuf {
    PathBuf::from(format!(r"\\.\pipe\valyria-{}", id.as_str()))
}

#[cfg(not(any(unix, windows)))]
pub fn socket_path(id: &WorkspaceId) -> PathBuf {
    run_dir(id).join("sock")
}

/// True when `socket_path` is a real filesystem entry that can be `stat`ed and
/// removed (unix). On Windows the transport is a named pipe with no file, so
/// staleness is probed by connecting instead.
pub const SOCKET_IS_FILE: bool = cfg!(unix);

pub fn pid_path(id: &WorkspaceId) -> PathBuf {
    run_dir(id).join("pid")
}

pub fn meta_path(id: &WorkspaceId) -> PathBuf {
    run_dir(id).join("meta.json")
}

/// The per-daemon client-auth token file (CORE-INTERFACE G10). Written `0600`
/// when this process spawns the daemon (and passed to it as
/// `--auth-token-file`); read back when adopting a daemon another instance of
/// this app started. A daemon started by hand with no token simply has no file
/// here, and the client connects unauthenticated.
pub fn auth_token_path(id: &WorkspaceId) -> PathBuf {
    run_dir(id).join("auth.token")
}

/// Create `run/<id>/` with `0700` permissions, idempotently.
pub fn ensure_run_dir(id: &WorkspaceId) -> Result<PathBuf> {
    let dir = run_dir(id);
    std::fs::create_dir_all(&dir).map_err(|source| BridgeError::RunDir {
        dir: dir.clone(),
        source,
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o700);
        std::fs::set_permissions(&dir, perms).map_err(|source| BridgeError::RunDir {
            dir: dir.clone(),
            source,
        })?;
    }
    Ok(dir)
}

/// FNV-1a over `bytes`, low 64 bits, as 16 hex chars.
fn fnv1a_hex(bytes: &[u8]) -> String {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut hash = OFFSET;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_path_hashes_stably() {
        let a = WorkspaceId::from_canonical(Path::new("/home/dev/project"));
        let b = WorkspaceId::from_canonical(Path::new("/home/dev/project"));
        assert_eq!(a, b);
        assert_eq!(a.as_str().len(), 16);
        assert!(a.as_str().bytes().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn different_paths_differ() {
        let a = WorkspaceId::from_canonical(Path::new("/home/dev/project-a"));
        let b = WorkspaceId::from_canonical(Path::new("/home/dev/project-b"));
        assert_ne!(a, b);
    }

    #[test]
    fn paths_hang_off_the_run_dir() {
        let id = WorkspaceId::from_canonical(Path::new("/tmp/x"));
        let sock = socket_path(&id);
        assert!(sock.ends_with("sock"));
        assert!(sock.parent().unwrap().ends_with(id.as_str()));
    }
}
