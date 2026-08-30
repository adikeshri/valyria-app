//! docs/PLAN.md Phase 7 exit criterion — "every read-only surface stays fully
//! usable through a long running task, verified by a soak test".
//!
//! Against a **real** `valyria serve`: start a task, then for a fixed window
//! hammer the local-read surfaces (`fs.list_dir` / `git.status` /
//! `fs.read_file`) and `client.task_status` while a human PTY runs commands
//! alongside — asserting every read cycle stays well under a bound and the
//! event stream still reaches a terminal state gapless. This is where a
//! regression that serialized reads behind Core I/O (e.g. holding a lock across
//! an `.await`) would show up as a stalled cycle or a starved stream.
//!
//! Skips (does not fail) when no Core binary is available: set `VALYRIA_BIN`,
//! or have `../valyria/target/release/valyria` built next to this repo.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::time::timeout;
use valyria_bridge::{
    protocol::WireEvent, spawn_or_adopt, CoreBinary, CoreClient, EventPump, GitRepo, PtyEvent,
    PtySession, PumpMessage, SupervisorConfig, WorkspaceFs,
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
            Err(_) => break,
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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reads_and_pty_stay_usable_through_a_running_task() {
    let Some(bin) = locate_core() else {
        eprintln!("SKIP soak: no Core binary (set VALYRIA_BIN or build ../valyria)");
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

    let mut session = spawn_or_adopt(cfg).await.expect("spawn Core");
    let client = CoreClient::with_token(session.socket_path.clone(), session.auth_token.clone());
    let fs = WorkspaceFs::new(&repo.root).expect("workspace fs");
    let git_repo = GitRepo::new(&repo.root);

    // A human shell at the workspace root, collecting its output.
    let pty_out = Arc::new(Mutex::new(String::new()));
    let pty = {
        let sink = pty_out.clone();
        PtySession::start(&repo.root, 80, 24, move |ev| {
            if let PtyEvent::Output(s) = ev {
                sink.lock().unwrap().push_str(&s);
            }
        })
        .expect("start pty")
    };

    // Start a task and subscribe to its stream.
    let task_id = client
        .task_create("add a function")
        .await
        .expect("task_create");
    let mut pump = EventPump::start(session.socket_path.clone(), session.auth_token.clone(), 0);

    // Hammer the read surfaces for a fixed window, PTY running alongside.
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut cycles = 0u32;
    let mut worst = Duration::ZERO;
    while Instant::now() < deadline {
        let t0 = Instant::now();
        let listing = fs.list_dir("").expect("list_dir");
        assert!(
            listing.iter().any(|e| e.name == "src"),
            "fs listing lost src"
        );
        git_repo.status().expect("git status");
        let file = fs.read_file("src/lib.rs").expect("read_file");
        assert!(
            file.text
                .as_deref()
                .unwrap_or_default()
                .contains("existing"),
            "file read came back wrong"
        );
        client.task_status(&task_id).await.expect("task_status");
        let dt = t0.elapsed();
        worst = worst.max(dt);
        assert!(
            dt < Duration::from_secs(2),
            "a read cycle stalled for {dt:?}"
        );

        cycles += 1;
        if cycles.is_multiple_of(5) {
            pty.write(&format!("echo soak-{cycles}\n"))
                .expect("pty write");
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(
        cycles > 20,
        "only {cycles} read cycles in 4s (worst {worst:?}) — reads are serializing"
    );

    // The PTY is still responsive after the load.
    pty.write("echo soak-final-marker\n").expect("pty write");
    let mut saw_marker = false;
    for _ in 0..60 {
        if pty_out.lock().unwrap().contains("soak-final-marker") {
            saw_marker = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(saw_marker, "PTY went unresponsive under load");
    assert!(pty.is_alive(), "shell died during the soak");

    // The event stream still reached a terminal state, gapless.
    let tid = task_id.clone();
    let (seqs, done, gaps) = drain(&mut pump, Duration::from_secs(60), move |e| {
        is_terminal(&tid, e)
    })
    .await;
    assert!(done, "task never completed while reads hammered the daemon");
    assert!(
        !gaps.iter().any(|&g| g),
        "event stream developed a gap under load"
    );
    assert!(
        contiguous(&seqs),
        "event stream has a hole under load: {seqs:?}"
    );

    let _ = session.shutdown_daemon().await;
}
