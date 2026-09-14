import * as vscode from "vscode";
import { modelServers } from "@valyria/state";
import { WebviewBase } from "./webviewBase";
import { modelChatModel, DEFAULT_MODEL_ROLE } from "../store/models";
import type { ModelSummary } from "../store/models";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { TaskFocus } from "../session/focus";
import type { BridgeHost } from "../bridge/host";

/**
 * Model Chat — the product's primary surface (right-hand Secondary Side
 * Bar, like Cursor's chat). A message here becomes a real Core task
 * (`task/create`): the full agent loop — system prompt, tools, plan,
 * verification — not a raw model probe. The left sidebar carries nothing
 * but the Models panel (for install/remove); which installed model is
 * *active* is picked right here, since that's the one Model Chat–specific
 * decision — everything else (task progress, tool activity, approvals)
 * surfaces inline here instead of in its own panel.
 */
export class ModelChatViewProvider extends WebviewBase {
  static readonly viewId = "valyria.modelChat";
  readonly viewId = ModelChatViewProvider.viewId;
  protected readonly bundle = "modelChat";

  private models: ModelSummary[] | null = null;
  private recommend: { role: string; recommended: unknown; candidates: unknown[] } | null = null;
  // Mirrors `ModelsViewProvider.pendingAction`: `model/activate` blocks for
  // as long as the server takes to boot, so the picker disables itself
  // rather than let a re-selection race the first and boot two servers.
  private activating = false;

  constructor(
    extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly supervisor: Supervisor,
    private readonly focus: TaskFocus,
    private readonly host: BridgeHost,
    private readonly dispatch: (name: string, args: unknown) => void
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    return modelChatModel(this.store.getState(), this.focus.pinned, this.supervisor.state, {
      inferenceCapable: this.supervisor.has("model_inference"),
      models: this.models,
      allowForTaskSupported: this.supervisor.has("approval_scope"),
      activating: this.activating,
      recommend: this.recommend,
    });
  }

  protected onCommand(name: string, args: unknown): void {
    if (name === "openModelManager") {
      void vscode.commands.executeCommand("valyria.models.focus");
      return;
    }
    if (name === "activateModel") {
      const id = (args as { id?: string } | undefined)?.id;
      if (id && !this.activating) void this.activate(id);
      return;
    }
    // createTask, cancelTask, resolveApproval, openSurface, openDiff,
    // openFile, setLayoutMode, rollbackTo — all already routed centrally.
    this.dispatch(name, args);
  }

  private modelName(id: string): string {
    return this.models?.find((m) => m.id === id)?.display_name ?? id;
  }

  private async activate(id: string): Promise<void> {
    this.activating = true;
    this.push();
    try {
      // Server lifecycle (`model_server_starting`/`_ready`/`_failed`) drives
      // the status pill live; this call's own success/failure drives the
      // toast, same split as the Models panel's own `activate`.
      await this.host.client.request("model/activate", { id, role: DEFAULT_MODEL_ROLE });
      void vscode.window.showInformationMessage(`Valyria: ${this.modelName(id)} is now the active coding model.`);
    } catch (e) {
      void vscode.window.showErrorMessage(`Valyria: activate failed — ${String(e)}`);
    } finally {
      this.activating = false;
      // A model that was never previously activated may emit no terminal
      // `model_server_*` event to trip `onStoreChange`'s refetch — but
      // `model/list`'s `active_roles` just changed either way, so fetch it
      // directly rather than wait.
      void this.refreshModels();
    }
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    void this.refreshModels();
    return [
      { dispose: this.store.onDidChange(() => this.onStoreChange(refresh)) },
      this.supervisor.onDidChange(refresh),
      this.focus.onDidChange(refresh),
    ];
  }

  private lastTerminalSeq = 0;

  /** `active_roles` (which model is bound to `primary_coder`) only ever
   *  changes alongside a server reaching a terminal state — same gate
   *  the Models panel uses to know when to re-fetch `model/list`. */
  private onStoreChange(cheapRerender: () => void): void {
    const state = this.store.getState();
    const latestTerminal = Math.max(
      0,
      ...modelServers(state)
        .filter((s) => s.state === "ready" || s.state === "failed" || s.state === "stopped")
        .map((s) => s.lastSeq)
    );
    if (latestTerminal > this.lastTerminalSeq) {
      this.lastTerminalSeq = latestTerminal;
      void this.refreshModels();
    } else {
      cheapRerender();
    }
  }

  private async refreshModels(): Promise<void> {
    if (this.supervisor.state !== "ready") return;
    try {
      const r = (await this.host.client.request("model/list", {})) as { models?: ModelSummary[] };
      this.models = r.models ?? [];
    } catch {
      this.models = null;
    }
    // Only to flag a model with no coding suitability at all (see
    // `unratedForCoding`'s doc comment) — `null` on failure/incapability
    // means "unknown," so nothing gets (mis-)flagged.
    if (this.supervisor.has("hardware")) {
      try {
        this.recommend = (await this.host.client.request("model/recommend", {
          role: DEFAULT_MODEL_ROLE,
        })) as { role: string; recommended: unknown; candidates: unknown[] };
      } catch {
        this.recommend = null;
      }
    } else {
      this.recommend = null;
    }
    this.push();
  }
}
