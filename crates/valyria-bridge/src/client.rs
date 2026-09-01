//! `CoreClient` — a typed, timeout-bounded wrapper over
//! `valyria_protocol::SocketClient`.
//!
//! Every method opens a short-lived `Call` connection (Core's connections are
//! one-shot — CORE-INTERFACE §1), so a slow call can never block the event
//! stream (docs/PLAN.md D9). A `Response::Error` becomes `BridgeError::Protocol`
//! carrying Core's `code` verbatim; a wrong variant becomes
//! `UnexpectedResponse`.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use futures::stream::BoxStream;
use valyria_protocol::{
    Client, Empty, PermissionResolveRequest, Request, Response, SocketClient, TaskCreateRequest,
    TaskIdRequest, TaskRollbackRequest, TaskStatusRequest, WireError, WireEvent,
};
use valyria_protocol::{
    ConfigSetRequest, ConfigShowResponse, DoctorRunResponse, GitBranchesResponse, GitDiffRequest,
    GitDiffResponse, GitLogRequest, GitLogResponse, GitStatusResponse, HardwareProbeResponse,
    HelloResponse, IndexStatusResponse, LedgerChangesRequest, LedgerChangesResponse,
    ModelActivateRequest, ModelIdRequest, ModelInspectResponse, ModelListResponse,
    ModelRecommendRequest, ModelRecommendResponse, ModelRemoveResponse, PlanGetResponse,
    SearchQueryRequest, SearchQueryResponse, TaskListResponse, TaskReportResponse,
    TaskRollbackResponse, TaskStatusResponse, WorkspaceStatusResponse,
};

use crate::error::{BridgeError, Result};
use crate::session::CLIENT_NAME;

/// Default per-call ceiling. Long work in Core is modelled as events, not slow
/// calls, so 30s is generous for anything on this surface.
pub const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct CoreClient {
    socket: Arc<SocketClient>,
    timeout: Duration,
}

impl CoreClient {
    pub fn new(socket_path: impl Into<PathBuf>) -> Self {
        Self {
            socket: Arc::new(SocketClient::new(socket_path)),
            timeout: DEFAULT_CALL_TIMEOUT,
        }
    }

    /// A client that authenticates every frame with the daemon's per-instance
    /// token (CORE-INTERFACE G10). `None` is exactly `new` — an unauthenticated
    /// client, for a daemon started without a token.
    pub fn with_token(socket_path: impl Into<PathBuf>, token: Option<String>) -> Self {
        let socket = match token {
            Some(t) => SocketClient::with_token(socket_path, t),
            None => SocketClient::new(socket_path),
        };
        Self {
            socket: Arc::new(socket),
            timeout: DEFAULT_CALL_TIMEOUT,
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn socket_path(&self) -> &std::path::Path {
        self.socket.path()
    }

    async fn call(&self, req: Request) -> Result<Response> {
        let fut = self.socket.call(req);
        match tokio::time::timeout(self.timeout, fut).await {
            Err(_) => Err(BridgeError::Transport(format!(
                "call timed out after {}s",
                self.timeout.as_secs()
            ))),
            Ok(Response::Error(e)) => Err(map_wire_error(e)),
            Ok(other) => Ok(other),
        }
    }

    // --- lifecycle -----------------------------------------------------

    pub async fn hello(&self) -> Result<HelloResponse> {
        match self
            .call(Request::Hello(valyria_protocol::HelloRequest {
                client_name: CLIENT_NAME.to_string(),
            }))
            .await?
        {
            Response::Hello(h) => Ok(h),
            other => Err(unexpected("Hello", other)),
        }
    }

    pub async fn workspace_status(&self) -> Result<WorkspaceStatusResponse> {
        match self.call(Request::WorkspaceStatus(Empty {})).await? {
            Response::WorkspaceStatus(r) => Ok(r),
            other => Err(unexpected("WorkspaceStatus", other)),
        }
    }

    // --- tasks -------------------------------------------------------

    pub async fn task_create(&self, objective: impl Into<String>) -> Result<String> {
        self.task_create_with_mode(objective, None).await
    }

    /// Create a task with an optional per-task autonomy override
    /// (`manual` | `assisted` | `autonomous`) — CORE-INTERFACE G1. With
    /// `None` the task inherits the daemon's start-time mode.
    pub async fn task_create_with_mode(
        &self,
        objective: impl Into<String>,
        permission_mode: Option<String>,
    ) -> Result<String> {
        match self
            .call(Request::TaskCreate(TaskCreateRequest {
                objective: objective.into(),
                permission_mode,
            }))
            .await?
        {
            Response::TaskCreate(r) => Ok(r.task_id),
            other => Err(unexpected("TaskCreate", other)),
        }
    }

    pub async fn task_list(&self) -> Result<TaskListResponse> {
        match self.call(Request::TaskList(Empty {})).await? {
            Response::TaskList(r) => Ok(r),
            other => Err(unexpected("TaskList", other)),
        }
    }

    pub async fn task_status(&self, task_id: &str) -> Result<TaskStatusResponse> {
        match self
            .call(Request::TaskStatus(TaskStatusRequest {
                task_id: task_id.to_string(),
            }))
            .await?
        {
            Response::TaskStatus(r) => Ok(r),
            other => Err(unexpected("TaskStatus", other)),
        }
    }

    pub async fn task_report(&self, task_id: &str) -> Result<TaskReportResponse> {
        match self
            .call(Request::TaskReport(TaskIdRequest {
                task_id: task_id.to_string(),
            }))
            .await?
        {
            Response::TaskReport(r) => Ok(r),
            other => Err(unexpected("TaskReport", other)),
        }
    }

    pub async fn task_plan(&self, task_id: &str) -> Result<PlanGetResponse> {
        match self
            .call(Request::TaskPlan(TaskIdRequest {
                task_id: task_id.to_string(),
            }))
            .await?
        {
            Response::TaskPlan(r) => Ok(r),
            other => Err(unexpected("TaskPlan", other)),
        }
    }

    /// Roll a task's workspace back to a checkpoint taken at a plan step
    /// boundary (§16). Restores the checkpointed files exactly and refuses on
    /// any file touched since — that refusal is Core's, surfaced verbatim as a
    /// `BridgeError::Protocol`. The app never computes a partial revert itself
    /// (docs/PLAN.md §4.8).
    ///
    /// Note (CORE-INTERFACE G13): v1 exposes no way to *discover* a
    /// `checkpoint_id` — `task_plan` reports only `checkpoint: bool` per step
    /// and no event carries the id. This method is wired and tested against
    /// Core's error path so the surface lights up the moment Core emits one.
    pub async fn task_rollback(
        &self,
        task_id: &str,
        checkpoint_id: &str,
    ) -> Result<TaskRollbackResponse> {
        match self
            .call(Request::TaskRollback(TaskRollbackRequest {
                task_id: task_id.to_string(),
                checkpoint_id: checkpoint_id.to_string(),
            }))
            .await?
        {
            Response::TaskRollback(r) => Ok(r),
            other => Err(unexpected("TaskRollback", other)),
        }
    }

    pub async fn task_pause(&self, task_id: &str) -> Result<()> {
        self.ack(Request::TaskPause(TaskIdRequest {
            task_id: task_id.to_string(),
        }))
        .await
    }

    pub async fn task_resume(&self, task_id: &str) -> Result<()> {
        self.ack(Request::TaskResume(TaskIdRequest {
            task_id: task_id.to_string(),
        }))
        .await
    }

    pub async fn task_cancel(&self, task_id: &str) -> Result<()> {
        self.ack(Request::TaskCancel(TaskIdRequest {
            task_id: task_id.to_string(),
        }))
        .await
    }

    pub async fn permission_resolve(&self, task_id: &str, approve: bool) -> Result<()> {
        self.permission_resolve_scoped(task_id, None, if approve { "once" } else { "deny" })
            .await
    }

    /// Resolve an approval, optionally asserting `request_id` (from the
    /// `approval_requested` payload) so a stale prompt is refused with
    /// `approval.superseded` rather than mis-resolved, and choosing a
    /// `decision` of `once` | `task` | `deny` — CORE-INTERFACE G2.
    pub async fn permission_resolve_scoped(
        &self,
        task_id: &str,
        request_id: Option<String>,
        decision: &str,
    ) -> Result<()> {
        self.ack(Request::PermissionResolve(PermissionResolveRequest {
            task_id: task_id.to_string(),
            approve: decision != "deny",
            request_id,
            decision: Some(decision.to_string()),
        }))
        .await
    }

    // --- diagnostics & config (§4.15, §26) ---------------------------

    /// The ten environment checks (`doctor_run`). Read-only; the Security
    /// overview and first-run wizard render these verbatim, marking anything
    /// Core does not report rather than inventing a verdict (§26, D8).
    pub async fn doctor_run(&self) -> Result<DoctorRunResponse> {
        match self.call(Request::DoctorRun(Empty {})).await? {
            Response::DoctorRun(r) => Ok(r),
            other => Err(unexpected("DoctorRun", other)),
        }
    }

    /// Effective config entries with their `origin` (`config_show`). The
    /// Settings and Security surfaces display the resolved value + origin; the
    /// app never claims a value it cannot read back here (D13).
    pub async fn config_show(&self) -> Result<ConfigShowResponse> {
        match self.call(Request::ConfigShow(Empty {})).await? {
            Response::ConfigShow(r) => Ok(r),
            other => Err(unexpected("ConfigShow", other)),
        }
    }

    /// The model inventory (`model_list`).
    pub async fn model_list(&self) -> Result<ModelListResponse> {
        match self.call(Request::ModelList(Empty {})).await? {
            Response::ModelList(r) => Ok(r),
            other => Err(unexpected("ModelList", other)),
        }
    }

    /// Write one config leaf to a Core-owned file, then return the
    /// re-resolved effective view (`config_set`) — CORE-INTERFACE G6.
    /// `scope` is `workspace` or `user`.
    pub async fn config_set(
        &self,
        key: &str,
        value: &str,
        scope: &str,
    ) -> Result<ConfigShowResponse> {
        match self
            .call(Request::ConfigSet(ConfigSetRequest {
                key: key.to_string(),
                value: value.to_string(),
                scope: scope.to_string(),
            }))
            .await?
        {
            Response::ConfigShow(r) => Ok(r),
            other => Err(unexpected("ConfigShow", other)),
        }
    }

    // --- repository read surface (CORE-INTERFACE G3) ----------------

    pub async fn git_status(&self) -> Result<GitStatusResponse> {
        match self.call(Request::GitStatus(Empty {})).await? {
            Response::GitStatus(r) => Ok(r),
            other => Err(unexpected("GitStatus", other)),
        }
    }

    pub async fn git_diff(&self, path: Option<String>, staged: bool) -> Result<GitDiffResponse> {
        match self
            .call(Request::GitDiff(GitDiffRequest { path, staged }))
            .await?
        {
            Response::GitDiff(r) => Ok(r),
            other => Err(unexpected("GitDiff", other)),
        }
    }

    pub async fn git_log(&self, limit: Option<u32>) -> Result<GitLogResponse> {
        match self.call(Request::GitLog(GitLogRequest { limit })).await? {
            Response::GitLog(r) => Ok(r),
            other => Err(unexpected("GitLog", other)),
        }
    }

    pub async fn git_branches(&self) -> Result<GitBranchesResponse> {
        match self.call(Request::GitBranches(Empty {})).await? {
            Response::GitBranches(r) => Ok(r),
            other => Err(unexpected("GitBranches", other)),
        }
    }

    pub async fn search_query(
        &self,
        query: impl Into<String>,
        modes: Vec<String>,
        anchors: Vec<String>,
        limit: Option<u32>,
    ) -> Result<SearchQueryResponse> {
        match self
            .call(Request::SearchQuery(SearchQueryRequest {
                query: query.into(),
                modes,
                anchors,
                limit,
            }))
            .await?
        {
            Response::SearchQuery(r) => Ok(r),
            other => Err(unexpected("SearchQuery", other)),
        }
    }

    pub async fn index_status(&self) -> Result<IndexStatusResponse> {
        match self.call(Request::IndexStatus(Empty {})).await? {
            Response::IndexStatus(r) => Ok(r),
            other => Err(unexpected("IndexStatus", other)),
        }
    }

    /// Build (or rebuild) the whole-workspace index + graph (protocol 1.10.0).
    /// Synchronous in Core; this can take a while on a large repo, so it runs
    /// with a longer timeout than the default call ceiling.
    pub async fn index_build(&self) -> Result<IndexStatusResponse> {
        let fut = self.socket.call(Request::IndexBuild(Empty {}));
        match tokio::time::timeout(Duration::from_secs(600), fut).await {
            Err(_) => Err(BridgeError::Transport(
                "index build timed out after 600s".to_string(),
            )),
            Ok(Response::Error(e)) => Err(map_wire_error(e)),
            Ok(Response::IndexBuild(r)) => Ok(r),
            Ok(other) => Err(unexpected("IndexBuild", other)),
        }
    }

    // --- hardware & model management (CORE-INTERFACE G4, G5) --------

    pub async fn hardware_probe(&self) -> Result<HardwareProbeResponse> {
        match self.call(Request::HardwareProbe(Empty {})).await? {
            Response::HardwareProbe(r) => Ok(r),
            other => Err(unexpected("HardwareProbe", other)),
        }
    }

    pub async fn model_recommend(&self, role: &str) -> Result<ModelRecommendResponse> {
        match self
            .call(Request::ModelRecommend(ModelRecommendRequest {
                role: role.to_string(),
            }))
            .await?
        {
            Response::ModelRecommend(r) => Ok(r),
            other => Err(unexpected("ModelRecommend", other)),
        }
    }

    /// Begin a model install. Returns immediately; progress arrives as
    /// `model_install_progress` / `_completed` / `_failed` events.
    pub async fn model_install(&self, id: &str) -> Result<()> {
        self.ack(Request::ModelInstall(ModelIdRequest { id: id.to_string() }))
            .await
    }

    pub async fn model_remove(&self, id: &str) -> Result<ModelRemoveResponse> {
        match self
            .call(Request::ModelRemove(ModelIdRequest { id: id.to_string() }))
            .await?
        {
            Response::ModelRemove(r) => Ok(r),
            other => Err(unexpected("ModelRemove", other)),
        }
    }

    pub async fn model_activate(&self, id: &str, role: &str) -> Result<()> {
        self.ack(Request::ModelActivate(ModelActivateRequest {
            id: id.to_string(),
            role: role.to_string(),
        }))
        .await
    }

    pub async fn model_inspect(&self, id: &str) -> Result<ModelInspectResponse> {
        match self
            .call(Request::ModelInspect(ModelIdRequest { id: id.to_string() }))
            .await?
        {
            Response::ModelInspect(r) => Ok(r),
            other => Err(unexpected("ModelInspect", other)),
        }
    }

    // --- change ownership (CORE-INTERFACE G8) -----------------------

    pub async fn ledger_changes(&self, task_id: &str) -> Result<LedgerChangesResponse> {
        match self
            .call(Request::LedgerChanges(LedgerChangesRequest {
                task_id: task_id.to_string(),
            }))
            .await?
        {
            Response::LedgerChanges(r) => Ok(r),
            other => Err(unexpected("LedgerChanges", other)),
        }
    }

    async fn ack(&self, req: Request) -> Result<()> {
        match self.call(req).await? {
            Response::Ack => Ok(()),
            other => Err(unexpected("Ack", other)),
        }
    }

    // --- events ----------------------------------------------------

    /// Open a long-lived event subscription from `since`. The connection stays
    /// open for the life of the returned stream (CORE-INTERFACE §1).
    pub async fn subscribe(&self, since: u64) -> BoxStream<'static, WireEvent> {
        self.socket.subscribe_events(since).await
    }

    /// [`Self::subscribe`] scoped to one task's events plus workspace-global
    /// ones — CORE-INTERFACE G11. `task_id: None` is the full stream.
    pub async fn subscribe_for_task(
        &self,
        since: u64,
        task_id: Option<String>,
    ) -> BoxStream<'static, WireEvent> {
        self.socket.subscribe_events_for_task(since, task_id).await
    }
}

fn map_wire_error(e: WireError) -> BridgeError {
    if e.code == "protocol.transport" {
        BridgeError::Transport(e.message)
    } else {
        BridgeError::Protocol {
            code: e.code,
            message: e.message,
            retryable: e.retryable,
        }
    }
}

fn unexpected(wanted: &str, got: Response) -> BridgeError {
    BridgeError::UnexpectedResponse(format!("wanted {wanted}, got {got:?}"))
}
