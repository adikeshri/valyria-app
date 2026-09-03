import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { agentCommandsModel } from "../store/models";
import type { Store } from "../store/store";
import type { TaskFocus } from "../session/focus";

export class AgentCommandsViewProvider extends WebviewBase {
  static readonly viewId = "valyria.commands";
  readonly viewId = AgentCommandsViewProvider.viewId;
  protected readonly bundle = "commands";

  constructor(
    extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly focus: TaskFocus
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    return agentCommandsModel(this.store.getState(), this.focus.pinned);
  }

  protected onCommand(): void {
    // Read-only (D7).
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    return [{ dispose: this.store.onDidChange(refresh) }, this.focus.onDidChange(refresh)];
  }
}
