/**
 * Local OS notifications (PLAN.md §31) — opt-in per category, local only, no
 * push. Phase 4 wires the "permission required" one; a blocked approval raises
 * a toast with Allow / Deny that routes through the same dispatch as the panel.
 */
import * as vscode from "vscode";
import { pendingApprovalFor, currentTask } from "@valyria/state";
import { CMD } from "../webviews/shared/protocol";
import type { Store } from "../store/store";
import type { TaskFocus } from "./focus";
import type { Supervisor } from "./supervisor";

type Category = "completed" | "blocked" | "permission_required" | "tests_failed" | "waiting";

function enabled(cat: Category): boolean {
  const cats = vscode.workspace
    .getConfiguration("valyria")
    .get<string[]>("notifications.categories", []);
  return cats.includes(cat);
}

export function watchApprovalNotifications(
  store: Store,
  focus: TaskFocus,
  _supervisor: Supervisor,
  dispatch: (name: string, args: unknown) => void
): vscode.Disposable {
  let lastSeq = -1;

  const dispose = store.onDidChange(() => {
    const state = store.getState();
    const taskId = focus.pinned ?? currentTask(state)?.id;
    if (!taskId) return;
    const ap = pendingApprovalFor(state, taskId);
    if (!ap || ap.seq === lastSeq) return;
    lastSeq = ap.seq;

    if (!enabled("permission_required") && !enabled("blocked")) return;

    const p = (ap.payload ?? {}) as Record<string, unknown>;
    const prompt = typeof p["prompt"] === "string" ? (p["prompt"] as string) : "Approval requested";
    const risk = typeof p["risk"] === "string" ? (p["risk"] as string) : null;
    const high = risk === "destructive" || risk === "network" || risk === "elevated";

    const msg = `Valyria needs approval: ${prompt}`;
    const show = high
      ? vscode.window.showWarningMessage(msg, "Review", "Deny")
      : vscode.window.showInformationMessage(msg, "Allow once", "Deny", "Review");

    void show.then((pick) => {
      if (pick === "Allow once") {
        dispatch(CMD.resolveApproval, { allow: true, seq: ap.seq, scope: "once", taskId });
      } else if (pick === "Deny") {
        dispatch(CMD.resolveApproval, { allow: false, seq: ap.seq, taskId });
      } else if (pick === "Review") {
        void vscode.commands.executeCommand("valyria.approvals.focus");
      }
    });
  });

  return { dispose };
}
