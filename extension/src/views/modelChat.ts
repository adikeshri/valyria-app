import * as vscode from "vscode";
import { modelServers } from "@valyria/state";
import { WebviewBase } from "./webviewBase";
import { modelChatModel } from "../store/models";
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
 * but the Models panel; everything else (task progress, tool activity,
 * approvals) surfaces inline here instead of in its own panel.
 */
export class ModelChatViewProvider extends WebviewBase {
  static readonly viewId = "valyria.modelChat";
  readonly viewId = ModelChatViewProvider.viewId;
  protected readonly bundle = "modelChat";

  private models: ModelSummary[] | null = null;

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
    });
  }

  protected onCommand(name: string, args: unknown): void {
    if (name === "openModelManager") {
      void vscode.commands.executeCommand("valyria.models.focus");
      return;
    }
    // createTask, cancelTask, resolveApproval, openSurface, openDiff,
    // openFile, setLayoutMode, rollbackTo — all already routed centrally.
    this.dispatch(name, args);
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
    this.push();
  }
}
