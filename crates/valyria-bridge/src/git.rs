//! Read-only git inspection for display (CORE-INTERFACE §3). Shells out to the
//! user's `git` — no library, no writes. `git status` / `diff` / `log` for the
//! Changes panel and file-tree decorations; every write operation (stage,
//! commit, branch, discard) stays Core's and is rendered disabled with the
//! reason (§17).

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::error::{BridgeError, Result};

#[derive(Clone)]
pub struct GitRepo {
    root: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitEntry {
    /// Path relative to the repo root, forward-slashed.
    pub path: String,
    /// `modified` | `added` | `deleted` | `renamed` | `untracked` | `conflicted`
    pub status: String,
    /// True when the change is staged (index differs from HEAD).
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub rel_time: String,
    pub subject: String,
}

impl GitRepo {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// `true` if the root is inside a git work tree.
    pub fn is_repo(&self) -> bool {
        self.run(&["rev-parse", "--is-inside-work-tree"])
            .map(|s| s.trim() == "true")
            .unwrap_or(false)
    }

    pub fn branch(&self) -> Result<String> {
        Ok(self
            .run(&["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_string())
    }

    /// `git status --porcelain=v1 -z`, parsed.
    pub fn status(&self) -> Result<Vec<GitEntry>> {
        let raw = self.run(&["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
        Ok(parse_porcelain_z(&raw))
    }

    /// Unified diff. `path` scopes it to one file; `staged` diffs the index.
    pub fn diff(&self, path: Option<&str>, staged: bool) -> Result<String> {
        let mut args: Vec<&str> = vec!["diff", "--no-color"];
        if staged {
            args.push("--staged");
        }
        if let Some(p) = path {
            args.push("--");
            args.push(p);
        }
        self.run(&args)
    }

    /// Unified diff for a single file that also covers the case Core's agent
    /// hits most on a fresh task: a **newly created, still-untracked** file.
    /// Plain `git diff` ignores those, so we fall back to `git diff --no-index`
    /// against an empty tree (exit status 1 with output is the normal "differs"
    /// result there, not an error).
    pub fn diff_file(&self, path: &str) -> Result<String> {
        let tracked = self
            .run(&["ls-files", "--error-unmatch", "--", path])
            .is_ok();
        if tracked {
            let combined = self.diff(Some(path), false)?;
            if !combined.trim().is_empty() {
                return Ok(combined);
            }
            // Tracked but no worktree change — show the staged diff if any.
            return self.diff(Some(path), true);
        }
        // Untracked: synthesize an all-additions diff.
        let out = Command::new("git")
            .arg("-C")
            .arg(&self.root)
            .args(["diff", "--no-color", "--no-index", "--", "/dev/null", path])
            .output()
            .map_err(|e| BridgeError::Git(format!("spawning git: {e}")))?;
        // `--no-index` exits 1 when the files differ (the expected case).
        match out.status.code() {
            Some(0) | Some(1) => Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
            _ => Err(BridgeError::Git(
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            )),
        }
    }

    /// Contents of `path` at `rev` (e.g. `HEAD`), for the "before" side of a
    /// review diff. `Ok(None)` when the path does not exist at that rev (a file
    /// the agent newly created) — not an error.
    pub fn show(&self, rev: &str, path: &str) -> Result<Option<String>> {
        let spec = format!("{rev}:{path}");
        let out = Command::new("git")
            .arg("-C")
            .arg(&self.root)
            .args(["show", "--textconv", &spec])
            .output()
            .map_err(|e| BridgeError::Git(format!("spawning git: {e}")))?;
        if out.status.success() {
            Ok(Some(String::from_utf8_lossy(&out.stdout).into_owned()))
        } else {
            let stderr = String::from_utf8_lossy(&out.stderr);
            // "exists on disk, but not in 'HEAD'" / "does not exist" → not tracked yet.
            if stderr.contains("does not exist") || stderr.contains("exists on disk") {
                Ok(None)
            } else {
                Err(BridgeError::Git(stderr.trim().to_string()))
            }
        }
    }

    pub fn log(&self, limit: u32) -> Result<Vec<GitCommit>> {
        let n = format!("-{}", limit.max(1));
        // %x1f = unit sep between fields, %x1e = record sep between commits.
        let raw = self.run(&[
            "log",
            &n,
            "--no-color",
            "--format=%H%x1f%h%x1f%an%x1f%cr%x1f%s%x1e",
        ])?;
        Ok(raw
            .split('\u{1e}')
            .filter_map(|rec| {
                let rec = rec.trim_matches(['\n', '\r']);
                if rec.is_empty() {
                    return None;
                }
                let mut f = rec.split('\u{1f}');
                Some(GitCommit {
                    hash: f.next()?.to_string(),
                    short_hash: f.next()?.to_string(),
                    author: f.next()?.to_string(),
                    rel_time: f.next()?.to_string(),
                    subject: f.next().unwrap_or_default().to_string(),
                })
            })
            .collect())
    }

    fn run(&self, args: &[&str]) -> Result<String> {
        let out = Command::new("git")
            .arg("-C")
            .arg(&self.root)
            .args(args)
            .output()
            .map_err(|e| BridgeError::Git(format!("spawning git: {e}")))?;
        if !out.status.success() {
            return Err(BridgeError::Git(
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            ));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    #[allow(dead_code)]
    pub fn root(&self) -> &Path {
        &self.root
    }
}

/// Parse `git status --porcelain=v1 -z`. Records are NUL-separated; a rename
/// record is `XY <to>\0<from>\0`, so we consume the extra field.
fn parse_porcelain_z(raw: &str) -> Vec<GitEntry> {
    let mut out = Vec::new();
    let mut it = raw.split('\0');
    while let Some(rec) = it.next() {
        if rec.len() < 4 {
            continue;
        }
        let (xy, path) = rec.split_at(3);
        let x = xy.as_bytes()[0] as char;
        let y = xy.as_bytes()[1] as char;
        let path = path.to_string();

        // Rename / copy carries the old path as the next NUL field.
        if x == 'R' || x == 'C' {
            let _from = it.next();
        }

        let staged = x != ' ' && x != '?';
        let code = if x != ' ' && x != '?' { x } else { y };
        let status = match code {
            'M' => "modified",
            'A' => "added",
            'D' => "deleted",
            'R' => "renamed",
            'C' => "copied",
            'U' => "conflicted",
            '?' => "untracked",
            _ => "modified",
        };
        out.push(GitEntry {
            path,
            status: status.to_string(),
            staged,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "t@e.com"],
            vec!["config", "user.name", "t"],
        ] {
            assert!(Command::new("git")
                .arg("-C")
                .arg(p)
                .args(&args)
                .status()
                .unwrap()
                .success());
        }
        std::fs::write(p.join("a.txt"), "one\n").unwrap();
        std::fs::write(p.join("b.txt"), "two\n").unwrap();
        Command::new("git")
            .arg("-C")
            .arg(p)
            .args(["add", "-A"])
            .status()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(p)
            .args(["commit", "-qm", "init"])
            .status()
            .unwrap();
        dir
    }

    #[test]
    fn detects_repo_and_branch() {
        let d = repo();
        let g = GitRepo::new(d.path());
        assert!(g.is_repo());
        assert!(!g.branch().unwrap().is_empty());
    }

    #[test]
    fn status_reports_modified_and_untracked() {
        let d = repo();
        std::fs::write(d.path().join("a.txt"), "one\nmore\n").unwrap();
        std::fs::write(d.path().join("new.txt"), "hi\n").unwrap();
        let g = GitRepo::new(d.path());
        let s = g.status().unwrap();
        assert!(s
            .iter()
            .any(|e| e.path == "a.txt" && e.status == "modified"));
        assert!(s
            .iter()
            .any(|e| e.path == "new.txt" && e.status == "untracked"));
    }

    #[test]
    fn log_returns_commits_newest_first() {
        let d = repo();
        std::fs::write(d.path().join("a.txt"), "one\ntwo\n").unwrap();
        Command::new("git")
            .arg("-C")
            .arg(d.path())
            .args(["commit", "-aqm", "second"])
            .status()
            .unwrap();
        let g = GitRepo::new(d.path());
        let log = g.log(10).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].subject, "second");
        assert_eq!(log[1].subject, "init");
        assert!(log[0].short_hash.len() >= 7 && log[0].hash.len() == 40);
    }

    #[test]
    fn diff_scoped_to_a_path() {
        let d = repo();
        std::fs::write(d.path().join("a.txt"), "one\nCHANGED\n").unwrap();
        let g = GitRepo::new(d.path());
        let diff = g.diff(Some("a.txt"), false).unwrap();
        assert!(diff.contains("+CHANGED"));
        assert!(!diff.contains("b.txt"));
    }

    #[test]
    fn show_returns_head_contents_and_none_for_untracked() {
        let d = repo();
        std::fs::write(d.path().join("a.txt"), "one\nCHANGED\n").unwrap();
        std::fs::write(d.path().join("fresh.txt"), "brand new\n").unwrap();
        let g = GitRepo::new(d.path());
        assert_eq!(g.show("HEAD", "a.txt").unwrap().as_deref(), Some("one\n"));
        assert_eq!(g.show("HEAD", "fresh.txt").unwrap(), None);
    }

    #[test]
    fn diff_file_covers_a_modified_tracked_file() {
        let d = repo();
        std::fs::write(d.path().join("a.txt"), "one\nCHANGED\n").unwrap();
        let g = GitRepo::new(d.path());
        let diff = g.diff_file("a.txt").unwrap();
        assert!(diff.contains("+CHANGED"));
    }

    #[test]
    fn diff_file_synthesizes_an_all_additions_diff_for_an_untracked_file() {
        let d = repo();
        std::fs::write(d.path().join("fresh.rs"), "fn new_thing() {}\n").unwrap();
        let g = GitRepo::new(d.path());
        let diff = g.diff_file("fresh.rs").unwrap();
        assert!(diff.contains("+fn new_thing() {}"), "diff was: {diff:?}");
        // No content removal lines — the only `-` is the `--- /dev/null` header.
        assert!(
            !diff
                .lines()
                .any(|l| l.starts_with('-') && !l.starts_with("---")),
            "an untracked file has nothing to remove: {diff:?}"
        );
    }
}
