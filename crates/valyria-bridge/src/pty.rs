//! The human PTY host (docs/PLAN.md §4.10, §18). A real shell the user types
//! into, opened at the authorized workspace root. Local-only and explicitly
//! sanctioned by CORE-INTERFACE §3 ("render a PTY the human types into") — it is
//! *not* a channel for running commands as the agent, which stays Core's alone
//! (D7). Commands the agent runs are a separate, read-only projection of
//! `tool_*` events and never touch this module.
//!
//! Shape mirrors [`crate::watcher`]: a blocking reader on a named OS thread, an
//! `AtomicBool` stop flag, a `Drop` that stops and joins, and a
//! `Fn(..) + Send + 'static` sink so the bridge never learns about Tauri.
//! `portable-pty` reads are blocking, so this cannot be a `tokio` task.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

use crate::error::{BridgeError, Result};

/// Cap on the replayed scrollback the bridge keeps. The renderer's xterm holds
/// its own (larger) buffer while mounted; this only has to survive the dock tab
/// being switched away and back.
const SCROLLBACK_CAP: usize = 256 * 1024;

/// What the reader thread reports. The host fans these to `core://pty-output`
/// and `core://pty-exit`.
#[derive(Debug, Clone)]
pub enum PtyEvent {
    /// A chunk of terminal output, decoded lossily from the shell's bytes.
    Output(String),
    /// The shell process ended. No more output will follow.
    Exit { code: Option<i32> },
}

/// A running shell bound to one workspace root.
pub struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
    scrollback: Arc<Mutex<VecDeque<u8>>>,
    alive: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl PtySession {
    /// Open a shell at `root` with the given initial size. `on_event` runs on a
    /// background thread for every output chunk and once for process exit.
    pub fn start<F>(root: &Path, cols: u16, rows: u16, on_event: F) -> Result<Self>
    where
        F: Fn(PtyEvent) + Send + 'static,
    {
        let size = pty_size(cols, rows);
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|e| BridgeError::PtySpawn(e.to_string()))?;

        let (shell, login) = resolve_shell();
        let mut cmd = CommandBuilder::new(&shell);
        if login {
            cmd.arg("-l");
        }
        cmd.cwd(root);
        // A bare PTY has no TERM; xterm.js speaks xterm-256color.
        cmd.env("TERM", "xterm-256color");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| BridgeError::PtySpawn(format!("{shell}: {e}")))?;
        // The slave fd is held by the child now; drop our handle so the master
        // sees EOF as soon as the shell exits.
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| BridgeError::PtyIo(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| BridgeError::PtyIo(e.to_string()))?;

        let scrollback = Arc::new(Mutex::new(VecDeque::<u8>::with_capacity(8 * 1024)));
        let alive = Arc::new(AtomicBool::new(true));
        let stop = Arc::new(AtomicBool::new(false));

        let join = std::thread::Builder::new()
            .name("valyria-pty-read".into())
            .spawn({
                let scrollback = scrollback.clone();
                let alive = alive.clone();
                let stop = stop.clone();
                move || read_loop(reader, scrollback, alive, stop, on_event)
            })
            .map_err(|e| BridgeError::PtySpawn(e.to_string()))?;

        Ok(Self {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            scrollback,
            alive,
            stop,
            join: Some(join),
        })
    }

    /// Feed raw keystroke bytes to the shell.
    pub fn write(&self, data: &str) -> Result<()> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(data.as_bytes())
            .and_then(|()| w.flush())
            .map_err(|e| BridgeError::PtyIo(e.to_string()))
    }

    /// Tell the shell its window changed size.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.master
            .lock()
            .unwrap()
            .resize(pty_size(cols, rows))
            .map_err(|e| BridgeError::PtyIo(e.to_string()))
    }

    /// Everything the shell has printed, capped at [`SCROLLBACK_CAP`] and
    /// trimmed to a UTF-8 char boundary at the front. Replayed into a fresh
    /// xterm when the panel remounts.
    pub fn scrollback(&self) -> String {
        let buf = self.scrollback.lock().unwrap();
        let (a, b) = buf.as_slices();
        let mut bytes = Vec::with_capacity(a.len() + b.len());
        bytes.extend_from_slice(a);
        bytes.extend_from_slice(b);
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// Whether the shell process is still running.
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.child.lock().unwrap().kill();
        // Killing the child closes the slave; the master read returns EOF and
        // the reader thread falls out of its loop.
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn read_loop<F>(
    mut reader: Box<dyn Read + Send>,
    scrollback: Arc<Mutex<VecDeque<u8>>>,
    alive: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    on_event: F,
) where
    F: Fn(PtyEvent),
{
    let mut buf = [0u8; 8 * 1024];
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        match reader.read(&mut buf) {
            Ok(0) => break, // EOF: the shell exited
            Ok(n) => {
                let chunk = &buf[..n];
                push_capped(&mut scrollback.lock().unwrap(), chunk);
                if !stop.load(Ordering::Relaxed) {
                    on_event(PtyEvent::Output(
                        String::from_utf8_lossy(chunk).into_owned(),
                    ));
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    alive.store(false, Ordering::Relaxed);
    if !stop.load(Ordering::Relaxed) {
        on_event(PtyEvent::Exit { code: None });
    }
}

/// Append `chunk`, drop oldest bytes past the cap, then drop any leading UTF-8
/// continuation bytes so a later decode starts on a char boundary.
fn push_capped(buf: &mut VecDeque<u8>, chunk: &[u8]) {
    buf.extend(chunk.iter().copied());
    while buf.len() > SCROLLBACK_CAP {
        buf.pop_front();
    }
    while let Some(&b) = buf.front() {
        if b & 0xC0 == 0x80 {
            buf.pop_front();
        } else {
            break;
        }
    }
}

/// Pick the user's shell. Falls back through the common Unix shells; the second
/// element says whether to pass `-l` (a real shell, not the bare `sh` fallback).
fn resolve_shell() -> (String, bool) {
    if let Ok(sh) = std::env::var("SHELL") {
        if !sh.is_empty() && Path::new(&sh).exists() {
            return (sh, true);
        }
    }
    for cand in ["/bin/zsh", "/bin/bash"] {
        if Path::new(cand).exists() {
            return (cand.to_string(), true);
        }
    }
    ("/bin/sh".to_string(), false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn echoes_a_command_back_through_the_callback() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel::<PtyEvent>();
        let pty = PtySession::start(dir.path(), 80, 24, move |e| {
            let _ = tx.send(e);
        })
        .unwrap();

        std::thread::sleep(Duration::from_millis(150));
        pty.write("echo phase7-marker\n").unwrap();

        let deadline = Instant::now() + Duration::from_secs(3);
        let mut seen = String::new();
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(PtyEvent::Output(s)) => {
                    seen.push_str(&s);
                    if seen.contains("phase7-marker") {
                        break;
                    }
                }
                Ok(PtyEvent::Exit { .. }) => break,
                Err(_) => {}
            }
        }
        assert!(
            seen.contains("phase7-marker"),
            "shell never echoed; got {seen:?}"
        );
    }

    #[test]
    fn scrollback_replays_prior_output() {
        let dir = tempfile::tempdir().unwrap();
        let pty = PtySession::start(dir.path(), 80, 24, |_| {}).unwrap();
        std::thread::sleep(Duration::from_millis(150));
        pty.write("echo sticky-line\n").unwrap();
        std::thread::sleep(Duration::from_millis(400));
        assert!(
            pty.scrollback().contains("sticky-line"),
            "scrollback missing the echoed line: {:?}",
            pty.scrollback()
        );
    }

    #[test]
    fn scrollback_caps_and_stays_on_a_utf8_boundary() {
        let mut buf = VecDeque::<u8>::new();
        // Fill well past the cap with a 3-byte char (€ = E2 82 AC) so a naive
        // trim would split it.
        let euro = "€".repeat(SCROLLBACK_CAP);
        push_capped(&mut buf, euro.as_bytes());
        assert!(buf.len() <= SCROLLBACK_CAP);
        let (a, b) = buf.as_slices();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(a);
        bytes.extend_from_slice(b);
        assert!(
            std::str::from_utf8(&bytes).is_ok(),
            "front not on a char boundary"
        );
    }

    #[test]
    fn resolve_shell_always_returns_something_runnable() {
        let (sh, _) = resolve_shell();
        assert!(Path::new(&sh).exists(), "{sh} does not exist");
    }
}
