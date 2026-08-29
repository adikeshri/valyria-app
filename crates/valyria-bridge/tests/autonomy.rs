//! docs/PLAN.md Phase 5 — the autonomy level is a daemon-start parameter
//! (CORE-INTERFACE G1). The supervisor passes `valyria serve --permission-mode
//! <mode>`, records it in `meta.json`, and reads it back when it later adopts
//! that daemon — so the UI can show the running mode and gate the switch.
//!
//! Skips (does not fail) when no Core binary is available.

use std::path::{Path, PathBuf};
use std::process::Command;

use valyria_bridge::{spawn_or_adopt, CoreBinary, Origin, SupervisorConfig};

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
    assert!(Command::new("git")
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

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn permission_mode_is_passed_recorded_and_read_back_on_adopt() {
    let Some(bin) = locate_core() else {
        eprintln!("SKIP autonomy: no Core binary (set VALYRIA_BIN or build ../valyria)");
        return;
    };

    let (_dir, root) = fixture();
    let home = tempfile::tempdir().unwrap();
    let mut cfg = SupervisorConfig::new(root, CoreBinary::Explicit(bin));
    cfg.valyria_home = Some(home.path().to_path_buf());
    cfg.kill_daemon_on_drop = true;
    cfg.permission_mode = Some("manual".to_string());

    // Spawned: the mode is what we asked for.
    let spawned = spawn_or_adopt(cfg.clone()).await.expect("spawn Core");
    assert_eq!(spawned.origin, Origin::Spawned);
    assert_eq!(spawned.permission_mode.as_deref(), Some("manual"));

    // Adopted: the mode is recovered from meta.json, even though `hello`
    // never carries it.
    let adopted = spawn_or_adopt(cfg.clone()).await.expect("adopt Core");
    assert_eq!(adopted.origin, Origin::Adopted);
    assert_eq!(
        adopted.permission_mode.as_deref(),
        Some("manual"),
        "adopted session should recover the autonomy level from meta.json"
    );
    assert!(
        !adopted.is_owned(),
        "an adopted daemon is not ours to restart"
    );

    drop(adopted);
    let mut spawned = spawned;
    let _ = spawned.shutdown_daemon().await;
}
