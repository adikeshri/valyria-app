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
//! The daemon is meant to **outlive the UI**, on two independent levels:
//! `kill_on_drop` defaults off (dropping the `Session` here never explicitly
//! kills it), and the spawned process is detached into its own OS process
//! group (`detach_from_launcher_process_group`) so a signal delivered to the
//! *launching* group — closing the terminal that started the app, or the app
//! quitting in a way that signals its own group — cannot reach it either.
//! Tests flip `kill_daemon_on_drop` so a panicking test never orphans a
//! process.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::process::{Child, Command};

use crate::core_binary::CoreBinary;
use crate::error::{BridgeError, Result};
use crate::session::{negotiate, NegotiatedSession};
use crate::workspace::{
    auth_token_path, ensure_run_dir, meta_path, pid_path, socket_path, WorkspaceId,
};

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
    /// The client-auth token every call/subscribe to this daemon must carry
    /// (CORE-INTERFACE G10). `Some` when we spawned the daemon (we generated it)
    /// or adopted one that has an `auth.token` file; `None` for a daemon started
    /// with no token. `CoreClient` / `EventPump` are built from this.
    pub auth_token: Option<String>,
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
        // The Windows pipe has no file to unlink; it goes away with the server.
        if crate::workspace::SOCKET_IS_FILE {
            let _ = std::fs::remove_file(&self.socket_path);
        }
        let _ = std::fs::remove_file(pid_path(&self.id));
        let _ = std::fs::remove_file(auth_token_path(&self.id));
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

/// Refuse early on a platform with no Core transport, rather than spawning a
/// daemon that can never bind and timing out (D14 / CORE-INTERFACE G9). The
/// rest of the app still runs — this only gates sessions.
///
/// Both unix (Unix-domain socket) and Windows (named pipe) have a transport as
/// of protocol 1.9.0, so sessions are allowed on both. Anything else (wasm,
/// unknown) is refused.
#[cfg(any(unix, windows))]
fn platform_precheck() -> Result<()> {
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn platform_precheck() -> Result<()> {
    Err(BridgeError::PlatformUnsupported(
        "Valyria's runtime talks to the app over a local IPC transport (a Unix-domain \
         socket or a Windows named pipe), and this platform has neither. The app runs \
         and shows version and compatibility information, but a session cannot start here."
            .to_string(),
    ))
}

/// Take the about-to-spawn Core daemon out of the launching process's job
/// group, so it truly outlives the UI (PLAN.md D1) rather than merely
/// surviving an explicit kill.
///
/// Without this, `valyria serve` inherits the process group of whatever
/// launched the app (the dev shell that `exec`'d Electron, or Electron
/// itself). Closing that controlling terminal, or the app quitting in a way
/// that sends a job-control signal to its own process group (SIGHUP on
/// terminal close, SIGTERM to `-pgid`), delivers the same signal to every
/// process still in that group — bridge-host *and* the daemon it spawned,
/// even though `kill_on_drop` is off and nothing in this crate asked for
/// that. `Session::shutdown_daemon`'s explicit `child.start_kill()` still
/// targets the child's pid directly, so it is unaffected by which group the
/// child sits in.
fn detach_from_launcher_process_group(cmd: &mut Command) {
    #[cfg(unix)]
    {
        // pgroup 0: the child becomes the leader of a brand-new process
        // group (gid == its own pid), detached from the parent's.
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        // CREATE_NEW_PROCESS_GROUP (winbase.h): excludes the child from the
        // parent's console process group, so Ctrl+C / console-close signals
        // sent to that group don't reach it either.
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }
}

/// Adopt a running daemon for this workspace, or spawn one.
pub async fn spawn_or_adopt(config: SupervisorConfig) -> Result<Session> {
    platform_precheck()?;

    let id = WorkspaceId::from_root(&config.workspace_root)?;
    ensure_run_dir(&id)?;
    let sock = socket_path(&id);

    if let Some(session) = try_adopt(&id, &sock, &config).await {
        return Ok(session);
    }

    // Nothing healthy to adopt — clear a stale socket (unix). On Windows the
    // pipe has no file; a stale pipe simply has no server and connect fails.
    if crate::workspace::SOCKET_IS_FILE {
        let _ = std::fs::remove_file(&sock);
    }

    // A fresh per-daemon client-auth token (G10): write it `0600` and hand the
    // path to `valyria serve`. Every client frame to this daemon then carries
    // it; a connection from any other local process is refused.
    let token = generate_auth_token();
    let token_file = auth_token_path(&id);
    write_token_file(&token_file, &token)?;

    let mut cmd = Command::new(config.core_binary.path());
    cmd.arg("serve")
        .arg("--workspace")
        .arg(&config.workspace_root)
        .arg("--socket")
        .arg(&sock)
        .arg("--auth-token-file")
        .arg(&token_file)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach_from_launcher_process_group(&mut cmd);
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

    let negotiated = poll_negotiate(
        &sock,
        &config.expected_protocol,
        Some(token.as_str()),
        config.startup_timeout,
    )
    .await?;

    write_pid_and_meta(&id, child.id(), &config, &negotiated);

    Ok(Session {
        id,
        socket_path: sock,
        negotiated,
        origin: Origin::Spawned,
        auth_token: Some(token),
        permission_mode: config.permission_mode.clone(),
        child: Some(child),
        kill_on_drop: config.kill_daemon_on_drop,
    })
}

/// 32 hex chars of token entropy. Uses `/dev/urandom` when it is there (every
/// unix host), and on Windows — which has no `/dev/urandom` and where this
/// token is defence-in-depth on top of the named pipe's per-user ACL (G9) —
/// falls back to a splitmix64 mix of several run-varying sources. Avoids a
/// `rand` / `getrandom` dependency for one 16-byte value.
fn generate_auth_token() -> String {
    let mut buf = [0u8; 16];
    let filled = {
        use std::io::Read;
        std::fs::File::open("/dev/urandom")
            .and_then(|mut f| f.read_exact(&mut buf))
            .is_ok()
    };
    if !filled {
        let mut seed = now_ns()
            ^ ((std::process::id() as u64).rotate_left(17))
            ^ (&buf as *const _ as u64).rotate_left(33)
            ^ format!("{:?}", std::thread::current().id())
                .bytes()
                .fold(0u64, |a, b| a.wrapping_mul(31).wrapping_add(b as u64));
        for chunk in buf.chunks_mut(8) {
            // splitmix64
            seed = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = seed;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^= z >> 31;
            for (i, b) in chunk.iter_mut().enumerate() {
                *b = (z >> (8 * i)) as u8;
            }
        }
    }
    let mut s = String::with_capacity(32);
    for b in buf {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn now_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// Write the token `0600` (create-or-truncate). The `run/<id>/` dir is already
/// `0700`.
fn write_token_file(path: &Path, token: &str) -> Result<()> {
    std::fs::write(path, token)
        .map_err(|e| BridgeError::Transport(format!("writing {}: {e}", path.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Read a token file written by a prior spawn (used when adopting). A missing
/// file means the daemon was started without one.
fn read_token_file(id: &WorkspaceId) -> Option<String> {
    let s = std::fs::read_to_string(auth_token_path(id)).ok()?;
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

/// Try to adopt: transport present, pid (if recorded) alive, `hello` succeeds
/// and the protocol major matches. Any miss returns `None` and the caller
/// spawns.
///
/// On unix "transport present" is `sock.exists()`; on Windows the named pipe
/// has no filesystem entry, so that pre-check is skipped and a dead pipe is
/// caught by `negotiate` failing below.
async fn try_adopt(id: &WorkspaceId, sock: &Path, config: &SupervisorConfig) -> Option<Session> {
    if crate::workspace::SOCKET_IS_FILE && !sock.exists() {
        return None;
    }
    if let Some(pid) = read_pid(id) {
        if !pid_is_alive(pid) {
            tracing::debug!(pid, "recorded daemon pid is not alive; will not adopt");
            return None;
        }
    }
    // If a prior spawn left an auth token, the daemon we are about to adopt was
    // started with it (G10) — authenticate the handshake with it too.
    let token = read_token_file(id);
    match negotiate(sock, &config.expected_protocol, token.as_deref()).await {
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
                auth_token: token,
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
    auth_token: Option<&str>,
    timeout: Duration,
) -> Result<NegotiatedSession> {
    let start = Instant::now();
    let mut delay = Duration::from_millis(50);
    loop {
        match negotiate(sock, expected_protocol, auth_token).await {
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
    // avoids a libc dependency.
    std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn pid_is_alive(pid: u32) -> bool {
    // `tasklist` prints a data row for a live pid and an "INFO: No tasks…"
    // line otherwise. If the query itself fails, fall back to "assume alive"
    // so a healthy daemon is still adopted — `negotiate` is the real check.
    match std::process::Command::new("tasklist")
        .args(["/NH", "/FI", &format!("PID eq {pid}")])
        .output()
    {
        Ok(out) => {
            let s = String::from_utf8_lossy(&out.stdout);
            s.contains(&pid.to_string())
        }
        Err(_) => true,
    }
}

#[cfg(not(any(unix, windows)))]
fn pid_is_alive(_pid: u32) -> bool {
    false
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_token_is_32_hex_and_unpredictable() {
        let a = generate_auth_token();
        let b = generate_auth_token();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b, "two tokens should not collide");
    }

    #[test]
    fn platform_precheck_allows_unix_and_windows() {
        let r = platform_precheck();
        if cfg!(any(unix, windows)) {
            assert!(
                r.is_ok(),
                "unix and Windows both have a Core transport (G9) and must allow sessions"
            );
        } else {
            assert_eq!(
                r.unwrap_err().code(),
                "bridge.platform.unsupported",
                "a host with no IPC transport must refuse sessions with a specific code (D14)"
            );
        }
    }
}
