/**
 * Rendered viewer for Valyria's own workspace data (docs/UX-DIFFERENTIATION.md,
 * lever D). Files under `<repo>/.valyria/` — the plan, task reports, notes — open
 * to a Valyria-rendered view instead of raw text, with a one-click "Open raw"
 * escape hatch. Registered `priority: "default"` for markdown / JSON files under
 * a `.valyria` directory only, so nothing else in the editor is affected.
 *
 * Read-only projection: edits happen in the raw editor. No agent logic.
 */
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { webviewHtml } from "./webviewHtml";

export const VALYRIA_DOC_VIEW = "valyria.document";

export class ValyriaDocEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel
  ): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out", "webviews")],
    };
    const uri = (...p: string[]) =>
      panel.webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", "webviews", ...p))
        .toString();
    panel.webview.html = webviewHtml({
      nonce: randomBytes(16).toString("base64"),
      cspSource: panel.webview.cspSource,
      title: `Valyria — ${document.uri.path.split("/").pop() ?? "document"}`,
      tokensUri: uri("tokens.css"),
      viewCssUri: uri("customdoc.css"),
      scriptUri: uri("customdoc.js"),
    });

    const push = () => {
      const name = document.uri.path.split("/").pop() ?? "";
      const kind = name.endsWith(".json") ? "json" : "md";
      void panel.webview.postMessage({
        type: "state",
        view: VALYRIA_DOC_VIEW,
        model: { kind, name, text: document.getText() },
      });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) push();
    });
    const msgSub = panel.webview.onDidReceiveMessage((msg: { type?: string; name?: string }) => {
      if (msg?.type === "ready") push();
      else if (msg?.type === "command" && msg["name"] === "openRaw") {
        void vscode.commands.executeCommand("vscode.openWith", document.uri, "default");
      }
    });
    panel.onDidDispose(() => {
      changeSub.dispose();
      msgSub.dispose();
    });
  }
}
