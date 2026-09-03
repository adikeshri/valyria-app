/**
 * The single place webview intents (and the equivalent palette commands) turn
 * into bridge calls. No agent logic — just routing (PLAN.md §41 / D2).
 */
import * as vscode from "vscode";
import { approvalIsCurrent } from "@valyria/state";
import { CMD } from "../webviews/shared/protocol";
import type { BridgeHost } from "../bridge/host";
import type { Supervisor } from "../session/supervisor";
import type { TaskFocus } from "../session/focus";
import type { Store } from "../store/store";
import type { LayoutController } from "../session/layout";

export interface DispatchDeps {
  host: BridgeHost;
  store: Store;
  supervisor: Supervisor;
  focus: TaskFocus;
  layout: LayoutController;
  log: vscode.LogOutputChannel;
}

function argStr(args: unknown, key: string): string | undefined {
  const v = (args as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" ? v : undefined;
}

export function makeWebviewDispatch(deps: DispatchDeps): (name: string, args: unknown) => void {
  const { host, store, supervisor, focus, layout, log } = deps;

  const targetTask = (args: unknown): string | undefined =>
    argStr(args, "taskId") ?? focus.pinned ?? store.currentTaskId();

  /** In Agent layout a Valyria surface owns editor column one, so files/diffs
   *  open beside it as a detail pane. */
  const fileColumn = (): vscode.ViewColumn =>
    layout.mode === "agent" ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;

  const resolveWorkspaceUri = (path: string): vscode.Uri => {
    const root = supervisor.session?.workspaceRoot;
    return root && !path.startsWith("/")
      ? vscode.Uri.joinPath(vscode.Uri.file(root), path)
      : vscode.Uri.file(path);
  };

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
            const a = (args ?? {}) as Record<string, unknown>;
            const taskId = targetTask(args);
            const allow = Boolean(a["allow"]);
            const seq = typeof a["seq"] === "number" ? (a["seq"] as number) : undefined;
            const scope = a["scope"] === "task" ? "task" : "once";
            if (!taskId) return;
            // G2 supersession guard: never answer a prompt a newer
            // approval_requested has replaced — re-prompt via the store instead.
            if (seq !== undefined && !approvalIsCurrent(store.getState(), taskId, seq)) {
              log.warn(`approval seq ${seq} is stale for ${taskId}; not resolving`);
              void vscode.window.showWarningMessage(
                "Valyria: that approval was superseded by a newer request. Review it again."
              );
              return;
            }
            if (supervisor.has("approval_scope")) {
              await host.client.request("permission/resolveScoped", { taskId, allow, scope });
            } else {
              await host.client.request("permission/resolve", { taskId, allow });
            }
            log.info(`approval ${allow ? `allowed (${scope})` : "denied"} for ${taskId}`);
            break;
          }
          case CMD.openFile: {
            const path = argStr(args, "path");
            if (!path) return;
            const line = (args as Record<string, unknown>)["line"];
            const uri = resolveWorkspaceUri(path);
            const opts: vscode.TextDocumentShowOptions = {
              preview: true,
              viewColumn: fileColumn(),
            };
            if (typeof line === "number" && line > 0) {
              const pos = new vscode.Position(line - 1, 0);
              opts.selection = new vscode.Range(pos, pos);
            }
            await vscode.window.showTextDocument(uri, opts);
            break;
          }
          case CMD.openDiff: {
            const path = argStr(args, "path");
            if (!path) return;
            const uri = resolveWorkspaceUri(path);
            // Prefer the built-in Git extension's change view (working tree vs
            // HEAD); fall back to just opening the file if Git isn't present.
            try {
              await vscode.commands.executeCommand("git.openChange", uri);
            } catch {
              await vscode.window.showTextDocument(uri, {
                preview: true,
                viewColumn: fileColumn(),
              });
            }
            break;
          }
          case CMD.openSurface: {
            const surface = argStr(args, "surface");
            const cmd =
              surface === "home"
                ? "valyria.openHome"
                : surface === "workspace"
                  ? "valyria.openWorkspacePanel"
                  : surface === "review"
                    ? "valyria.openReview"
                    : null;
            if (cmd) await vscode.commands.executeCommand(cmd);
            break;
          }
          case CMD.setLayoutMode: {
            const mode = argStr(args, "mode");
            if (mode === "agent" || mode === "editor") {
              await layout.setMode(mode, { explicit: true });
            }
            break;
          }
          case CMD.rollbackTo: {
            const taskId = targetTask(args);
            const checkpointId = argStr(args, "checkpointId");
            const intent = argStr(args, "intent");
            if (!taskId || !checkpointId) return;
            const ok = await vscode.window.showWarningMessage(
              `Roll back to “${intent ?? checkpointId}”? Core restores the files it recorded at this checkpoint.`,
              { modal: true },
              "Roll back"
            );
            if (ok !== "Roll back") return;
            const r = (await host.client.request("task/rollback", { taskId, checkpointId })) as {
              restored_files?: string[];
              reverted_entries?: number;
            };
            void vscode.window.showInformationMessage(
              `Valyria: rolled back — ${r.reverted_entries ?? 0} entr${
                (r.reverted_entries ?? 0) === 1 ? "y" : "ies"
              } reverted, ${(r.restored_files ?? []).length} file(s) restored.`
            );
            log.info(`rollback ${taskId} -> ${checkpointId}: ${JSON.stringify(r)}`);
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
