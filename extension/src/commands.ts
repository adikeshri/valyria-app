/**
 * Command-palette / menu entries. Each is a thin wrapper over a bridge call —
 * no agent logic in the extension (PLAN.md §41 / D2).
 */
import * as vscode from "vscode";
import type { BridgeHost } from "./bridge/host";
import type { Supervisor } from "./session/supervisor";
import type { Store } from "./store/store";

type Reopen = (root: string, appliedThrough: number) => Promise<void>;

export function registerCommands(
  context: vscode.ExtensionContext,
  host: BridgeHost,
  supervisor: Supervisor,
  store: Store,
  log: vscode.LogOutputChannel,
  reopen: Reopen
): void {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  const pickRoot = async (): Promise<string | undefined> => {
    const open = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (open) return open;
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      openLabel: "Open for Valyria agent",
    });
    return picked?.[0]?.fsPath;
  };

  reg("valyria.openWorkspace", async () => {
    const root = await pickRoot();
    if (!root) return;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Valyria: connecting to Core…" },
      () => reopen(root, 0)
    );
  });

  reg("valyria.newTask", async () => {
    if (!supervisor.session) {
      await vscode.commands.executeCommand("valyria.openWorkspace");
      if (!supervisor.session) return;
    }
    const objective = await vscode.window.showInputBox({
      prompt: "What should the agent do?",
      placeHolder: "e.g. Add a --json flag to the export command and cover it with a test",
    });
    if (!objective) return;
    const { taskId } = await host.client.request("task/create", { objective });
    log.info(`task created: ${taskId}`);
    void vscode.window.showInformationMessage(`Valyria task started: ${taskId}`);
  });

  const taskCmd = (id: string, method: "task/pause" | "task/resume" | "task/cancel") =>
    reg(id, async () => {
      const verb = method.split("/")[1] ?? method;
      const taskId =
        store.currentTaskId() ??
        (await vscode.window.showInputBox({ prompt: `Task id to ${verb}` }));
      if (!taskId) return;
      await host.client.request(method, { taskId });
      log.info(`${method} ${taskId}`);
    });
  taskCmd("valyria.pauseTask", "task/pause");
  taskCmd("valyria.resumeTask", "task/resume");
  taskCmd("valyria.cancelTask", "task/cancel");

  reg("valyria.reconnect", async () => {
    const root =
      supervisor.session?.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    // Resume from what the store already has, so Core replays only the tail.
    await reopen(root, store.lastSeq);
  });

  reg("valyria.restartBridge", () => {
    host.restart();
  });

  reg("valyria.showAbout", async () => {
    // Reveal the About / Compatibility view (auto-registered `<viewId>.focus`).
    await vscode.commands.executeCommand("valyria.about.focus");
  });
}
