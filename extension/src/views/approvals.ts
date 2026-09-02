import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { approvalsModel } from "../store/models";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { TaskFocus } from "../session/focus";

export class ApprovalsViewProvider extends WebviewBase {
  static readonly viewId = "valyria.approvals";
  readonly viewId = ApprovalsViewProvider.viewId;
  protected readonly bundle = "approvals";

  constructor(
    extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly supervisor: Supervisor,
    private readonly focus: TaskFocus,
    private readonly dispatch: (name: string, args: unknown) => void
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    return approvalsModel(
      this.store.getState(),
      this.focus.pinned,
      this.supervisor.has("approval_scope")
    );
  }

  protected onCommand(name: string, args: unknown): void {
    this.dispatch(name, args);
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    return [
      { dispose: this.store.onDidChange(refresh) },
      this.supervisor.onDidChange(refresh),
      this.focus.onDidChange(refresh),
    ];
  }
}
