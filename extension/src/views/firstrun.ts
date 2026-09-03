import * as vscode from "vscode";
import { WebviewBase } from "./webviewBase";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { BridgeHost } from "../bridge/host";
import type { LayoutController, LayoutMode } from "../session/layout";
import type { EditorPanelManager } from "./editorPanels";

const SEEN_KEY = "valyria.seenFirstRun";
const CTX_KEY = "valyria.showFirstRun";
const PROBE_OBJECTIVE =
  "List the top-level modules or packages in this repository. Read-only — do not modify any files.";

export class FirstRunViewProvider extends WebviewBase {
  static readonly viewId = "valyria.firstrun";
  readonly viewId = FirstRunViewProvider.viewId;
  protected readonly bundle = "firstrun";

  private probeTaskId: string | undefined;

  constructor(
    extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    private readonly store: Store,
    private readonly supervisor: Supervisor,
    private readonly host: BridgeHost,
    private readonly layout: LayoutController,
    private readonly panels: EditorPanelManager,
    private readonly reopen: (root: string, appliedThrough: number) => Promise<void>
  ) {
    super(extensionUri);
  }

  static async syncVisibility(context: vscode.ExtensionContext): Promise<void> {
    const seen = context.globalState.get<boolean>(SEEN_KEY) === true;
    await vscode.commands.executeCommand("setContext", CTX_KEY, !seen);
  }

  private probeState(): "idle" | "running" | "done" | "failed" {
    if (!this.probeTaskId) return "idle";
    const t = this.store.getState().tasks[this.probeTaskId];
    if (!t) return "running";
    if (t.state === "completed") {
      void this.context.globalState.update(SEEN_KEY, true);
      return "done";
    }
    if (t.state === "failed") return "failed";
    return "running";
  }

  protected buildModel(): unknown {
    const probeState = this.probeState();
    return {
      connection: this.supervisor.state,
      hasRepo: !!vscode.workspace.workspaceFolders?.length,
      layoutMode: this.layout.mode,
      probeState,
      probeResult:
        probeState === "done"
          ? "The stack works end to end — you're ready."
          : probeState === "failed"
            ? "The probe task failed. Check the Activity view and Core logs."
            : null,
    };
  }

  protected async onCommand(name: string, args: unknown): Promise<void> {
    if (name === "firstRunOpenRepo") {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        openLabel: "Open for Valyria agent",
      });
      const root = picked?.[0]?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root) await this.reopen(root, 0);
      this.push();
    } else if (name === "firstRunProbeTask") {
      try {
        const { taskId } = await this.host.client.request("task/create", { objective: PROBE_OBJECTIVE });
        this.probeTaskId = taskId;
        this.push();
      } catch (e) {
        void vscode.window.showErrorMessage(`Valyria: ${String(e)}`);
      }
    } else if (name === "firstRunSetLayout") {
      const mode = (args as { mode?: string } | undefined)?.mode;
      if (mode === "agent" || mode === "editor") {
        await this.layout.setMode(mode as LayoutMode, { explicit: true });
        this.push();
      }
    } else if (name === "firstRunDismiss") {
      await this.context.globalState.update(SEEN_KEY, true);
      await vscode.commands.executeCommand("setContext", CTX_KEY, false);
      await this.panels.open("home");
    }
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    return [
      { dispose: this.store.onDidChange(refresh) },
      this.supervisor.onDidChange(refresh),
      this.layout.onDidChange(refresh),
      vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    ];
  }
}
