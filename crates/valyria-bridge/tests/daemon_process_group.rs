//! Regression test for "closing the app kills the daemon too".
//!
//! `valyria serve` is meant to outlive the UI (PLAN.md D1): a crashed or
//! closed window re-adopts it later. `kill_on_drop` being off only guards
//! against this crate *explicitly* killing it — it does nothing about the
//! daemon inheriting the launching process's OS process group. Without
//! `detach_from_launcher_process_group` (`crates/valyria-bridge/src/
//! supervisor.rs`), closing the terminal that started the app (SIGHUP to the
//! foreground process group) or a quit path that signals its own group
//! (SIGTERM to `-pgid`) takes the daemon down along with everything else in
//! that group — even though nothing in this crate asked for that.
//!
//! Skips (does not fail) when no Core binary is available.
//!
//! Process groups are a POSIX concept — the whole file is unix-only so the
//! Windows build doesn't see `locate_core` / `git` / `fixture` as dead code
//! (their only caller is the unix-only test).
#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::time::Duration;

use valyria_bridge::{spawn_or_adopt, CoreBinary, SupervisorConfig};

fn locate_core() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("VALYRIA_BIN") {
        let p = PathBuf::from(p);
        return p.exists().then_some(p);
    }
    let app_root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(2)?;
    for rel in [
        "../valyria/target/release/valyria",
        "../valyria/target/debug/valyria",
    ] {
        let cand = app_root.join(rel);
        if cand.exists() {
            return Some(cand);
        }
    }
    None
}

fn git(dir: &Path, args: &[&str]) {
    assert!(std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap()
        .success());
}

fn fixture() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    std::fs::write(root.join("README.md"), "# fixture\n").unwrap();
    git(&root, &["init", "-q"]);
    git(&root, &["add", "-A"]);
    git(
        &root,
        &[
            "-c",
            "user.email=t@example.com",
            "-c",
            "user.name=t",
            "commit",
            "-q",
            "-m",
            "init",
        ],
    );
    (dir, root)
}

/// The pgid `ps` reports for `pid`, or `None` if the process is gone or `ps`
/// can't be read (never a panic — a flaky read must not fail the test the
/// wrong way, it should just not assert anything false).
fn pgid_of(pid: u32) -> Option<i32> {
    let out = std::process::Command::new("ps")
        .args(["-o", "pgid=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn spawned_daemon_is_detached_from_the_launching_process_group() {
    let Some(bin) = locate_core() else {
        eprintln!(
            "SKIP daemon_process_group: no Core binary (set VALYRIA_BIN or build ../valyria)"
        );
        return;
    };

    let (_dir, root) = fixture();
    let home = tempfile::tempdir().unwrap();
    let cfg = SupervisorConfig {
        workspace_root: root,
        core_binary: CoreBinary::Explicit(bin),
        expected_protocol: "1.0.0".to_string(),
        valyria_home: Some(home.path().to_path_buf()),
        startup_timeout: Duration::from_secs(30),
        kill_daemon_on_drop: true,
        permission_mode: None,
    };

    let mut session = spawn_or_adopt(cfg).await.expect("spawn Core");
    let daemon_pid = session.daemon_pid().expect("own the spawned daemon");

    let own_pgid = pgid_of(std::process::id()).expect("read this process's own pgid");
    let daemon_pgid = pgid_of(daemon_pid).expect("read the freshly spawned daemon's pgid");

    assert_ne!(
        daemon_pgid, own_pgid,
        "the daemon shares this process's group — a signal delivered to the \
         group (terminal hangup, an app-quit path that signals its own \
         group) would kill it along with everything else in that group, \
         defeating 'the daemon outlives the UI' (PLAN.md D1)"
    );
    assert_eq!(
        daemon_pgid, daemon_pid as i32,
        "process_group(0) makes the daemon the leader of its own new group \
         (pgid == pid) — anything else means the detach didn't take"
    );

    session.shutdown_daemon().await.expect("clean shutdown");
}
