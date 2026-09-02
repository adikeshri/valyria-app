/**
 * Lifecycle of the `valyria-bridge-host` child process.
 *
 * One host per extension activation (i.e. per window / per workspace). It is a
 * plain child process speaking JSON-RPC on stdio; Core's Unix socket lives
 * entirely inside it (the extension never opens a socket — PLAN.md D9).
 *
 * On an *unexpected* exit the host is respawned with bounded backoff. The Core
 * daemon it supervised keeps running independently (PLAN.md D1), so a respawned
 * host re-adopts it on the next `session/open`.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { JsonRpcClient } from "./client";

const RESPAWN_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

export class BridgeHost implements vscode.Disposable {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private _client: JsonRpcClient | undefined;
  private intentionalStop = false;
  private respawns = 0;
  private respawnTimer: NodeJS.Timeout | undefined;

  private readonly _onExit = new vscode.EventEmitter<number | null>();
  /** Fires on every host exit (before any auto-respawn). */
  readonly onExit = this._onExit.event;

  private readonly _onRespawn = new vscode.EventEmitter<void>();
  /** Fires when a fresh client is available after an auto-respawn. */
  readonly onRespawn = this._onRespawn.event;

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
    this.intentionalStop = false;

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
    proc.on("exit", (code) => this.onProcExit(code));
    proc.on("error", (e) => this.log.error(`bridge-host spawn error: ${e.message}`));

    this._client = new JsonRpcClient(proc.stdout, proc.stdin);
    return this._client;
  }

  private onProcExit(code: number | null): void {
    this.log.warn(`bridge-host exited: ${code}`);
    this._client?.dispose();
    this._client = undefined;
    this.proc = undefined;
    this._onExit.fire(code);

    if (this.intentionalStop) return;
    if (this.respawns >= RESPAWN_BACKOFF_MS.length) {
      this.log.error("bridge-host crashed too many times; not respawning");
      return;
    }
    const delay = RESPAWN_BACKOFF_MS[this.respawns] ?? 8000;
    this.respawns += 1;
    this.log.info(`respawning bridge-host in ${delay}ms (attempt ${this.respawns})`);
    this.respawnTimer = setTimeout(() => {
      try {
        this.start();
        this._onRespawn.fire();
      } catch (e) {
        this.log.error(`bridge-host respawn failed: ${String(e)}`);
      }
    }, delay);
  }

  /** Call after a successful `session/open` — a healthy run resets the counter. */
  markHealthy(): void {
    this.respawns = 0;
  }

  stop(): void {
    this.intentionalStop = true;
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this._client?.dispose();
    this._client = undefined;
    if (this.proc && this.proc.exitCode === null) {
      // The daemon outlives us by design (PLAN.md D1). SIGTERM is enough.
      this.proc.kill("SIGTERM");
    }
    this.proc = undefined;
  }

  /** stop() + start(), for the "Restart Bridge Host" command. */
  restart(): void {
    this.stop();
    this.respawns = 0;
    this.start();
  }

  dispose(): void {
    this.stop();
    this._onExit.dispose();
    this._onRespawn.dispose();
  }

  private resolveBinary(): string {
    const configured = vscode.workspace
      .getConfiguration("valyria")
      .get<string>("bridge.hostPath");
    if (configured && existsSync(configured)) return configured;

    const exe =
      process.platform === "win32" ? "valyria-bridge-host.exe" : "valyria-bridge-host";

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
