//! Read-only filesystem access, **strictly scoped to the authorized workspace
//! root** (CORE-INTERFACE §3, "the local-read exception").
//!
//! This is a display fallback, not Core logic: it lists directories and reads
//! file bytes so the explorer and code viewer have something to show until
//! Core exposes a repository read surface (G3). It never decides *what the
//! agent sees* and never writes.
//!
//! Every path from the renderer is untrusted. `resolve` rejects absolute paths,
//! `..` traversal, and — via `canonicalize` — symlinks that would escape the
//! root. A caller can only ever reach files under the one directory the user
//! authorized when they opened the workspace.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::error::{BridgeError, Result};

/// Cap on how much of a file we hand the renderer for display.
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// How much we sniff to decide "binary".
const SNIFF_BYTES: usize = 8192;

#[derive(Clone)]
pub struct WorkspaceFs {
    root: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    Dir,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirEntry {
    /// Path relative to the workspace root, forward-slashed.
    pub path: String,
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileEncoding {
    Utf8,
    Binary,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileView {
    pub path: String,
    pub encoding: FileEncoding,
    /// Present only for `utf8`. Truncated to `MAX_FILE_BYTES`.
    pub text: Option<String>,
    pub byte_len: u64,
    pub truncated: bool,
}

impl WorkspaceFs {
    /// `root` must already be the canonical, user-authorized workspace path
    /// (the supervisor canonicalizes it when resolving the `WorkspaceId`).
    pub fn new(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        let root = root.canonicalize().map_err(|source| BridgeError::Fs {
            path: root.clone(),
            source,
        })?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Turn an untrusted relative path into an absolute one guaranteed to sit
    /// under `root`. Empty / "." / "/" all mean the root itself.
    pub fn resolve(&self, rel: &str) -> Result<PathBuf> {
        let trimmed = rel.trim_start_matches(['/', '\\']);
        let candidate = Path::new(trimmed);

        for comp in candidate.components() {
            match comp {
                Component::Normal(_) | Component::CurDir => {}
                // `..`, a drive prefix, or a root — all disallowed outright,
                // before we ever touch the filesystem.
                _ => {
                    return Err(BridgeError::PathEscape {
                        rel: rel.to_string(),
                    })
                }
            }
        }

        let joined = self.root.join(candidate);

        // Canonicalize to collapse `.` and, crucially, resolve symlinks — then
        // re-check containment so a symlink inside the tree can't point out.
        let canonical = match joined.canonicalize() {
            Ok(c) => c,
            Err(source) => {
                return Err(BridgeError::Fs {
                    path: joined,
                    source,
                })
            }
        };
        if !canonical.starts_with(&self.root) {
            return Err(BridgeError::PathEscape {
                rel: rel.to_string(),
            });
        }
        Ok(canonical)
    }

    /// List one directory (non-recursive). Entries are sorted dirs-first, then
    /// by name. Hidden entries are included; `.git` is not special-cased here.
    pub fn list_dir(&self, rel: &str) -> Result<Vec<DirEntry>> {
        let abs = self.resolve(rel)?;
        let read = std::fs::read_dir(&abs).map_err(|source| BridgeError::Fs {
            path: abs.clone(),
            source,
        })?;

        let mut out = Vec::new();
        for entry in read.flatten() {
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            let kind = if meta.is_dir() {
                EntryKind::Dir
            } else if meta.file_type().is_symlink() {
                EntryKind::Symlink
            } else if meta.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            let child_rel = join_rel(rel, &name);
            out.push(DirEntry {
                path: child_rel,
                name,
                kind,
                size: meta.len(),
            });
        }
        out.sort_by(|a, b| {
            let a_dir = matches!(a.kind, EntryKind::Dir);
            let b_dir = matches!(b.kind, EntryKind::Dir);
            b_dir
                .cmp(&a_dir) // dirs first
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(out)
    }

    /// Read a file for display. Binary files return no text; large files are
    /// truncated to `MAX_FILE_BYTES`.
    pub fn read_file(&self, rel: &str) -> Result<FileView> {
        let abs = self.resolve(rel)?;
        let meta = std::fs::metadata(&abs).map_err(|source| BridgeError::Fs {
            path: abs.clone(),
            source,
        })?;
        if !meta.is_file() {
            return Err(BridgeError::Fs {
                path: abs.clone(),
                source: std::io::Error::new(std::io::ErrorKind::InvalidInput, "not a regular file"),
            });
        }
        let byte_len = meta.len();
        let truncated = byte_len > MAX_FILE_BYTES;

        let bytes = read_capped(&abs, MAX_FILE_BYTES as usize)?;
        let looks_binary = bytes.iter().take(SNIFF_BYTES).any(|&b| b == 0);

        if looks_binary {
            return Ok(FileView {
                path: normalize_rel(rel),
                encoding: FileEncoding::Binary,
                text: None,
                byte_len,
                truncated,
            });
        }
        match String::from_utf8(bytes) {
            Ok(text) => Ok(FileView {
                path: normalize_rel(rel),
                encoding: FileEncoding::Utf8,
                text: Some(text),
                byte_len,
                truncated,
            }),
            Err(_) => Ok(FileView {
                path: normalize_rel(rel),
                encoding: FileEncoding::Binary,
                text: None,
                byte_len,
                truncated,
            }),
        }
    }
}

/// Directory names skipped by [`WorkspaceFs::search`] — heavy, rarely what a
/// filename search wants.
const SEARCH_PRUNE: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".venv",
    "__pycache__",
];

impl WorkspaceFs {
    /// Substring filename search (case-insensitive) over the whole tree,
    /// breadth-first, capped at `limit`. A display fallback marked "filename
    /// match only" in the UI — it is **not** Core's ranked retrieval (G3).
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<String>> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        let mut queue = std::collections::VecDeque::from([self.root.clone()]);
        while let Some(dir) = queue.pop_front() {
            if out.len() >= limit {
                break;
            }
            let Ok(read) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in read.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                let Ok(ft) = entry.file_type() else { continue };
                if ft.is_dir() {
                    if !SEARCH_PRUNE.contains(&name.as_ref()) {
                        queue.push_back(entry.path());
                    }
                    continue;
                }
                if !ft.is_file() {
                    continue;
                }
                if let Ok(rel) = entry.path().strip_prefix(&self.root) {
                    let rel = rel.to_string_lossy().replace('\\', "/");
                    if rel.to_lowercase().contains(&q) {
                        out.push(rel);
                        if out.len() >= limit {
                            break;
                        }
                    }
                }
            }
        }
        out.sort();
        Ok(out)
    }
}

fn read_capped(path: &Path, cap: usize) -> Result<Vec<u8>> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|source| BridgeError::Fs {
        path: path.to_path_buf(),
        source,
    })?;
    let mut buf = Vec::new();
    file.take(cap as u64)
        .read_to_end(&mut buf)
        .map_err(|source| BridgeError::Fs {
            path: path.to_path_buf(),
            source,
        })?;
    Ok(buf)
}

fn normalize_rel(rel: &str) -> String {
    rel.trim_start_matches(['/', '\\']).replace('\\', "/")
}

fn join_rel(parent: &str, name: &str) -> String {
    let p = normalize_rel(parent);
    if p.is_empty() || p == "." {
        name.to_string()
    } else {
        format!("{}/{}", p.trim_end_matches('/'), name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, WorkspaceFs) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/lib.rs"), "pub fn f() {}\n").unwrap();
        std::fs::write(dir.path().join("README.md"), "# hi\n").unwrap();
        std::fs::write(dir.path().join("data.bin"), [0u8, 1, 2, 0, 255]).unwrap();
        let fs = WorkspaceFs::new(dir.path()).unwrap();
        (dir, fs)
    }

    #[test]
    fn lists_root_dirs_first() {
        let (_d, fs) = fixture();
        let entries = fs.list_dir("").unwrap();
        assert!(matches!(entries[0].kind, EntryKind::Dir));
        assert_eq!(entries[0].name, "src");
        assert!(entries.iter().any(|e| e.name == "README.md"));
    }

    #[test]
    fn reads_utf8_and_flags_binary() {
        let (_d, fs) = fixture();
        let v = fs.read_file("src/lib.rs").unwrap();
        assert!(matches!(v.encoding, FileEncoding::Utf8));
        assert_eq!(v.text.as_deref(), Some("pub fn f() {}\n"));

        let b = fs.read_file("data.bin").unwrap();
        assert!(matches!(b.encoding, FileEncoding::Binary));
        assert!(b.text.is_none());
    }

    #[test]
    fn rejects_dotdot_traversal() {
        let (_d, fs) = fixture();
        let err = fs.list_dir("../../etc").unwrap_err();
        assert_eq!(err.code(), "bridge.fs.path_escape");
        assert_eq!(
            fs.read_file("../secret").unwrap_err().code(),
            "bridge.fs.path_escape"
        );
    }

    #[test]
    fn rejects_absolute_paths() {
        let (_d, fs) = fixture();
        // leading slash is stripped, so this resolves under root and then 404s
        // — it must NOT read the real /etc/passwd.
        let err = fs.read_file("/etc/passwd").unwrap_err();
        assert!(matches!(
            err.code(),
            "bridge.fs.io" | "bridge.fs.path_escape"
        ));
    }

    #[test]
    fn search_matches_by_substring_and_prunes_heavy_dirs() {
        let (dir, fs) = fixture();
        std::fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        std::fs::write(dir.path().join("node_modules/pkg/lib.rs"), "x").unwrap();
        let hits = fs.search("lib", 50).unwrap();
        assert!(hits.contains(&"src/lib.rs".to_string()));
        assert!(!hits.iter().any(|h| h.contains("node_modules")));
        assert!(fs.search("", 50).unwrap().is_empty());
    }

    #[test]
    fn rejects_symlink_escape() {
        let (dir, fs) = fixture();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("loot"), "secret\n").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.path().join("loot"), dir.path().join("link"))
                .unwrap();
            let err = fs.read_file("link").unwrap_err();
            assert_eq!(err.code(), "bridge.fs.path_escape");
        }
    }
}
