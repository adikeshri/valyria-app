import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import { securityModel } from "../store/models";
import { activeTasks } from "@valyria/state";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { BridgeHost } from "../bridge/host";

interface ConfigEntry {
  key: string;
  value: string;
  origin: string;
}
interface DoctorCheck {
  name: string;
  status: string;
  detail: string;
  remediation?: string | null;
}

/** VALYRIA.md / AGENTS.md at the repo root are read by Core as agent
 *  instructions — "authorized". The same names elsewhere are ordinary files. */
const INSTRUCTION_FILES = ["VALYRIA.md", "AGENTS.md", ".valyria/VALYRIA.md"];

export class SecurityViewProvider extends WebviewBase {
  static readonly viewId = "valyria.security";
  readonly viewId = SecurityViewProvider.viewId;
  protected readonly bundle = "security";

  private configEntries: ConfigEntry[] | null = null;
  private doctor: { checks: DoctorCheck[]; summary: string } | null = null;
  private instructions: { name: string; text: string; authorized: boolean }[] = [];

  constructor(
    extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly supervisor: Supervisor,
    private readonly host: BridgeHost
  ) {
    super(extensionUri);
  }

  protected buildModel(): unknown {
    const s = this.supervisor.session;
    return securityModel({
      configEntries: this.configEntries,
      doctor: this.doctor,
      session: s
        ? {
            permissionMode: s.permissionMode,
            ownsDaemon: s.ownsDaemon,
            protocolVersion: s.protocolVersion,
            runtimeVersion: s.runtimeVersion,
          }
        : null,
      activeTasks: activeTasks(this.store.getState()).length,
      repoInstructions: this.instructions,
    });
  }

  protected onCommand(name: string, args: unknown): void {
    if (name === "refreshSecurity") {
      void this.refresh();
    } else if (name === "setAutonomy") {
      const mode = (args as { mode?: string } | undefined)?.mode;
      if (mode) void this.setAutonomy(mode);
    }
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    // fetch once when the view first resolves
    void this.refresh();
    return [
      this.supervisor.onDidChange(refresh),
      { dispose: this.store.onDidChange(refresh) },
    ];
  }

  private async refresh(): Promise<void> {
    if (this.supervisor.state === "ready") {
      try {
        const cfg = (await this.host.client.request("config/show", {})) as {
          entries?: ConfigEntry[];
        };
        this.configEntries = cfg?.entries ?? [];
      } catch {
        this.configEntries = null;
      }
      try {
        this.doctor = (await this.host.client.request("doctor/run", {})) as {
          checks: DoctorCheck[];
          summary: string;
        };
      } catch {
        this.doctor = null;
      }
    }
    await this.readInstructions();
    this.push();
  }

  private async readInstructions(): Promise<void> {
    const root = this.supervisor.session?.workspaceRoot;
    if (!root) {
      this.instructions = [];
      return;
    }
    const out: { name: string; text: string; authorized: boolean }[] = [];
    for (const rel of INSTRUCTION_FILES) {
      try {
        const uri = vscode.Uri.joinPath(vscode.Uri.file(root), rel);
        const bytes = await vscode.workspace.fs.readFile(uri);
        out.push({
          name: rel,
          text: Buffer.from(bytes).toString("utf8").slice(0, 20_000),
          authorized: !rel.includes("/") || rel.startsWith(".valyria/"),
        });
      } catch {
        /* not present */
      }
    }
    this.instructions = out;
  }

  private async setAutonomy(mode: string): Promise<void> {
    try {
      await this.host.client.request("session/restart", { permissionMode: mode });
      void vscode.window.showInformationMessage(`Valyria: Core restarted under ${mode} autonomy.`);
    } catch (e) {
      void vscode.window.showErrorMessage(`Valyria: could not change autonomy — ${String(e)}`);
    }
  }
}
