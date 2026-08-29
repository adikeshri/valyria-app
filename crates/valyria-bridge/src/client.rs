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
    TaskIdRequest, TaskStatusRequest, WireError, WireEvent,
};
use valyria_protocol::{
    HelloResponse, PlanGetResponse, TaskListResponse, TaskReportResponse, TaskStatusResponse,
    WorkspaceStatusResponse,
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
        match self
            .call(Request::TaskCreate(TaskCreateRequest {
                objective: objective.into(),
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
        self.ack(Request::PermissionResolve(PermissionResolveRequest {
            task_id: task_id.to_string(),
            approve,
        }))
        .await
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
