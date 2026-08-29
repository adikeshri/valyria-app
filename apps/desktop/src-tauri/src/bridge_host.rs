//! Tauri host ⇄ `valyria-bridge`.
//!
//! The renderer never opens a socket. It calls these commands, and receives
//! the Core event stream as batched Tauri events:
//!
//!   `core://event-batch`  → `EventBatch` (coalesced, carries first/last seq)
//!   `core://reconnected`  → u64 (cursor the subscription resumed from)
//!   `core://closed`       → u64 (last seq before the stream ended)
//!   `core://fs-changed`   → Vec<String> (workspace paths that changed)
//!   `core://pty-output`   → String (a chunk of human-terminal output)
//!   `core://pty-exit`     → Option<i32> (the human shell ended)
//!
//! One `valyria serve` daemon per open workspace; it outlives this process
//! (`kill_daemon_on_drop = false`). The PTY (`core://pty-*`) is a local shell
//! the human types into — never a channel for agent commands (D7).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use valyria_bridge::protocol::{
  ConfigShowResponse, DoctorRunResponse, ModelListResponse, PlanGetResponse, TaskListResponse,
  TaskReportResponse, TaskRollbackResponse, TaskStatusResponse, WorkspaceStatusResponse,
};
use valyria_bridge::{
  config_path, spawn_or_adopt, write_key, BridgeError, ConfigScope, CoreBinary, CoreClient,
  DirEntry, EventPump, FileView, GitCommit, GitEntry, GitRepo, PtyEvent, PtySession, PumpMessage,
  Session, SupervisorConfig, WorkspaceFs, WorkspaceWatcher,
};

/// Protocol version this build negotiates against (core.lock.json).
const EXPECTED_PROTOCOL: &str = "1.0.0";

#[derive(Default)]
pub struct BridgeState(Arc<Mutex<Option<Live>>>);

struct Live {
  session: Session,
  client: CoreClient,
  pump_task: tokio::task::JoinHandle<()>,
  /// Local-read fallbacks, strictly scoped to the authorized root
  /// (CORE-INTERFACE §3). Deleted per-surface as Core exposes G3.
  fs: WorkspaceFs,
  git: GitRepo,
  /// Recursive fs watcher → `core://fs-changed`. Dropped (and its thread
  /// joined) when the session is replaced.
  _watcher: Option<WorkspaceWatcher>,
  /// The human's shell, opened lazily the first time the Terminal panel mounts
  /// (`pty_open`). `None` until then. Bound to the authorized root, so it dies
  /// with the session — dropping it kills the shell and joins its reader.
  pty: Option<PtySession>,
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
  /// Autonomy level the daemon is running under (§25). `null` when adopted
  /// from a daemon that recorded none. `owns_daemon` is false for an adopted
  /// daemon — the autonomy switch is disabled then, because a restart is not
  /// ours to perform (CORE-INTERFACE G1).
  pub permission_mode: Option<String>,
  pub owns_daemon: bool,
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
      permission_mode: s.permission_mode.clone(),
      owns_daemon: s.is_owned(),
    }
  }
}

/// `manual` | `assisted` | `autonomous`, or an error string for anything else.
fn validate_mode(mode: &str) -> Result<String, String> {
  match mode {
    "manual" | "assisted" | "autonomous" => Ok(mode.to_string()),
    other => Err(format!(
      "[bridge.autonomy.bad_mode] {other:?} is not a valid autonomy level"
    )),
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
  permission_mode: Option<String>,
) -> Result<SessionInfo, String> {
  let mode = permission_mode.map(|m| validate_mode(&m)).transpose()?;
  open_and_store(app, state, workspace_root, mode).await
}

/// Restart the workspace daemon under a new autonomy level (§25 / G1). Only
/// valid when this process spawned the daemon — an adopted daemon is not ours
/// to stop. Refuses while a task is active (checked in the renderer, enforced
/// here as a courtesy by leaving the running session in place on error).
#[tauri::command]
pub async fn session_restart(
  app: AppHandle,
  state: State<'_, BridgeState>,
  permission_mode: String,
) -> Result<SessionInfo, String> {
  let mode = validate_mode(&permission_mode)?;

  let workspace_root = {
    let mut guard = state.0.lock().await;
    let live = guard
      .as_ref()
      .ok_or_else(|| "[bridge.no_session] no session is open".to_string())?;
    if !live.session.is_owned() {
      return Err(
        "[bridge.autonomy.not_owned] Core for this workspace was started by another process. \
         Quit it there to change the autonomy level."
          .to_string(),
      );
    }
    let root = live.fs.root().display().to_string();
    // Take it out and stop the daemon; on a spawn failure below the workspace
    // is left with no session and the renderer surfaces the error.
    let mut prev = guard.take().expect("checked present above");
    prev.session.shutdown_daemon().await.map_err(err_str)?;
    drop(prev); // aborts the old pump task
    root
  };

  open_and_store(app, state, workspace_root, Some(mode)).await
}

async fn open_and_store(
  app: AppHandle,
  state: State<'_, BridgeState>,
  workspace_root: String,
  permission_mode: Option<String>,
) -> Result<SessionInfo, String> {
  let core = resolve_core_binary()?;
  let cfg = SupervisorConfig {
    workspace_root: PathBuf::from(&workspace_root),
    core_binary: core,
    expected_protocol: EXPECTED_PROTOCOL.to_string(),
    valyria_home: None,
    startup_timeout: Duration::from_secs(20),
    kill_daemon_on_drop: false,
    permission_mode,
  };

  let session = spawn_or_adopt(cfg).await.map_err(err_str)?;
  let client = CoreClient::new(session.socket_path.clone());
  let fs = WorkspaceFs::new(&workspace_root).map_err(err_str)?;
  let git = GitRepo::new(&workspace_root);

  // Recursive fs watch → the renderer, coalesced in the bridge.
  let watch_app = app.clone();
  let watcher = WorkspaceWatcher::start(&workspace_root, move |paths| {
    let _ = watch_app.emit("core://fs-changed", paths);
  })
  .map_err(err_str)
  .ok();

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
    fs,
    git,
    _watcher: watcher,
    pty: None,
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
pub async fn task_status(
  state: State<'_, BridgeState>,
  task_id: String,
) -> Result<TaskStatusResponse, String> {
  with_client(&state, |c| async move { c.task_status(&task_id).await }).await
}

#[tauri::command]
pub async fn task_plan(
  state: State<'_, BridgeState>,
  task_id: String,
) -> Result<PlanGetResponse, String> {
  with_client(&state, |c| async move { c.task_plan(&task_id).await }).await
}

#[tauri::command]
pub async fn task_report(
  state: State<'_, BridgeState>,
  task_id: String,
) -> Result<TaskReportResponse, String> {
  with_client(&state, |c| async move { c.task_report(&task_id).await }).await
}

#[tauri::command]
pub async fn task_rollback(
  state: State<'_, BridgeState>,
  task_id: String,
  checkpoint_id: String,
) -> Result<TaskRollbackResponse, String> {
  with_client(&state, |c| async move {
    c.task_rollback(&task_id, &checkpoint_id).await
  })
  .await
}

#[tauri::command]
pub async fn doctor_run(state: State<'_, BridgeState>) -> Result<DoctorRunResponse, String> {
  with_client(&state, |c| async move { c.doctor_run().await }).await
}

#[tauri::command]
pub async fn config_show(state: State<'_, BridgeState>) -> Result<ConfigShowResponse, String> {
  with_client(&state, |c| async move { c.config_show().await }).await
}

#[tauri::command]
pub async fn workspace_status(
  state: State<'_, BridgeState>,
) -> Result<WorkspaceStatusResponse, String> {
  with_client(&state, |c| async move { c.workspace_status().await }).await
}

#[tauri::command]
pub async fn model_list(state: State<'_, BridgeState>) -> Result<ModelListResponse, String> {
  with_client(&state, |c| async move { c.model_list().await }).await
}

/// D13 write-then-verify (CORE-INTERFACE G6): edit Core's own `config.toml`,
/// then return a fresh `config_show` so the caller renders the **effective**
/// value with its origin — not the optimistic write.
#[tauri::command]
pub async fn config_write(
  state: State<'_, BridgeState>,
  scope: String,
  key: String,
  value: String,
) -> Result<ConfigShowResponse, String> {
  let scope = ConfigScope::parse(&scope).map_err(err_str)?;
  let client = {
    let guard = state.0.lock().await;
    guard
      .as_ref()
      .map(|l| l.client.clone())
      .ok_or_else(|| "[bridge.no_session] no session is open".to_string())?
  };

  let data_dir = match scope {
    ConfigScope::Workspace => Some(client.workspace_status().await.map_err(err_str)?.data_dir),
    ConfigScope::User => None,
  };
  let path = config_path(scope, data_dir.as_deref().map(std::path::Path::new)).map_err(err_str)?;

  tokio::task::spawn_blocking(move || write_key(&path, &key, &value))
    .await
    .map_err(|e| e.to_string())?
    .map_err(err_str)?;

  client.config_show().await.map_err(err_str)
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

// --- human PTY (docs/PLAN.md §4.10 / CORE-INTERFACE §3) -----------------
//
// A shell the human types into, at the authorized root. Sanctioned as a local
// surface ("render a PTY the human types into"). It is NOT a way to run a
// command as the agent — that stays Core's (D7). Agent commands are a separate
// read-only projection of `tool_*` events in the renderer.

/// Open (or re-attach to) the workspace shell and return its replayed
/// scrollback. Called when the Terminal panel mounts; the dock unmounts the
/// panel on every tab switch, so a live shell is kept here, not in the WebView.
#[tauri::command]
pub async fn pty_open(
  app: AppHandle,
  state: State<'_, BridgeState>,
  cols: u16,
  rows: u16,
) -> Result<String, String> {
  let mut guard = state.0.lock().await;
  let live = guard
    .as_mut()
    .ok_or_else(|| "[bridge.no_session] no session is open".to_string())?;

  if let Some(pty) = live.pty.as_ref() {
    if pty.is_alive() {
      let _ = pty.resize(cols, rows);
      return Ok(pty.scrollback());
    }
  }

  let pty_app = app.clone();
  let pty = PtySession::start(live.fs.root(), cols, rows, move |ev| match ev {
    PtyEvent::Output(chunk) => {
      let _ = pty_app.emit("core://pty-output", chunk);
    }
    PtyEvent::Exit { code } => {
      let _ = pty_app.emit("core://pty-exit", code);
    }
  })
  .map_err(err_str)?;
  let snapshot = pty.scrollback();
  live.pty = Some(pty);
  Ok(snapshot)
}

/// Feed raw keystroke bytes to the shell.
#[tauri::command]
pub async fn pty_write(state: State<'_, BridgeState>, data: String) -> Result<(), String> {
  let guard = state.0.lock().await;
  let live = guard
    .as_ref()
    .ok_or_else(|| "[bridge.no_session] no session is open".to_string())?;
  match live.pty.as_ref() {
    Some(pty) => pty.write(&data).map_err(err_str),
    None => Err("[bridge.pty.io] no terminal is open".to_string()),
  }
}

/// Tell the shell its window changed size.
#[tauri::command]
pub async fn pty_resize(state: State<'_, BridgeState>, cols: u16, rows: u16) -> Result<(), String> {
  let guard = state.0.lock().await;
  let live = guard
    .as_ref()
    .ok_or_else(|| "[bridge.no_session] no session is open".to_string())?;
  match live.pty.as_ref() {
    Some(pty) => pty.resize(cols, rows).map_err(err_str),
    None => Ok(()),
  }
}

/// End the shell. Dropping the `PtySession` kills it and joins its reader.
#[tauri::command]
pub async fn pty_close(state: State<'_, BridgeState>) -> Result<(), String> {
  let mut guard = state.0.lock().await;
  if let Some(live) = guard.as_mut() {
    live.pty = None;
  }
  Ok(())
}

// --- local-read repository surfaces (CORE-INTERFACE §3) ------------------
//
// Served locally, scoped to the authorized root, and marked as such in the UI.
// Each flips to a Core method the moment G3 lands.

async fn snapshot(state: &BridgeState) -> Result<(WorkspaceFs, GitRepo), String> {
  let guard = state.0.lock().await;
  let l = guard
    .as_ref()
    .ok_or_else(|| "no session is open".to_string())?;
  Ok((l.fs.clone(), l.git.clone()))
}

#[tauri::command]
pub async fn fs_list_dir(
  state: State<'_, BridgeState>,
  path: String,
) -> Result<Vec<DirEntry>, String> {
  let (fs, _) = snapshot(&state).await?;
  tokio::task::spawn_blocking(move || fs.list_dir(&path))
    .await
    .map_err(|e| e.to_string())?
    .map_err(err_str)
}

#[tauri::command]
pub async fn fs_read_file(state: State<'_, BridgeState>, path: String) -> Result<FileView, String> {
  let (fs, _) = snapshot(&state).await?;
  tokio::task::spawn_blocking(move || fs.read_file(&path))
    .await
    .map_err(|e| e.to_string())?
    .map_err(err_str)
}

#[tauri::command]
pub async fn fs_search(
  state: State<'_, BridgeState>,
  query: String,
  limit: Option<usize>,
) -> Result<Vec<String>, String> {
  let (fs, _) = snapshot(&state).await?;
  let cap = limit.unwrap_or(200).min(1000);
  tokio::task::spawn_blocking(move || fs.search(&query, cap))
    .await
    .map_err(|e| e.to_string())?
    .map_err(err_str)
}

#[tauri::command]
pub async fn git_status(state: State<'_, BridgeState>) -> Result<Vec<GitEntry>, String> {
  let (_, git) = snapshot(&state).await?;
  tokio::task::spawn_blocking(move || git.status())
    .await
    .map_err(|e| e.to_string())?
    .map_err(err_str)
}

#[tauri::command]
pub async fn git_log(state: State<'_, BridgeState>, limit: u32) -> Result<Vec<GitCommit>, String> {
  let (_, git) = snapshot(&state).await?;
  tokio::task::spawn_blocking(move || git.log(limit))
    .await
    .map_err(|e| e.to_string())?
    .map_err(err_str)
}

#[tauri::command]
pub async fn git_diff(
  state: State<'_, BridgeState>,
  path: Option<String>,
  staged: bool,
) -> Result<String, String> {
  let (_, git) = snapshot(&state).await?;
  tokio::task::spawn_blocking(move || git.diff(path.as_deref(), staged))
    .await
    .map_err(|e| e.to_string())?
    .map_err(err_str)
}

/// Unified diff for one file, including a synthesized all-additions diff for a
/// still-untracked file the agent just created (see `GitRepo::diff_file`).
#[tauri::command]
pub async fn git_diff_file(state: State<'_, BridgeState>, path: String) -> Result<String, String> {
  let (_, git) = snapshot(&state).await?;
  tokio::task::spawn_blocking(move || git.diff_file(&path))
    .await
    .map_err(|e| e.to_string())?
    .map_err(err_str)
}

/// Contents of a path at `HEAD` — the "before" side of a review diff.
/// Empty string when the path is new (not in `HEAD`).
#[tauri::command]
pub async fn git_show_head(state: State<'_, BridgeState>, path: String) -> Result<String, String> {
  let (_, git) = snapshot(&state).await?;
  tokio::task::spawn_blocking(move || git.show("HEAD", &path))
    .await
    .map_err(|e| e.to_string())?
    .map(|opt| opt.unwrap_or_default())
    .map_err(err_str)
}

#[tauri::command]
pub async fn git_branch(state: State<'_, BridgeState>) -> Result<String, String> {
  let (_, git) = snapshot(&state).await?;
  tokio::task::spawn_blocking(move || {
    if git.is_repo() {
      git.branch()
    } else {
      Ok(String::new())
    }
  })
  .await
  .map_err(|e| e.to_string())?
  .map_err(err_str)
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
