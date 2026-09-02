/**
 * Phase-1 surface: the raw Core event feed.
 *
 * A `WebviewViewProvider` that subscribes to `core/eventBatch` from the host and
 * appends rows. Deliberately minimal — this is the "watch events stream live"
 * exit criterion from ARCHITECTURE-VSCODE.md §7 phase 1. The rich Activity /
 * Timeline surfaces (phase 2) will replace the body with the ported `Live*`
 * React panels + the `@valyria/state` reducer.
 */
import * as vscode from "vscode";
import type { BridgeHost } from "../bridge/host";

export class ActivityViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "valyria.activity";
  private view: vscode.WebviewView | undefined;
  private readonly ring: string[] = [];
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly host: BridgeHost) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();

    for (const d of this.disposers.splice(0)) d();
    const c = this.host.client;
    this.disposers.push(
      c.on("core/eventBatch", (batch) => {
        for (const ev of batch.events) {
          this.push(
            `#${String(ev.seq).padStart(5, " ")}  ${ev.kind}  ` +
              JSON.stringify(ev.payload)
          );
        }
      }),
      c.on("core/closed", (p) => this.push(`— stream closed at seq ${p.lastSeq} —`)),
      c.on("core/reconnected", (p) => this.push(`— resumed from seq ${p.resumeFrom} —`)),
      c.on("core/connectionState", (p) => this.push(`— connection: ${p.state} —`))
    );

    view.onDidDispose(() => {
      for (const d of this.disposers.splice(0)) d();
      this.view = undefined;
    });
  }

  private push(line: string): void {
    this.ring.push(line);
    if (this.ring.length > 2000) this.ring.shift();
    this.view?.webview.postMessage({ type: "append", line });
  }

  private html(): string {
    const nonce = String(Math.random()).slice(2);
    return /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { font-family: var(--vscode-editor-font-family, monospace);
         font-size: var(--vscode-editor-font-size, 12px);
         color: var(--vscode-foreground); padding: 4px 8px; }
  #log { white-space: pre-wrap; word-break: break-all; }
  .row { padding: 1px 0; border-bottom: 1px solid var(--vscode-editorWidget-border, transparent); }
</style></head>
<body>
  <div id="log"></div>
  <script nonce="${nonce}">
    const log = document.getElementById('log');
    window.addEventListener('message', (e) => {
      if (e.data?.type !== 'append') return;
      const div = document.createElement('div');
      div.className = 'row';
      div.textContent = e.data.line;
      log.appendChild(div);
      while (log.childElementCount > 2000) log.removeChild(log.firstChild);
      window.scrollTo(0, document.body.scrollHeight);
    });
  </script>
</body></html>`;
  }
}
