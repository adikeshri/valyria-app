/**
 * Shared plumbing for every Valyria `WebviewView`.
 *
 * A subclass declares its `viewId`, its bundle name, how to build the
 * view-model, and how to handle a command. This base owns the security
 * boundary (CSP + nonce + `localResourceRoots`), the message loop, and
 * auto-refresh wiring.
 */
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { WebviewMessage } from "../webviews/shared/protocol";
import { webviewHtml } from "./webviewHtml";

export abstract class WebviewBase implements vscode.WebviewViewProvider {
  protected view: vscode.WebviewView | undefined;
  private readonly subs: vscode.Disposable[] = [];

  constructor(protected readonly extensionUri: vscode.Uri) {}

  /** e.g. "valyria.activity" — must match `package.json` contributes.views. */
  abstract readonly viewId: string;
  /** Bundle basename under `out/webviews/` (no extension). */
  protected abstract readonly bundle: string;

  /** Produce the current view-model. Runs in the ext host; the webview renders it. */
  protected abstract buildModel(): unknown;

  /** Handle an intent from the webview. */
  protected abstract onCommand(name: string, args: unknown): void | Promise<void>;

  /** Register listeners that should trigger a re-push; return their disposers. */
  protected abstract wire(refresh: () => void): vscode.Disposable[];

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out", "webviews")],
    };
    view.webview.html = this.html(view.webview);

    for (const d of this.subs.splice(0)) d.dispose();
    this.subs.push(
      view.webview.onDidReceiveMessage((msg: WebviewMessage) => {
        if (msg?.type === "ready") this.push();
        else if (msg?.type === "command") void this.onCommand(msg.name, msg.args);
      }),
      ...this.wire(() => this.push())
    );

    view.onDidChangeVisibility(() => {
      if (view.visible) this.push();
    });
    view.onDidDispose(() => {
      for (const d of this.subs.splice(0)) d.dispose();
      this.view = undefined;
    });
  }

  /** Push the current model to the webview (no-op if not resolved/visible). */
  protected push(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({
      type: "state",
      view: this.viewId,
      model: this.buildModel(),
    });
  }

  private uri(webview: vscode.Webview, ...p: string[]): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", "webviews", ...p));
  }

  private html(webview: vscode.Webview): string {
    return webviewHtml({
      nonce: randomBytes(16).toString("base64"),
      cspSource: webview.cspSource,
      title: this.viewId,
      tokensUri: this.uri(webview, "tokens.css").toString(),
      viewCssUri: this.uri(webview, `${this.bundle}.css`).toString(),
      scriptUri: this.uri(webview, `${this.bundle}.js`).toString(),
    });
  }
}
