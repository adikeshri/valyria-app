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
import { modelInstalls, modelServers } from "@valyria/state";
import { BridgeHost } from "./bridge/host";
import type { JsonRpcClient } from "./bridge/client";
import { registerCommands } from "./commands";
import { Supervisor } from "./session/supervisor";
import { TaskFocus } from "./session/focus";
import { LayoutController } from "./session/layout";
import { StatusBar } from "./status";
import { Store } from "./store/store";
import { FileOwnershipDecorations } from "./views/ownership";
import { ModelsViewProvider } from "./views/models";
import { ModelChatViewProvider } from "./views/modelChat";
import { EditorPanelManager } from "./views/editorPanels";
import { ValyriaDocEditorProvider, VALYRIA_DOC_VIEW } from "./views/customEditors";
import { makeWebviewDispatch } from "./views/dispatch";
import { maybePromptResume } from "./session/resume";
import { watchNotifications } from "./session/notify";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("Valyria", { log: true });
  context.subscriptions.push(log);
  log.info("Valyria extension activating");

  const host = new BridgeHost(context, log);
  const store = new Store(log);
  const supervisor = new Supervisor(host, log);
  const focus = new TaskFocus();
  const layout = new LayoutController(context, log);
  context.subscriptions.push(host, supervisor, focus, layout);
  await layout.applyOnActivate();

  try {
    host.start();
  } catch (e) {
    vscode.window.showErrorMessage(`Valyria: could not start the bridge host. ${String(e)}`);
    log.error(String(e));
    return;
  }

  const dispatch = makeWebviewDispatch({ host, store, supervisor, focus, layout, log });
  const panels = new EditorPanelManager(
    context.extensionUri,
    store,
    supervisor,
    focus,
    layout,
    host,
    dispatch,
    log
  );
  context.subscriptions.push(panels);
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
      void refreshRuntimeMarker();
    } catch (e) {
      log.error(`session/open failed: ${String(e)}`);
    }
  };

  // Reflect observed state into the Local · Offline · Model marker (§32).
  const refreshRuntimeMarker = async (): Promise<void> => {
    if (supervisor.state !== "ready") return;
    try {
      // The active model is whatever `model/list` reports as bound to the
      // primary coding role (Core's `active_roles`); no config-key guessing.
      let activeModel: string | null = null;
      try {
        const list = (await host.client.request("model/list", {})) as {
          models?: { id: string; display_name?: string; active_roles?: string[] }[];
        };
        const primary =
          (list.models ?? []).find((m) => (m.active_roles ?? []).includes("primary_coder")) ??
          (list.models ?? []).find((m) => (m.active_roles ?? []).length > 0);
        activeModel = primary ? (primary.display_name ?? primary.id) : null;
      } catch {
        /* leave activeModel null */
      }
      const doc = (await host.client.request("doctor/run", {})) as {
        checks?: { name: string; status: string; detail: string }[];
      };
      const networkRuntime = (doc.checks ?? []).some(
        (c) => /network|online|remote.?model/i.test(c.name) && c.status === "pass" && /enabled|allowed|reachable/i.test(c.detail)
      );
      const runtime = { activeModel, networkRuntime };
      statusBar.setRuntime(runtime);
      panels.setRuntime(runtime);
    } catch {
      /* marker stays at its safe default: Local · Offline */
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
      void maybePromptResume(store, focus, dispatch, host, log);
    }),
  });

  // `refreshRuntimeMarker` otherwise only runs once, right after
  // `supervisor.open()` — so the status bar's "Model: …" text went stale
  // the moment a user activated, restarted, or removed a model from the
  // Model Manager for the rest of the session. Re-run it whenever a
  // *terminal* model-install or model-server event lands (not on every
  // progress tick, which doesn't change `active_roles`).
  let lastModelTerminalSeq = 0;
  context.subscriptions.push({
    dispose: store.onDidChange(() => {
      if (supervisor.state !== "ready") return;
      const state = store.getState();
      const latest = Math.max(
        0,
        ...modelInstalls(state)
          .filter((m) => m.status !== "running")
          .map((m) => m.lastSeq),
        ...modelServers(state)
          .filter((s) => s.state === "ready" || s.state === "failed" || s.state === "stopped")
          .map((s) => s.lastSeq)
      );
      if (latest > lastModelTerminalSeq) {
        lastModelTerminalSeq = latest;
        void refreshRuntimeMarker();
      }
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

  const statusBar = new StatusBar(supervisor, store, focus, layout);
  context.subscriptions.push(statusBar);

  // `valyria.hasSession` gates the task-oriented palette entries (package.json
  // contributes.menus.commandPalette).
  const syncSessionContext = () =>
    void vscode.commands.executeCommand(
      "setContext",
      "valyria.hasSession",
      supervisor.state === "ready" && !!supervisor.session
    );
  context.subscriptions.push(supervisor.onDidChange(syncSessionContext));
  syncSessionContext();

  context.subscriptions.push(
    watchNotifications(store, focus, supervisor, dispatch),
    new FileOwnershipDecorations(store, focus, supervisor, host, log)
  );

  const uri = context.extensionUri;
  // The sidebar (left) is Models only — everything else the app does now
  // happens through Model Chat, on the right.
  const views: Array<[string, vscode.WebviewViewProvider]> = [
    [ModelsViewProvider.viewId, new ModelsViewProvider(uri, store, supervisor, host)],
    [ModelChatViewProvider.viewId, new ModelChatViewProvider(uri, store, supervisor, focus, host, dispatch)],
  ];
  for (const [id, provider] of views) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(id, provider, {
        webviewOptions: { retainContextWhenHidden: true },
      })
    );
  }

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      VALYRIA_DOC_VIEW,
      new ValyriaDocEditorProvider(uri),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }
    )
  );

  registerCommands({ context, host, supervisor, store, layout, panels, log, reopen });

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

  // Land on the Valyria Home surface instead of the Code-OSS Welcome page
  // (docs/UX-DIFFERENTIATION.md, lever D): in Agent layout it is the centre of
  // gravity, and with no folder open it is the natural entry point. Skipped
  // when the window restored editors — the user's own session wins.
  const hasRestoredEditors = vscode.window.tabGroups.all.some((g) => g.tabs.length > 0);
  if (!hasRestoredEditors && (layout.mode === "agent" || !root)) {
    void panels.open("home");
  }

  // Model Chat lives in its own Secondary Side Bar container (right-hand
  // side, like Cursor's chat) rather than tucked into the Valyria
  // activity-bar container. Reveal it once so it's immediately visible —
  // after that the user's own layout (moved, closed, whatever) wins, same
  // as any other view.
  const modelChatRevealedKey = "valyria.modelChatRevealed";
  if (!context.globalState.get(modelChatRevealedKey)) {
    await context.globalState.update(modelChatRevealedKey, true);
    void vscode.commands.executeCommand(`${ModelChatViewProvider.viewId}.focus`);
  }

  log.info("Valyria extension activated");
}

export function deactivate(): void {
  // context.subscriptions disposes BridgeHost → SIGTERM to the host.
  // The Core daemon is intentionally left running (PLAN.md D1).
}
