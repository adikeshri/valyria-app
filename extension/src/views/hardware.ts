import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { hardwareModel } from "../store/models";
import type { Supervisor } from "../session/supervisor";
import type { BridgeHost } from "../bridge/host";

export class HardwareViewProvider extends WebviewBase {
  static readonly viewId = "valyria.hardware";
  readonly viewId = HardwareViewProvider.viewId;
  protected readonly bundle = "hardware";

  private probe: Record<string, unknown> | null = null;
  private recommend: {
    role: string;
    recommended: Record<string, unknown> | null;
    candidates: Record<string, unknown>[];
  } | null = null;

  constructor(
    extensionUri: vscode.Uri,
    private readonly supervisor: Supervisor,
    private readonly host: BridgeHost
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    return hardwareModel({
      probe: this.probe,
      recommend: this.recommend,
      hardwareCapable: this.supervisor.has("hardware"),
    });
  }

  protected onCommand(name: string): void {
    if (name === "refreshHardware") void this.refresh();
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    void this.refresh();
    return [this.supervisor.onDidChange(refresh)];
  }

  private async refresh(): Promise<void> {
    if (this.supervisor.state !== "ready") return;
    try {
      this.probe = (await this.host.client.request("hardware/probe", {})) as Record<string, unknown>;
    } catch {
      this.probe = null;
    }
    if (this.supervisor.has("hardware")) {
      try {
        this.recommend = (await this.host.client.request("model/recommend", { role: "code" })) as {
          role: string;
          recommended: Record<string, unknown> | null;
          candidates: Record<string, unknown>[];
        };
      } catch {
        this.recommend = null;
      }
    } else {
      this.recommend = null;
    }
    this.push();
  }
}
