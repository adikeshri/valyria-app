//! docs/PLAN.md Phase 4 — the `task_rollback` wire path.
//!
//! Rollback in the app goes through Core's `task_rollback` and nothing else:
//! the confirmation UI shows what Core will restore, and the result
//! (`restored_files`, `reverted_entries`) is reported verbatim. The app never
//! computes a partial revert itself (§4.8).
//!
//! What this test can prove against pinned Core:
//!
//!  * `CoreClient::task_rollback` speaks the frozen `task.rollback` method and
//!    decodes `TaskRollbackResponse`;
//!  * an unresolvable `checkpoint_id` comes back as a **structured**
//!    `BridgeError::Protocol` carrying Core's `code` — not a transport error,
//!    not a panic — so the UI can render §36's four answers.
//!
//! What it cannot: drive a *successful* rollback. v1 exposes no way to discover
//! a `checkpoint_id` (CORE-INTERFACE G13) — `task_plan` reports only
//! `checkpoint: bool` per step and no event carries the id. The happy path
//! lights up when Core emits one; until then the UI keeps the action disabled
//! with that reason.
//!
//! Skips (does not fail) when no Core binary is available.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use tokio::time::timeout;
use valyria_bridge::{
    protocol::WireEvent, spawn_or_adopt, BridgeError, CoreBinary, CoreClient, EventPump,
    PumpMessage, SupervisorConfig,
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

fn is_terminal(task_id: &str, e: &WireEvent) -> bool {
    e.task_id.as_deref() == Some(task_id)
        && (e.kind == "task_completed"
            || e.kind == "task_failed"
            || (e.kind == "state_changed"
                && matches!(
                    e.payload.get("to").and_then(|v| v.as_str()),
                    Some("COMPLETED") | Some("FAILED")
                )))
}

async fn run_to_completion(sock: &Path, task_id: &str) {
    let mut pump = EventPump::start(sock.to_path_buf(), 0);
    let tid = task_id.to_string();
    loop {
        match timeout(Duration::from_secs(90), pump.recv()).await {
            Ok(Some(PumpMessage::Batch(b))) => {
                if b.events.iter().any(|e| is_terminal(&tid, e)) {
                    break;
                }
            }
            Ok(Some(_)) => {}
            Ok(None) | Err(_) => break,
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn rollback_wire_path_reports_core_errors_structurally() {
    let Some(bin) = locate_core() else {
        eprintln!("SKIP rollback: no Core binary (set VALYRIA_BIN or build ../valyria)");
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
    };

    let mut session = spawn_or_adopt(cfg).await.expect("spawn Core");
    let client = CoreClient::new(session.socket_path.clone());
    let task_id = client
        .task_create("add a function")
        .await
        .expect("task_create");
    run_to_completion(&session.socket_path, &task_id).await;

    // The completion report round-trips (Phase 4 verification inspector source).
    let report = client.task_report(&task_id).await.expect("task_report");
    assert_eq!(report.task_id, task_id);

    // An id that is not a valid `ckpt_…` ULID: Core rejects it with a stable,
    // non-retryable `code`, mapped to BridgeError::Protocol (not Transport).
    let bad = client.task_rollback(&task_id, "not-a-checkpoint").await;
    match bad {
        Err(BridgeError::Protocol {
            code, retryable, ..
        }) => {
            assert!(!code.is_empty(), "error carries a code for §36");
            assert!(!retryable, "an invalid checkpoint id is not retryable");
        }
        other => panic!("expected a structured protocol error, got {other:?}"),
    }

    // A well-formed but unknown checkpoint id: still a structured protocol
    // error, never a transport failure or a panic.
    let unknown = client
        .task_rollback(&task_id, "ckpt_00000000000000000000000000")
        .await;
    assert!(
        matches!(unknown, Err(BridgeError::Protocol { .. })),
        "unknown checkpoint id should be a protocol error, got {unknown:?}"
    );

    let _ = session.shutdown_daemon().await;
}
