/**
 * Activity — a human-readable running narrative of what the agent is doing,
 * derived from the event store (PLAN.md §4.6, §10: no model reasoning text).
 *
 * Phase 1: a themed list rendered from `@valyria/state`'s `activityLine`
 * selector plus the live connection state. Phase 3 replaces the body with the
 * ported rich panel; the data source (the store) does not change.
 */
import * as vscode from "vscode";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";

export class ActivityViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "valyria.activity";
  private view: vscode.WebviewView | undefined;
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    private readonly store: Store,
    private readonly supervisor: Supervisor
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);

    for (const d of this.subs.splice(0)) d.dispose();
    this.subs.push(
      { dispose: this.store.onDidChange(() => this.render()) },
      this.supervisor.onDidChange(() => this.render())
    );
    view.onDidDispose(() => {
      for (const d of this.subs.splice(0)) d.dispose();
      this.view = undefined;
    });
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({
      type: "state",
      connection: this.supervisor.state,
      lines: this.store.activityLines(),
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = String(Math.random()).slice(2);
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return /* html */ `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    padding: 6px 10px;
  }
  #conn {
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--vscode-descriptionForeground);
    padding-bottom: 6px; border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
    margin-bottom: 6px;
  }
  #conn.bad { color: var(--vscode-errorForeground); }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column-reverse; }
  li { padding: 3px 0; border-bottom: 1px solid var(--vscode-editorWidget-border, transparent); }
  #empty { color: var(--vscode-descriptionForeground); padding-top: 8px; }
</style></head>
<body>
  <div id="conn" aria-live="polite">starting…</div>
  <ol id="log" aria-live="polite"></ol>
  <div id="empty" hidden>No agent activity yet.</div>
  <script nonce="${nonce}">
    const conn = document.getElementById('conn');
    const log = document.getElementById('log');
    const empty = document.getElementById('empty');
    const BAD = new Set(['degraded','failed','incompatible']);
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (m?.type !== 'state') return;
      conn.textContent = m.connection;
      conn.className = BAD.has(m.connection) ? 'bad' : '';
      log.replaceChildren(...m.lines.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }));
      empty.hidden = m.lines.length > 0;
    });
  </script>
</body></html>`;
  }
}
