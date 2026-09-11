import * as vscode from "vscode";
import { engineInstalls, modelInstalls, modelServers } from "@valyria/state";
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
    const state = this.store.getState();
    return modelsModel({
      models: this.models,
      recommend: this.recommend,
      installs: modelInstalls(state),
      servers: modelServers(state),
      engineInstall: engineInstalls(state)[0] ?? null,
      role: this.role,
      manageCapable: this.supervisor.has("model_manage"),
      hardwareCapable: this.supervisor.has("hardware"),
      inferenceCapable: this.supervisor.has("model_inference"),
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
      case "restartServer":
        if (a.id && a.role) void this.restartServer(a.id, a.role);
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
      // Every batch re-renders cheaply (install/server progress lives in
      // the store already); a batch that actually finished an install or
      // changed a server's state also re-fetches `model/list` so
      // `installed` / `active_roles` — which only that RPC carries —
      // catch up without a guessed `setTimeout`.
      { dispose: this.store.onDidChange(() => this.onStoreChange(refresh)) },
    ];
  }

  private lastTerminalSeq = 0;

  /** Only a *terminal* install/server event changes what `model/list`
   *  reports (`installed`, `active_roles`) — an in-flight
   *  `model_install_progress` tick doesn't, so re-fetching on every one of
   *  those would just be chatty. Everything else still re-renders cheaply
   *  off the store's already-current progress bars. */
  private onStoreChange(cheapRerender: () => void): void {
    const state = this.store.getState();
    const latestTerminal = Math.max(
      0,
      ...modelInstalls(state)
        .filter((m) => m.status !== "running")
        .map((m) => m.lastSeq),
      ...modelServers(state)
        .filter((s) => s.state === "ready" || s.state === "failed" || s.state === "stopped")
        .map((s) => s.lastSeq)
    );
    if (latestTerminal > this.lastTerminalSeq) {
      this.lastTerminalSeq = latestTerminal;
      void this.refresh();
    } else {
      cheapRerender();
    }
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
    // No `setTimeout` follow-up needed: `onStoreChange` re-fetches
    // `model/list` itself the moment `model_install_completed` /
    // `_failed` lands on the event stream.
    await promptAndInstallModel(this.host, id);
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
      // Blocks until the server (when `model_inference` is served) answers
      // `/health` or fails — the `model_server_starting`/`_ready`/`_failed`
      // events arrive first and drive the chip; this call's own
      // success/failure drives the toast.
      await this.host.client.request("model/activate", { id, role });
      void vscode.window.showInformationMessage(
        `Valyria: ${this.modelName(id)} now serves “${role}”.`
      );
    } catch (e) {
      void vscode.window.showErrorMessage(`Valyria: activate failed — ${String(e)}`);
    }
  }

  private async restartServer(id: string, role: string): Promise<void> {
    try {
      await this.host.client.request("model/restartServer", { id, role });
    } catch (e) {
      void vscode.window.showErrorMessage(`Valyria: restart failed — ${String(e)}`);
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
      // A removed model that was never activated emits no `model_server_*`
      // event for `onStoreChange` to catch — but we know for certain
      // `model/list` just changed, so fetch it directly rather than wait.
      void this.refresh();
    } catch (e) {
      void vscode.window.showErrorMessage(`Valyria: remove failed — ${String(e)}`);
    }
  }
}
