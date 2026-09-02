import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { taskModel } from "../store/models";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { TaskFocus } from "../session/focus";

export class TaskViewProvider extends WebviewBase {
  static readonly viewId = "valyria.task";
  readonly viewId = TaskViewProvider.viewId;
  protected readonly bundle = "task";

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
    return taskModel(
      this.store.getState(),
      this.focus.pinned,
      this.supervisor.has("diagnostics_v2")
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
