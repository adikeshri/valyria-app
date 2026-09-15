//! M5 / protocol 1.13.0 — `task_children`, `task_artifacts`, `plan_revisions`.
//!
//! What this test can prove against a real, pinned Core binary: the three
//! new wire methods round-trip end to end (`CoreClient` → the daemon →
//! `TaskManager`/`PlanStore` → back) for an ordinary task driven by the real
//! CLI — which never spawns child tasks or role-pipeline artifacts on its
//! own, so the honest, correct answer for all three is "empty list", not an
//! error. Proving a *populated* list would need a role-pipeline-driving
//! entry point in the CLI, which doesn't exist yet (`valyria-cli` only ever
//! drives the single-task loop) — tracked as a follow-up once that surface
//! exists.
//!
//! Skips (does not fail) when no Core binary is available.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use tokio::time::timeout;
use valyria_bridge::{
    protocol::WireEvent, spawn_or_adopt, CoreBinary, CoreClient, EventPump, PumpMessage,
    SupervisorConfig,
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

async fn run_to_completion(sock: &Path, auth_token: Option<String>, task_id: &str) {
    let mut pump = EventPump::start(sock.to_path_buf(), auth_token, 0);
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
async fn multi_agent_wire_methods_round_trip_for_an_ordinary_task() {
    let Some(bin) = locate_core() else {
        eprintln!("SKIP multi_agent: no Core binary (set VALYRIA_BIN or build ../valyria)");
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

    let session = spawn_or_adopt(cfg).await.expect("spawn Core");
    let client = CoreClient::with_token(session.socket_path.clone(), session.auth_token.clone());
    let task_id = client
        .task_create("add a function")
        .await
        .expect("task_create");
    run_to_completion(&session.socket_path, session.auth_token.clone(), &task_id).await;

    // An ordinary CLI-driven task never spawns children or role-pipeline
    // artifacts, and never revises its plan — all three come back as real,
    // successful, empty responses, not errors.
    let children = client.task_children(&task_id).await.expect("task_children");
    assert!(children.children.is_empty(), "{children:?}");

    let artifacts = client
        .task_artifacts(&task_id)
        .await
        .expect("task_artifacts");
    assert!(artifacts.artifacts.is_empty(), "{artifacts:?}");

    let revisions = client
        .plan_revisions(&task_id)
        .await
        .expect("plan_revisions");
    assert!(revisions.revisions.is_empty(), "{revisions:?}");

    // Querying by a syntactically-valid but never-created task id is a
    // clean empty list, not an error — `children_of`/`artifacts_for_task`/
    // `all_revisions` are all pure "rows matching this id" queries with no
    // existence check on the id itself (unlike `task_status`, which does
    // fetch the task row and so *does* error on an unknown id). Same
    // convention as `task_children`/`task_artifacts`/`plan_revisions`
    // returning empty for a real task that simply has none of either.
    let unknown = valyria_types::TaskId::new().to_string();
    let children = client.task_children(&unknown).await.expect("task_children");
    assert!(children.children.is_empty(), "{children:?}");
}
