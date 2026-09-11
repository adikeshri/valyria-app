/**
 * Resume-on-launch (PLAN.md §4.16 / §30).
 *
 * After a fresh session's events have hydrated the store, if a task is in a
 * non-terminal state we ask: Resume / Inspect / Discard. State recovery is
 * entirely Core's (`task_resume` / `task_cancel`); the app only asks.
 */
import * as vscode from "vscode";
import { activeTasks } from "@valyria/state";
import { CMD } from "../webviews/shared/protocol";
import type { Store } from "../store/store";
import type { TaskFocus } from "./focus";
import type { BridgeHost } from "../bridge/host";

export async function maybePromptResume(
  store: Store,
  focus: TaskFocus,
  dispatch: (name: string, args: unknown) => void,
  host: BridgeHost,
  log: vscode.LogOutputChannel
): Promise<void> {
  const nonTerminal = activeTasks(store.getState());
  if (nonTerminal.length === 0) return;

  const t = nonTerminal[0]!;
  const label = (t.objective ?? t.id).slice(0, 80);
  const state = t.state.replace(/_/g, " ");
  log.info(`resume prompt: task ${t.id} is ${state}`);

  const pick = await vscode.window.showInformationMessage(
    `Valyria: a task is ${state} — “${label}”`,
    "Resume",
    "Inspect",
    "Discard"
  );
  if (pick === "Resume") {
    dispatch(CMD.resumeTask, { taskId: t.id });
  } else if (pick === "Inspect") {
    focus.pin(t.id);
    void vscode.commands.executeCommand("valyria.modelChat.focus");
  } else if (pick === "Discard") {
    const sure = await vscode.window.showWarningMessage(
      `Discard the ${state} task? Core will cancel it.`,
      { modal: true },
      "Discard task"
    );
    if (sure === "Discard task") {
      // `task/cancel` alone only sets a durable flag a *currently running*
      // driver would notice — but a task a resume prompt exists for is
      // exactly the case where nothing is running it any more, so that
      // flag would just sit unhonored forever. `task/resume` recovers the
      // task and spawns a fresh driver loop, which checks the pending
      // signal before doing anything else — so setting the cancel first,
      // then resuming, actually terminates it instead of quietly reviving
      // it back into normal operation.
      await host.client.request("task/cancel", { taskId: t.id });
      await host.client.request("task/resume", { taskId: t.id });
    }
  }
}
