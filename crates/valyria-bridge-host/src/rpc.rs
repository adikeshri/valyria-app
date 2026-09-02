//! JSON-RPC 2.0 message types + LSP-style `Content-Length` framing over stdio.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// An incoming request. `id` absent ⇒ a notification (we don't expect any from
/// the extension today, but tolerate them).
#[derive(Debug, Deserialize)]
pub struct Incoming {
    #[allow(dead_code)]
    pub jsonrpc: Option<String>,
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub fn new(code: i32, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }
    pub fn method_not_found(method: &str) -> Self {
        Self::new(-32601, format!("method not implemented: {method}"))
    }
    pub fn invalid_params(msg: impl Into<String>) -> Self {
        Self::new(-32602, msg)
    }
    /// A bridge/Core failure. Keeps the stable `code` string in `data` so the
    /// extension can map it (mirrors PLAN.md "Errors" convention).
    pub fn bridge(code: &str, msg: impl Into<String>) -> Self {
        Self {
            code: -32000,
            message: msg.into(),
            data: Some(Value::String(code.to_string())),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum OutgoingBody {
    Result { result: Value },
    Error { error: RpcError },
}

#[derive(Debug, Serialize)]
pub struct Response {
    jsonrpc: &'static str,
    id: Value,
    #[serde(flatten)]
    body: OutgoingBody,
}

impl Response {
    pub fn ok(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            body: OutgoingBody::Result { result },
        }
    }
    pub fn err(id: Value, error: RpcError) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            body: OutgoingBody::Error { error },
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Notification {
    jsonrpc: &'static str,
    method: &'static str,
    params: Value,
}

impl Notification {
    pub fn new(method: &'static str, params: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            method,
            params,
        }
    }
}

/// Anything that can go out on stdout, serialized as one framed message.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum Outgoing {
    Response(Response),
    Notification(Notification),
}

/// Read one framed message from `r`. `Ok(None)` on clean EOF.
pub async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> std::io::Result<Option<Incoming>> {
    // Parse headers.
    let mut header = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        let n = r.read(&mut byte).await?;
        if n == 0 {
            return if header.is_empty() {
                Ok(None)
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "EOF mid-header",
                ))
            };
        }
        header.push(byte[0]);
        if header.ends_with(b"\r\n\r\n") {
            break;
        }
        if header.len() > 8192 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "header too large",
            ));
        }
    }
    let header = String::from_utf8_lossy(&header);
    let mut len = None;
    for line in header.split("\r\n") {
        if let Some(v) = line.strip_prefix("Content-Length:") {
            len = v.trim().parse::<usize>().ok();
        }
    }
    let len = len
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "no Content-Length"))?;

    let mut body = vec![0u8; len];
    r.read_exact(&mut body).await?;
    let incoming = serde_json::from_slice::<Incoming>(&body).map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("bad JSON body: {e}"),
        )
    })?;
    Ok(Some(incoming))
}

/// Write one framed message to `w`.
pub async fn write_frame<W: AsyncWrite + Unpin>(w: &mut W, msg: &Outgoing) -> std::io::Result<()> {
    let body = serde_json::to_vec(msg)?;
    w.write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
        .await?;
    w.write_all(&body).await?;
    w.flush().await
}
