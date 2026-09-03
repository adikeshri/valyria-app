import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { verificationModel } from "../store/models";
import { resolveFocus } from "../store/models";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { TaskFocus } from "../session/focus";
import type { BridgeHost } from "../bridge/host";

interface Report {
  status: string;
  verified: { kind: string; command: string; outcome: string; run_id: string }[];
  unverified: string[];
}

export class VerificationViewProvider extends WebviewBase {
  static readonly viewId = "valyria.verification";
  readonly viewId = VerificationViewProvider.viewId;
  protected readonly bundle = "verification";

  private cache = new Map<string, Report>();
  private fetching = new Set<string>();

  constructor(
    extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly focus: TaskFocus,
    private readonly supervisor: Supervisor,
    private readonly host: BridgeHost
  ) {
    super(extensionUri);
  }

  private currentTaskId(): string | undefined {
    return resolveFocus(this.store.getState(), this.focus.pinned);
  }

  protected buildModel(): unknown {
    const id = this.currentTaskId() ?? null;
    return verificationModel({
      taskId: id,
      report: id ? (this.cache.get(id) ?? null) : null,
    });
  }

  protected onCommand(name: string): void {
    if (name === "refreshVerification") {
      const id = this.currentTaskId();
      if (id) {
        this.cache.delete(id);
        void this.fetch(id);
      }
    }
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    const maybeFetch = () => {
      const id = this.currentTaskId();
      if (id && !this.cache.has(id)) void this.fetch(id);
      refresh();
    };
    maybeFetch();
    return [
      { dispose: this.store.onDidChange(maybeFetch) },
      this.focus.onDidChange(maybeFetch),
      this.supervisor.onDidChange(refresh),
    ];
  }

  private async fetch(taskId: string): Promise<void> {
    if (this.supervisor.state !== "ready" || this.fetching.has(taskId)) return;
    this.fetching.add(taskId);
    try {
      const r = (await this.host.client.request("task/report", { taskId })) as Report;
      this.cache.set(taskId, r);
      this.push();
    } catch {
      /* leave uncached — the view shows "no report yet" + a retry */
    } finally {
      this.fetching.delete(taskId);
    }
  }
}
