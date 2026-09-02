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
import { TaskFocus } from "./session/focus";
import { StatusBar } from "./status";
import { Store } from "./store/store";
import { ActivityViewProvider } from "./views/activity";
import { ChatViewProvider } from "./views/chat";
import { TaskViewProvider } from "./views/task";
import { TimelineViewProvider } from "./views/timeline";
import { HistoryViewProvider } from "./views/history";
import { ApprovalsViewProvider } from "./views/approvals";
import { SecurityViewProvider } from "./views/security";
import { VerificationViewProvider } from "./views/verification";
import { AgentCommandsViewProvider } from "./views/agentCommands";
import { FileOwnershipDecorations } from "./views/ownership";
import { makeWebviewDispatch } from "./views/dispatch";
import { maybePromptResume } from "./session/resume";
import { watchApprovalNotifications } from "./session/notify";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("Valyria", { log: true });
  context.subscriptions.push(log);
  log.info("Valyria extension activating");

  const host = new BridgeHost(context, log);
  const store = new Store(log);
  const supervisor = new Supervisor(host, log);
  const focus = new TaskFocus();
  context.subscriptions.push(host, supervisor, focus);

  try {
    host.start();
  } catch (e) {
    vscode.window.showErrorMessage(`Valyria: could not start the bridge host. ${String(e)}`);
    log.error(String(e));
    return;
  }

  const dispatch = makeWebviewDispatch({ host, store, supervisor, focus, log });
  let resumePrompted = false;

  const reopen = async (root: string, appliedThrough: number): Promise<void> => {
    if (appliedThrough === 0) {
      store.reset();
      focus.clear();
      resumePrompted = false;
    }
    try {
      await supervisor.open(root, appliedThrough);
      host.markHealthy();
    } catch (e) {
      log.error(`session/open failed: ${String(e)}`);
    }
  };

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

  // Once events have started flowing after a fresh open, offer to resume any
  // non-terminal task (PLAN.md §4.16 / §30).
  context.subscriptions.push({
    dispose: store.onDidChange(() => {
      if (resumePrompted || supervisor.state !== "ready") return;
      resumePrompted = true;
      void maybePromptResume(store, focus, dispatch, log);
    }),
  });

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

  context.subscriptions.push(
    watchApprovalNotifications(store, focus, supervisor, dispatch),
    new FileOwnershipDecorations(store, focus, supervisor, host, log)
  );

  const uri = context.extensionUri;
  const views: Array<[string, vscode.WebviewViewProvider]> = [
    [ChatViewProvider.viewId, new ChatViewProvider(uri, store, supervisor, focus, dispatch)],
    [TaskViewProvider.viewId, new TaskViewProvider(uri, store, supervisor, focus, dispatch)],
    [ActivityViewProvider.viewId, new ActivityViewProvider(uri, store, supervisor)],
    [ApprovalsViewProvider.viewId, new ApprovalsViewProvider(uri, store, supervisor, focus, dispatch)],
    [AgentCommandsViewProvider.viewId, new AgentCommandsViewProvider(uri, store, focus)],
    [VerificationViewProvider.viewId, new VerificationViewProvider(uri, store, focus, supervisor, host)],
    [SecurityViewProvider.viewId, new SecurityViewProvider(uri, store, supervisor, host)],
    [TimelineViewProvider.viewId, new TimelineViewProvider(uri, store)],
    [HistoryViewProvider.viewId, new HistoryViewProvider(uri, store, focus, dispatch)],
  ];
  for (const [id, provider] of views) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(id, provider, {
        webviewOptions: { retainContextWhenHidden: true },
      })
    );
  }

  registerCommands(context, host, supervisor, store, log, reopen);

  host.onExit((code) => {
    if (code !== 0 && code !== null) {
      log.warn(
        `bridge host exited (${code}); auto-respawn will run. The Core daemon keeps running.`
      );
    }
  });

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
