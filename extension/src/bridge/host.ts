/**
 * Lifecycle of the `valyria-bridge-host` child process.
 *
 * One host per extension activation (i.e. per window / per workspace). It is a
 * plain child process speaking JSON-RPC on stdio; Core's Unix socket lives
 * entirely inside it (the extension never opens a socket — PLAN.md D9).
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { JsonRpcClient } from "./client";

export class BridgeHost implements vscode.Disposable {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private _client: JsonRpcClient | undefined;
  private readonly _onExit = new vscode.EventEmitter<number | null>();
  readonly onExit = this._onExit.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel
  ) {}

  get client(): JsonRpcClient {
    if (!this._client) throw new Error("bridge-host not started");
    return this._client;
  }

  get running(): boolean {
    return this.proc !== undefined && this.proc.exitCode === null;
  }

  start(): JsonRpcClient {
    if (this.running) return this.client;

    const bin = this.resolveBinary();
    this.log.info(`spawning bridge-host: ${bin}`);
    const env: NodeJS.ProcessEnv = { ...process.env };
    const coreBin = vscode.workspace
      .getConfiguration("valyria")
      .get<string>("core.binaryPath");
    if (coreBin) env.VALYRIA_BIN = coreBin;

    const proc = spawn(bin, ["--stdio"], { env, stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;

    proc.stderr.on("data", (b: Buffer) => {
      for (const line of b.toString("utf8").split("\n")) {
        if (line.trim()) this.log.debug(`[host] ${line}`);
      }
    });
    proc.on("exit", (code) => {
      this.log.warn(`bridge-host exited: ${code}`);
      this._client?.dispose();
      this._client = undefined;
      this.proc = undefined;
      this._onExit.fire(code);
    });
    proc.on("error", (e) => this.log.error(`bridge-host spawn error: ${e.message}`));

    this._client = new JsonRpcClient(proc.stdout, proc.stdin);
    return this._client;
  }

  stop(): void {
    this._client?.dispose();
    this._client = undefined;
    if (this.proc && this.proc.exitCode === null) {
      // Graceful: the host tells its Core daemon nothing (the daemon outlives us
      // by design — PLAN.md D1). SIGTERM is enough.
      this.proc.kill("SIGTERM");
    }
    this.proc = undefined;
  }

  dispose(): void {
    this.stop();
    this._onExit.dispose();
  }

  private resolveBinary(): string {
    const configured = vscode.workspace
      .getConfiguration("valyria")
      .get<string>("bridge.hostPath");
    if (configured && existsSync(configured)) return configured;

    const exe = process.platform === "win32"
      ? "valyria-bridge-host.exe"
      : "valyria-bridge-host";

    // Bundled next to the extension (scripts/dev.sh + scripts/build.sh drop it here).
    const bundled = join(this.context.extensionPath, "bin", exe);
    if (existsSync(bundled)) return bundled;

    // Fallback: the resources dir of a packaged build.
    const resources = join(vscode.env.appRoot, "..", "bin", exe);
    if (existsSync(resources)) return resources;

    throw new Error(
      `valyria-bridge-host not found. Looked at:\n  ${bundled}\n  ${resources}\n` +
        `Set "valyria.bridge.hostPath" or run scripts/dev.sh.`
    );
  }
}
