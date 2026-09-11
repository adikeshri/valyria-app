//! `cargo run -p xtask -- <check>`
//!
//!   check-layering      valyria-bridge depends on no Core crate outside the
//!                       D2 allowlist ({valyria-protocol, valyria-types})
//!   check-protocol      the vendored protocol schemas match the pinned Core
//!                       checkout, when one is present next to this repo
//!   verify-core         core.lock.json is internally consistent (git_rev,
//!                       protocol_version) and its `release` block (the
//!                       prebuilt Core binary pin, docs/RELEASING.md) is
//!                       well-formed — offline, safe for every CI job
//!   verify-core-release core.lock.json's `release.tag` actually exists on
//!                       Core's GitHub repo and resolves to the same commit
//!                       as `git_rev` — needs network, release pipeline only,
//!                       deliberately NOT part of `all`/ci.yml
//!   check-versions      every package.json/Cargo.toml version field in this
//!                       repo agrees (scripts/sync-version.mjs is the only
//!                       thing that should ever change them)
//!   check-extension     the Code-OSS-fork extension declares only the
//!                       `@valyria/*` + `zod` runtime deps, references no
//!                       xterm/PTY package (D7), `valyria-bridge-host` exposes
//!                       no PTY methods, and no source file carries a banned
//!                       generic error string (§36)
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
        Some("verify-core-release") => verify_core_release(&repo),
        Some("check-versions") => check_versions(&repo),
        Some("check-extension") => check_extension(&repo),
        Some("all") => check_layering(&repo)
            .and_then(|_| verify_core(&repo))
            .and_then(|_| check_versions(&repo))
            .and_then(|_| check_protocol(&repo))
            .and_then(|_| check_extension(&repo)),
        other => {
            eprintln!("unknown task: {other:?}");
            eprintln!(
                "usage: cargo run -p xtask -- <check-layering|check-protocol|verify-core|verify-core-release|check-versions|check-extension|all>"
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

    verify_release_block(&lock)?;

    println!("verify-core: ok — pinned to {rev}, protocol {lock_proto}");
    Ok(())
}

/// The `release` block names the prebuilt Core GitHub Release binary the
/// app's release pipeline downloads and checksums for each platform
/// (docs/RELEASING.md §Core binary). Offline shape check only — whether the
/// tag/checksums are actually correct is `verify-core-release`'s job.
const RELEASE_TARGETS: &[&str] = &[
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "x86_64-unknown-linux-gnu",
    "x86_64-pc-windows-msvc",
];

fn verify_release_block(lock: &serde_json::Value) -> Result<(), String> {
    let release = lock
        .get("release")
        .ok_or("core.lock.json: missing `release` block (the prebuilt Core binary pin)")?;

    let tag = release
        .get("tag")
        .and_then(|v| v.as_str())
        .ok_or("core.lock.json: release.tag missing or not a string")?;
    if !tag.starts_with('v') || tag.len() < 2 {
        return Err(format!(
            "core.lock.json: release.tag {tag:?} must look like a version tag (e.g. \"v0.2.0\")"
        ));
    }
    // Strip the leading `v` and any `-rc.N`/`-alpha.N` prerelease suffix to get
    // the bare version the asset-naming convention embeds.
    let version = tag[1..].split('-').next().unwrap_or(&tag[1..]);

    let artifacts = release
        .get("artifacts")
        .and_then(|v| v.as_object())
        .ok_or("core.lock.json: release.artifacts missing or not an object")?;

    for target in RELEASE_TARGETS {
        let entry = artifacts
            .get(*target)
            .ok_or_else(|| format!("core.lock.json: release.artifacts is missing {target}"))?;

        let asset = entry
            .get("asset")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("core.lock.json: release.artifacts.{target}.asset missing"))?;
        let expected_ext = if *target == "x86_64-pc-windows-msvc" {
            ".exe"
        } else {
            ""
        };
        let expected = format!("valyria-{version}-{target}{expected_ext}");
        if asset != expected {
            return Err(format!(
                "core.lock.json: release.artifacts.{target}.asset is {asset:?}, expected {expected:?} \
                 (naming convention: valyria-<version>-<triple>[.exe])"
            ));
        }

        let sha256 = entry
            .get("sha256")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("core.lock.json: release.artifacts.{target}.sha256 missing"))?;
        if sha256.len() != 64 || !sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!(
                "core.lock.json: release.artifacts.{target}.sha256 is not a 64-char hex digest"
            ));
        }
    }

    Ok(())
}

// --- verify-core-release (network — release pipeline only, not ci.yml) --

/// Confirms `core.lock.json`'s `release.tag` really exists on Core's GitHub
/// repo and resolves to the same commit as `git_rev` — i.e. the binary the
/// app is about to download and the protocol crates it was compiled against
/// come from the same Core commit. Needs network (`git ls-remote`), so this
/// is never part of `all`/ci.yml; it's an explicit step in release.yml.
fn verify_core_release(repo: &Path) -> Result<(), String> {
    let lock_path = repo.join("core.lock.json");
    let lock_text = std::fs::read_to_string(&lock_path)
        .map_err(|e| format!("reading {}: {e}", lock_path.display()))?;
    let lock: serde_json::Value =
        serde_json::from_str(&lock_text).map_err(|e| format!("parsing core.lock.json: {e}"))?;

    let git_rev = lock
        .get("git_rev")
        .and_then(|v| v.as_str())
        .ok_or("core.lock.json: missing git_rev")?;
    let repository = lock
        .get("release")
        .and_then(|r| r.get("repository"))
        .and_then(|v| v.as_str())
        .or_else(|| lock.get("repository").and_then(|v| v.as_str()))
        .ok_or("core.lock.json: missing release.repository / repository")?;
    let tag = lock
        .get("release")
        .and_then(|r| r.get("tag"))
        .and_then(|v| v.as_str())
        .ok_or("core.lock.json: missing release.tag")?;

    let output = std::process::Command::new("git")
        .args(["ls-remote", repository, &format!("refs/tags/{tag}")])
        .output()
        .map_err(|e| format!("running `git ls-remote {repository} refs/tags/{tag}`: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "git ls-remote {repository} refs/tags/{tag} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let resolved = stdout
        .split_whitespace()
        .next()
        .ok_or_else(|| format!("release.tag {tag:?} does not exist on {repository}"))?;

    if resolved != git_rev {
        return Err(format!(
            "release.tag {tag:?} resolves to {resolved}, but core.lock.json's git_rev is {git_rev} — \
             the shipped Core binary and the compiled-in protocol crates would come from different commits"
        ));
    }

    println!("verify-core-release: ok — {tag} on {repository} resolves to {git_rev}");
    Ok(())
}

// --- check-versions -------------------------------------------------------

/// Every version field in the repo that a release depends on. Kept in sync
/// only by `scripts/sync-version.mjs` — never hand-edited (that's how they
/// drifted to 0.0.0 / 0.1.0 / 0.1.0 before this check existed).
const VERSIONED_PACKAGE_JSONS: &[&str] = &[
    "package.json",
    "extension/package.json",
    "chrome/package.json",
    "theme/package.json",
    "packages/protocol/package.json",
    "packages/state/package.json",
];

fn check_versions(repo: &Path) -> Result<(), String> {
    let mut versions: Vec<(String, String)> = Vec::new();

    for rel in VERSIONED_PACKAGE_JSONS {
        let path = repo.join(rel);
        let text = std::fs::read_to_string(&path).map_err(|e| format!("reading {rel}: {e}"))?;
        let json: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| format!("parsing {rel}: {e}"))?;
        let version = json
            .get("version")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("{rel}: missing \"version\""))?;
        versions.push((rel.to_string(), version.to_string()));
    }

    let cargo_path = repo.join("Cargo.toml");
    let cargo_text = std::fs::read_to_string(&cargo_path)
        .map_err(|e| format!("reading {}: {e}", cargo_path.display()))?;
    let cargo_toml: toml::Value =
        toml::from_str(&cargo_text).map_err(|e| format!("parsing Cargo.toml: {e}"))?;
    let cargo_version = cargo_toml
        .get("workspace")
        .and_then(|w| w.get("package"))
        .and_then(|p| p.get("version"))
        .and_then(|v| v.as_str())
        .ok_or("Cargo.toml: missing [workspace.package] version")?;
    versions.push((
        "Cargo.toml [workspace.package]".to_string(),
        cargo_version.to_string(),
    ));

    let expected = &versions[0].1;
    let offenders: Vec<String> = versions
        .iter()
        .filter(|(_, v)| v != expected)
        .map(|(rel, v)| format!("{rel} is {v}"))
        .collect();

    if offenders.is_empty() {
        println!(
            "check-versions: ok — all {} version fields are {expected}",
            versions.len()
        );
        Ok(())
    } else {
        Err(format!(
            "version fields disagree (expected {expected} from {}): {}\n\
             Run `node scripts/sync-version.mjs <version>` to fix — never hand-edit these.",
            versions[0].0,
            offenders.join(", ")
        ))
    }
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

    // Banned generic error strings (§36: every user-visible error must say what
    // happened / whether the agent stopped / what to do — "something went wrong"
    // is not expressible).
    const BANNED_ERRORS: &[&str] = &[
        "something went wrong",
        "an error occurred",
        "unknown error",
        "unexpected error",
        "oops",
    ];

    // No xterm / PTY (D7) and no banned error strings in the extension source.
    let mut ts_files = Vec::new();
    collect_files(&repo.join("extension/src"), "ts", &mut ts_files);
    for f in &ts_files {
        let text = std::fs::read_to_string(f).unwrap_or_default();
        let rel = f
            .strip_prefix(repo)
            .unwrap_or(f)
            .to_string_lossy()
            .replace('\\', "/");
        if text.contains("xterm") || text.contains("node-pty") || text.contains("portable-pty") {
            offenders.push(format!("{rel} references a terminal/PTY package (D7)"));
        }
        let lower = text.to_lowercase();
        for banned in BANNED_ERRORS {
            if lower.contains(banned) {
                offenders.push(format!(
                    "{rel} contains a banned generic error string: {banned:?}"
                ));
            }
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
        println!(
            "check-extension: ok — deps allowlisted, no xterm/PTY (D7), no banned error strings (§36)"
        );
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
