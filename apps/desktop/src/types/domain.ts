// Domain types for the visual prototype. Named to mirror valyria-protocol's
// wire vocabulary (see ../../docs/CORE-INTERFACE.md) so wiring the real
// bridge later is a data-source swap, not a reshape.

export type TaskState =
  | "planning"
  | "running"
  | "waiting_for_permission"
  | "verifying"
  | "repairing"
  | "paused"
  | "completed"
  | "failed";

export type AutonomyLevel = "manual" | "assisted" | "autonomous";

export type Ownership = "agent" | "user" | "existing";

export interface PlanStep {
  id: string;
  intent: string;
  targets: string[];
  status: "pending" | "active" | "done" | "skipped";
  checkpoint: boolean;
}

export interface ModifiedFile {
  path: string;
  additions: number;
  deletions: number;
  ownership: Ownership;
  status: "modified" | "added" | "deleted" | "renamed";
}

export type TimelineKind =
  | "task_started"
  | "plan_created"
  | "context_retrieved"
  | "model_started"
  | "model_completed"
  | "tool_started"
  | "tool_completed"
  | "file_changed"
  | "test_started"
  | "test_passed"
  | "test_failed"
  | "approval_requested"
  | "task_paused"
  | "task_completed"
  | "task_failed"
  | "state_changed"
  | "progress_stalled"
  | "verification_evidence";

export interface TimelineEvent {
  id: string;
  seq: number;
  ts: string; // HH:MM
  kind: TimelineKind;
  title: string;
  detail?: string;
  payload?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  ts: string;
  attachments?: string[];
}

export type VerificationOutcome = "pass" | "fail" | "not_run";

export interface VerificationClaim {
  kind: string;
  command: string;
  outcome: VerificationOutcome;
  runId?: string;
  detail?: string;
}

export interface ApprovalRequest {
  id: string;
  taskId: string;
  tool: string;
  category: "network" | "filesystem" | "command" | "git" | "credentials";
  risk: "low" | "medium" | "high";
  prompt: string;
  command?: string;
  reason: string;
  requestedAt: string;
}

export interface ContextItem {
  path: string;
  reason: string;
  trust: "authorized_instruction" | "repository" | "historical";
  tokens: number;
}

export interface Task {
  id: string;
  objective: string;
  state: TaskState;
  autonomy: AutonomyLevel;
  model: string;
  createdAt: string;
  updatedAt: string;
  durationSec: number;
  plan: PlanStep[];
  modifiedFiles: ModifiedFile[];
  timeline: TimelineEvent[];
  chat: ChatMessage[];
  verified: VerificationClaim[];
  unverified: VerificationClaim[];
  context: ContextItem[];
  pendingApproval?: ApprovalRequest;
  day: "Today" | "Yesterday" | "Earlier";
}

export type FileKind = "dir" | "file";
export type FileChangeState = "clean" | "modified" | "added" | "deleted" | "agent";

export interface FileNode {
  name: string;
  path: string;
  kind: FileKind;
  children?: FileNode[];
  changeState?: FileChangeState;
  symbolCount?: number;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  relTime: string;
}

export interface ModelSummary {
  id: string;
  family: string;
  quantization: string;
  sizeGb: number;
  memGb: number;
  role: "coding" | "planning" | "embedding";
  license: string;
  installed: boolean;
  active: boolean;
  perfClass: "fast" | "balanced" | "quality";
}

export interface HardwareReport {
  cpu: string;
  cores: number;
  ramGb: number;
  gpu: string;
  vramGb: number | null;
  accelerator: string;
  os: string;
  recommendedModel: string;
}

export type ConnectionState =
  | "starting"
  | "connecting"
  | "ready"
  | "degraded"
  | "reconnecting"
  | "incompatible"
  | "failed";
