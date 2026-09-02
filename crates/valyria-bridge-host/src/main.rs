//! `valyria-bridge-host` — a JSON-RPC 2.0 (stdio) front end for `valyria-bridge`.
//!
//! Spawned by the Valyria VS Code extension. This is exactly the role that
//! `apps/desktop/src-tauri/src/bridge_host.rs` played for the Tauri renderer:
//! one process per workspace, owning the Core socket, the session supervisor and
//! the event pump, and exposing them as RPC methods + stdout notifications.
//!
//! Layering (PLAN.md D2): depends on `valyria-bridge` only. `xtask
//! check-layering` treats it like the bridge.

#![forbid(unsafe_code)]

mod rpc;

use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{stdin, stdout, BufReader};
use tokio::sync::{mpsc, Mutex};
use valyria_bridge::{
    spawn_or_adopt, BridgeError, CoreBinary, CoreClient, EventPump, PumpMessage, Session,
    SupervisorConfig,
};

use rpc::{read_frame, write_frame, Incoming, Notification, Outgoing, Response, RpcError};

/// Protocol major this build negotiates against (core.lock.json → 1.10.0).
const EXPECTED_PROTOCOL: &str = "1.10.0";

type OutTx = mpsc::UnboundedSender<Outgoing>;

struct Live {
    session: Session,
    client: CoreClient,
    pump_task: tokio::task::JoinHandle<()>,
    /// The display root passed to `session/open` — `Session` doesn't retain it.
    root: String,
}

impl Drop for Live {
    fn drop(&mut self) {
        self.pump_task.abort();
    }
}

#[derive(Default)]
struct Host {
    live: Mutex<Option<Live>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    workspace_root: String,
    workspace_id: String,
    socket_path: String,
    origin: &'static str,
    protocol_version: String,
    runtime_version: String,
    capabilities: Vec<String>,
    permission_mode: Option<String>,
    owns_daemon: bool,
    authenticated: bool,
}

impl SessionInfo {
    fn of(root: &str, s: &Session) -> Self {
        Self {
            workspace_root: root.to_string(),
            workspace_id: s.id.as_str().to_string(),
            socket_path: s.socket_path.display().to_string(),
            origin: if s.is_adopted() { "adopted" } else { "spawned" },
            protocol_version: s.negotiated.protocol_version.clone(),
            runtime_version: s.negotiated.runtime_version.clone(),
            capabilities: s.negotiated.capabilities.clone(),
            permission_mode: s.permission_mode.clone(),
            owns_daemon: s.is_owned(),
            authenticated: s.auth_token.is_some(),
        }
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("VALYRIA_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Outgoing>();
    let host = Arc::new(Host::default());

    // Single stdout writer — the only thing that touches stdout.
    let writer = tokio::spawn(async move {
        let mut w = stdout();
        while let Some(msg) = out_rx.recv().await {
            if write_frame(&mut w, &msg).await.is_err() {
                break;
            }
        }
    });

    let mut reader = BufReader::new(stdin());
    loop {
        match read_frame(&mut reader).await {
            Ok(Some(req)) => {
                let host = Arc::clone(&host);
                let out_tx = out_tx.clone();
                // Sequential dispatch keeps ordering simple and matches the old
                // one-at-a-time Tauri command model. A slow Core call cannot
                // block the event pump — that runs in its own task.
                handle(host, out_tx, req).await;
            }
            Ok(None) => {
                tracing::info!("stdin closed; exiting");
                break;
            }
            Err(e) => {
                tracing::error!("frame read error: {e}");
                break;
            }
        }
    }

    drop(out_tx);
    let _ = writer.await;
}

async fn handle(host: Arc<Host>, out_tx: OutTx, req: Incoming) {
    let Some(id) = req.id.clone() else {
        tracing::debug!("ignoring notification: {}", req.method);
        return;
    };
    let method = req.method.clone();
    let result = dispatch(&host, &out_tx, &req).await;
    let msg = match result {
        Ok(v) => Response::ok(id, v),
        Err(e) => {
            tracing::warn!("{method} -> error {}: {}", e.code, e.message);
            Response::err(id, e)
        }
    };
    let _ = out_tx.send(Outgoing::Response(msg));
}

fn param<'a>(req: &'a Incoming, key: &str) -> Option<&'a Value> {
    req.params.get(key)
}
fn str_param(req: &Incoming, key: &str) -> Result<String, RpcError> {
    param(req, key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| RpcError::invalid_params(format!("missing string param `{key}`")))
}
fn opt_str(req: &Incoming, key: &str) -> Option<String> {
    param(req, key).and_then(Value::as_str).map(str::to_string)
}

fn map_err(e: BridgeError) -> RpcError {
    RpcError::bridge(e.code(), e.to_string())
}
fn to_value<T: Serialize>(v: T) -> Result<Value, RpcError> {
    serde_json::to_value(v).map_err(|e| RpcError::new(-32603, format!("serialize: {e}")))
}

async fn with_client<F, Fut, T>(host: &Host, f: F) -> Result<Value, RpcError>
where
    F: FnOnce(CoreClient) -> Fut,
    Fut: std::future::Future<Output = Result<T, BridgeError>>,
    T: Serialize,
{
    let client = {
        let guard = host.live.lock().await;
        guard
            .as_ref()
            .ok_or_else(|| RpcError::bridge("bridge.no_session", "no session is open"))?
            .client
            .clone()
    };
    f(client).await.map_err(map_err).and_then(to_value)
}

async fn dispatch(host: &Host, out_tx: &OutTx, req: &Incoming) -> Result<Value, RpcError> {
    match req.method.as_str() {
        // ---- session / supervisor -------------------------------------
        "session/open" => {
            let root = str_param(req, "workspaceRoot")?;
            let mode = opt_str(req, "permissionMode");
            let applied_through = param(req, "appliedThrough")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            session_open(host, out_tx.clone(), root, mode, applied_through).await
        }
        "session/status" => {
            let guard = host.live.lock().await;
            match guard.as_ref() {
                None => Ok(Value::Null),
                Some(live) => to_value(SessionInfo::of(&live.session_root(), &live.session)),
            }
        }
        "session/close" => {
            let mut guard = host.live.lock().await;
            *guard = None;
            Ok(Value::Null)
        }
        "session/restart" => Err(RpcError::method_not_found(
            "session/restart (autonomy restart — port from bridge_host.rs::session_restart)",
        )),
        "about/info" => {
            let guard = host.live.lock().await;
            let s = guard
                .as_ref()
                .map(|l| SessionInfo::of(&l.session_root(), &l.session));
            Ok(json!({
                "bridgeHost": env!("CARGO_PKG_VERSION"),
                "expectedProtocol": EXPECTED_PROTOCOL,
                "session": s.map(to_value).transpose()?,
            }))
        }

        // ---- tasks --------------------------------------------------
        "task/create" => {
            let objective = str_param(req, "objective")?;
            let mode = opt_str(req, "mode");
            with_client(host, |c| async move {
                c.task_create_with_mode(objective, mode).await
            })
            .await
            .map(|v| json!({ "taskId": v }))
        }
        "task/list" => with_client(host, |c| async move { c.task_list().await }).await,
        "task/status" => {
            let t = str_param(req, "taskId")?;
            with_client(host, |c| async move { c.task_status(&t).await }).await
        }
        "task/plan" => {
            let t = str_param(req, "taskId")?;
            with_client(host, |c| async move { c.task_plan(&t).await }).await
        }
        "task/report" => {
            let t = str_param(req, "taskId")?;
            with_client(host, |c| async move { c.task_report(&t).await }).await
        }
        "task/rollback" => {
            let t = str_param(req, "taskId")?;
            let cp = str_param(req, "checkpointId")?;
            with_client(host, |c| async move { c.task_rollback(&t, &cp).await }).await
        }
        "task/pause" => {
            let t = str_param(req, "taskId")?;
            with_client(host, |c| async move { c.task_pause(&t).await }).await
        }
        "task/resume" => {
            let t = str_param(req, "taskId")?;
            with_client(host, |c| async move { c.task_resume(&t).await }).await
        }
        "task/cancel" => {
            let t = str_param(req, "taskId")?;
            with_client(host, |c| async move { c.task_cancel(&t).await }).await
        }

        // ---- approvals --------------------------------------------
        "permission/resolve" => {
            let t = str_param(req, "taskId")?;
            let allow = param(req, "allow")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            with_client(
                host,
                |c| async move { c.permission_resolve(&t, allow).await },
            )
            .await
        }
        "permission/resolveScoped" => {
            let t = str_param(req, "taskId")?;
            let scope = str_param(req, "scope")?; // "once" | "task"
            let allow = param(req, "allow")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let decision = if !allow {
                "deny".to_string()
            } else if scope == "task" {
                "allow_task".to_string()
            } else {
                "allow_once".to_string()
            };
            with_client(host, |c| async move {
                c.permission_resolve_scoped(&t, None, &decision).await
            })
            .await
        }

        // ---- config / doctor -------------------------------------
        "config/show" => with_client(host, |c| async move { c.config_show().await }).await,
        "config/set" => {
            let key = str_param(req, "key")?;
            let value = str_param(req, "value")?;
            with_client(
                host,
                |c| async move { c.config_set(&key, &value, "repo").await },
            )
            .await
        }
        "doctor/run" => with_client(host, |c| async move { c.doctor_run().await }).await,

        // ---- workspace / index / search -------------------------
        "workspace/status" => {
            with_client(host, |c| async move { c.workspace_status().await }).await
        }
        "search/query" => {
            let q = str_param(req, "query")?;
            let modes = param(req, "modes")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            with_client(host, |c| async move {
                c.search_query(q, modes, Vec::new(), None).await
            })
            .await
        }
        "index/status" => with_client(host, |c| async move { c.index_status().await }).await,
        "index/build" => with_client(host, |c| async move { c.index_build().await }).await,

        // ---- git (Core surface, G3) ----------------------------
        "git/status" => with_client(host, |c| async move { c.git_status().await }).await,
        "git/diff" => {
            let path = opt_str(req, "path");
            with_client(host, |c| async move { c.git_diff(path, false).await }).await
        }
        "git/log" => {
            let limit = param(req, "limit")
                .and_then(Value::as_u64)
                .map(|n| n as u32);
            with_client(host, |c| async move { c.git_log(limit).await }).await
        }
        "git/branches" => with_client(host, |c| async move { c.git_branches().await }).await,

        // ---- models / hardware --------------------------------
        "model/list" => with_client(host, |c| async move { c.model_list().await }).await,
        "model/recommend" => {
            with_client(host, |c| async move { c.model_recommend("code").await }).await
        }
        "model/install" => {
            let id = str_param(req, "id")?;
            with_client(host, |c| async move { c.model_install(&id).await }).await
        }
        "model/remove" => {
            let id = str_param(req, "id")?;
            with_client(host, |c| async move { c.model_remove(&id).await }).await
        }
        "model/activate" => {
            let id = str_param(req, "id")?;
            with_client(host, |c| async move { c.model_activate(&id, "code").await }).await
        }
        "model/inspect" => {
            let id = str_param(req, "id")?;
            with_client(host, |c| async move { c.model_inspect(&id).await }).await
        }
        "hardware/probe" => with_client(host, |c| async move { c.hardware_probe().await }).await,

        // ---- ledger (G8) -------------------------------------
        "ledger/changes" => {
            let t = str_param(req, "taskId")?;
            with_client(host, |c| async move { c.ledger_changes(&t).await }).await
        }

        // ---- config/write (TOML) — port from bridge_host.rs::config_write
        "config/write" => Err(RpcError::method_not_found(
            "config/write (TOML write-then-verify — port from bridge_host.rs::config_write)",
        )),

        other => Err(RpcError::method_not_found(other)),
    }
}

impl Live {
    fn session_root(&self) -> String {
        self.root.clone()
    }
}

// --- session/open ------------------------------------------------------------

async fn session_open(
    host: &Host,
    out_tx: OutTx,
    root: String,
    permission_mode: Option<String>,
    applied_through: u64,
) -> Result<Value, RpcError> {
    // $VALYRIA_BIN, else a sidecar next to our own executable.
    let sidecar = std::env::current_exe().ok().and_then(|exe| {
        let name = if cfg!(windows) {
            "valyria.exe"
        } else {
            "valyria"
        };
        let cand = exe.parent()?.join(name);
        cand.exists().then_some(cand)
    });
    let core_binary: CoreBinary = CoreBinary::resolve(None, sidecar).map_err(map_err)?;

    let mut config = SupervisorConfig::new(&root, core_binary);
    config.expected_protocol = EXPECTED_PROTOCOL.to_string();
    config.permission_mode = permission_mode;

    emit_state(&out_tx, "connecting", None);

    let session = spawn_or_adopt(config).await.map_err(|e| {
        emit_state(&out_tx, "failed", Some(&e.to_string()));
        map_err(e)
    })?;

    let client = CoreClient::with_token(session.socket_path.clone(), session.auth_token.clone());

    // Event pump → notifications. Its own task; never blocks a Core call.
    let mut pump = EventPump::start(
        session.socket_path.clone(),
        session.auth_token.clone(),
        applied_through,
    );
    let pump_out = out_tx.clone();
    let pump_task = tokio::spawn(async move {
        while let Some(msg) = pump.recv().await {
            match msg {
                PumpMessage::Batch(b) => {
                    let events: Vec<Value> = b
                        .events
                        .into_iter()
                        .map(|e| {
                            json!({
                                "seq": e.seq,
                                "taskId": e.task_id,
                                "tsMs": e.ts_ms as u64,
                                "kind": e.kind,
                                "payload": e.payload,
                            })
                        })
                        .collect();
                    send_notif(
                        &pump_out,
                        "core/eventBatch",
                        json!({
                            "firstSeq": b.first_seq,
                            "lastSeq": b.last_seq,
                            "gapBefore": b.gap_before,
                            "events": events,
                        }),
                    );
                }
                PumpMessage::Reconnected { from } => {
                    send_notif(&pump_out, "core/reconnected", json!({ "resumeFrom": from }));
                }
                PumpMessage::Closed { last_seq } => {
                    send_notif(&pump_out, "core/closed", json!({ "lastSeq": last_seq }));
                    emit_state(&pump_out, "degraded", Some("Core stream closed"));
                }
            }
        }
    });

    let info = SessionInfo::of(&root, &session);
    let live = Live {
        session,
        client,
        pump_task,
        root: root.clone(),
    };
    *host.live.lock().await = Some(live);

    emit_state(&out_tx, "ready", None);
    to_value(info)
}

fn send_notif(out_tx: &OutTx, method: &'static str, params: Value) {
    let _ = out_tx.send(Outgoing::Notification(Notification::new(method, params)));
}
fn emit_state(out_tx: &OutTx, state: &str, detail: Option<&str>) {
    let mut p = json!({ "state": state });
    if let Some(d) = detail {
        p["detail"] = Value::String(d.to_string());
    }
    send_notif(out_tx, "core/connectionState", p);
}
