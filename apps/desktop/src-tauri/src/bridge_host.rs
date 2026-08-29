//! Tauri host ⇄ `valyria-bridge`.
//!
//! The renderer never opens a socket. It calls these commands, and receives
//! the Core event stream as batched Tauri events:
//!
//!   `core://event-batch`  → `EventBatch` (coalesced, carries first/last seq)
//!   `core://reconnected`  → u64 (cursor the subscription resumed from)
//!   `core://closed`       → u64 (last seq before the stream ended)
//!
//! One `valyria serve` daemon per open workspace; it outlives this process
//! (`kill_daemon_on_drop = false`).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use valyria_bridge::protocol::TaskListResponse;
use valyria_bridge::{
  spawn_or_adopt, BridgeError, CoreBinary, CoreClient, EventPump, PumpMessage, Session,
  SupervisorConfig,
};

/// Protocol version this build negotiates against (core.lock.json).
const EXPECTED_PROTOCOL: &str = "1.0.0";

#[derive(Default)]
pub struct BridgeState(Arc<Mutex<Option<Live>>>);

struct Live {
  session: Session,
  client: CoreClient,
  pump_task: tokio::task::JoinHandle<()>,
}

impl Drop for Live {
  fn drop(&mut self) {
    self.pump_task.abort();
  }
}

#[derive(serde::Serialize)]
pub struct SessionInfo {
  pub workspace_root: String,
  pub workspace_id: String,
  pub socket_path: String,
  pub origin: &'static str,
  pub protocol_version: String,
  pub runtime_version: String,
  pub capabilities: Vec<String>,
}

impl SessionInfo {
  fn of(root: String, s: &Session) -> Self {
    Self {
      workspace_root: root,
      workspace_id: s.id.as_str().to_string(),
      socket_path: s.socket_path.display().to_string(),
      origin: if s.is_adopted() { "adopted" } else { "spawned" },
      protocol_version: s.negotiated.protocol_version.clone(),
      runtime_version: s.negotiated.runtime_version.clone(),
      capabilities: s.negotiated.capabilities.clone(),
    }
  }
}

fn err_str(e: BridgeError) -> String {
  format!("[{}] {e}", e.code())
}

/// `$VALYRIA_BIN`, then the bundled sidecar next to our own executable
/// (docs/INTEGRATION.md D-INT-1).
fn resolve_core_binary() -> Result<CoreBinary, String> {
  let sidecar = std::env::current_exe().ok().and_then(|exe| {
    let name = if cfg!(windows) {
      "valyria.exe"
    } else {
      "valyria"
    };
    let cand = exe.parent()?.join(name);
    cand.exists().then_some(cand)
  });
  CoreBinary::resolve(None, sidecar).map_err(err_str)
}

#[tauri::command]
pub async fn session_open(
  app: AppHandle,
  state: State<'_, BridgeState>,
  workspace_root: String,
) -> Result<SessionInfo, String> {
  let core = resolve_core_binary()?;
  let cfg = SupervisorConfig {
    workspace_root: PathBuf::from(&workspace_root),
    core_binary: core,
    expected_protocol: EXPECTED_PROTOCOL.to_string(),
    valyria_home: None,
    startup_timeout: Duration::from_secs(20),
    kill_daemon_on_drop: false,
  };

  let session = spawn_or_adopt(cfg).await.map_err(err_str)?;
  let client = CoreClient::new(session.socket_path.clone());
  let info = SessionInfo::of(workspace_root, &session);

  // Fan the workspace event stream out to the renderer.
  let mut pump = EventPump::start(session.socket_path.clone(), 0);
  let app = app.clone();
  let pump_task = tokio::spawn(async move {
    while let Some(msg) = pump.recv().await {
      let _ = match msg {
        PumpMessage::Batch(b) => app.emit("core://event-batch", b),
        PumpMessage::Reconnected { from } => app.emit("core://reconnected", from),
        PumpMessage::Closed { last_seq } => {
          let _ = app.emit("core://closed", last_seq);
          break;
        }
      };
    }
  });

  let mut slot = state.0.lock().await;
  if let Some(prev) = slot.take() {
    drop(prev); // aborts its pump; its daemon keeps running
  }
  *slot = Some(Live {
    session,
    client,
    pump_task,
  });
  Ok(info)
}

async fn with_client<T, F, Fut>(state: &BridgeState, f: F) -> Result<T, String>
where
  F: FnOnce(CoreClient) -> Fut,
  Fut: std::future::Future<Output = Result<T, BridgeError>>,
{
  let client = {
    let guard = state.0.lock().await;
    guard
      .as_ref()
      .map(|l| l.client.clone())
      .ok_or_else(|| "no session is open".to_string())?
  };
  f(client).await.map_err(err_str)
}

#[tauri::command]
pub async fn task_create(
  state: State<'_, BridgeState>,
  objective: String,
) -> Result<String, String> {
  with_client(&state, |c| async move { c.task_create(objective).await }).await
}

#[tauri::command]
pub async fn task_list(state: State<'_, BridgeState>) -> Result<TaskListResponse, String> {
  with_client(&state, |c| async move { c.task_list().await }).await
}

#[tauri::command]
pub async fn task_pause(state: State<'_, BridgeState>, task_id: String) -> Result<(), String> {
  with_client(&state, |c| async move { c.task_pause(&task_id).await }).await
}

#[tauri::command]
pub async fn task_resume(state: State<'_, BridgeState>, task_id: String) -> Result<(), String> {
  with_client(&state, |c| async move { c.task_resume(&task_id).await }).await
}

#[tauri::command]
pub async fn task_cancel(state: State<'_, BridgeState>, task_id: String) -> Result<(), String> {
  with_client(&state, |c| async move { c.task_cancel(&task_id).await }).await
}

#[tauri::command]
pub async fn permission_resolve(
  state: State<'_, BridgeState>,
  task_id: String,
  approve: bool,
) -> Result<(), String> {
  with_client(&state, |c| async move {
    c.permission_resolve(&task_id, approve).await
  })
  .await
}

#[tauri::command]
pub async fn session_status(state: State<'_, BridgeState>) -> Result<Option<SessionInfo>, String> {
  let guard = state.0.lock().await;
  Ok(
    guard
      .as_ref()
      .map(|l| SessionInfo::of(l.session.socket_path.display().to_string(), &l.session)),
  )
}
