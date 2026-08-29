//! `cargo run -p xtask -- <check>`
//!
//!   check-layering   valyria-bridge depends on no Core crate outside the
//!                    D2 allowlist ({valyria-protocol, valyria-types})
//!   check-protocol   the vendored protocol schemas match the pinned Core
//!                    checkout, when one is present next to this repo
//!   verify-core      core.lock.json is internally consistent and matches
//!                    the vendored version.txt
//!
//! Exit code is non-zero on the first failure so CI fails loudly.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

fn main() -> ExitCode {
    let task = std::env::args().nth(1);
    let repo = repo_root();
    let result = match task.as_deref() {
        Some("check-layering") => check_layering(&repo),
        Some("check-protocol") => check_protocol(&repo),
        Some("verify-core") => verify_core(&repo),
        Some("all") => check_layering(&repo)
            .and_then(|_| verify_core(&repo))
            .and_then(|_| check_protocol(&repo)),
        other => {
            eprintln!("unknown task: {other:?}");
            eprintln!("usage: cargo run -p xtask -- <check-layering|check-protocol|verify-core|all>");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(msg) => {
            eprintln!("xtask: {msg}");
            ExitCode::FAILURE
        }
    }
}

fn repo_root() -> PathBuf {
    // this crate lives at <repo>/crates/xtask
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repo root is two levels above crates/xtask")
        .to_path_buf()
}

// --- check-layering (docs/PLAN.md D2) -------------------------------------

/// The only Core crates `valyria-bridge` may depend on.
const BRIDGE_CORE_ALLOWLIST: &[&str] = &["valyria-protocol", "valyria-types"];

fn check_layering(repo: &Path) -> Result<(), String> {
    let manifest_path = repo.join("crates/valyria-bridge/Cargo.toml");
    let text = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("reading {}: {e}", manifest_path.display()))?;
    let manifest: toml::Value =
        toml::from_str(&text).map_err(|e| format!("parsing {}: {e}", manifest_path.display()))?;

    let mut offenders = Vec::new();
    for table in ["dependencies", "build-dependencies", "dev-dependencies"] {
        let Some(deps) = manifest.get(table).and_then(|v| v.as_table()) else {
            continue;
        };
        for name in deps.keys() {
            let looks_like_core = name == "valyria" || name.starts_with("valyria-");
            if looks_like_core && !BRIDGE_CORE_ALLOWLIST.contains(&name.as_str()) {
                offenders.push(format!("[{table}] {name}"));
            }
        }
    }

    if offenders.is_empty() {
        println!(
            "check-layering: ok — valyria-bridge depends only on {}",
            BRIDGE_CORE_ALLOWLIST.join(", ")
        );
        Ok(())
    } else {
        Err(format!(
            "valyria-bridge has forbidden Core dependencies (D2):\n  {}\n\
             The bridge may only depend on: {}",
            offenders.join("\n  "),
            BRIDGE_CORE_ALLOWLIST.join(", ")
        ))
    }
}

// --- verify-core --------------------------------------------------------

fn verify_core(repo: &Path) -> Result<(), String> {
    let lock_path = repo.join("core.lock.json");
    let lock_text = std::fs::read_to_string(&lock_path)
        .map_err(|e| format!("reading {}: {e}", lock_path.display()))?;
    let lock: serde_json::Value =
        serde_json::from_str(&lock_text).map_err(|e| format!("parsing core.lock.json: {e}"))?;

    let rev = lock
        .get("git_rev")
        .and_then(|v| v.as_str())
        .ok_or("core.lock.json: missing git_rev")?;
    if rev.len() != 40 || !rev.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(format!("core.lock.json: git_rev {rev:?} is not a 40-char sha"));
    }

    let lock_proto = lock
        .get("protocol_version")
        .and_then(|v| v.as_str())
        .ok_or("core.lock.json: missing protocol_version")?;
    let vendored = repo.join("packages/protocol/schemas/version.txt");
    let vendored_proto = std::fs::read_to_string(&vendored)
        .map_err(|e| format!("reading {}: {e}", vendored.display()))?;
    let vendored_proto = vendored_proto.trim();
    if vendored_proto != lock_proto {
        return Err(format!(
            "protocol version mismatch: core.lock.json says {lock_proto}, \
             packages/protocol/schemas/version.txt says {vendored_proto}"
        ));
    }

    // The bridge's git dep rev must match the lockfile.
    let bridge_manifest = repo.join("Cargo.toml");
    let bridge_text = std::fs::read_to_string(&bridge_manifest)
        .map_err(|e| format!("reading {}: {e}", bridge_manifest.display()))?;
    if !bridge_text.contains(rev) {
        return Err(format!(
            "Cargo.toml [workspace.dependencies] does not pin Core to {rev} \
             (from core.lock.json)"
        ));
    }

    println!("verify-core: ok — pinned to {rev}, protocol {lock_proto}");
    Ok(())
}

// --- check-protocol ----------------------------------------------------

fn check_protocol(repo: &Path) -> Result<(), String> {
    let vendored = repo.join("packages/protocol/schemas");
    // The sibling Core checkout, if the developer has one. CI that needs a
    // hard guarantee runs a dedicated job that checks out the pinned rev.
    let sibling = repo
        .parent()
        .map(|p| p.join("valyria/docs/protocol"))
        .filter(|p| p.exists());

    let Some(sibling) = sibling else {
        println!(
            "check-protocol: skipped — no ../valyria checkout. \
             Vendored schemas in packages/protocol/schemas are the source of truth here."
        );
        return Ok(());
    };

    let mut mismatches = Vec::new();
    for name in [
        "request.schema.json",
        "response.schema.json",
        "event.schema.json",
        "version.txt",
    ] {
        let a = std::fs::read_to_string(vendored.join(name))
            .map_err(|e| format!("reading vendored {name}: {e}"))?;
        let b = std::fs::read_to_string(sibling.join(name))
            .map_err(|e| format!("reading ../valyria {name}: {e}"))?;
        if a != b {
            mismatches.push(name);
        }
    }

    if mismatches.is_empty() {
        println!("check-protocol: ok — vendored schemas match ../valyria");
        Ok(())
    } else {
        Err(format!(
            "vendored schemas differ from ../valyria: {}\n\
             If ../valyria is at the pinned rev, run `xtask sync-core` and commit. \
             If it is ahead, this is an unrecorded Core bump.",
            mismatches.join(", ")
        ))
    }
}
