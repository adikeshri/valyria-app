/**
 * Command-palette / menu entries. Each is a thin wrapper over a bridge call or a
 * UI action — no agent logic in the extension (PLAN.md §41 / D2).
 *
 * Titles are task-oriented Valyria verbs (docs/UX-DIFFERENTIATION.md, lever E):
 * "Start a Task", "Review Changes", "Open Home", "Agent Layout".
 */
import * as vscode from "vscode";
import { testResultsForTask } from "@valyria/state";
import type { BridgeHost } from "./bridge/host";
import type { Supervisor } from "./session/supervisor";
import type { Store } from "./store/store";
import type { LayoutController, LayoutMode } from "./session/layout";
import type { EditorPanelManager } from "./views/editorPanels";
import { resolveFocus } from "./store/models";

type Reopen = (root: string, appliedThrough: number) => Promise<void>;

export interface CommandDeps {
  context: vscode.ExtensionContext;
  host: BridgeHost;
  supervisor: Supervisor;
  store: Store;
  layout: LayoutController;
  panels: EditorPanelManager;
  log: vscode.LogOutputChannel;
  reopen: Reopen;
}

export function registerCommands(deps: CommandDeps): void {
  const { context, host, supervisor, store, layout, panels, log, reopen } = deps;
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
    await panels.open("workspace");
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
    await reopen(root, store.lastSeq);
  });

  reg("valyria.restartBridge", () => {
    host.restart();
  });

  reg("valyria.showAbout", async () => {
    await vscode.commands.executeCommand("valyria.about.focus");
  });

  // --- editor-area surfaces (docs/UX-DIFFERENTIATION.md, lever D) ---
  reg("valyria.openHome", () => panels.open("home"));
  reg("valyria.openWorkspacePanel", () => panels.open("workspace"));
  reg("valyria.openReview", () => panels.open("review"));
  reg("valyria.reviewChanges", () => panels.open("review"));

  // --- dual-mode layout (lever C) ---
  const setMode = (mode: LayoutMode) => layout.setMode(mode, { explicit: true });
  reg("valyria.layout.setMode", (arg: unknown) => {
    const mode = typeof arg === "string" ? arg : (arg as { mode?: string } | undefined)?.mode;
    if (mode === "agent" || mode === "editor") return setMode(mode);
    return layout.toggle();
  });
  reg("valyria.layout.agentMode", () => setMode("agent"));
  reg("valyria.layout.editorMode", () => setMode("editor"));
  reg("valyria.layout.toggleMode", () => layout.toggle());

  // --- explain a failure (lever E): compose an objective from observed state ---
  reg("valyria.explainFailure", async () => {
    if (!supervisor.session) return;
    const taskId = resolveFocus(store.getState(), undefined);
    const failing = taskId
      ? testResultsForTask(store.getState(), taskId)
          .filter((t) => t.outcome === "failed")
          .at(-1)
      : undefined;
    const seed = failing
      ? `Explain why this fails and propose a fix: ${failing.summary ?? failing.command}`
      : "Explain the most recent failure and propose a fix.";
    const objective = await vscode.window.showInputBox({
      prompt: "Send to the agent",
      value: seed,
    });
    if (!objective) return;
    const { taskId: id } = await host.client.request("task/create", { objective });
    log.info(`explain-failure task created: ${id}`);
    await panels.open("workspace");
  });
}
