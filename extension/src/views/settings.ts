import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { settingsModel } from "../store/models";
import type { Supervisor } from "../session/supervisor";
import type { BridgeHost } from "../bridge/host";

interface ConfigEntry {
  key: string;
  value: string;
  origin: string;
}

export class SettingsViewProvider extends WebviewBase {
  static readonly viewId = "valyria.settings";
  readonly viewId = SettingsViewProvider.viewId;
  protected readonly bundle = "settings";

  private entries: ConfigEntry[] | null = null;
  private known = new Set<string>();

  constructor(
    extensionUri: vscode.Uri,
    private readonly supervisor: Supervisor,
    private readonly host: BridgeHost
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    return settingsModel({ entries: this.entries });
  }

  protected onCommand(name: string, args: unknown): void {
    if (name === "writeConfig") void this.write(args as { key: string; value: string });
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    void this.refresh();
    return [this.supervisor.onDidChange(refresh)];
  }

  private async refresh(): Promise<void> {
    if (this.supervisor.state !== "ready") return;
    try {
      const c = (await this.host.client.request("config/show", {})) as { entries?: ConfigEntry[] };
      this.entries = c.entries ?? [];
      this.known = new Set(this.entries.map((e) => e.key));
    } catch {
      this.entries = null;
    }
    this.push();
  }

  private async write(a: { key: string; value: string }): Promise<void> {
    // D13: never write a key Core did not already report.
    if (!this.known.has(a.key)) {
      void vscode.window.showWarningMessage(`Valyria: won't write unknown config key "${a.key}".`);
      return;
    }
    try {
      const c = (await this.host.client.request("config/write", {
        key: a.key,
        value: a.value,
        scope: "workspace",
      })) as { entries?: ConfigEntry[] };
      // The response is a fresh config_show — render the effective value.
      this.entries = c.entries ?? this.entries;
      this.known = new Set((this.entries ?? []).map((e) => e.key));
      this.push();
      const eff = (this.entries ?? []).find((e) => e.key === a.key);
      if (eff && eff.value !== a.value) {
        void vscode.window.showInformationMessage(
          `Valyria: "${a.key}" resolved to "${eff.value}" (${eff.origin}) — a policy or precedence rule adjusted it.`
        );
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`Valyria: config write failed — ${String(e)}`);
    }
  }
}
