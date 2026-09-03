import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { contextModel } from "../store/models";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { TaskFocus } from "../session/focus";

export class ContextViewProvider extends WebviewBase {
  static readonly viewId = "valyria.context";
  readonly viewId = ContextViewProvider.viewId;
  protected readonly bundle = "context";

  constructor(
    extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly supervisor: Supervisor,
    private readonly focus: TaskFocus
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    return contextModel(this.store.getState(), this.focus.pinned, this.supervisor.has("context"));
  }

  protected onCommand(): void {
    /* read-only */
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    return [
      { dispose: this.store.onDidChange(refresh) },
      this.supervisor.onDidChange(refresh),
      this.focus.onDidChange(refresh),
    ];
  }
}
