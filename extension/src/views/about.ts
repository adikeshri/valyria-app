import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { aboutModel } from "../store/models";
import type { Supervisor } from "../session/supervisor";
import type { BridgeHost } from "../bridge/host";

const WINDOWS_TIER3 = process.platform === "win32";

export class AboutViewProvider extends WebviewBase {
  static readonly viewId = "valyria.about";
  readonly viewId = AboutViewProvider.viewId;
  protected readonly bundle = "about";

  private about: { bridgeHost?: string; expectedProtocol?: string; compatibility?: string } | null = null;
  private models: { id: string; installed: boolean; active_roles?: string[] }[] = [];
  private activeModelIds = new Set<string>();

  constructor(
    extensionUri: vscode.Uri,
    private readonly supervisor: Supervisor,
    private readonly host: BridgeHost
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    const s = this.supervisor.session;
    return aboutModel({
      appName: `${vscode.env.appName} ${vscode.version}`,
      platform: `${process.platform} ${process.arch}`,
      windowsTier3: WINDOWS_TIER3,
      connection: this.supervisor.state,
      about: this.about,
      session: s
        ? {
            protocolVersion: s.protocolVersion,
            runtimeVersion: s.runtimeVersion,
            origin: s.origin,
            ownsDaemon: s.ownsDaemon,
            authenticated: s.authenticated,
            permissionMode: s.permissionMode,
            workspaceRoot: s.workspaceRoot,
          }
        : null,
      capabilities: this.supervisor.caps.list(),
      surfaces: this.supervisor.caps.snapshot(),
      models: this.models,
      activeModelIds: this.activeModelIds,
    });
  }

  protected onCommand(): void {
    /* read-only */
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    void this.fetch();
    return [this.supervisor.onDidChange(() => { void this.fetch(); refresh(); })];
  }

  private async fetch(): Promise<void> {
    try {
      this.about = (await this.host.client.request("about/info", {})) as typeof this.about;
    } catch {
      /* keep last */
    }
    if (this.supervisor.state === "ready") {
      try {
        const r = (await this.host.client.request("model/list", {})) as {
          models?: { id: string; installed: boolean; active_roles?: string[] }[];
        };
        this.models = r.models ?? [];
        // "Active" now comes straight from Core's role bindings, not a
        // heuristic over config keys.
        this.activeModelIds = new Set(
          this.models.filter((m) => (m.active_roles ?? []).length > 0).map((m) => m.id)
        );
      } catch {
        /* keep last */
      }
    }
    this.push();
  }
}
