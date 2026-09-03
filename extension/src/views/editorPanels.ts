/**
 * Editor-area Valyria surfaces (docs/UX-DIFFERENTIATION.md, lever D).
 *
 * The sidebar views are kept for Editor layout; this manager promotes the three
 * agent-first surfaces into the **editor area**, where a VS Code fork puts a
 * file:
 *
 *   - **Home**      — the tab you land on: a task prompt, active + recent tasks,
 *                     the runtime marker. Replaces the Welcome page.
 *   - **Workspace** — the focused task as one document: conversation, plan,
 *                     changed files, verification, pending approval.
 *   - **Review**    — agent-authored changes framed for approval; each row jumps
 *                     into the editor's own diff.
 *
 * Each surface is a singleton `WebviewPanel`. Models are the same pure selectors
 * the sidebar uses (`homeModel` / `workspaceModel` / `reviewModel`); Core round
 * trips (`task/report`, `ledger/changes`) are cached per task id.
 */
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { resolveFocus, homeModel, workspaceModel, reviewModel } from "../store/models";
import { webviewHtml } from "./webviewHtml";
import { CMD } from "../webviews/shared/protocol";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { TaskFocus } from "../session/focus";
import type { LayoutController } from "../session/layout";
import type { BridgeHost } from "../bridge/host";
import type { WebviewMessage } from "../webviews/shared/protocol";

export type Surface = "home" | "workspace" | "review";

const TITLE: Record<Surface, string> = {
  home: "Valyria",
  workspace: "Task Workspace",
  review: "Review Changes",
};
const BUNDLE: Record<Surface, string> = {
  home: "home",
  workspace: "workspace",
  review: "review",
};
const ICON: Record<Surface, string> = {
  home: "sparkle",
  workspace: "list-tree",
  review: "git-compare",
};

interface TaskData {
  taskId: string | null;
  report: {
    status?: string;
    verified?: { kind: string; command: string; outcome: string; run_id?: string }[];
    unverified?: string[];
  } | null;
  ownership: Record<string, string>;
}

export class EditorPanelManager implements vscode.Disposable {
  private readonly panels = new Map<Surface, vscode.WebviewPanel>();
  private readonly subs: vscode.Disposable[] = [];
  private data: TaskData = { taskId: null, report: null, ownership: {} };
  private fetching = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly supervisor: Supervisor,
    private readonly focus: TaskFocus,
    private readonly layout: LayoutController,
    private readonly host: BridgeHost,
    private readonly dispatch: (name: string, args: unknown) => void,
    private readonly log: vscode.LogOutputChannel
  ) {
    const onChange = () => {
      void this.maybeRefreshData();
      this.pushAll();
    };
    this.subs.push(
      { dispose: this.store.onDidChange(onChange) },
      this.supervisor.onDidChange(onChange),
      this.focus.onDidChange(onChange),
      this.layout.onDidChange(() => this.pushAll())
    );
  }

  /** Where a file / diff opened from a surface should land. In Agent layout the
   *  surface owns column one, so files open beside it as a detail pane. */
  fileColumn(): vscode.ViewColumn {
    return this.layout.mode === "agent" ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
  }

  async open(surface: Surface): Promise<void> {
    const existing = this.panels.get(surface);
    if (existing) {
      existing.reveal(existing.viewColumn ?? vscode.ViewColumn.One, false);
      this.push(surface);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      `valyria.${surface}`,
      TITLE[surface],
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out", "webviews")],
      }
    );
    panel.iconPath = new vscode.ThemeIcon(ICON[surface]);
    panel.webview.html = this.html(panel.webview, surface);
    this.panels.set(surface, panel);

    const msgSub = panel.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      if (msg?.type === "ready") this.push(surface);
      else if (msg?.type === "command") void this.onCommand(msg.name, msg.args);
    });
    const visSub = panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible) {
        void this.maybeRefreshData(true);
        this.push(surface);
      }
    });
    panel.onDidDispose(() => {
      msgSub.dispose();
      visSub.dispose();
      this.panels.delete(surface);
    });

    void this.maybeRefreshData(true);
  }

  private onCommand(name: string, args: unknown): void {
    if (name === CMD.openSurface) {
      const s = (args as { surface?: string } | undefined)?.surface;
      if (s === "home" || s === "workspace" || s === "review") void this.open(s);
      return;
    }
    if (name === "refreshSurface") {
      void this.maybeRefreshData(true);
      return;
    }
    this.dispatch(name, args);
  }

  private currentTaskId(): string | null {
    return resolveFocus(this.store.getState(), this.focus.pinned) ?? null;
  }

  private async maybeRefreshData(force = false): Promise<void> {
    const taskId = this.currentTaskId();
    if (this.panels.size === 0) return;
    if (this.fetching) return;
    if (!force && taskId === this.data.taskId) return;
    if (this.supervisor.state !== "ready" || !taskId) {
      this.data = { taskId, report: null, ownership: {} };
      this.pushAll();
      return;
    }
    this.fetching = true;
    const next: TaskData = { taskId, report: null, ownership: {} };
    try {
      next.report = (await this.host.client.request("task/report", { taskId })) as TaskData["report"];
    } catch (e) {
      this.log.info(`task/report unavailable for ${taskId}: ${String(e)}`);
    }
    if (this.supervisor.has("ledger")) {
      try {
        const r = (await this.host.client.request("ledger/changes", { taskId })) as {
          changes?: { path: string; classification: string }[];
        };
        for (const c of r.changes ?? []) next.ownership[c.path] = c.classification;
      } catch (e) {
        this.log.info(`ledger/changes unavailable for ${taskId}: ${String(e)}`);
      }
    }
    this.fetching = false;
    this.data = next;
    this.pushAll();
  }

  private buildModel(surface: Surface): unknown {
    const state = this.store.getState();
    const conn = this.supervisor.state;
    if (surface === "home") {
      return homeModel(state, {
        connection: conn,
        hasRepo: !!vscode.workspace.workspaceFolders?.length,
        repoName: vscode.workspace.workspaceFolders?.[0]?.name ?? null,
        activeModel: this.runtime.activeModel,
        networkRuntime: this.runtime.networkRuntime,
        autonomy: this.supervisor.session?.permissionMode ?? null,
        layoutMode: this.layout.mode,
      });
    }
    if (surface === "workspace") {
      return workspaceModel(state, this.focus.pinned, {
        connection: conn,
        ownership: this.data.ownership,
        report: this.data.report,
        rollbackCapable: this.supervisor.has("diagnostics_v2"),
      });
    }
    return reviewModel(state, this.focus.pinned, {
      connection: conn,
      ledgerAvailable: this.supervisor.has("ledger"),
      ownership: this.data.ownership,
      report: this.data.report,
    });
  }

  /** Kept in sync by extension.ts via `setRuntime` — mirrors the status bar marker. */
  private runtime: { activeModel: string | null; networkRuntime: boolean } = {
    activeModel: null,
    networkRuntime: false,
  };
  setRuntime(info: { activeModel?: string | null; networkRuntime?: boolean }): void {
    if (info.activeModel !== undefined) this.runtime.activeModel = info.activeModel;
    if (info.networkRuntime !== undefined) this.runtime.networkRuntime = info.networkRuntime;
    this.pushAll();
  }

  private push(surface: Surface): void {
    const panel = this.panels.get(surface);
    if (!panel) return;
    void panel.webview.postMessage({
      type: "state",
      view: `valyria.${surface}`,
      model: this.buildModel(surface),
    });
  }

  private pushAll(): void {
    for (const s of this.panels.keys()) this.push(s);
  }

  private html(webview: vscode.Webview, surface: Surface): string {
    const uri = (...p: string[]) =>
      webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", "webviews", ...p))
        .toString();
    return webviewHtml({
      nonce: randomBytes(16).toString("base64"),
      cspSource: webview.cspSource,
      title: `Valyria — ${TITLE[surface]}`,
      tokensUri: uri("tokens.css"),
      viewCssUri: uri(`${BUNDLE[surface]}.css`),
      scriptUri: uri(`${BUNDLE[surface]}.js`),
    });
  }

  dispose(): void {
    for (const d of this.subs) d.dispose();
    for (const p of this.panels.values()) p.dispose();
  }
}
