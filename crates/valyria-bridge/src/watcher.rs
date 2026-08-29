//! A recursive filesystem watcher for the open workspace (docs/PLAN.md §4.4,
//! the "external changes appear within 500ms" criterion). Local-read only
//! (CORE-INTERFACE §3): it tells the UI *that* files changed so the explorer,
//! git panel and open file can refresh — it never decides what the agent sees.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};

use crate::error::{BridgeError, Result};

/// Coalescing window for a burst of change events (a `git checkout`, a formatter
/// run, an editor save-all).
const DEBOUNCE: Duration = Duration::from_millis(250);

pub struct WorkspaceWatcher {
    // Dropped last; keeps the OS watch registered for the watcher's life.
    _watcher: notify::RecommendedWatcher,
    stop: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl WorkspaceWatcher {
    /// Watch `root` recursively. `on_change` runs on a background thread with a
    /// batch of paths relative to `root` (forward-slashed), coalesced over
    /// [`DEBOUNCE`]. High-churn git internals (`objects/`, `logs/`) are dropped.
    pub fn start<F>(root: impl Into<PathBuf>, on_change: F) -> Result<Self>
    where
        F: Fn(Vec<String>) + Send + 'static,
    {
        let root = root
            .into()
            .canonicalize()
            .map_err(|e| BridgeError::Watch(e.to_string()))?;

        let (tx, rx) = mpsc::channel::<Vec<PathBuf>>();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                let _ = tx.send(ev.paths);
            }
        })
        .map_err(|e| BridgeError::Watch(e.to_string()))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| BridgeError::Watch(e.to_string()))?;

        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = stop.clone();
        let join = std::thread::Builder::new()
            .name("valyria-fs-watch".into())
            .spawn(move || debounce_loop(rx, &root, stop_thread, on_change))
            .map_err(|e| BridgeError::Watch(e.to_string()))?;

        Ok(Self {
            _watcher: watcher,
            stop,
            join: Some(join),
        })
    }
}

impl Drop for WorkspaceWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

fn debounce_loop<F>(
    rx: mpsc::Receiver<Vec<PathBuf>>,
    root: &Path,
    stop: Arc<AtomicBool>,
    on_change: F,
) where
    F: Fn(Vec<String>),
{
    while !stop.load(Ordering::Relaxed) {
        // Wait for the first event of a burst (with a wakeup so we can observe `stop`).
        let first = match rx.recv_timeout(Duration::from_millis(400)) {
            Ok(p) => p,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return,
        };

        let mut changed: BTreeSet<String> = BTreeSet::new();
        add_paths(&mut changed, first, root);

        let deadline = Instant::now() + DEBOUNCE;
        loop {
            let wait = deadline.saturating_duration_since(Instant::now());
            if wait.is_zero() {
                break;
            }
            match rx.recv_timeout(wait) {
                Ok(p) => add_paths(&mut changed, p, root),
                Err(_) => break,
            }
        }

        if !changed.is_empty() {
            on_change(changed.into_iter().collect());
        }
    }
}

fn add_paths(set: &mut BTreeSet<String>, paths: Vec<PathBuf>, root: &Path) {
    for p in paths {
        let Ok(rel) = p.strip_prefix(root) else {
            continue;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        if rel.is_empty() {
            continue;
        }
        if rel.starts_with(".git/objects/") || rel.starts_with(".git/logs/") {
            continue;
        }
        set.insert(rel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn reports_a_new_file_within_a_second() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();

        let (tx, rx) = mpsc::channel::<Vec<String>>();
        let _watcher = WorkspaceWatcher::start(dir.path(), move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();

        // Give the OS watch a moment to arm, then create a file.
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(dir.path().join("src/new.rs"), "fn x() {}\n").unwrap();

        let batch = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("watcher never reported the change");
        assert!(batch.iter().any(|p| p == "src/new.rs" || p == "src"));
    }

    #[test]
    fn drops_git_object_churn() {
        let mut set = BTreeSet::new();
        let root = Path::new("/repo");
        add_paths(
            &mut set,
            vec![
                root.join(".git/objects/ab/cdef"),
                root.join(".git/index"),
                root.join("src/lib.rs"),
            ],
            root,
        );
        assert!(set.contains("src/lib.rs"));
        assert!(set.contains(".git/index"));
        assert!(!set.iter().any(|p| p.contains("objects")));
    }
}
