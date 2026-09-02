//! `cargo run -p xtask -- <check>`
//!
//!   check-layering   valyria-bridge depends on no Core crate outside the
//!                    D2 allowlist ({valyria-protocol, valyria-types})
//!   check-protocol   the vendored protocol schemas match the pinned Core
//!                    checkout, when one is present next to this repo
//!   verify-core      core.lock.json is internally consistent and matches
//!                    the vendored version.txt
//!   check-extension  the Code-OSS-fork extension declares only the
//!                    `@valyria/*` + `zod` runtime deps, references no
//!                    xterm/PTY package, and `valyria-bridge-host` exposes no
//!                    PTY methods (D7 — the terminal is Code-OSS's)
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
        Some("check-extension") => check_extension(&repo),
        Some("all") => check_layering(&repo)
            .and_then(|_| verify_core(&repo))
            .and_then(|_| check_protocol(&repo))
            .and_then(|_| check_extension(&repo)),
        other => {
            eprintln!("unknown task: {other:?}");
            eprintln!(
                "usage: cargo run -p xtask -- <check-layering|check-protocol|verify-core|check-extension|all>"
            );
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

/// Per-crate allowlists of `valyria*` dependencies. Anything matching
/// `valyria` / `valyria-*` not on a crate's list fails the build (D2).
///
/// `valyria-bridge` speaks the Core protocol and may see only the wire crates.
/// `valyria-bridge-host` is a thin stdio front end and may see only the bridge.
const LAYERING: &[(&str, &[&str])] = &[
    (
        "crates/valyria-bridge/Cargo.toml",
        &["valyria-protocol", "valyria-types"],
    ),
    ("crates/valyria-bridge-host/Cargo.toml", &["valyria-bridge"]),
];

fn check_layering(repo: &Path) -> Result<(), String> {
    let mut all_offenders = Vec::new();

    for (rel, allowlist) in LAYERING {
        let manifest_path = repo.join(rel);
        let text = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("reading {}: {e}", manifest_path.display()))?;
        let manifest: toml::Value = toml::from_str(&text)
            .map_err(|e| format!("parsing {}: {e}", manifest_path.display()))?;

        for table in ["dependencies", "build-dependencies", "dev-dependencies"] {
            let Some(deps) = manifest.get(table).and_then(|v| v.as_table()) else {
                continue;
            };
            for name in deps.keys() {
                let looks_like_core = name == "valyria" || name.starts_with("valyria-");
                if looks_like_core && !allowlist.contains(&name.as_str()) {
                    all_offenders.push(format!("{rel} [{table}] {name}"));
                }
            }
        }
    }

    if all_offenders.is_empty() {
        for (rel, allowlist) in LAYERING {
            println!(
                "check-layering: ok — {rel} depends only on {}",
                allowlist.join(", ")
            );
        }
        Ok(())
    } else {
        Err(format!(
            "forbidden Core dependencies (D2):\n  {}",
            all_offenders.join("\n  ")
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
        return Err(format!(
            "core.lock.json: git_rev {rev:?} is not a 40-char sha"
        ));
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
            mismatches.push(name.to_string());
        }
    }

    // Per-kind payload contracts (G12): every `events/<kind>.schema.json` must
    // match Core's byte-for-byte, the file sets must be equal, and every
    // contract's kind must be a real event kind. A Core payload-shape change
    // that is not re-vendored fails here.
    {
        let v_dir = vendored.join("events");
        let c_dir = sibling.join("events");
        let list = |d: &Path| -> Vec<String> {
            let mut v: Vec<String> = std::fs::read_dir(d)
                .into_iter()
                .flatten()
                .flatten()
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| n.ends_with(".schema.json"))
                .collect();
            v.sort();
            v
        };
        let v_files = list(&v_dir);
        let c_files = list(&c_dir);
        if v_files != c_files {
            mismatches.push(format!(
                "events/ file set (vendored {v_files:?} vs Core {c_files:?})"
            ));
        }
        for name in v_files.iter().filter(|n| c_files.contains(n)) {
            let a = std::fs::read_to_string(v_dir.join(name))
                .map_err(|e| format!("reading vendored events/{name}: {e}"))?;
            let b = std::fs::read_to_string(c_dir.join(name))
                .map_err(|e| format!("reading ../valyria events/{name}: {e}"))?;
            if a != b {
                mismatches.push(format!("events/{name}"));
            }
        }
    }

    // Event-kind coverage (D5 / G12): the vendored kind list must equal the
    // string literals in Core's `valyria_events::EventKind::as_str`.
    let vendored_kinds = read_lines_sorted(&vendored.join("event-kinds.txt"))?;

    // Every per-kind payload contract names a kind that actually exists.
    for name in std::fs::read_dir(vendored.join("events"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
    {
        if let Some(stem) = name.strip_suffix(".schema.json") {
            if !vendored_kinds.iter().any(|k| k == stem) {
                mismatches.push(format!(
                    "events/{name} has no matching kind in event-kinds.txt"
                ));
            }
        }
    }
    let core_kind_rs = repo
        .parent()
        .unwrap()
        .join("valyria/crates/valyria-events/src/kind.rs");
    match std::fs::read_to_string(&core_kind_rs) {
        Ok(src) => {
            let mut core_kinds: Vec<String> = src
                .lines()
                .filter_map(|l| {
                    let l = l.trim();
                    // matches:  EventKind::Foo => "foo_bar",
                    let start = l.find("=> \"")? + 4;
                    let end = l[start..].find('"')? + start;
                    Some(l[start..end].to_string())
                })
                .filter(|k| k.chars().all(|c| c.is_ascii_lowercase() || c == '_'))
                .collect();
            core_kinds.sort();
            core_kinds.dedup();
            if core_kinds != vendored_kinds {
                mismatches.push(format!(
                    "event-kinds.txt (vendored {:?} vs Core {:?})",
                    vendored_kinds, core_kinds
                ));
            }
        }
        Err(e) => return Err(format!("reading {}: {e}", core_kind_rs.display())),
    }

    if mismatches.is_empty() {
        println!("check-protocol: ok — vendored schemas and event kinds match ../valyria");
        Ok(())
    } else {
        Err(format!(
            "vendored protocol artifacts differ from ../valyria: {}\n\
             If ../valyria is at the pinned rev, run `xtask sync-core` and commit. \
             If it is ahead, this is an unrecorded Core bump.",
            mismatches.join(", ")
        ))
    }
}

// --- check-extension (ARCHITECTURE-VSCODE.md / D7) ----------------------

/// Invariants for the Code-OSS-fork extension:
///  - it declares no runtime deps beyond `@valyria/*` + `zod` (everything else
///    is bundled or provided by the extension host);
///  - it never pulls in an xterm package — the agent-command view is a
///    projection of `tool_*` events, never a PTY, and it must not be able to
///    share the integrated terminal's buffer (D7);
///  - `valyria-bridge-host` exposes no PTY methods (the terminal is Code-OSS's).
fn check_extension(repo: &Path) -> Result<(), String> {
    let mut offenders = Vec::new();

    let pkg_path = repo.join("extension/package.json");
    let pkg = std::fs::read_to_string(&pkg_path)
        .map_err(|e| format!("reading {}: {e}", pkg_path.display()))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&pkg).map_err(|e| format!("parsing extension/package.json: {e}"))?;

    const ALLOWED_DEPS: &[&str] = &["@valyria/protocol", "@valyria/state", "zod"];
    if let Some(deps) = manifest.get("dependencies").and_then(|v| v.as_object()) {
        for name in deps.keys() {
            if !ALLOWED_DEPS.contains(&name.as_str()) {
                offenders.push(format!("extension dependency not on the allowlist: {name}"));
            }
        }
    }

    // No xterm anywhere in the extension source or its manifest (D7).
    let mut ts_files = Vec::new();
    collect_files(&repo.join("extension/src"), "ts", &mut ts_files);
    for f in &ts_files {
        let text = std::fs::read_to_string(f).unwrap_or_default();
        if text.contains("xterm") || text.contains("node-pty") || text.contains("portable-pty") {
            let rel = f
                .strip_prefix(repo)
                .unwrap_or(f)
                .to_string_lossy()
                .replace('\\', "/");
            offenders.push(format!("{rel} references a terminal/PTY package (D7)"));
        }
    }

    // The bridge-host must not have grown PTY methods back.
    let host = std::fs::read_to_string(repo.join("crates/valyria-bridge-host/src/main.rs"))
        .unwrap_or_default();
    if host.contains("\"pty/") || host.contains("PtySession") {
        offenders.push(
            "valyria-bridge-host exposes PTY methods — the terminal is Code-OSS's (D7)".into(),
        );
    }

    if offenders.is_empty() {
        println!("check-extension: ok — deps allowlisted, no xterm/PTY in the extension (D7)");
        Ok(())
    } else {
        Err(format!(
            "extension invariants broken:\n  {}",
            offenders.join("\n  ")
        ))
    }
}

fn collect_files(dir: &Path, ext: &str, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, ext, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some(ext) {
            out.push(path);
        }
    }
}

fn read_lines_sorted(path: &Path) -> Result<Vec<String>, String> {
    let mut v: Vec<String> = std::fs::read_to_string(path)
        .map_err(|e| format!("reading {}: {e}", path.display()))?
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    v.sort();
    v.dedup();
    Ok(v)
}
