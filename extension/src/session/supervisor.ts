/**
 * Thin session state around the bridge-host: which workspace is open, the
 * negotiated capabilities, and the connection state the status bar renders.
 *
 * The real supervision (spawn / adopt / health / reap of `valyria serve`) lives
 * in the Rust `valyria-bridge`. This object just tracks what the host reports.
 */
import * as vscode from "vscode";
import type { BridgeHost } from "../bridge/host";
import type { ConnectionState, SessionInfo } from "../bridge/protocol";

export class Supervisor implements vscode.Disposable {
  private _session: SessionInfo | undefined;
  private _state: ConnectionState = "starting";
  private readonly disposables: vscode.Disposable[] = [];

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly host: BridgeHost,
    private readonly log: vscode.LogOutputChannel
  ) {
    const c = host.client;
    this.disposables.push(
      { dispose: c.on("core/connectionState", (p) => {
          this._state = p.state;
          this.log.info(`connection: ${p.state}${p.detail ? ` (${p.detail})` : ""}`);
          this._onDidChange.fire();
        }) },
      { dispose: c.on("core/reconnected", (p) => {
          this.log.info(`stream resumed from seq ${p.resumeFrom}`);
        }) },
      host.onExit(() => {
        this._state = "failed";
        this._session = undefined;
        this._onDidChange.fire();
      })
    );
  }

  get session(): SessionInfo | undefined {
    return this._session;
  }

  get state(): ConnectionState {
    return this._state;
  }

  has(capability: string): boolean {
    return this._session?.capabilities.includes(capability) ?? false;
  }

  async open(workspaceRoot: string): Promise<SessionInfo> {
    this._state = "connecting";
    this._onDidChange.fire();
    const mode = vscode.workspace
      .getConfiguration("valyria")
      .get<string>("autonomy.defaultMode", "manual");
    try {
      const info = await this.host.client.request("session/open", {
        workspaceRoot,
        permissionMode: mode,
      });
      this._session = info;
      this._state = "ready";
      this.log.info(
        `session ready: ${info.workspaceRoot} · protocol ${info.protocolVersion} · ` +
          `${info.origin} · caps [${info.capabilities.join(", ")}]`
      );
      this._onDidChange.fire();
      return info;
    } catch (e) {
      this._state = "failed";
      this._onDidChange.fire();
      throw e;
    }
  }

  async refreshStatus(): Promise<void> {
    try {
      const info = await this.host.client.request("session/status", {});
      this._session = info ?? undefined;
      this._onDidChange.fire();
    } catch (e) {
      this.log.error(`session/status failed: ${String(e)}`);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this._onDidChange.dispose();
  }
}
