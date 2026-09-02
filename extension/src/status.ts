/**
 * Status-bar presence: the three things PLAN.md §4.1 says must always be visible
 * — active model, runtime/connection status, and the Local · Offline marker.
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
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly supervisor: Supervisor) {
    this.item = vscode.window.createStatusBarItem(
      "valyria.status",
      vscode.StatusBarAlignment.Left,
      100
    );
    this.item.command = "valyria.showAbout";
    this.disposables.push(
      this.item,
      supervisor.onDidChange(() => this.render())
    );
    this.render();
    this.item.show();
  }

  private render(): void {
    const state = this.supervisor.state;
    const s = this.supervisor.session;
    this.item.text = STATE_LABEL[state];
    const lines = [`Connection: ${state}`];
    if (s) {
      lines.push(
        `Workspace: ${s.workspaceRoot}`,
        `Protocol: ${s.protocolVersion}  ·  Runtime: ${s.runtimeVersion || "?"}`,
        `Daemon: ${s.origin}${s.ownsDaemon ? "" : " (adopted)"}`,
        `Autonomy: ${s.permissionMode ?? "n/a"}`,
        "",
        "Local · Offline"
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
