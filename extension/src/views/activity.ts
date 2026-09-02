/**
 * Activity view — thin `WebviewBase` subclass. All rendering lives in
 * `src/webviews/activity/`; this side just builds the model from the store +
 * supervisor and re-pushes on change.
 *
 * Phase 3 swaps the webview body for the ported rich panel; the model and this
 * wiring do not change.
 */
import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { ActivityModel } from "../webviews/shared/protocol";

export class ActivityViewProvider extends WebviewBase {
  static readonly viewId = "valyria.activity";
  readonly viewId = ActivityViewProvider.viewId;
  protected readonly bundle = "activity";

  constructor(
    extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly supervisor: Supervisor
  ) {
    super(extensionUri);
  }

  protected buildModel(): ActivityModel {
    return {
      connection: this.supervisor.state,
      lines: this.store.activityLines(),
      degraded: this.store.degradedCount(),
    };
  }

  protected onCommand(): void {
    // Activity is read-only.
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    return [
      { dispose: this.store.onDidChange(refresh) },
      this.supervisor.onDidChange(refresh),
    ];
  }
}
