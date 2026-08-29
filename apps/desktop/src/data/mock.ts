// Local sample data for the visual prototype (docs/PLAN.md Phase 0/1 precedes
// real Core wiring — see ../../docs/CORE-INTERFACE.md). Nothing here reaches
// a network or a filesystem; it exists to make every panel legible with
// plausible, internally-consistent content before the protocol bridge lands.

import type {
  ApprovalRequest,
  ChatMessage,
  ContextItem,
  FileNode,
  GitCommit,
  HardwareReport,
  ModelSummary,
  PlanStep,
  Task,
  TimelineEvent,
  ModifiedFile,
  VerificationClaim,
} from "../types/domain";

export const WORKSPACE_ROOT = "~/dev/northwind-api";
export const WORKSPACE_NAME = "northwind-api";
export const CURRENT_BRANCH = "fix/session-expiry-race";

export const fileTree: FileNode[] = [
  {
    name: "northwind-api",
    path: "/",
    kind: "dir",
    children: [
      {
        name: "src",
        path: "/src",
        kind: "dir",
        children: [
          {
            name: "auth",
            path: "/src/auth",
            kind: "dir",
            children: [
              { name: "__init__.py", path: "/src/auth/__init__.py", kind: "file" },
              { name: "service.py", path: "/src/auth/service.py", kind: "file", changeState: "agent", symbolCount: 14 },
              { name: "tokens.py", path: "/src/auth/tokens.py", kind: "file", changeState: "agent", symbolCount: 9 },
              { name: "middleware.py", path: "/src/auth/middleware.py", kind: "file", symbolCount: 6 },
            ],
          },
          {
            name: "billing",
            path: "/src/billing",
            kind: "dir",
            children: [
              { name: "invoices.py", path: "/src/billing/invoices.py", kind: "file", symbolCount: 21 },
              { name: "webhooks.py", path: "/src/billing/webhooks.py", kind: "file", symbolCount: 11 },
            ],
          },
          {
            name: "storage",
            path: "/src/storage",
            kind: "dir",
            children: [
              { name: "session_store.py", path: "/src/storage/session_store.py", kind: "file", changeState: "modified", symbolCount: 8 },
              { name: "redis_client.py", path: "/src/storage/redis_client.py", kind: "file", symbolCount: 5 },
            ],
          },
          { name: "config.py", path: "/src/config.py", kind: "file" },
          { name: "main.py", path: "/src/main.py", kind: "file" },
        ],
      },
      {
        name: "tests",
        path: "/tests",
        kind: "dir",
        children: [
          {
            name: "auth",
            path: "/tests/auth",
            kind: "dir",
            children: [
              { name: "test_service.py", path: "/tests/auth/test_service.py", kind: "file", changeState: "agent", symbolCount: 12 },
              { name: "test_tokens.py", path: "/tests/auth/test_tokens.py", kind: "file", symbolCount: 7 },
            ],
          },
          { name: "test_billing.py", path: "/tests/test_billing.py", kind: "file" },
          { name: "conftest.py", path: "/tests/conftest.py", kind: "file" },
        ],
      },
      { name: "AGENTS.md", path: "/AGENTS.md", kind: "file" },
      { name: "pyproject.toml", path: "/pyproject.toml", kind: "file" },
      { name: "README.md", path: "/README.md", kind: "file" },
    ],
  },
];

export const gitCommits: GitCommit[] = [
  { hash: "a4c19e2", message: "fix(auth): close session-expiry race in refresh path", author: "you", relTime: "uncommitted" },
  { hash: "e91b0f4", message: "billing: retry webhook delivery with backoff", author: "M. Ridley", relTime: "3 hours ago" },
  { hash: "7d2aa61", message: "storage: switch session store to redis cluster client", author: "you", relTime: "yesterday" },
  { hash: "10307f3", message: "Initial commit", author: "A. Keshri", relTime: "2 days ago" },
];

export const modifiedFiles: ModifiedFile[] = [
  { path: "src/auth/service.py", additions: 18, deletions: 6, ownership: "agent", status: "modified" },
  { path: "src/auth/tokens.py", additions: 9, deletions: 2, ownership: "agent", status: "modified" },
  { path: "tests/auth/test_service.py", additions: 31, deletions: 0, ownership: "agent", status: "modified" },
  { path: "src/storage/session_store.py", additions: 4, deletions: 1, ownership: "user", status: "modified" },
];

export const contextItems: ContextItem[] = [
  { path: "src/auth/service.py", reason: "direct implementation — refresh_session()", trust: "repository", tokens: 812 },
  { path: "src/auth/tokens.py", reason: "TokenPair used by refresh_session", trust: "repository", tokens: 340 },
  { path: "tests/auth/test_service.py", reason: "affected test — covers refresh_session", trust: "repository", tokens: 465 },
  { path: "AGENTS.md", reason: "authorized repository instructions", trust: "authorized_instruction", tokens: 210 },
  { path: "commit 7d2aa61", reason: "historical context — session store migration", trust: "historical", tokens: 96 },
];

export const verifiedEvidence: VerificationClaim[] = [
  { kind: "formatter", command: "ruff format --check src tests", outcome: "pass", runId: "run_01j9k2" },
  { kind: "lint", command: "ruff check src tests", outcome: "pass", runId: "run_01j9k3" },
  { kind: "targeted", command: "pytest tests/auth -q", outcome: "pass", runId: "run_01j9k7" },
];

export const unverifiedEvidence: VerificationClaim[] = [
  { kind: "integration", command: "pytest tests/ -m integration", outcome: "not_run" },
  { kind: "full_suite", command: "pytest", outcome: "not_run" },
];

export const planSteps: PlanStep[] = [
  { id: "p1", intent: "Reproduce the expiry race with a targeted test", targets: ["tests/auth/test_service.py"], status: "done", checkpoint: false },
  { id: "p2", intent: "Guard refresh_session() against concurrent expiry", targets: ["src/auth/service.py"], status: "done", checkpoint: true },
  { id: "p3", intent: "Extend TokenPair to carry a monotonic issue counter", targets: ["src/auth/tokens.py"], status: "done", checkpoint: true },
  { id: "p4", intent: "Run targeted tests and repair on failure", targets: ["tests/auth"], status: "active", checkpoint: false },
  { id: "p5", intent: "Run full verification and produce completion report", targets: ["*"], status: "pending", checkpoint: false },
];

export const timeline: TimelineEvent[] = [
  { id: "e1", seq: 1, ts: "10:02", kind: "task_started", title: "Task started", detail: "Fix the session-expiry race condition in refresh_session()" },
  { id: "e2", seq: 2, ts: "10:02", kind: "context_retrieved", title: "Repository analyzed", detail: "5 relevant files found" },
  { id: "e3", seq: 3, ts: "10:03", kind: "plan_created", title: "Plan created", detail: "5 implementation steps" },
  { id: "e4", seq: 4, ts: "10:03", kind: "tool_started", title: "Reading src/auth/service.py", payload: { tool: "read_file" } },
  { id: "e5", seq: 5, ts: "10:04", kind: "file_changed", title: "Edited tests/auth/test_service.py", detail: "+31 −0" },
  { id: "e6", seq: 6, ts: "10:04", kind: "test_started", title: "Running pytest tests/auth -q" },
  { id: "e7", seq: 7, ts: "10:05", kind: "test_failed", title: "2 tests failed", detail: "test_concurrent_refresh_does_not_duplicate_session" },
  { id: "e8", seq: 8, ts: "10:05", kind: "tool_started", title: "Investigating failure", detail: "Diagnosing race in refresh_session()" },
  { id: "e9", seq: 9, ts: "10:06", kind: "file_changed", title: "Edited src/auth/service.py", detail: "+18 −6" },
  { id: "e10", seq: 10, ts: "10:06", kind: "file_changed", title: "Edited src/auth/tokens.py", detail: "+9 −2" },
  { id: "e11", seq: 11, ts: "10:07", kind: "test_started", title: "Running pytest tests/auth -q" },
  { id: "e12", seq: 12, ts: "10:07", kind: "test_passed", title: "Tests passed", detail: "12 passed in 1.84s" },
  { id: "e13", seq: 13, ts: "10:08", kind: "approval_requested", title: "Permission requested", detail: "Run full verification suite (network: disabled)" },
];

export const chatMessages: ChatMessage[] = [
  { id: "c1", role: "user", text: "There's an intermittent bug where a user gets logged out right after their session should have refreshed — looks like a race in the token refresh path. Can you find and fix it?", ts: "10:01" },
  { id: "c2", role: "agent", text: "I looked at src/auth/service.py and tests/auth/test_service.py. refresh_session() reads the current session, checks expiry, then writes a new token — with no guard against two concurrent refreshes racing on the same session. I wrote a test that reproduces it, then fixed refresh_session() to use a compare-and-set on a monotonic issue counter in TokenPair, so a stale refresh is rejected instead of silently overwriting a newer one.\n\nTargeted tests pass (12/12). I'd like to run the full verification suite next — it needs network access disabled per policy, which is fine, just flagging before I run it.", ts: "10:08" },
];

export const pendingApproval: ApprovalRequest = {
  id: "appr_1",
  taskId: "task_01",
  tool: "run_command",
  category: "command",
  risk: "low",
  prompt: "Run the full test suite to verify the fix before completing.",
  command: "pytest",
  reason: "Mandatory full verification run before a task can complete (§4.26).",
  requestedAt: "10:08",
};

export const currentTask: Task = {
  id: "task_01",
  objective: "Fix the session-expiry race condition in refresh_session()",
  state: "waiting_for_permission",
  autonomy: "assisted",
  model: "Qwen3-Coder-30B-A3B (Q4_K_M)",
  createdAt: "10:02",
  updatedAt: "10:08",
  durationSec: 372,
  plan: planSteps,
  modifiedFiles,
  timeline,
  chat: chatMessages,
  verified: verifiedEvidence,
  unverified: unverifiedEvidence,
  context: contextItems,
  pendingApproval,
  day: "Today",
};

export const taskHistory: Task[] = [
  currentTask,
  {
    ...currentTask,
    id: "task_00",
    objective: "Add response caching to invoices endpoint",
    state: "completed",
    updatedAt: "09:14",
    durationSec: 501,
    day: "Today",
    pendingApproval: undefined,
  },
  {
    ...currentTask,
    id: "task_y1",
    objective: "Refactor session storage layer to redis cluster client",
    state: "completed",
    updatedAt: "18:42",
    durationSec: 1180,
    day: "Yesterday",
    pendingApproval: undefined,
  },
  {
    ...currentTask,
    id: "task_y2",
    objective: "Investigate flaky test_billing.py::test_webhook_retry",
    state: "failed",
    updatedAt: "15:03",
    durationSec: 220,
    day: "Yesterday",
    pendingApproval: undefined,
  },
];

export const modelList: ModelSummary[] = [
  { id: "qwen3-coder-30b-a3b-q4", family: "Qwen3-Coder", quantization: "Q4_K_M", sizeGb: 18.2, memGb: 22, role: "coding", license: "Apache-2.0", installed: true, active: true, perfClass: "balanced" },
  { id: "qwen3-coder-30b-a3b-q8", family: "Qwen3-Coder", quantization: "Q8_0", sizeGb: 32.1, memGb: 36, role: "coding", license: "Apache-2.0", installed: false, active: false, perfClass: "quality" },
  { id: "deepseek-coder-v2-lite-q4", family: "DeepSeek-Coder-V2-Lite", quantization: "Q4_K_M", sizeGb: 9.8, memGb: 14, role: "coding", license: "MIT", installed: false, active: false, perfClass: "fast" },
  { id: "llama-3.1-8b-planning-q5", family: "Llama-3.1-8B-Instruct", quantization: "Q5_K_M", sizeGb: 5.7, memGb: 9, role: "planning", license: "Llama 3.1", installed: true, active: false, perfClass: "fast" },
  { id: "nomic-embed-text-v1.5", family: "nomic-embed-text", quantization: "F16", sizeGb: 0.3, memGb: 1, role: "embedding", license: "Apache-2.0", installed: true, active: true, perfClass: "fast" },
];

export const hardware: HardwareReport = {
  cpu: "Apple M3 Max",
  cores: 16,
  ramGb: 64,
  gpu: "Apple M3 Max GPU (40-core)",
  vramGb: null,
  accelerator: "Metal (unified memory)",
  os: "macOS 15.4 (aarch64)",
  recommendedModel: "Qwen3-Coder-30B-A3B (Q4_K_M)",
};

export const diffs: Record<string, { before: string; after: string; language: string }> = {
  "src/auth/service.py": {
    language: "python",
    before: `def refresh_session(session_id: str, request_token: str) -> TokenPair:
    session = store.get(session_id)
    if session is None:
        raise SessionNotFound(session_id)

    if session.expires_at < now():
        raise SessionExpired(session_id)

    new_pair = tokens.issue(session.user_id)
    store.set(session_id, session.with_tokens(new_pair))
    return new_pair
`,
    after: `def refresh_session(session_id: str, request_token: str) -> TokenPair:
    session = store.get(session_id)
    if session is None:
        raise SessionNotFound(session_id)

    if session.expires_at < now():
        raise SessionExpired(session_id)

    new_pair = tokens.issue(session.user_id, after=session.tokens.issue_seq)

    # Compare-and-set on the monotonic issue counter: if another refresh
    # already landed while we were issuing this one, ours is stale — reject
    # it instead of silently clobbering the newer session (race root cause).
    updated = store.compare_and_set(
        session_id,
        expected_seq=session.tokens.issue_seq,
        new_state=session.with_tokens(new_pair),
    )
    if not updated:
        raise StaleRefresh(session_id)

    return new_pair
`,
  },
  "src/auth/tokens.py": {
    language: "python",
    before: `@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str


def issue(user_id: str) -> TokenPair:
    return TokenPair(
        access_token=_sign(user_id, ttl=ACCESS_TTL),
        refresh_token=_sign(user_id, ttl=REFRESH_TTL),
    )
`,
    after: `@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    issue_seq: int = 0


def issue(user_id: str, after: int = 0) -> TokenPair:
    return TokenPair(
        access_token=_sign(user_id, ttl=ACCESS_TTL),
        refresh_token=_sign(user_id, ttl=REFRESH_TTL),
        issue_seq=after + 1,
    )
`,
  },
  "tests/auth/test_service.py": {
    language: "python",
    before: `def test_refresh_session_returns_new_pair(session_factory):
    session = session_factory()
    pair = refresh_session(session.id, session.tokens.refresh_token)
    assert pair.access_token != session.tokens.access_token
`,
    after: `def test_refresh_session_returns_new_pair(session_factory):
    session = session_factory()
    pair = refresh_session(session.id, session.tokens.refresh_token)
    assert pair.access_token != session.tokens.access_token


def test_concurrent_refresh_does_not_duplicate_session(session_factory):
    session = session_factory()

    first = refresh_session(session.id, session.tokens.refresh_token)
    # Simulate a second refresh racing on the *pre-refresh* token.
    with pytest.raises(StaleRefresh):
        refresh_session(session.id, session.tokens.refresh_token)

    stored = store.get(session.id)
    assert stored.tokens.access_token == first.access_token
`,
  },
  "src/storage/session_store.py": {
    language: "python",
    before: `def set(self, session_id: str, state: SessionState) -> None:
    self._redis.set(session_id, state.serialize())
`,
    after: `def set(self, session_id: str, state: SessionState) -> None:
    self._redis.set(session_id, state.serialize(), ex=SESSION_TTL_SECONDS)
`,
  },
};

export const fileContents: Record<string, { language: string; code: string }> = {
  "src/auth/service.py": { language: "python", code: diffs["src/auth/service.py"].after },
  "src/auth/tokens.py": { language: "python", code: diffs["src/auth/tokens.py"].after },
  "tests/auth/test_service.py": { language: "python", code: diffs["tests/auth/test_service.py"].after },
  "src/storage/session_store.py": { language: "python", code: diffs["src/storage/session_store.py"].after },
  "AGENTS.md": {
    language: "markdown",
    code: `# Repository instructions for Valyria

- Run \`ruff format\` and \`ruff check\` before considering any Python change done.
- Network access is disabled by default; ask before installing dependencies.
- Session and token logic in \`src/auth/\` is security-sensitive — prefer the
  smallest correct change and always add a regression test.
- Full suite: \`pytest\`. Targeted: \`pytest tests/<area> -q\`.
`,
  },
};

export const terminalAgentLines = [
  "$ pytest tests/auth -q",
  "............",
  "12 passed in 1.84s",
];

export const terminalUserLines = [
  "$ git status",
  "On branch fix/session-expiry-race",
  "Changes not staged for commit:",
  "  modified:   src/auth/service.py",
  "  modified:   src/auth/tokens.py",
  "  modified:   src/storage/session_store.py",
  "",
  "Untracked files:",
  "  (agent-owned, see Task panel)",
];
