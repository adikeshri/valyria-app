//! The session supervisor (docs/PLAN.md §4.2) — the load-bearing subsystem.
//!
//! One Core daemon per workspace. On `open`:
//!
//! ```text
//! resolve workspace_id → ensure run/<id>/ (0700)
//!   → socket + pid present, pid alive, `hello` ok, runtime matches → ADOPT   (§30 crash recovery)
//!   → otherwise: clean any stale socket, spawn `valyria serve`, poll-connect
//!     with bounded backoff, `hello`, write pid + meta.json → SPAWNED
//! ```
//!
//! The daemon is meant to **outlive the UI** (`kill_on_drop` defaults off).
//! Tests flip `kill_daemon_on_drop` so a panicking test never orphans a
//! process.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::process::{Child, Command};

use crate::core_binary::CoreBinary;
use crate::error::{BridgeError, Result};
use crate::session::{negotiate, NegotiatedSession};
use crate::workspace::{ensure_run_dir, meta_path, pid_path, socket_path, WorkspaceId};

#[derive(Clone)]
pub struct SupervisorConfig {
    pub workspace_root: PathBuf,
    pub core_binary: CoreBinary,
    /// Protocol version this build expects (from `core.lock.json`). A major
    /// mismatch is a hard failure (CORE-INTERFACE §4).
    pub expected_protocol: String,
    /// `$VALYRIA_HOME` for the spawned daemon. `None` → inherit (Core defaults
    /// to `~/.valyria`). Tests pin this to a tempdir.
    pub valyria_home: Option<PathBuf>,
    /// How long to wait for a freshly spawned daemon to answer `hello`.
    pub startup_timeout: Duration,
    /// Kill the spawned daemon when the `Session` drops. Off in production
    /// (the daemon outlives the UI); on in tests.
    pub kill_daemon_on_drop: bool,
    /// Autonomy level to start the daemon with (§25, CORE-INTERFACE G1):
    /// `manual` | `assisted` | `autonomous`. `None` → let Core apply its own
    /// default. Passed as `valyria serve --permission-mode <mode>`; changing it
    /// on a live workspace means restarting the daemon.
    pub permission_mode: Option<String>,
}

impl SupervisorConfig {
    pub fn new(workspace_root: impl Into<PathBuf>, core_binary: CoreBinary) -> Self {
        Self {
            workspace_root: workspace_root.into(),
            core_binary,
            expected_protocol: "1.0.0".to_string(),
            valyria_home: None,
            startup_timeout: Duration::from_secs(20),
            kill_daemon_on_drop: false,
            permission_mode: None,
        }
    }
}

/// How the current session's daemon came to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// Adopted a daemon that was already running (§30).
    Adopted,
    /// Spawned a fresh daemon.
    Spawned,
}

pub struct Session {
    pub id: WorkspaceId,
    pub socket_path: PathBuf,
    pub negotiated: NegotiatedSession,
    pub origin: Origin,
    /// Autonomy level the daemon is running under (§25). For a spawned daemon
    /// this is what we passed on the command line; for an adopted one it is
    /// read back from `meta.json` and may be `None` if a foreign process wrote
    /// no meta. The UI shows this and disables the autonomy switch while it is
    /// unknown or while the daemon is not ours to restart.
    pub permission_mode: Option<String>,
    /// `Some` only when this process spawned the daemon.
    child: Option<Child>,
    kill_on_drop: bool,
}

impl Session {
    pub fn is_adopted(&self) -> bool {
        self.origin == Origin::Adopted
    }

    /// True when this process spawned the daemon and may therefore stop or
    /// restart it (the autonomy switch needs this — §25 / G1).
    pub fn is_owned(&self) -> bool {
        self.child.is_some()
    }

    /// The spawned daemon's pid, if we own it.
    pub fn daemon_pid(&self) -> Option<u32> {
        self.child.as_ref().and_then(Child::id)
    }

    /// Explicitly end a daemon this session spawned (the "quit and stop Core"
    /// action). No-op for an adopted daemon — that one is not ours to kill
    /// here.
    pub async fn shutdown_daemon(&mut self) -> Result<()> {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        let _ = std::fs::remove_file(&self.socket_path);
        let _ = std::fs::remove_file(pid_path(&self.id));
        Ok(())
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if self.kill_on_drop {
            if let Some(child) = &mut self.child {
                let _ = child.start_kill();
            }
        }
    }
}

/// Adopt a running daemon for this workspace, or spawn one.
pub async fn spawn_or_adopt(config: SupervisorConfig) -> Result<Session> {
    let id = WorkspaceId::from_root(&config.workspace_root)?;
    ensure_run_dir(&id)?;
    let sock = socket_path(&id);

    if let Some(session) = try_adopt(&id, &sock, &config).await {
        return Ok(session);
    }

    // Nothing healthy to adopt — clear a stale socket and spawn.
    let _ = std::fs::remove_file(&sock);

    let mut cmd = Command::new(config.core_binary.path());
    cmd.arg("serve")
        .arg("--workspace")
        .arg(&config.workspace_root)
        .arg("--socket")
        .arg(&sock)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(mode) = &config.permission_mode {
        cmd.arg("--permission-mode").arg(mode);
    }
    if let Some(home) = &config.valyria_home {
        cmd.env("VALYRIA_HOME", home);
    }

    let child = cmd.spawn().map_err(|source| BridgeError::Spawn {
        bin: config.core_binary.path().to_path_buf(),
        source,
    })?;

    let negotiated =
        poll_negotiate(&sock, &config.expected_protocol, config.startup_timeout).await?;

    write_pid_and_meta(&id, child.id(), &config, &negotiated);

    Ok(Session {
        id,
        socket_path: sock,
        negotiated,
        origin: Origin::Spawned,
        permission_mode: config.permission_mode.clone(),
        child: Some(child),
        kill_on_drop: config.kill_daemon_on_drop,
    })
}

/// Try to adopt: socket present, pid (if recorded) alive, `hello` succeeds and
/// the protocol major matches. Any miss returns `None` and the caller spawns.
async fn try_adopt(id: &WorkspaceId, sock: &Path, config: &SupervisorConfig) -> Option<Session> {
    if !sock.exists() {
        return None;
    }
    if let Some(pid) = read_pid(id) {
        if !pid_is_alive(pid) {
            tracing::debug!(pid, "recorded daemon pid is not alive; will not adopt");
            return None;
        }
    }
    match negotiate(sock, &config.expected_protocol).await {
        Ok(negotiated) => {
            tracing::info!(
                runtime = %negotiated.runtime_version,
                "adopted a running Core daemon"
            );
            Some(Session {
                id: id.clone(),
                socket_path: sock.to_path_buf(),
                negotiated,
                origin: Origin::Adopted,
                permission_mode: read_meta_permission_mode(id),
                child: None,
                kill_on_drop: false,
            })
        }
        Err(BridgeError::ProtocolMismatch { .. }) => {
            // A live but incompatible daemon: do not adopt, do not silently
            // kill it either. Surfacing this is the caller's job.
            None
        }
        Err(_) => None,
    }
}

/// Poll-connect with bounded exponential backoff until `hello` succeeds.
async fn poll_negotiate(
    sock: &Path,
    expected_protocol: &str,
    timeout: Duration,
) -> Result<NegotiatedSession> {
    let start = Instant::now();
    let mut delay = Duration::from_millis(50);
    loop {
        match negotiate(sock, expected_protocol).await {
            Ok(n) => return Ok(n),
            Err(e @ BridgeError::ProtocolMismatch { .. }) => return Err(e),
            Err(_) => {
                if start.elapsed() >= timeout {
                    return Err(BridgeError::StartupTimeout {
                        waited_ms: start.elapsed().as_millis(),
                    });
                }
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_millis(500));
            }
        }
    }
}

fn write_pid_and_meta(
    id: &WorkspaceId,
    pid: Option<u32>,
    config: &SupervisorConfig,
    negotiated: &NegotiatedSession,
) {
    if let Some(pid) = pid {
        let _ = std::fs::write(pid_path(id), pid.to_string());
    }
    let meta = serde_json::json!({
        "root": config.workspace_root,
        "runtime_version": negotiated.runtime_version,
        "protocol_version": negotiated.protocol_version,
        "permission_mode": config.permission_mode,
        "started_at_ms": now_ms(),
    });
    let _ = std::fs::write(
        meta_path(id),
        serde_json::to_vec_pretty(&meta).unwrap_or_default(),
    );
}

fn read_pid(id: &WorkspaceId) -> Option<u32> {
    std::fs::read_to_string(pid_path(id))
        .ok()
        .and_then(|s| s.trim().parse().ok())
}

/// The autonomy level recorded when the daemon was started, if a `meta.json`
/// with that field exists (a daemon spawned by an older app, or by hand, will
/// have none — the UI then shows the mode as unknown).
fn read_meta_permission_mode(id: &WorkspaceId) -> Option<String> {
    let text = std::fs::read_to_string(meta_path(id)).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get("permission_mode")?.as_str().map(str::to_string)
}

#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    // `kill -0` probes existence without sending a signal. Spawning `kill`
    // avoids a libc dependency; Windows is tier 3 so unix-only is fine here.
    std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn pid_is_alive(_pid: u32) -> bool {
    false
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}
