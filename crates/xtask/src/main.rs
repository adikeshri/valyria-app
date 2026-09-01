//! `cargo run -p xtask -- <check>`
//!
//!   check-layering   valyria-bridge depends on no Core crate outside the
//!                    D2 allowlist ({valyria-protocol, valyria-types})
//!   check-protocol   the vendored protocol schemas match the pinned Core
//!                    checkout, when one is present next to this repo
//!   verify-core      core.lock.json is internally consistent and matches
//!                    the vendored version.txt
//!   check-d7         the human PTY and the agent-command view never share a
//!                    buffer: only the terminal panel touches `@xterm/xterm`,
//!                    and the agent-command view touches no PTY plumbing
//!   check-error-strings  no renderer surface shows a raw error string or a
//!                    banned generic — every error goes through
//!                    `core/errors.ts` `present()` + `<ErrorState>` (§3 / §36)
//!   check-a11y       overlays trap focus (`useOverlayA11y`), the only tab
//!                    strip implementation is `TabStrip.tsx`, and every image
//!                    has an `alt`
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
        Some("check-d7") => check_d7(&repo),
        Some("check-error-strings") => check_error_strings(&repo),
        Some("check-a11y") => check_a11y(&repo),
        Some("all") => check_layering(&repo)
            .and_then(|_| verify_core(&repo))
            .and_then(|_| check_protocol(&repo))
            .and_then(|_| check_d7(&repo))
            .and_then(|_| check_error_strings(&repo))
            .and_then(|_| check_a11y(&repo)),
        other => {
            eprintln!("unknown task: {other:?}");
            eprintln!(
                "usage: cargo run -p xtask -- <check-layering|check-protocol|verify-core|check-d7|check-error-strings|check-a11y|all>"
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

// --- check-d7 (docs/PLAN.md D7 / §4.10) --------------------------------
//
// The integrated terminal shares a panel between the human's shell and the
// agent's commands, but never a buffer — confusing the two is a security
// problem (a user who thinks the agent ran a command it did not run approves
// the wrong things). This makes that mechanical:
//
//   * `@xterm/xterm` — a real writable terminal — is imported by the human
//     terminal only (the live panel plus its mock/dispatcher).
//   * the agent-command view is a read-only projection of `tool_*` events and
//     must not reach for any PTY plumbing.

/// Renderer files allowed to import `@xterm/xterm`.
const XTERM_ALLOWED: &[&str] = &[
    "apps/desktop/src/panels/LiveTerminalPanel.tsx",
    "apps/desktop/src/panels/TerminalPanel.tsx",
];

/// The agent-command view — must stay a plain list, never a terminal.
const AGENT_VIEW: &str = "apps/desktop/src/panels/LiveAgentCommands.tsx";
const AGENT_VIEW_FORBIDDEN: &[&str] =
    &["@xterm/xterm", "core/pty", "pty_write", "core://pty-output"];

fn check_d7(repo: &Path) -> Result<(), String> {
    let src = repo.join("apps/desktop/src");
    let mut files = Vec::new();
    collect_files(&src, "tsx", &mut files);
    collect_files(&src, "ts", &mut files);

    let mut offenders = Vec::new();

    for file in &files {
        let rel = file
            .strip_prefix(repo)
            .unwrap_or(file)
            .to_string_lossy()
            .replace('\\', "/");
        let text = std::fs::read_to_string(file)
            .map_err(|e| format!("reading {}: {e}", file.display()))?;

        if text.contains("@xterm/xterm") && !XTERM_ALLOWED.contains(&rel.as_str()) {
            offenders.push(format!(
                "{rel} imports @xterm/xterm — only the human terminal may (D7)"
            ));
        }

        if rel == AGENT_VIEW {
            for needle in AGENT_VIEW_FORBIDDEN {
                if text.contains(needle) {
                    offenders.push(format!(
                        "{rel} references {needle:?} — the agent-command view must not touch PTY plumbing (D7)"
                    ));
                }
            }
        }
    }

    // The allowlisted files must actually exist, or the guard is dead.
    for allowed in XTERM_ALLOWED {
        if !repo.join(allowed).exists() {
            offenders.push(format!("allowlisted file {allowed} is missing"));
        }
    }
    if !repo.join(AGENT_VIEW).exists() {
        offenders.push(format!("{AGENT_VIEW} is missing"));
    }

    if offenders.is_empty() {
        println!("check-d7: ok — human PTY and agent-command view stay separate buffers");
        Ok(())
    } else {
        Err(format!(
            "D7 separation violated:\n  {}",
            offenders.join("\n  ")
        ))
    }
}

// --- check-error-strings (docs/PLAN.md §3 / PRD §36) ------------------
//
// Every user-visible error answers the four §36 questions, via
// `core/errors.ts` `present()` + `<ErrorState>`. A raw `String(e)` or a bare
// generic in JSX bypasses that — bar it mechanically.

/// Renderer strings that mean "an error is being rendered raw" or "a generic
/// stand-in is being shown".
const ERR_BANNED: &[&str] = &[
    "{String(e)}",
    ">{err}",
    ">{error}",
    "{err}<",
    "{error}<",
    "title={err}",
    "title={error}",
    "title={String(",
    "Something went wrong",
    "An error occurred",
    "Unknown error",
    "went wrong",
];

/// The one file allowed to render presentation fields directly.
const ERR_ALLOWED: &[&str] = &["apps/desktop/src/components/ErrorState.tsx"];

fn check_error_strings(repo: &Path) -> Result<(), String> {
    let src = repo.join("apps/desktop/src");
    let mut files = Vec::new();
    collect_files(&src, "tsx", &mut files);

    let mut offenders = Vec::new();
    for file in &files {
        let rel = file
            .strip_prefix(repo)
            .unwrap_or(file)
            .to_string_lossy()
            .replace('\\', "/");
        if ERR_ALLOWED.contains(&rel.as_str()) {
            continue;
        }
        let text = std::fs::read_to_string(file)
            .map_err(|e| format!("reading {}: {e}", file.display()))?;
        for needle in ERR_BANNED {
            if text.contains(needle) {
                offenders.push(format!("{rel} contains {needle:?}"));
            }
        }
    }

    if !repo.join("apps/desktop/src/core/errors.ts").exists() {
        offenders.push("apps/desktop/src/core/errors.ts is missing".to_string());
    }

    if offenders.is_empty() {
        println!("check-error-strings: ok — errors go through present() + <ErrorState>");
        Ok(())
    } else {
        Err(format!(
            "raw / generic error strings in the renderer (§36):\n  {}\n\
             Route them through `present()` from core/errors.ts and render <ErrorState>.",
            offenders.join("\n  ")
        ))
    }
}

// --- check-a11y (docs/PLAN.md §5 Phase 9 / D10) -----------------------
//
// Static structural checks. The manual VoiceOver/NVDA + axe pass is
// docs/ACCESSIBILITY.md — this gate just holds the invariants a grep can hold.

/// Full-screen overlays: each must trap focus / handle Escape via the shared
/// hook, or keyboard users get stuck behind them.
const OVERLAY_FILES: &[&str] = &[
    "apps/desktop/src/components/SettingsView.tsx",
    "apps/desktop/src/components/AboutView.tsx",
    "apps/desktop/src/components/CommandPalette.tsx",
    "apps/desktop/src/components/LiveFirstRun.tsx",
    "apps/desktop/src/components/FirstRunView.tsx",
];

fn check_a11y(repo: &Path) -> Result<(), String> {
    let src = repo.join("apps/desktop/src");
    let mut files = Vec::new();
    collect_files(&src, "tsx", &mut files);

    let mut offenders = Vec::new();

    for overlay in OVERLAY_FILES {
        let path = repo.join(overlay);
        match std::fs::read_to_string(&path) {
            Ok(text) => {
                if !text.contains("useOverlayA11y") {
                    offenders.push(format!(
                        "{overlay} does not use useOverlayA11y (focus trap / Escape)"
                    ));
                }
            }
            Err(_) => offenders.push(format!("{overlay} is missing (overlay allowlist stale)")),
        }
    }

    for file in &files {
        let rel = file
            .strip_prefix(repo)
            .unwrap_or(file)
            .to_string_lossy()
            .replace('\\', "/");
        let text = std::fs::read_to_string(file)
            .map_err(|e| format!("reading {}: {e}", file.display()))?;

        // Only TabStrip defines the tablist role.
        if text.contains("role=\"tablist\"") && rel != "apps/desktop/src/components/TabStrip.tsx" {
            offenders.push(format!(
                "{rel} hand-rolls role=\"tablist\" — use <TabStrip>"
            ));
        }
        // Every <img> carries an alt.
        for (i, line) in text.lines().enumerate() {
            if line.contains("<img ") && !line.contains("alt=") {
                offenders.push(format!("{rel}:{} <img> without alt=", i + 1));
            }
        }
    }

    if offenders.is_empty() {
        println!(
            "check-a11y: ok — overlays trap focus, TabStrip is the only tab strip, images have alt"
        );
        Ok(())
    } else {
        Err(format!(
            "accessibility invariants broken:\n  {}",
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
