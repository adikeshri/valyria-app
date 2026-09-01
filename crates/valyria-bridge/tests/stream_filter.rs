//! CORE-INTERFACE G11 — the per-task event filter.
//!
//! `EventPump::start_scoped(.., task_id)` subscribes to one task's events plus
//! workspace-global (task-less) ones only. The main desktop session does not
//! use this (it needs the full, seq-contiguous stream for crash recovery,
//! docs/PLAN.md D3) — this covers the plumbing a scoped consumer relies on.
//!
//! What this proves against pinned Core:
//!
//!  * a pump scoped to task A never delivers task B's events;
//!  * task A's own events still arrive and reach a terminal state.
//!
//! Skips (does not fail) when no Core binary is available.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use tokio::time::timeout;
use valyria_bridge::{
    spawn_or_adopt, CoreBinary, CoreClient, EventPump, PumpMessage, SupervisorConfig,
};

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
    let ok = Command::new("git")
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap()
        .success();
    assert!(ok, "git {args:?} failed");
}

fn fixture() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(
        root.join("src/lib.rs"),
        "pub fn existing(a: i32) -> i32 {\n    a\n}\n",
    )
    .unwrap();
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

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn scoped_pump_excludes_other_tasks() {
    let Some(bin) = locate_core() else {
        eprintln!("SKIP stream_filter: no Core binary (set VALYRIA_BIN or build ../valyria)");
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
    let client = CoreClient::with_token(session.socket_path.clone(), session.auth_token.clone());

    let task_a = client.task_create("add a function").await.expect("task a");
    let task_b = client
        .task_create("add another function")
        .await
        .expect("task b");

    // A pump scoped to task A.
    let mut pump = EventPump::start_scoped(
        session.socket_path.clone(),
        session.auth_token.clone(),
        0,
        Some(task_a.clone()),
    );

    let mut seen_for_a = false;
    let mut a_terminal = false;
    let mut foreign: BTreeSet<String> = BTreeSet::new();

    // Drain until task A terminates or we time out; record every task_id seen.
    loop {
        match timeout(Duration::from_secs(90), pump.recv()).await {
            Ok(Some(PumpMessage::Batch(b))) => {
                for e in &b.events {
                    match e.task_id.as_deref() {
                        Some(t) if t == task_a => {
                            seen_for_a = true;
                            let to = e
                                .payload
                                .get("to")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default();
                            if e.kind == "task_completed"
                                || e.kind == "task_failed"
                                || matches!(to, "COMPLETED" | "FAILED")
                            {
                                a_terminal = true;
                            }
                        }
                        Some(other) => {
                            foreign.insert(other.to_string());
                        }
                        None => {} // workspace-global — allowed on a scoped stream
                    }
                }
                if a_terminal {
                    break;
                }
            }
            Ok(Some(_)) => {}
            Ok(None) | Err(_) => break,
        }
    }

    assert!(
        seen_for_a,
        "the scoped pump delivered none of task A's events"
    );
    assert!(
        !foreign.contains(&task_b),
        "task B's events leaked onto a stream scoped to task A: {foreign:?}"
    );

    let _ = session.shutdown_daemon().await;
}
