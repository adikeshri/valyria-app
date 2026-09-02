/**
 * Command-palette / menu entries. Each is a thin wrapper over a bridge call —
 * no agent logic in the extension (PLAN.md §41 / D2).
 */
import * as vscode from "vscode";
import type { BridgeHost } from "./bridge/host";
import type { Supervisor } from "./session/supervisor";

export function registerCommands(
  context: vscode.ExtensionContext,
  host: BridgeHost,
  supervisor: Supervisor,
  log: vscode.LogOutputChannel
): void {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("valyria.openWorkspace", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let root = folder;
    if (!root) {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        openLabel: "Open for Valyria agent",
      });
      root = picked?.[0]?.fsPath;
    }
    if (!root) return;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Valyria: connecting to Core…" },
      () => supervisor.open(root!)
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
    vscode.window.showInformationMessage(`Valyria task started: ${taskId}`);
  });

  const taskCmd = (id: string, method: "task/pause" | "task/resume" | "task/cancel") =>
    reg(id, async () => {
      const taskId = await vscode.window.showInputBox({ prompt: `Task id to ${method.split("/")[1]}` });
      if (!taskId) return;
      await host.client.request(method, { taskId });
    });
  taskCmd("valyria.pauseTask", "task/pause");
  taskCmd("valyria.resumeTask", "task/resume");
  taskCmd("valyria.cancelTask", "task/cancel");

  reg("valyria.reconnect", async () => {
    const root = supervisor.session?.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    await supervisor.open(root);
  });

  reg("valyria.restartBridge", async () => {
    host.stop();
    host.start();
    await new Promise((r) => setTimeout(r, 200));
    await supervisor.refreshStatus();
  });

  reg("valyria.showAbout", async () => {
    let about: Record<string, unknown> = {};
    try {
      about = await host.client.request("about/info", {});
    } catch (e) {
      about = { error: String(e) };
    }
    const s = supervisor.session;
    const doc = await vscode.workspace.openTextDocument({
      language: "json",
      content: JSON.stringify(
        {
          connectionState: supervisor.state,
          session: s ?? null,
          about,
        },
        null,
        2
      ),
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  });
}
