/**
 * The single place webview intents (and the equivalent palette commands) turn
 * into bridge calls. No agent logic — just routing (PLAN.md §41 / D2).
 */
import * as vscode from "vscode";
import { CMD } from "../webviews/shared/protocol";
import type { BridgeHost } from "../bridge/host";
import type { TaskFocus } from "../session/focus";
import type { Store } from "../store/store";

export interface DispatchDeps {
  host: BridgeHost;
  store: Store;
  focus: TaskFocus;
  log: vscode.LogOutputChannel;
}

function argStr(args: unknown, key: string): string | undefined {
  const v = (args as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" ? v : undefined;
}

export function makeWebviewDispatch(deps: DispatchDeps): (name: string, args: unknown) => void {
  const { host, store, focus, log } = deps;

  const targetTask = (args: unknown): string | undefined =>
    argStr(args, "taskId") ?? focus.pinned ?? store.currentTaskId();

  return (name: string, args: unknown): void => {
    void (async () => {
      try {
        switch (name) {
          case CMD.createTask: {
            const objective = argStr(args, "objective")?.trim();
            if (!objective) return;
            const { taskId } = await host.client.request("task/create", { objective });
            focus.pin(taskId);
            log.info(`task created: ${taskId}`);
            break;
          }
          case CMD.pauseTask:
          case CMD.resumeTask:
          case CMD.cancelTask: {
            const taskId = targetTask(args);
            if (!taskId) return;
            const method = (
              { [CMD.pauseTask]: "task/pause", [CMD.resumeTask]: "task/resume", [CMD.cancelTask]: "task/cancel" } as const
            )[name];
            await host.client.request(method, { taskId });
            log.info(`${method} ${taskId}`);
            break;
          }
          case CMD.focusTask: {
            const taskId = argStr(args, "taskId");
            if (taskId) focus.pin(taskId);
            break;
          }
          case CMD.resolveApproval: {
            const taskId = targetTask(args);
            const allow = Boolean((args as Record<string, unknown> | undefined)?.["allow"]);
            if (!taskId) return;
            await host.client.request("permission/resolve", { taskId, allow });
            log.info(`approval ${allow ? "allowed" : "denied"} for ${taskId}`);
            break;
          }
          default:
            log.warn(`unknown webview command: ${name}`);
        }
      } catch (e) {
        log.error(`command ${name} failed: ${String(e)}`);
        void vscode.window.showErrorMessage(`Valyria: ${String(e)}`);
      }
    })();
  };
}
