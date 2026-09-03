/**
 * Status-bar presence.
 *
 * Two jobs:
 *   1. The things PLAN.md §4.1 / §32 say must always be visible — the Core
 *      connection state and the permanent `Local · Offline · Model` marker
 *      (reflecting observed state, never a hard-coded string).
 *   2. The Valyria identity cues (docs/UX-DIFFERENTIATION.md, lever E) — a live
 *      **agent ticker** that narrates the focused task ("Planning", "Editing 3
 *      files", "Blocked: approval", "Verifying"), and a one-click **layout mode**
 *      toggle. A moving status bar is a Valyria tell; a stationary one is a
 *      VS Code tell.
 */
import * as vscode from "vscode";
import type { Supervisor } from "./session/supervisor";
import type { Store } from "./store/store";
import type { TaskFocus } from "./session/focus";
import type { LayoutController } from "./session/layout";
import type { ConnectionState } from "./bridge/protocol";
import { tickerModel } from "./store/models";

const STATE_LABEL: Record<ConnectionState, string> = {
  starting: "$(loading~spin) Valyria: starting",
  connecting: "$(loading~spin) Valyria: connecting",
  ready: "$(pass-filled) Valyria",
  degraded: "$(warning) Valyria: degraded",
  reconnecting: "$(loading~spin) Valyria: reconnecting",
  incompatible: "$(error) Valyria: incompatible",
  failed: "$(error) Valyria: offline",
};

const TICKER_ICON: Record<string, string> = {
  idle: "sparkle",
  working: "loading~spin",
  blocked: "shield",
  paused: "debug-pause",
  done: "pass-filled",
  failed: "error",
};

export class StatusBar implements vscode.Disposable {
  private readonly ticker: vscode.StatusBarItem;
  private readonly item: vscode.StatusBarItem;
  private readonly offline: vscode.StatusBarItem;
  private readonly layoutItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private activeModel: string | null = null;
  private networkRuntime = false;

  constructor(
    private readonly supervisor: Supervisor,
    private readonly store: Store,
    private readonly focus: TaskFocus,
    private readonly layout: LayoutController
  ) {
    this.ticker = vscode.window.createStatusBarItem(
      "valyria.ticker",
      vscode.StatusBarAlignment.Left,
      101
    );
    this.ticker.command = "valyria.openWorkspacePanel";

    this.item = vscode.window.createStatusBarItem(
      "valyria.status",
      vscode.StatusBarAlignment.Left,
      100
    );
    this.item.command = "valyria.showAbout";

    this.offline = vscode.window.createStatusBarItem(
      "valyria.offline",
      vscode.StatusBarAlignment.Left,
      99
    );
    this.offline.command = "valyria.showAbout";

    this.layoutItem = vscode.window.createStatusBarItem(
      "valyria.layout",
      vscode.StatusBarAlignment.Left,
      98
    );
    this.layoutItem.command = "valyria.layout.toggleMode";

    this.disposables.push(
      this.ticker,
      this.item,
      this.offline,
      this.layoutItem,
      supervisor.onDidChange(() => this.render()),
      { dispose: store.onDidChange(() => this.render()) },
      focus.onDidChange(() => this.render()),
      this.layout.onDidChange(() => this.render())
    );
    this.render();
    this.item.show();
    this.offline.show();
    this.layoutItem.show();
  }

  /** Called by extension.ts when config / doctor data reveals the active model
   *  or a network-capable runtime — the marker reflects observed state (§32). */
  setRuntime(info: { activeModel?: string | null; networkRuntime?: boolean }): void {
    if (info.activeModel !== undefined) this.activeModel = info.activeModel;
    if (info.networkRuntime !== undefined) this.networkRuntime = info.networkRuntime;
    this.render();
  }

  private render(): void {
    const state = this.supervisor.state;
    const s = this.supervisor.session;

    // --- agent ticker -------------------------------------------------
    const t = tickerModel(this.store.getState(), this.focus.pinned, state);
    if (t.hasTask && t.phase) {
      this.ticker.text = `$(${TICKER_ICON[t.tone] ?? "sparkle"}) ${t.phase}`;
      this.ticker.tooltip = new vscode.MarkdownString(
        `**Valyria** — ${t.phase}\n\n${t.filesTouched} file(s) touched · open the Task Workspace`
      );
      this.ticker.backgroundColor =
        t.tone === "blocked" || t.tone === "failed"
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
      this.ticker.show();
    } else {
      this.ticker.hide();
    }

    // --- connection --------------------------------------------------
    this.item.text = STATE_LABEL[state];

    const net = this.networkRuntime ? "Network runtime" : "Local · Offline";
    const model = this.activeModel ? ` · Model: ${this.activeModel}` : "";
    this.offline.text = `$(${this.networkRuntime ? "globe" : "shield"}) ${net}${model}`;
    this.offline.tooltip = this.networkRuntime
      ? "Core reports a network-capable model runtime."
      : "Inference runs entirely on this machine. No telemetry, ever (PLAN.md §32).";

    const lines = [`Connection: ${state}`];
    if (s) {
      lines.push(
        `Workspace: ${s.workspaceRoot}`,
        `Protocol: ${s.protocolVersion}  ·  Runtime: ${s.runtimeVersion || "?"}`,
        `Daemon: ${s.origin}${s.ownsDaemon ? "" : " (adopted)"}`,
        `Autonomy: ${s.permissionMode ?? "n/a"}`,
        "",
        `${net}${model}`
      );
    }
    this.item.tooltip = new vscode.MarkdownString(lines.join("\n\n"));
    this.item.backgroundColor =
      state === "incompatible" || state === "failed"
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : state === "degraded"
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;

    // --- layout mode ----------------------------------------------
    const mode = this.layout.mode;
    this.layoutItem.text = `$(layout) ${mode === "agent" ? "Agent" : "Editor"}`;
    this.layoutItem.tooltip = new vscode.MarkdownString(
      `Valyria layout: **${mode}**\n\nClick to switch to ${mode === "agent" ? "Editor" : "Agent"} layout.`
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
