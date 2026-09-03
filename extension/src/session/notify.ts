/**
 * Local OS notifications (PLAN.md §31) — opt-in per category, local only, no
 * push. Categories: completed, blocked, permission_required, tests_failed,
 * waiting.
 */
import * as vscode from "vscode";
import { pendingApprovalFor, currentTask, tasksByRecency } from "@valyria/state";
import { CMD } from "../webviews/shared/protocol";
import type { Store } from "../store/store";
import type { TaskFocus } from "./focus";
import type { Supervisor } from "./supervisor";

type Category = "completed" | "blocked" | "permission_required" | "tests_failed" | "waiting";

function enabled(cat: Category): boolean {
  return vscode.workspace
    .getConfiguration("valyria")
    .get<string[]>("notifications.categories", [])
    .includes(cat);
}

export function watchNotifications(
  store: Store,
  focus: TaskFocus,
  _supervisor: Supervisor,
  dispatch: (name: string, args: unknown) => void
): vscode.Disposable {
  let lastApprovalSeq = -1;
  const notifiedTerminal = new Set<string>();
  const notifiedTestFail = new Set<string>();

  const dispose = store.onDidChange(() => {
    const state = store.getState();

    // --- pending approval ---
    const taskId = focus.pinned ?? currentTask(state)?.id;
    if (taskId) {
      const ap = pendingApprovalFor(state, taskId);
      if (ap && ap.seq !== lastApprovalSeq) {
        lastApprovalSeq = ap.seq;
        if (enabled("permission_required") || enabled("blocked")) {
          const p = (ap.payload ?? {}) as Record<string, unknown>;
          const prompt = typeof p["prompt"] === "string" ? (p["prompt"] as string) : "Approval requested";
          const risk = typeof p["risk"] === "string" ? (p["risk"] as string) : null;
          const high = risk === "destructive" || risk === "network" || risk === "elevated";
          const show = high
            ? vscode.window.showWarningMessage(`Valyria needs approval: ${prompt}`, "Review", "Deny")
            : vscode.window.showInformationMessage(`Valyria needs approval: ${prompt}`, "Allow once", "Deny", "Review");
          void show.then((pick) => {
            if (pick === "Allow once") dispatch(CMD.resolveApproval, { allow: true, seq: ap.seq, scope: "once", taskId });
            else if (pick === "Deny") dispatch(CMD.resolveApproval, { allow: false, seq: ap.seq, taskId });
            else if (pick === "Review") void vscode.commands.executeCommand("valyria.approvals.focus");
          });
        }
      }
    }

    // --- terminal transitions + test failures ---
    for (const t of tasksByRecency(state)) {
      if (t.terminal && !notifiedTerminal.has(t.id)) {
        notifiedTerminal.add(t.id);
        const label = (t.objective ?? t.id).slice(0, 60);
        if (t.state === "completed" && enabled("completed")) {
          void vscode.window.showInformationMessage(`Valyria: task completed — “${label}”`);
        } else if (t.state === "failed" && enabled("completed")) {
          void vscode.window.showWarningMessage(`Valyria: task failed — “${label}”`);
        }
      }
      if (t.state === "waiting_for_permission" && enabled("waiting") && !notifiedTerminal.has(`wait:${t.id}`)) {
        notifiedTerminal.add(`wait:${t.id}`);
      }
    }

    if (enabled("tests_failed")) {
      for (const e of state.events) {
        if (e.kind !== "test_failed") continue;
        const key = `${e.taskId}:${e.seq}`;
        if (notifiedTestFail.has(key)) continue;
        notifiedTestFail.add(key);
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const summary = typeof p["summary"] === "string" ? (p["summary"] as string) : "tests failed";
        void vscode.window.showWarningMessage(`Valyria: ${summary}`);
      }
    }
  });

  return { dispose };
}
