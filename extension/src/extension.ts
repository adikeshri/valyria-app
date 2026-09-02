/**
 * Valyria — built-in extension entry point.
 *
 * activate(): start the bridge-host, wire the supervisor + status bar + views +
 * commands, and (if a folder is open) connect to Core for that workspace.
 *
 * Everything agent-related is a projection of `valyria-bridge-host` state. The
 * editor itself (files, search, diff, git, terminal, debug, …) is upstream
 * Code-OSS and this extension does not touch it.
 */
import * as vscode from "vscode";
import { BridgeHost } from "./bridge/host";
import { registerCommands } from "./commands";
import { Supervisor } from "./session/supervisor";
import { StatusBar } from "./status";
import { ActivityViewProvider } from "./views/activity";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("Valyria", { log: true });
  context.subscriptions.push(log);
  log.info("Valyria extension activating");

  const host = new BridgeHost(context, log);
  context.subscriptions.push(host);

  try {
    host.start();
  } catch (e) {
    vscode.window.showErrorMessage(`Valyria: could not start the bridge host. ${String(e)}`);
    log.error(String(e));
    return;
  }

  const supervisor = new Supervisor(host, log);
  context.subscriptions.push(supervisor);
  context.subscriptions.push(new StatusBar(supervisor));

  const activity = new ActivityViewProvider(host);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ActivityViewProvider.viewId, activity)
  );

  registerCommands(context, host, supervisor, log);

  host.onExit((code) => {
    if (code !== 0 && code !== null) {
      vscode.window
        .showWarningMessage(
          `Valyria bridge host exited (${code}). The Core daemon keeps running.`,
          "Restart"
        )
        .then((pick) => {
          if (pick === "Restart") vscode.commands.executeCommand("valyria.restartBridge");
        });
    }
  });

  // Auto-connect when a single folder is open — opening a repo is still an
  // explicit authorization act, but a folder already open in the window counts.
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root) {
    supervisor.open(root).catch((e) => {
      log.error(`initial session/open failed: ${String(e)}`);
      vscode.window.showErrorMessage(`Valyria: ${String(e)}`);
    });
  }

  log.info("Valyria extension activated");
}

export function deactivate(): void {
  // context.subscriptions handles BridgeHost.dispose() → SIGTERM to the host.
  // The Core daemon is intentionally left running (PLAN.md D1).
}
