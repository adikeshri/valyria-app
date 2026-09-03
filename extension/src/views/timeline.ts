import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { timelineModel } from "../store/models";
import type { Store } from "../store/store";

export class TimelineViewProvider extends WebviewBase {
  static readonly viewId = "valyria.timeline";
  readonly viewId = TimelineViewProvider.viewId;
  protected readonly bundle = "timeline";

  constructor(
    extensionUri: vscode.Uri,
    private readonly store: Store
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    return timelineModel(this.store.getState());
  }

  protected onCommand(): void {
    // Timeline is read-only.
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    return [{ dispose: this.store.onDidChange(refresh) }];
  }
}
