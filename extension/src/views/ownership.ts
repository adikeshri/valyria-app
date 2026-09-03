/**
 * Change ownership (PLAN.md §4.8 / D7 / D8, gap G8).
 *
 * A `FileDecorationProvider` that badges explorer entries the agent authored
 * (or that a concurrent user edit has since touched), sourced ONLY from Core's
 * ledger (`ledger_changes`). When the `ledger` capability is absent there are
 * no decorations and no guessing — the app never infers ownership from
 * file-touch order.
 */
import * as vscode from "vscode";
import { resolveFocus } from "../store/models";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { TaskFocus } from "../session/focus";
import type { BridgeHost } from "../bridge/host";

interface LedgerChange {
  path: string;
  classification: string; // agent_authored | pre_existing | concurrent_user_modification | unknown
  kind: string; // write | delete
}

const AGENT = new vscode.FileDecoration(
  "A",
  "Agent-authored change (Core ledger)",
  new vscode.ThemeColor("charts.purple")
);
const CONCURRENT = new vscode.FileDecoration(
  "!",
  "Agent change plus a concurrent user edit (Core ledger)",
  new vscode.ThemeColor("editorWarning.foreground")
);

export class FileOwnershipDecorations
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  /** fsPath → classification */
  private byPath = new Map<string, string>();
  private lastTaskId: string | undefined;
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    private readonly store: Store,
    private readonly focus: TaskFocus,
    private readonly supervisor: Supervisor,
    private readonly host: BridgeHost,
    private readonly log: vscode.LogOutputChannel
  ) {
    this.subs.push(
      vscode.window.registerFileDecorationProvider(this),
      { dispose: this.store.onDidChange(() => this.maybeRefresh()) },
      this.focus.onDidChange(() => this.maybeRefresh()),
      this.supervisor.onDidChange(() => this.maybeRefresh())
    );
  }

  /** True when Core exposes the ledger; the UI marks the surface unavailable otherwise. */
  get available(): boolean {
    return this.supervisor.has("ledger");
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const c = this.byPath.get(uri.fsPath);
    if (c === "agent_authored") return AGENT;
    if (c === "concurrent_user_modification") return CONCURRENT;
    return undefined;
  }

  private maybeRefresh(): void {
    const taskId = resolveFocus(this.store.getState(), this.focus.pinned);
    if (taskId === this.lastTaskId) return;
    this.lastTaskId = taskId;
    if (!taskId || !this.available || this.supervisor.state !== "ready") {
      this.clear();
      return;
    }
    void this.fetch(taskId);
  }

  private async fetch(taskId: string): Promise<void> {
    try {
      const r = (await this.host.client.request("ledger/changes", { taskId })) as {
        changes?: LedgerChange[];
      };
      const root = this.supervisor.session?.workspaceRoot;
      const next = new Map<string, string>();
      for (const ch of r.changes ?? []) {
        const fs = root ? vscode.Uri.joinPath(vscode.Uri.file(root), ch.path).fsPath : ch.path;
        next.set(fs, ch.classification);
      }
      const changed = new Set([...this.byPath.keys(), ...next.keys()]);
      this.byPath = next;
      this._onDidChange.fire([...changed].map((p) => vscode.Uri.file(p)));
      this.log.info(`ledger: ${next.size} owned path(s) for ${taskId}`);
    } catch (e) {
      this.log.error(`ledger/changes failed: ${String(e)}`);
    }
  }

  private clear(): void {
    if (this.byPath.size === 0) return;
    const uris = [...this.byPath.keys()].map((p) => vscode.Uri.file(p));
    this.byPath = new Map();
    this._onDidChange.fire(uris);
  }

  dispose(): void {
    for (const d of this.subs) d.dispose();
    this._onDidChange.dispose();
  }
}
