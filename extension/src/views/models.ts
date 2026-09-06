import * as vscode from "vscode";
import { modelInstalls } from "@valyria/state";
import { WebviewBase } from "./webviewBase";
import { modelsModel, DEFAULT_MODEL_ROLE, MODEL_ROLES } from "../store/models";
import { promptAndInstallModel } from "./modelInstall";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { BridgeHost } from "../bridge/host";

interface ModelSummary {
  id: string;
  family: string;
  display_name?: string;
  quantization: string;
  parameters_b?: number;
  context_length?: number;
  size_bytes: number;
  installed: boolean;
  license: string;
  active_roles?: string[];
}

/**
 * The Model Manager (PLAN.md §20 / docs/MODEL-SETUP-PLAN.md). Choose and set
 * up a model without leaving the editor: a hardware-scored shortlist, live
 * install progress off the event stream, a license acceptance prompt, and
 * per-role activation.
 *
 * The extension has NO download path — install / cancel / activate / remove
 * all go through Core (gated on `model_manage`), which owns every weight byte
 * (§20, §38).
 */
export class ModelsViewProvider extends WebviewBase {
  static readonly viewId = "valyria.models";
  readonly viewId = ModelsViewProvider.viewId;
  protected readonly bundle = "models";

  private models: ModelSummary[] | null = null;
  private recommend: { role: string; recommended: unknown; candidates: unknown[] } | null = null;
  private role: string = DEFAULT_MODEL_ROLE;

  constructor(
    extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly supervisor: Supervisor,
    private readonly host: BridgeHost
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    return modelsModel({
      models: this.models,
      recommend: this.recommend,
      installs: modelInstalls(this.store.getState()),
      role: this.role,
      manageCapable: this.supervisor.has("model_manage"),
      hardwareCapable: this.supervisor.has("hardware"),
    });
  }

  protected onCommand(name: string, args: unknown): void {
    const a = (args ?? {}) as { id?: string; role?: string };
    switch (name) {
      case "refreshModels":
        void this.refresh();
        break;
      case "setModelRole":
        if (a.role && (MODEL_ROLES as readonly string[]).includes(a.role)) {
          this.role = a.role;
          this.recommend = null;
          this.push();
          void this.refresh();
        }
        break;
      case "installModel":
        if (a.id) void this.install(a.id);
        break;
      case "cancelModelInstall":
        if (a.id) void this.cancelInstall(a.id);
        break;
      case "activateModel":
        if (a.id && a.role) void this.activate(a.id, a.role);
        break;
      case "removeModel":
        if (a.id) void this.remove(a.id);
        break;
    }
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    void this.refresh();
    return [
      this.supervisor.onDidChange(refresh),
      // Install progress arrives on the event stream — re-render on every batch.
      { dispose: this.store.onDidChange(refresh) },
    ];
  }

  private async refresh(): Promise<void> {
    if (this.supervisor.state !== "ready") return;
    try {
      const r = (await this.host.client.request("model/list", {})) as { models?: ModelSummary[] };
      this.models = r.models ?? [];
    } catch {
      this.models = null;
    }
    if (this.supervisor.has("hardware")) {
      try {
        this.recommend = (await this.host.client.request("model/recommend", {
          role: this.role,
        })) as { role: string; recommended: unknown; candidates: unknown[] };
      } catch {
        this.recommend = null;
      }
    } else {
      this.recommend = null;
    }
    this.push();
  }

  private modelName(id: string): string {
    return this.models?.find((m) => m.id === id)?.display_name ?? id;
  }

  private async install(id: string): Promise<void> {
    const started = await promptAndInstallModel(this.host, id);
    if (started) setTimeout(() => void this.refresh(), 1000);
  }

  private async cancelInstall(id: string): Promise<void> {
    try {
      await this.host.client.request("model/cancelInstall", { id });
      void vscode.window.showInformationMessage(`Valyria: cancelling ${this.modelName(id)}.`);
    } catch (e) {
      void vscode.window.showErrorMessage(`Valyria: cancel failed — ${String(e)}`);
    }
  }

  private async activate(id: string, role: string): Promise<void> {
    try {
      await this.host.client.request("model/activate", { id, role });
      void vscode.window.showInformationMessage(
        `Valyria: ${this.modelName(id)} now serves “${role}”.`
      );
      setTimeout(() => void this.refresh(), 300);
    } catch (e) {
      void vscode.window.showErrorMessage(`Valyria: activate failed — ${String(e)}`);
    }
  }

  private async remove(id: string): Promise<void> {
    const REMOVE = "Remove";
    const choice = await vscode.window.showWarningMessage(
      `Remove ${this.modelName(id)}? Core deletes its weights and any role bindings.`,
      { modal: true },
      REMOVE
    );
    if (choice !== REMOVE) return;
    try {
      const r = (await this.host.client.request("model/remove", { id })) as { freed_bytes?: number };
      const freed = typeof r.freed_bytes === "number" ? ` — ${(r.freed_bytes / 1e9).toFixed(1)} GB reclaimed` : "";
      void vscode.window.showInformationMessage(`Valyria: removed ${this.modelName(id)}${freed}.`);
      setTimeout(() => void this.refresh(), 300);
    } catch (e) {
      void vscode.window.showErrorMessage(`Valyria: remove failed — ${String(e)}`);
    }
  }
}
