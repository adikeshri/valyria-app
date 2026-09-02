/**
 * Valyria — built-in extension entry point.
 *
 * activate(): start the bridge-host, wire the event store + supervisor + status
 * bar + views + commands, and (if a folder is open) connect to Core.
 *
 * Everything agent-related is a projection of `valyria-bridge-host` state
 * (PLAN.md D3). The editor itself (files, search, diff, git, terminal, debug, …)
 * is upstream Code-OSS and this extension does not touch it.
 */
import * as vscode from "vscode";
import { BridgeHost } from "./bridge/host";
import type { JsonRpcClient } from "./bridge/client";
import { registerCommands } from "./commands";
import { Supervisor } from "./session/supervisor";
import { StatusBar } from "./status";
import { Store } from "./store/store";
import { ActivityViewProvider } from "./views/activity";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("Valyria", { log: true });
  context.subscriptions.push(log);
  log.info("Valyria extension activating");

  const host = new BridgeHost(context, log);
  const store = new Store(log);
  const supervisor = new Supervisor(host, log);
  context.subscriptions.push(host, supervisor);

  try {
    host.start();
  } catch (e) {
    vscode.window.showErrorMessage(`Valyria: could not start the bridge host. ${String(e)}`);
    log.error(String(e));
    return;
  }

  /** Open (or re-open) the workspace session. `appliedThrough === 0` means a
   *  full replay from Core's journal, so the local store is reset first. */
  const reopen = async (root: string, appliedThrough: number): Promise<void> => {
    if (appliedThrough === 0) store.reset();
    try {
      await supervisor.open(root, appliedThrough);
      host.markHealthy();
    } catch (e) {
      log.error(`session/open failed: ${String(e)}`);
    }
  };

  // (Re)attach every stream listener to the current client. Re-run after an
  // auto-respawn, since respawn replaces the client object.
  const clientSubs: vscode.Disposable[] = [];
  const wireClient = (client: JsonRpcClient): void => {
    for (const d of clientSubs.splice(0)) d.dispose();
    clientSubs.push(
      { dispose: client.on("core/eventBatch", (b) => store.ingestBatch(b)) },
      {
        dispose: client.on("core/connectionState", (p) => {
          store.setConnection(p.state);
          supervisor.setState(p.state);
        }),
      },
      { dispose: client.on("core/reconnected", (p) => log.info(`stream resumed from seq ${p.resumeFrom}`)) },
      { dispose: client.on("core/closed", (p) => log.warn(`Core stream closed at seq ${p.lastSeq}`)) },
      {
        dispose: client.on("core/log", (p) => {
          log.appendLine(`[core] ${p.message}`);
          if (p.level === "info" && p.message.startsWith("Core restarted")) {
            void vscode.window.showInformationMessage(`Valyria: ${p.message}`);
          }
        }),
      }
    );
  };
  wireClient(host.client);

  context.subscriptions.push(
    host.onRespawn(() => {
      log.info("bridge-host respawned — re-wiring stream and re-opening the session");
      wireClient(host.client);
      const root =
        supervisor.session?.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root) void reopen(root, store.lastSeq);
    }),
    { dispose: () => { for (const d of clientSubs.splice(0)) d.dispose(); } }
  );

  context.subscriptions.push(new StatusBar(supervisor));

  const activity = new ActivityViewProvider(store, supervisor);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ActivityViewProvider.viewId, activity)
  );

  registerCommands(context, host, supervisor, store, log, reopen);

  host.onExit((code) => {
    if (code !== 0 && code !== null) {
      log.warn(
        `bridge host exited (${code}); auto-respawn will run. The Core daemon keeps running.`
      );
    }
  });

  // A folder already open in the window counts as authorization to connect.
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root) {
    await reopen(root, 0);
  } else {
    log.info("no folder open — waiting for 'Valyria: Open Repository for Agent'");
  }

  log.info("Valyria extension activated");
}

export function deactivate(): void {
  // context.subscriptions disposes BridgeHost → SIGTERM to the host.
  // The Core daemon is intentionally left running (PLAN.md D1).
}
