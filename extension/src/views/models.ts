import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { modelsModel } from "../store/models";
import type { Supervisor } from "../session/supervisor";
import type { BridgeHost } from "../bridge/host";

interface ModelSummary {
  id: string;
  family: string;
  quantization: string;
  size_bytes: number;
  installed: boolean;
  license: string;
}
interface ConfigEntry {
  key: string;
  value: string;
  origin: string;
}

export class ModelsViewProvider extends WebviewBase {
  static readonly viewId = "valyria.models";
  readonly viewId = ModelsViewProvider.viewId;
  protected readonly bundle = "models";

  private models: ModelSummary[] | null = null;
  private config: ConfigEntry[] | null = null;

  constructor(
    extensionUri: vscode.Uri,
    private readonly supervisor: Supervisor,
    private readonly host: BridgeHost
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    return modelsModel({
      models: this.models,
      configEntries: this.config,
      manageCapable: this.supervisor.has("model_manage"),
    });
  }

  protected onCommand(name: string, args: unknown): void {
    if (name === "refreshModels") void this.refresh();
    else if (name === "manageModel") void this.manage(args as { id: string; action: string });
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    void this.refresh();
    return [this.supervisor.onDidChange(refresh)];
  }

  private async refresh(): Promise<void> {
    if (this.supervisor.state !== "ready") return;
    try {
      const r = (await this.host.client.request("model/list", {})) as { models?: ModelSummary[] };
      this.models = r.models ?? [];
    } catch {
      this.models = null;
    }
    try {
      const c = (await this.host.client.request("config/show", {})) as { entries?: ConfigEntry[] };
      this.config = c.entries ?? [];
    } catch {
      this.config = null;
    }
    this.push();
  }

  private async manage(a: { id: string; action: string }): Promise<void> {
    const verb = a.action;
    const confirm = await vscode.window.showWarningMessage(
      `${verb[0]!.toUpperCase()}${verb.slice(1)} model “${a.id}”? Core performs this locally.`,
      { modal: true },
      verb[0]!.toUpperCase() + verb.slice(1)
    );
    if (!confirm) return;
    const method = ({ install: "model/install", remove: "model/remove", activate: "model/activate" } as const)[
      a.action as "install" | "remove" | "activate"
    ];
    try {
      await this.host.client.request(method, { id: a.id });
      void vscode.window.showInformationMessage(`Valyria: ${verb} started for ${a.id}.`);
      setTimeout(() => void this.refresh(), 1500);
    } catch (e) {
      void vscode.window.showErrorMessage(`Valyria: ${verb} failed — ${String(e)}`);
    }
  }
}
