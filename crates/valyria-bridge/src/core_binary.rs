//! Resolving which `valyria` binary to run (docs/INTEGRATION.md D-INT-1).
//!
//! Order:
//!   1. an explicit path (from app settings — `settings.coreBinaryPath`)
//!   2. `$VALYRIA_BIN`
//!   3. the bundled Tauri sidecar
//!
//! The sidecar itself is resolved by the Tauri host (`app.shell().sidecar`),
//! not here — this crate has no Tauri dependency. When neither 1 nor 2 is set
//! the host is expected to pass the resolved sidecar path in as `Explicit`.

use std::path::{Path, PathBuf};

use crate::error::{BridgeError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreBinary {
    /// A concrete path: a settings override, `$VALYRIA_BIN`, or the sidecar
    /// path the Tauri host resolved.
    Explicit(PathBuf),
}

impl CoreBinary {
    /// Resolve from the environment. `sidecar` is the path the Tauri host
    /// resolved for the bundled binary, if any.
    pub fn resolve(settings_override: Option<PathBuf>, sidecar: Option<PathBuf>) -> Result<Self> {
        if let Some(path) = settings_override {
            return Self::checked(path);
        }
        if let Some(path) = std::env::var_os("VALYRIA_BIN") {
            return Self::checked(PathBuf::from(path));
        }
        if let Some(path) = sidecar {
            return Self::checked(path);
        }
        Err(BridgeError::CoreBinaryNotFound)
    }

    fn checked(path: PathBuf) -> Result<Self> {
        if !path.exists() {
            return Err(BridgeError::CoreBinaryNotFound);
        }
        if !is_executable(&path) {
            return Err(BridgeError::CoreBinaryNotExecutable { path });
        }
        Ok(CoreBinary::Explicit(path))
    }

    pub fn path(&self) -> &Path {
        match self {
            CoreBinary::Explicit(p) => p,
        }
    }
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    std::fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_everything_is_not_found() {
        // No override, and $VALYRIA_BIN is unlikely to point anywhere real in CI.
        let prev = std::env::var_os("VALYRIA_BIN");
        std::env::remove_var("VALYRIA_BIN");
        let err = CoreBinary::resolve(None, None).unwrap_err();
        assert_eq!(err.code(), "bridge.core_binary.not_found");
        if let Some(v) = prev {
            std::env::set_var("VALYRIA_BIN", v);
        }
    }

    #[test]
    fn a_real_executable_resolves() {
        // `/bin/sh` exists and is executable on every unix CI runner.
        #[cfg(unix)]
        {
            let r = CoreBinary::resolve(Some(PathBuf::from("/bin/sh")), None).unwrap();
            assert_eq!(r.path(), Path::new("/bin/sh"));
        }
    }
}
