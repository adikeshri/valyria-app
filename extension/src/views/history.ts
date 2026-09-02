import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { historyModel } from "../store/models";
import type { Store } from "../store/store";
import type { TaskFocus } from "../session/focus";

export class HistoryViewProvider extends WebviewBase {
  static readonly viewId = "valyria.history";
  readonly viewId = HistoryViewProvider.viewId;
  protected readonly bundle = "history";

  constructor(
    extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly focus: TaskFocus,
    private readonly dispatch: (name: string, args: unknown) => void
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    return historyModel(this.store.getState(), this.focus.pinned);
  }

  protected onCommand(name: string, args: unknown): void {
    this.dispatch(name, args);
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    return [
      { dispose: this.store.onDidChange(refresh) },
      this.focus.onDidChange(refresh),
    ];
  }
}
