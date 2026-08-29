//! D13 — Settings write to Core's own config files, then re-read `config_show`.
//!
//! There is no `config_set` on the wire (CORE-INTERFACE G6), so the app edits
//! `<repo>/.valyria/config.toml` (workspace scope) or `$VALYRIA_HOME/config.toml`
//! (user scope) — Core's documented user surfaces — and the caller immediately
//! re-reads `config_show` to render the **effective** value with its origin. If
//! a policy floor or precedence rule overrode the write, the user sees that.
//!
//! This module only edits TOML files. It never decides what a value *means* —
//! Core owns validation against its compiled-in policy floor.

use std::path::{Path, PathBuf};

use crate::error::{BridgeError, Result};
use crate::workspace::valyria_home;

/// Which config file a write targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigScope {
    /// `<data_dir>/config.toml` — this workspace only.
    Workspace,
    /// `$VALYRIA_HOME/config.toml` — every workspace, unless overridden.
    User,
}

impl ConfigScope {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "workspace" => Ok(Self::Workspace),
            "user" => Ok(Self::User),
            other => Err(BridgeError::Config(format!(
                "unknown config scope {other:?} (expected \"workspace\" or \"user\")"
            ))),
        }
    }
}

/// Resolve the file a scope writes to. `data_dir` comes from `workspace_status`
/// and is only needed for `Workspace` scope.
pub fn config_path(scope: ConfigScope, data_dir: Option<&Path>) -> Result<PathBuf> {
    match scope {
        ConfigScope::User => Ok(valyria_home().join("config.toml")),
        ConfigScope::Workspace => data_dir
            .map(|d| d.join("config.toml"))
            .ok_or_else(|| BridgeError::Config("workspace scope needs a data_dir".into())),
    }
}

/// Set a dotted `key` to a string `value` in the TOML file at `path`, creating
/// the file and any parent tables as needed, and leaving every other key
/// untouched. Returns the path written.
///
/// `value` is always written as a TOML string. Core's settings that take an
/// enum (`network = "denied"`) accept that; a caller that needs a non-string
/// leaf is out of scope until Core exposes `config_set`.
pub fn write_key(path: &Path, key: &str, value: &str) -> Result<()> {
    let mut doc: toml::Table = if path.exists() {
        let text = std::fs::read_to_string(path).map_err(|source| BridgeError::Fs {
            path: path.to_path_buf(),
            source,
        })?;
        text.parse().map_err(|e| {
            BridgeError::Config(format!("{} is not valid TOML: {e}", path.display()))
        })?
    } else {
        toml::Table::new()
    };

    set_dotted(&mut doc, key, toml::Value::String(value.to_string()))?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|source| BridgeError::Fs {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    let serialized =
        toml::to_string_pretty(&doc).map_err(|e| BridgeError::Config(format!("serialize: {e}")))?;
    // Write via a temp file + rename so a crash never leaves a half-written config.
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, serialized).map_err(|source| BridgeError::Fs {
        path: tmp.clone(),
        source,
    })?;
    std::fs::rename(&tmp, path).map_err(|source| BridgeError::Fs {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(())
}

/// Walk/insert dotted `a.b.c` tables and set the leaf.
fn set_dotted(table: &mut toml::Table, key: &str, value: toml::Value) -> Result<()> {
    let mut parts = key.split('.').peekable();
    let mut cur = table;
    while let Some(part) = parts.next() {
        if parts.peek().is_none() {
            cur.insert(part.to_string(), value);
            return Ok(());
        }
        let entry = cur
            .entry(part.to_string())
            .or_insert_with(|| toml::Value::Table(toml::Table::new()));
        cur = entry.as_table_mut().ok_or_else(|| {
            BridgeError::Config(format!("config key {key:?} crosses a non-table value"))
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("config.toml");
        (d, p)
    }

    #[test]
    fn writes_a_leaf_into_a_new_file() {
        let (_d, p) = tmp();
        write_key(&p, "network", "denied").unwrap();
        let back: toml::Table = std::fs::read_to_string(&p).unwrap().parse().unwrap();
        assert_eq!(back["network"].as_str(), Some("denied"));
    }

    #[test]
    fn preserves_sibling_keys() {
        let (_d, p) = tmp();
        std::fs::write(&p, "network = \"denied\"\n[log]\nformat = \"json\"\n").unwrap();
        write_key(&p, "permission.mode", "manual").unwrap();
        let back: toml::Table = std::fs::read_to_string(&p).unwrap().parse().unwrap();
        assert_eq!(back["network"].as_str(), Some("denied"));
        assert_eq!(back["log"]["format"].as_str(), Some("json"));
        assert_eq!(back["permission"]["mode"].as_str(), Some("manual"));
    }

    #[test]
    fn overwrites_the_same_key_idempotently() {
        let (_d, p) = tmp();
        write_key(&p, "log.format", "json").unwrap();
        write_key(&p, "log.format", "pretty").unwrap();
        let back: toml::Table = std::fs::read_to_string(&p).unwrap().parse().unwrap();
        assert_eq!(back["log"]["format"].as_str(), Some("pretty"));
        assert_eq!(back["log"].as_table().unwrap().len(), 1);
    }

    #[test]
    fn rejects_a_key_that_crosses_a_scalar() {
        let (_d, p) = tmp();
        write_key(&p, "network", "denied").unwrap();
        let err = write_key(&p, "network.mode", "x").unwrap_err();
        assert!(matches!(err, BridgeError::Config(_)));
    }

    #[test]
    fn config_path_resolves_per_scope() {
        let user = config_path(ConfigScope::User, None).unwrap();
        assert!(user.ends_with("config.toml"));
        let ws = config_path(ConfigScope::Workspace, Some(Path::new("/x/.valyria"))).unwrap();
        assert_eq!(ws, Path::new("/x/.valyria/config.toml"));
        assert!(config_path(ConfigScope::Workspace, None).is_err());
    }
}
