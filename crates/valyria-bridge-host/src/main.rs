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

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{stdin, stdout, BufReader};
use tokio::sync::{mpsc, Mutex};
use valyria_bridge::{
    config_path, spawn_or_adopt, write_key, BridgeError, ConfigScope, CoreBinary, CoreClient,
    EventPump, PumpMessage, Session, SupervisorConfig,
};

use rpc::{read_frame, write_frame, Incoming, Notification, Outgoing, Response, RpcError};

/// Protocol major this build negotiates against (core.lock.json → 1.10.0).
const EXPECTED_PROTOCOL: &str = "1.10.0";

/// Bounded backoff for re-establishing a daemon that dropped its stream.
const RESTART_BACKOFF_MS: [u64; 6] = [200, 500, 1000, 2000, 4000, 8000];

type OutTx = mpsc::UnboundedSender<Outgoing>;

struct Live {
    session: Session,
    client: CoreClient,
    /// The supervise task: forwards the event stream and, on a hard close,
    /// restarts the daemon and resumes from `last_seq`. Aborted when this
    /// `Live` is dropped (a new `session/open`, or `session/close`).
    supervise_task: tokio::task::JoinHandle<()>,
    /// Highest `last_seq` delivered so far — the resume cursor after a restart.
    last_seq: Arc<AtomicU64>,
    /// The display root passed to `session/open` (`Session` doesn't retain it);
    /// also what the supervise task rebuilds from on a restart.
    root: String,
}

impl Drop for Live {
    fn drop(&mut self) {
        self.supervise_task.abort();
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

    emit_state(&out_tx, "starting", None);

    let mut reader = BufReader::new(stdin());
    loop {
        match read_frame(&mut reader).await {
            Ok(Some(req)) => {
                // Sequential dispatch keeps ordering simple and matches the old
                // one-at-a-time Tauri command model. A slow Core call cannot
                // block the event pump — that runs in its own task.
                handle(&host, &out_tx, req).await;
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

async fn handle(host: &Arc<Host>, out_tx: &OutTx, req: Incoming) {
    let Some(id) = req.id.clone() else {
        tracing::debug!("ignoring notification: {}", req.method);
        return;
    };
    let method = req.method.clone();
    let result = dispatch(host, out_tx, &req).await;
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
fn str_array(req: &Incoming, key: &str) -> Vec<String> {
    param(req, key)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
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

async fn dispatch(host: &Arc<Host>, out_tx: &OutTx, req: &Incoming) -> Result<Value, RpcError> {
    match req.method.as_str() {
        // ---- session / supervisor -----------------------------------
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
                Some(live) => to_value(SessionInfo::of(&live.root, &live.session)),
            }
        }
        "session/close" => {
            *host.live.lock().await = None;
            emit_state(out_tx, "starting", Some("session closed"));
            Ok(Value::Null)
        }
        "session/restart" => {
            let mode = str_param(req, "permissionMode")?;
            session_restart(host, out_tx.clone(), mode).await
        }
        "about/info" => about_info(host).await,

        // ---- tasks ------------------------------------------------
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

        // ---- approvals ------------------------------------------
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
                "deny"
            } else if scope == "task" {
                "allow_task"
            } else {
                "allow_once"
            };
            with_client(host, |c| async move {
                c.permission_resolve_scoped(&t, None, decision).await
            })
            .await
        }

        // ---- config / doctor ----------------------------------
        "config/show" => with_client(host, |c| async move { c.config_show().await }).await,
        "config/set" => {
            let key = str_param(req, "key")?;
            let value = str_param(req, "value")?;
            let scope = opt_str(req, "scope").unwrap_or_else(|| "repo".to_string());
            with_client(
                host,
                |c| async move { c.config_set(&key, &value, &scope).await },
            )
            .await
        }
        "config/write" => {
            let key = str_param(req, "key")?;
            let value = str_param(req, "value")?;
            let scope = str_param(req, "scope")?; // "workspace" | "user"
            config_write(host, scope, key, value).await
        }
        "doctor/run" => with_client(host, |c| async move { c.doctor_run().await }).await,

        // ---- workspace / index / search -----------------------
        "workspace/status" => {
            with_client(host, |c| async move { c.workspace_status().await }).await
        }
        "search/query" => {
            let q = str_param(req, "query")?;
            let modes = str_array(req, "modes");
            let anchors = str_array(req, "anchors");
            let limit = param(req, "limit")
                .and_then(Value::as_u64)
                .map(|n| n as u32);
            with_client(host, |c| async move {
                c.search_query(q, modes, anchors, limit).await
            })
            .await
        }
        "index/status" => with_client(host, |c| async move { c.index_status().await }).await,
        "index/build" => with_client(host, |c| async move { c.index_build().await }).await,

        // ---- git (Core surface, G3) --------------------------
        "git/status" => with_client(host, |c| async move { c.git_status().await }).await,
        "git/diff" => {
            let path = opt_str(req, "path");
            let staged = param(req, "staged")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            with_client(host, |c| async move { c.git_diff(path, staged).await }).await
        }
        "git/log" => {
            let limit = param(req, "limit")
                .and_then(Value::as_u64)
                .map(|n| n as u32);
            with_client(host, |c| async move { c.git_log(limit).await }).await
        }
        "git/branches" => with_client(host, |c| async move { c.git_branches().await }).await,

        // ---- models / hardware ------------------------------
        "model/list" => with_client(host, |c| async move { c.model_list().await }).await,
        "model/recommend" => {
            let role = opt_str(req, "role").unwrap_or_else(|| "code".to_string());
            with_client(host, |c| async move { c.model_recommend(&role).await }).await
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
            let role = opt_str(req, "role").unwrap_or_else(|| "code".to_string());
            with_client(host, |c| async move { c.model_activate(&id, &role).await }).await
        }
        "model/inspect" => {
            let id = str_param(req, "id")?;
            with_client(host, |c| async move { c.model_inspect(&id).await }).await
        }
        "hardware/probe" => with_client(host, |c| async move { c.hardware_probe().await }).await,

        // ---- ledger (G8) -----------------------------------
        "ledger/changes" => {
            let t = str_param(req, "taskId")?;
            with_client(host, |c| async move { c.ledger_changes(&t).await }).await
        }

        other => Err(RpcError::method_not_found(other)),
    }
}

// --- session lifecycle ----------------------------------------------------

fn build_supervisor_config(
    root: &str,
    permission_mode: Option<String>,
) -> Result<SupervisorConfig, RpcError> {
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
    let mut config = SupervisorConfig::new(root, core_binary);
    config.expected_protocol = EXPECTED_PROTOCOL.to_string();
    config.permission_mode = permission_mode;
    Ok(config)
}

/// Map a supervisor failure to a connection state: a protocol-major mismatch is
/// `incompatible` (nothing to retry), everything else is `failed`.
fn state_for(err: &BridgeError) -> &'static str {
    if err.code() == "bridge.protocol.mismatch" {
        "incompatible"
    } else {
        "failed"
    }
}

async fn session_open(
    host: &Arc<Host>,
    out_tx: OutTx,
    root: String,
    permission_mode: Option<String>,
    applied_through: u64,
) -> Result<Value, RpcError> {
    // Windows tier 3 (§39 / CORE-INTERFACE G9): Core's daemon is a UnixListener
    // and there is no Windows sandbox. The build installs and reports versions
    // (About surface), but an agent session is refused with the specific reason.
    if cfg!(windows) {
        emit_state(&out_tx, "incompatible", Some("Windows tier 3"));
        return Err(RpcError::bridge(
            "bridge.platform.windows_tier3",
            "Windows is tier 3 — Core's daemon transport and sandbox are not available yet \
             (CORE-INTERFACE G9). Versions and compatibility are shown; agent sessions are disabled.",
        ));
    }

    emit_state(&out_tx, "connecting", None);

    let config = build_supervisor_config(&root, permission_mode.clone())?;
    let session = spawn_or_adopt(config).await.map_err(|e| {
        emit_state(&out_tx, state_for(&e), Some(&e.to_string()));
        map_err(e)
    })?;

    let client = CoreClient::with_token(session.socket_path.clone(), session.auth_token.clone());
    let last_seq = Arc::new(AtomicU64::new(applied_through));

    let pump = EventPump::start(
        session.socket_path.clone(),
        session.auth_token.clone(),
        applied_through,
    );

    let supervise_task = tokio::spawn(supervise(
        Arc::clone(host),
        out_tx.clone(),
        root.clone(),
        permission_mode.clone(),
        pump,
        Arc::clone(&last_seq),
    ));

    let info = SessionInfo::of(&root, &session);
    *host.live.lock().await = Some(Live {
        session,
        client,
        supervise_task,
        last_seq,
        root: root.clone(),
    });

    emit_state(&out_tx, "ready", None);
    to_value(info)
}

/// Restart the workspace daemon under a new autonomy level (§25 / G1). Only
/// valid when this process spawned the daemon — an adopted daemon is not ours
/// to stop.
async fn session_restart(host: &Arc<Host>, out_tx: OutTx, mode: String) -> Result<Value, RpcError> {
    let (root, applied_through) = {
        let mut guard = host.live.lock().await;
        let live = guard
            .as_ref()
            .ok_or_else(|| RpcError::bridge("bridge.no_session", "no session is open"))?;
        if !live.session.is_owned() {
            return Err(RpcError::bridge(
                "bridge.autonomy.not_owned",
                "Core for this workspace was started by another process; stop it there to change autonomy.",
            ));
        }
        let root = live.root.clone();
        let applied_through = live.last_seq.load(Ordering::SeqCst);
        // Drop the current session: aborts its supervise task and, because we
        // own the daemon, stops it too.
        if let Some(mut prev) = guard.take() {
            prev.session.shutdown_daemon().await.map_err(map_err)?;
        }
        (root, applied_through)
    };

    session_open(host, out_tx, root, Some(mode), applied_through).await
}

async fn about_info(host: &Host) -> Result<Value, RpcError> {
    let guard = host.live.lock().await;
    let (session, verdict) = match guard.as_ref() {
        None => (None, "no session"),
        Some(live) => {
            let got = &live.session.negotiated.protocol_version;
            let verdict = if major(got) == major(EXPECTED_PROTOCOL) {
                "compatible"
            } else {
                "incompatible"
            };
            (Some(SessionInfo::of(&live.root, &live.session)), verdict)
        }
    };
    Ok(json!({
        "bridgeHost": env!("CARGO_PKG_VERSION"),
        "expectedProtocol": EXPECTED_PROTOCOL,
        "compatibility": verdict,
        "session": session.map(to_value).transpose()?,
    }))
}

fn major(v: &str) -> &str {
    v.split('.').next().unwrap_or(v)
}

/// D13 write-then-verify (CORE-INTERFACE G6): edit Core's own `config.toml`,
/// then return a fresh `config_show` so the caller renders the effective value
/// with its origin — not the optimistic write.
async fn config_write(
    host: &Host,
    scope: String,
    key: String,
    value: String,
) -> Result<Value, RpcError> {
    let scope = ConfigScope::parse(&scope).map_err(map_err)?;
    let client = {
        let guard = host.live.lock().await;
        guard
            .as_ref()
            .ok_or_else(|| RpcError::bridge("bridge.no_session", "no session is open"))?
            .client
            .clone()
    };

    let data_dir = match scope {
        ConfigScope::Workspace => Some(client.workspace_status().await.map_err(map_err)?.data_dir),
        ConfigScope::User => None,
    };
    let path =
        config_path(scope, data_dir.as_deref().map(std::path::Path::new)).map_err(map_err)?;

    tokio::task::spawn_blocking(move || write_key(&path, &key, &value))
        .await
        .map_err(|e| RpcError::new(-32603, format!("join: {e}")))?
        .map_err(map_err)?;

    client
        .config_show()
        .await
        .map_err(map_err)
        .and_then(to_value)
}

// --- the supervise task -------------------------------------------------

async fn supervise(
    host: Arc<Host>,
    out_tx: OutTx,
    root: String,
    permission_mode: Option<String>,
    mut pump: EventPump,
    last_seq: Arc<AtomicU64>,
) {
    loop {
        match pump.recv().await {
            Some(PumpMessage::Batch(b)) => {
                last_seq.fetch_max(b.last_seq, Ordering::SeqCst);
                forward_batch(&out_tx, b);
            }
            Some(PumpMessage::Reconnected { from }) => {
                send_notif(&out_tx, "core/reconnected", json!({ "resumeFrom": from }));
                emit_state(&out_tx, "ready", None);
            }
            Some(PumpMessage::Closed { last_seq: ls }) => {
                last_seq.fetch_max(ls, Ordering::SeqCst);
                send_notif(&out_tx, "core/closed", json!({ "lastSeq": ls }));
                match restart(&host, &out_tx, &root, &permission_mode, &last_seq).await {
                    Some(new_pump) => pump = new_pump,
                    None => {
                        emit_state(
                            &out_tx,
                            "failed",
                            Some("Core stream ended and could not be re-established"),
                        );
                        return;
                    }
                }
            }
            None => {
                // The pump was dropped (session replaced/closed) — stop quietly.
                return;
            }
        }
    }
}

fn forward_batch(out_tx: &OutTx, b: valyria_bridge::EventBatch) {
    // Events go out as their raw wire shape (`seq`, `task_id`, `ts_ms`, `kind`,
    // `payload`) — that is exactly what `@valyria/state`'s decoder expects
    // (`wireEventEnvelope`). Only the batch envelope is camelCased.
    let events: Vec<Value> = b
        .events
        .iter()
        .map(|e| serde_json::to_value(e).unwrap_or(Value::Null))
        .collect();
    send_notif(
        out_tx,
        "core/eventBatch",
        json!({
            "firstSeq": b.first_seq,
            "lastSeq": b.last_seq,
            "gapBefore": b.gap_before,
            "events": events,
        }),
    );
}

/// The daemon dropped its stream and could not self-heal. Re-`spawn_or_adopt`
/// with bounded backoff, swap the new session/client into `host.live` in place
/// (so this task is not aborting itself), and return a fresh pump resuming from
/// `last_seq`. `None` when every attempt failed or the session was closed
/// meanwhile.
async fn restart(
    host: &Arc<Host>,
    out_tx: &OutTx,
    root: &str,
    permission_mode: &Option<String>,
    last_seq: &Arc<AtomicU64>,
) -> Option<EventPump> {
    for (i, backoff) in RESTART_BACKOFF_MS.iter().enumerate() {
        emit_state(
            out_tx,
            "reconnecting",
            Some(&format!("attempt {}/{}", i + 1, RESTART_BACKOFF_MS.len())),
        );
        tokio::time::sleep(Duration::from_millis(*backoff)).await;

        let config = match build_supervisor_config(root, permission_mode.clone()) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let session = match spawn_or_adopt(config).await {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("restart attempt {} failed: {e}", i + 1);
                continue;
            }
        };
        let client =
            CoreClient::with_token(session.socket_path.clone(), session.auth_token.clone());
        let resume_from = last_seq.load(Ordering::SeqCst);
        let pump = EventPump::start(
            session.socket_path.clone(),
            session.auth_token.clone(),
            resume_from,
        );

        {
            let mut guard = host.live.lock().await;
            match guard.as_mut() {
                Some(live) => {
                    live.session = session;
                    live.client = client;
                }
                None => return None, // session/close won the race
            }
        }

        emit_state(out_tx, "ready", None);
        send_notif(
            out_tx,
            "core/log",
            json!({
                "level": "info",
                "message": format!(
                    "Core restarted; task state reloaded from the journal, event stream resumed from seq {resume_from}"
                )
            }),
        );
        return Some(pump);
    }
    None
}

// --- notification helpers ---------------------------------------------

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
