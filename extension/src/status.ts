/**
 * Status-bar presence: the things PLAN.md §4.1 / §32 say must always be visible
 * — connection status, and the permanent `Local · Offline · Model: <id>` marker
 * (which reflects observed state, not a hard-coded string).
 */
import * as vscode from "vscode";
import type { Supervisor } from "./session/supervisor";
import type { ConnectionState } from "./bridge/protocol";

const STATE_LABEL: Record<ConnectionState, string> = {
  starting: "$(loading~spin) Valyria: starting",
  connecting: "$(loading~spin) Valyria: connecting",
  ready: "$(pass-filled) Valyria",
  degraded: "$(warning) Valyria: degraded",
  reconnecting: "$(loading~spin) Valyria: reconnecting",
  incompatible: "$(error) Valyria: incompatible",
  failed: "$(error) Valyria: offline",
};

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly offline: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private activeModel: string | null = null;
  private networkRuntime = false;

  constructor(private readonly supervisor: Supervisor) {
    this.item = vscode.window.createStatusBarItem("valyria.status", vscode.StatusBarAlignment.Left, 100);
    this.item.command = "valyria.showAbout";
    this.offline = vscode.window.createStatusBarItem("valyria.offline", vscode.StatusBarAlignment.Left, 99);
    this.offline.command = "valyria.showAbout";
    this.disposables.push(
      this.item,
      this.offline,
      supervisor.onDidChange(() => this.render())
    );
    this.render();
    this.item.show();
    this.offline.show();
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
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
