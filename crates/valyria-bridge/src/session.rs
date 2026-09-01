//! The `hello` handshake and connection-state vocabulary.
//!
//! This is the front half of the session supervisor (docs/PLAN.md §4.2). The
//! spawn / adopt / health / reap loop lands in the next increment; what is here
//! is the part the walking skeleton needs first: connect to a socket, negotiate
//! protocol + capabilities, and refuse a major-version mismatch
//! (CORE-INTERFACE §4).

use valyria_protocol::{Client, HelloRequest, Request, Response, SocketClient};

use crate::error::{BridgeError, Result};

/// Every state the supervisor can be in, all nameable (docs/PLAN.md §4.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Starting,
    Connecting,
    Ready,
    Degraded,
    Reconnecting,
    Incompatible,
    Failed,
}

/// What `hello` established for a live session.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct NegotiatedSession {
    pub protocol_version: String,
    pub runtime_version: String,
    /// Capabilities Core advertised. The UI gates surfaces on these, never on a
    /// version string (docs/PLAN.md D6).
    pub capabilities: Vec<String>,
}

impl NegotiatedSession {
    pub fn has(&self, capability: &str) -> bool {
        self.capabilities.iter().any(|c| c == capability)
    }
}

/// The client name this app announces in `hello`.
pub const CLIENT_NAME: &str = "valyria-app";

/// Connect to `socket_path`, send `hello`, and check compatibility against the
/// protocol version this build was compiled against (`core.lock.json`,
/// surfaced here as `expected_protocol`).
pub async fn negotiate(
    socket_path: &std::path::Path,
    expected_protocol: &str,
    auth_token: Option<&str>,
) -> Result<NegotiatedSession> {
    let client = match auth_token {
        Some(token) => SocketClient::with_token(socket_path, token),
        None => SocketClient::new(socket_path),
    };
    let resp = client
        .call(Request::Hello(HelloRequest {
            client_name: CLIENT_NAME.to_string(),
        }))
        .await;

    let hello = match resp {
        Response::Hello(h) => h,
        Response::Error(e) => {
            return Err(if e.code == "protocol.transport" {
                BridgeError::Transport(e.message)
            } else {
                BridgeError::Handshake(format!("{}: {}", e.code, e.message))
            });
        }
        other => {
            return Err(BridgeError::Handshake(format!(
                "expected a hello response, got {other:?}"
            )))
        }
    };

    if major(&hello.protocol_version) != major(expected_protocol) {
        return Err(BridgeError::ProtocolMismatch {
            expected: expected_protocol.to_string(),
            got: hello.protocol_version,
        });
    }

    Ok(NegotiatedSession {
        protocol_version: hello.protocol_version,
        runtime_version: hello.runtime_version,
        capabilities: hello.capabilities,
    })
}

/// First dotted component of a semver string, or the whole string if it has no
/// dot. A parse failure is treated as "different major" by the caller.
fn major(version: &str) -> &str {
    version.split('.').next().unwrap_or(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn major_extraction() {
        assert_eq!(major("1.0.0"), "1");
        assert_eq!(major("2.3.4"), "2");
        assert_eq!(major("garbage"), "garbage");
    }

    #[test]
    fn capability_lookup() {
        let s = NegotiatedSession {
            protocol_version: "1.0.0".into(),
            runtime_version: "0.1.0".into(),
            capabilities: vec!["plan".into(), "doctor".into()],
        };
        assert!(s.has("plan"));
        assert!(!s.has("models"));
    }
}
