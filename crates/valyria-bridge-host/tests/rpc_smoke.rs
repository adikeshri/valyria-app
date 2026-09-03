//! Spawns the built `valyria-bridge-host` binary and speaks JSON-RPC to it over
//! stdio. No Core daemon is involved — this guards the framing + dispatch
//! contract (the session-dependent methods are covered by the bridge's own
//! integration tests against a real Core sidecar).

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

struct Host {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Host {
    fn spawn() -> Self {
        let bin = env!("CARGO_BIN_EXE_valyria-bridge-host");
        let mut child = Command::new(bin)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn valyria-bridge-host");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Host {
            child,
            stdin,
            stdout,
        }
    }

    fn send(&mut self, id: u64, method: &str, params: serde_json::Value) {
        let body = serde_json::to_vec(&serde_json::json!({
            "jsonrpc": "2.0", "id": id, "method": method, "params": params,
        }))
        .unwrap();
        write!(self.stdin, "Content-Length: {}\r\n\r\n", body.len()).unwrap();
        self.stdin.write_all(&body).unwrap();
        self.stdin.flush().unwrap();
    }

    /// Read one framed message, skipping notifications, until a response with
    /// `id` arrives.
    fn recv_response(&mut self, id: u64) -> serde_json::Value {
        loop {
            let mut len = None;
            loop {
                let mut line = String::new();
                self.stdout.read_line(&mut line).unwrap();
                let trimmed = line.trim_end();
                if trimmed.is_empty() {
                    break;
                }
                if let Some(v) = trimmed.strip_prefix("Content-Length:") {
                    len = Some(v.trim().parse::<usize>().unwrap());
                }
            }
            let len = len.expect("framed message had a Content-Length");
            let mut buf = vec![0u8; len];
            self.stdout.read_exact(&mut buf).unwrap();
            let msg: serde_json::Value = serde_json::from_slice(&buf).unwrap();
            if msg.get("id").and_then(|v| v.as_u64()) == Some(id) {
                return msg;
            }
            // otherwise a notification (e.g. core/connectionState) — keep reading
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn about_info_returns_bridge_metadata_without_a_session() {
    let mut h = Host::spawn();
    h.send(1, "about/info", serde_json::json!({}));
    let resp = h.recv_response(1);

    let result = resp
        .get("result")
        .expect("about/info is a result, not an error");
    assert_eq!(result["expectedProtocol"], "1.10.0");
    assert_eq!(result["compatibility"], "no session");
    assert!(result["bridgeHost"].is_string());
    assert!(result["session"].is_null());
}

#[test]
fn session_status_is_null_before_any_open() {
    let mut h = Host::spawn();
    h.send(7, "session/status", serde_json::json!({}));
    let resp = h.recv_response(7);
    assert!(resp["result"].is_null(), "got {resp}");
}

#[test]
fn session_dependent_method_errors_with_no_session_code() {
    let mut h = Host::spawn();
    h.send(2, "task/list", serde_json::json!({}));
    let resp = h.recv_response(2);
    let err = resp
        .get("error")
        .expect("task/list without a session is an error");
    // the stable bridge code travels in `data` (see rpc::RpcError::bridge)
    assert_eq!(err["data"], "bridge.no_session", "got {resp}");
}

#[test]
fn unknown_method_is_method_not_found() {
    let mut h = Host::spawn();
    h.send(3, "does/notexist", serde_json::json!({}));
    let resp = h.recv_response(3);
    assert_eq!(resp["error"]["code"], -32601, "got {resp}");
}

#[test]
fn missing_required_param_is_invalid_params() {
    let mut h = Host::spawn();
    h.send(4, "task/status", serde_json::json!({})); // missing taskId
    let resp = h.recv_response(4);
    assert_eq!(resp["error"]["code"], -32602, "got {resp}");
}

#[test]
fn a_starting_connection_state_notification_is_emitted_on_boot() {
    let mut h = Host::spawn();
    // The very first framed message the host sends is core/connectionState:starting.
    let mut len = None;
    loop {
        let mut line = String::new();
        h.stdout.read_line(&mut line).unwrap();
        let t = line.trim_end();
        if t.is_empty() {
            break;
        }
        if let Some(v) = t.strip_prefix("Content-Length:") {
            len = Some(v.trim().parse::<usize>().unwrap());
        }
    }
    let mut buf = vec![0u8; len.unwrap()];
    h.stdout.read_exact(&mut buf).unwrap();
    let msg: serde_json::Value = serde_json::from_slice(&buf).unwrap();
    assert_eq!(msg["method"], "core/connectionState");
    assert_eq!(msg["params"]["state"], "starting");
}
