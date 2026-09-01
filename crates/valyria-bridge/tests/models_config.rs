//! docs/PLAN.md Phase 6 — the read-only model inventory and the D13
//! write-then-verify config path, against a real `valyria serve`.
//!
//!  * `model_list` decodes `ModelListResponse` (empty on a clean machine — no
//!    model is ever fetched by the app, D-INT-3);
//!  * `write_key` edits `$VALYRIA_HOME/config.toml` and a following
//!    `config_show` reports the value with `origin = "global"` (CORE-INTERFACE
//!    G6 — Core has no `config_set`).
//!
//! Skips (does not fail) when no Core binary is available.

use std::path::{Path, PathBuf};
use std::process::Command;

use valyria_bridge::{
    config_path, spawn_or_adopt, write_key, ConfigScope, CoreBinary, CoreClient, SupervisorConfig,
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
async fn model_list_and_config_write_then_verify() {
    let Some(bin) = locate_core() else {
        eprintln!("SKIP models_config: no Core binary (set VALYRIA_BIN or build ../valyria)");
        return;
    };

    let (_dir, root) = fixture();
    let home = tempfile::tempdir().unwrap();
    // Point $VALYRIA_HOME at the tempdir so the user-scope config write lands there.
    std::env::set_var("VALYRIA_HOME", home.path());

    let mut cfg = SupervisorConfig::new(root, CoreBinary::Explicit(bin));
    cfg.valyria_home = Some(home.path().to_path_buf());
    cfg.kill_daemon_on_drop = true;

    let mut session = spawn_or_adopt(cfg).await.expect("spawn Core");
    let client = CoreClient::with_token(session.socket_path.clone(), session.auth_token.clone());

    // Inventory decodes; a clean machine has none.
    let models = client.model_list().await.expect("model_list");
    for m in &models.models {
        assert!(!m.id.is_empty());
    }

    // Baseline: `log.format` is the compiled default (`pretty`).
    let before = client.config_show().await.expect("config_show");
    let log_before = before
        .entries
        .iter()
        .find(|e| e.key == "log.format")
        .expect("log.format key");
    assert_eq!(log_before.origin, "default");
    assert_eq!(log_before.value, "pretty");

    // Write it to the user config and re-read: Core reports the effective value
    // with `origin = "global"` (its name for $VALYRIA_HOME/config.toml).
    let path = config_path(ConfigScope::User, None).unwrap();
    write_key(&path, "log.format", "json").expect("write log.format");

    let after = client.config_show().await.expect("config_show after write");
    let log_after = after
        .entries
        .iter()
        .find(|e| e.key == "log.format")
        .expect("log.format key");
    assert_eq!(
        log_after.value, "json",
        "effective value reflects the write"
    );
    assert_eq!(
        log_after.origin, "global",
        "origin points at the user config file"
    );

    // A nested leaf works too. As of protocol 1.1.0 (G6) `config_show` reports
    // the network policy as its individual leaves (`network.internet`, …) so a
    // write and a re-read line up exactly.
    write_key(&path, "network.internet", "controlled").expect("write network.internet");
    let after2 = client
        .config_show()
        .await
        .expect("config_show after nested write");
    let net = after2
        .entries
        .iter()
        .find(|e| e.key == "network.internet")
        .expect("network.internet key");
    assert_eq!(
        net.value, "controlled",
        "nested write reflected in the network policy leaf"
    );
    assert_eq!(
        net.origin, "global",
        "the leaf's origin points at the user config"
    );

    std::env::remove_var("VALYRIA_HOME");
    let _ = session.shutdown_daemon().await;
}
