import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { chatModel } from "../store/models";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { TaskFocus } from "../session/focus";

export class ChatViewProvider extends WebviewBase {
  static readonly viewId = "valyria.chat";
  readonly viewId = ChatViewProvider.viewId;
  protected readonly bundle = "chat";

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
    return chatModel(this.store.getState(), this.focus.pinned, this.supervisor.state);
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
