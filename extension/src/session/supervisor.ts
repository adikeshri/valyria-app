/**
 * Session state around the bridge-host: which workspace is open, the negotiated
 * capabilities, and the connection state the status bar renders.
 *
 * The real supervision (spawn / adopt / health / reap of `valyria serve`) lives
 * in the Rust `valyria-bridge` + `valyria-bridge-host`. This object is a passive
 * projection of what the host reports; `extension.ts` drives it from the single
 * client-notification wiring (so it survives a host respawn).
 */
import * as vscode from "vscode";
import type { BridgeHost } from "../bridge/host";
import type { ConnectionState, SessionInfo } from "../bridge/protocol";
import { Capabilities } from "./capabilities";

export class Supervisor implements vscode.Disposable {
  private _session: SessionInfo | undefined;
  private _state: ConnectionState = "starting";
  /** The D6 registry, refreshed from every `hello` (via `session/open`). */
  readonly caps = new Capabilities();

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly host: BridgeHost,
    private readonly log: vscode.LogOutputChannel
  ) {}

  get session(): SessionInfo | undefined {
    return this._session;
  }

  get state(): ConnectionState {
    return this._state;
  }

  has(capability: string): boolean {
    return this.caps.has(capability);
  }

  /** Driven by `extension.ts` from `core/connectionState`. */
  setState(s: ConnectionState): void {
    if (this._state === s) return;
    this._state = s;
    this.log.info(`connection: ${s}`);
    this._onDidChange.fire();
  }

  async open(workspaceRoot: string, appliedThrough = 0): Promise<SessionInfo> {
    this._state = "connecting";
    this._onDidChange.fire();
    const mode = vscode.workspace
      .getConfiguration("valyria")
      .get<string>("autonomy.defaultMode", "manual");
    try {
      const info = await this.host.client.request("session/open", {
        workspaceRoot,
        permissionMode: mode,
        appliedThrough,
      });
      this._session = info;
      this.caps.set(info.capabilities);
      this._state = "ready";
      this.log.info(
        `session ready: ${info.workspaceRoot} · protocol ${info.protocolVersion} · ` +
          `${info.origin} · caps [${info.capabilities.join(", ")}]`
      );
      this._onDidChange.fire();
      return info;
    } catch (e) {
      this._state = "failed";
      this.caps.clear();
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
    this._onDidChange.dispose();
  }
}
