//! docs/PLAN.md Phase 1 exit criterion — "the most important milestone in the
//! plan".
//!
//! Against a **real** `valyria serve` (the compiled Core binary, fake model, a
//! git fixture repo):
//!
//!  1. spawn a daemon, negotiate `hello`, create a task, stream every event to
//!     a terminal state — asserting the `seq` run is gapless;
//!  2. simulate a UI crash (drop everything) and **adopt** the still-running
//!     daemon (§30);
//!  3. resume the event stream from a mid-run cursor and assert the tail
//!     replays exactly, with no hole and no duplicate;
//!  4. SIGKILL the daemon and confirm the next open **re-spawns** it and the
//!     task is still there — rehydrated from Core's journal.
//!
//! Skips (does not fail) when no Core binary is available: set `VALYRIA_BIN`,
//! or have `../valyria/target/release/valyria` built next to this repo.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use tokio::time::timeout;
use valyria_bridge::{
    protocol::WireEvent, spawn_or_adopt, CoreBinary, CoreClient, EventPump, Origin, PumpMessage,
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

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
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
        Self { _dir: dir, root }
    }
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

/// Drain a pump until `stop` returns true for some event, or until no batch
/// arrives for `quiet`. Returns every `seq` seen and whether `stop` fired.
async fn drain(
    pump: &mut EventPump,
    quiet: Duration,
    mut stop: impl FnMut(&WireEvent) -> bool,
) -> (BTreeSet<u64>, bool, Vec<bool>) {
    let mut seqs = BTreeSet::new();
    let mut gaps = Vec::new();
    let mut stopped = false;
    loop {
        match timeout(quiet, pump.recv()).await {
            Ok(Some(PumpMessage::Batch(b))) => {
                gaps.push(b.gap_before);
                for e in &b.events {
                    seqs.insert(e.seq);
                    if stop(e) {
                        stopped = true;
                    }
                }
                if stopped {
                    break;
                }
            }
            Ok(Some(PumpMessage::Reconnected { .. })) => {}
            Ok(Some(PumpMessage::Closed { .. })) | Ok(None) => break,
            Err(_) => break, // no more events coming
        }
    }
    (seqs, stopped, gaps)
}

fn contiguous(seqs: &BTreeSet<u64>) -> bool {
    match (seqs.iter().next(), seqs.iter().next_back()) {
        (Some(&lo), Some(&hi)) => seqs.len() as u64 == hi - lo + 1,
        _ => true,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn supervise_stream_kill_ui_resume_kill_daemon() {
    let Some(bin) = locate_core() else {
        eprintln!("SKIP walking_skeleton: no Core binary (set VALYRIA_BIN or build ../valyria)");
        return;
    };

    let repo = Fixture::new();
    let home = tempfile::tempdir().unwrap();
    let cfg = SupervisorConfig {
        workspace_root: repo.root.clone(),
        core_binary: CoreBinary::Explicit(bin),
        expected_protocol: "1.0.0".to_string(),
        valyria_home: Some(home.path().to_path_buf()),
        startup_timeout: Duration::from_secs(30),
        kill_daemon_on_drop: true,
        permission_mode: None,
    };

    // 1. Spawn, negotiate, create a task, stream it to completion.
    let mut session = spawn_or_adopt(cfg.clone()).await.expect("spawn Core");
    assert_eq!(session.origin, Origin::Spawned);
    assert_eq!(
        session.negotiated.protocol_version.split('.').next(),
        Some("1")
    );
    let daemon_pid = session.daemon_pid().expect("own the spawned daemon");

    let client = CoreClient::new(session.socket_path.clone());
    assert_eq!(
        client.workspace_status().await.expect("status").total_tasks,
        0
    );
    let task_id = client
        .task_create("add a function")
        .await
        .expect("task_create");

    let full: BTreeSet<u64> = {
        let mut pump = EventPump::start(session.socket_path.clone(), 0);
        let tid = task_id.clone();
        let (seqs, done, gaps) = drain(&mut pump, Duration::from_secs(90), move |e| {
            is_terminal(&tid, e)
        })
        .await;
        assert!(done, "task never reached a terminal state");
        assert!(
            !gaps.iter().any(|&g| g),
            "unexpected gap in the initial stream"
        );
        assert!(contiguous(&seqs), "initial stream has a hole: {seqs:?}");
        assert!(seqs.contains(&1), "Core's seq run should start at 1");
        seqs
    }; // pump + its connection dropped == UI process gone; daemon still runs

    let lo = *full.iter().next().unwrap();
    let hi = *full.iter().next_back().unwrap();

    // 2. Relaunch the UI: adopt the still-running daemon (§30).
    let adopted = spawn_or_adopt(cfg.clone())
        .await
        .expect("adopt running daemon");
    assert_eq!(adopted.origin, Origin::Adopted);
    assert_eq!(
        adopted.daemon_pid(),
        None,
        "an adopted daemon is not ours to hold"
    );
    assert_eq!(
        adopted.negotiated.runtime_version,
        session.negotiated.runtime_version
    );

    // 3. Resume the stream from a mid-run cursor (exclusive): exact tail, no
    //    hole, no dup.
    let mid = lo + (hi - lo) / 2;
    let mut pump2 = EventPump::start(adopted.socket_path.clone(), mid);
    let (tail, _stop, gaps2) = drain(&mut pump2, Duration::from_secs(15), |_| false).await;
    assert!(
        !gaps2.first().copied().unwrap_or(false),
        "resume reported a gap at the cursor"
    );
    let expected_tail: BTreeSet<u64> = (mid + 1..=hi).collect();
    assert_eq!(tail, expected_tail, "resumed tail != exact replayed range");

    // 4. History is Core's — still listed.
    let listed = client.task_list().await.expect("task_list");
    assert!(listed.tasks.iter().any(|t| t.task_id == task_id));

    // 5. SIGKILL the daemon (tokio `start_kill` = SIGKILL); the next open must
    //    re-spawn it and the task must survive via the journal.
    drop(pump2);
    session.shutdown_daemon().await.expect("kill daemon");
    let _ = daemon_pid;

    let respawned = spawn_or_adopt(cfg.clone())
        .await
        .expect("respawn after daemon death");
    assert_eq!(respawned.origin, Origin::Spawned);
    let after = CoreClient::new(respawned.socket_path.clone());
    let relisted = after.task_list().await.expect("task_list after respawn");
    assert!(
        relisted.tasks.iter().any(|t| t.task_id == task_id),
        "journal did not rehydrate the task after a daemon restart"
    );
    let report = after.task_report(&task_id).await.expect("task_report");
    assert!(!report.status.is_empty(), "rehydrated report has no status");
}

/// Not a gate — a helper to (re)capture the trace fixture the `@valyria/state`
/// reducer replay test runs against. Run explicitly:
///   VALYRIA_BIN=... cargo test -p valyria-bridge --test walking_skeleton -- --ignored capture_trace
#[ignore]
#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn capture_trace() {
    let Some(bin) = locate_core() else {
        panic!("set VALYRIA_BIN to capture a trace");
    };
    let repo = Fixture::new();
    let home = tempfile::tempdir().unwrap();
    let cfg = SupervisorConfig {
        workspace_root: repo.root.clone(),
        core_binary: CoreBinary::Explicit(bin),
        expected_protocol: "1.0.0".to_string(),
        valyria_home: Some(home.path().to_path_buf()),
        startup_timeout: Duration::from_secs(30),
        kill_daemon_on_drop: true,
        permission_mode: None,
    };
    let mut session = spawn_or_adopt(cfg).await.unwrap();
    let client = CoreClient::new(session.socket_path.clone());
    let task_id = client.task_create("add a function").await.unwrap();

    let mut pump = EventPump::start(session.socket_path.clone(), 0);
    let mut lines: Vec<String> = Vec::new();
    let tid = task_id.clone();
    loop {
        match timeout(Duration::from_secs(90), pump.recv()).await {
            Ok(Some(PumpMessage::Batch(b))) => {
                let mut done = false;
                for e in &b.events {
                    lines.push(serde_json::to_string(e).unwrap());
                    if is_terminal(&tid, e) {
                        done = true;
                    }
                }
                if done {
                    break;
                }
            }
            Ok(Some(_)) => {}
            Ok(None) | Err(_) => break,
        }
    }
    let out = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .join("fixtures/traces/add-a-function.jsonl");
    std::fs::create_dir_all(out.parent().unwrap()).unwrap();
    std::fs::write(&out, lines.join("\n") + "\n").unwrap();
    eprintln!("wrote {} events to {}", lines.len(), out.display());
    let _ = session.shutdown_daemon().await;
}
