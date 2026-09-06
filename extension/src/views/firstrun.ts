import * as vscode from "vscode";
import { modelInstall } from "@valyria/state";
import { WebviewBase } from "./webviewBase";
import { promptAndInstallModel } from "./modelInstall";
import { DEFAULT_MODEL_ROLE } from "../store/models";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { BridgeHost } from "../bridge/host";
import type { LayoutController, LayoutMode } from "../session/layout";
import type { EditorPanelManager } from "./editorPanels";

const SEEN_KEY = "valyria.seenFirstRun";
const CTX_KEY = "valyria.showFirstRun";
const MODEL_STEP_KEY = "valyria.firstRunModelHandled";
const PROBE_OBJECTIVE =
  "List the top-level modules or packages in this repository. Read-only — do not modify any files.";

interface RecommendCandidate {
  id: string;
  display_name?: string;
  size_bytes?: number;
  fit_kind?: string;
}

export class FirstRunViewProvider extends WebviewBase {
  static readonly viewId = "valyria.firstrun";
  readonly viewId = FirstRunViewProvider.viewId;
  protected readonly bundle = "firstrun";

  private probeTaskId: string | undefined;
  private recommended: RecommendCandidate | null = null;
  private installedCount = 0;
  private recommendedId: string | undefined;
  private modelLoaded = false;

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

  /** Load the recommended model + install count once Core is reachable. */
  private async loadModelStep(): Promise<void> {
    if (this.modelLoaded || this.supervisor.state !== "ready") return;
    if (!this.supervisor.has("model_manage")) {
      this.modelLoaded = true;
      return;
    }
    try {
      const list = (await this.host.client.request("model/list", {})) as {
        models?: { installed?: boolean }[];
      };
      this.installedCount = (list.models ?? []).filter((m) => m.installed).length;
    } catch {
      /* leave count at 0 */
    }
    if (this.supervisor.has("hardware")) {
      try {
        const rec = (await this.host.client.request("model/recommend", {
          role: DEFAULT_MODEL_ROLE,
        })) as { recommended?: RecommendCandidate | null };
        this.recommended = rec.recommended ?? null;
        this.recommendedId = this.recommended?.id;
      } catch {
        this.recommended = null;
      }
    }
    this.modelLoaded = true;
    this.push();
  }

  private modelStepModel(): {
    capable: boolean;
    handled: boolean;
    installedCount: number;
    recommendedId: string | null;
    recommendedName: string | null;
    recommendedSizeGb: number | null;
    recommendedFit: string | null;
    install: {
      status: "running" | "completed" | "failed";
      phase: string | null;
      fraction: number | null;
      message: string | null;
      code: string | null;
    } | null;
  } {
    const handled =
      this.context.globalState.get<boolean>(MODEL_STEP_KEY) === true || this.installedCount > 0;
    const inst = this.recommendedId
      ? modelInstall(this.store.getState(), this.recommendedId)
      : undefined;
    return {
      capable: this.supervisor.has("model_manage"),
      handled,
      installedCount: this.installedCount,
      recommendedId: this.recommended?.id ?? null,
      recommendedName: this.recommended?.display_name ?? this.recommended?.id ?? null,
      recommendedSizeGb:
        typeof this.recommended?.size_bytes === "number"
          ? this.recommended.size_bytes / 1e9
          : null,
      recommendedFit: this.recommended?.fit_kind ?? null,
      install: inst
        ? {
            status: inst.status,
            phase: inst.phase,
            fraction:
              inst.totalBytes > 0
                ? Math.max(0, Math.min(1, inst.downloadedBytes / inst.totalBytes))
                : null,
            message: inst.message,
            code: inst.code,
          }
        : null,
    };
  }

  protected buildModel(): unknown {
    void this.loadModelStep();
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
      model: this.modelStepModel(),
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
      this.modelLoaded = false;
      this.push();
    } else if (name === "firstRunInstallModel") {
      const id = (args as { id?: string } | undefined)?.id ?? this.recommendedId;
      if (!id) return;
      const started = await promptAndInstallModel(this.host, id);
      if (started) {
        this.recommendedId = id;
        this.push();
      }
    } else if (name === "firstRunActivateModel") {
      const id = (args as { id?: string } | undefined)?.id ?? this.recommendedId;
      if (!id) return;
      try {
        await this.host.client.request("model/activate", { id, role: DEFAULT_MODEL_ROLE });
        await this.context.globalState.update(MODEL_STEP_KEY, true);
        void vscode.window.showInformationMessage(`Valyria: ${id} is now your coding model.`);
        this.modelLoaded = false;
        this.push();
      } catch (e) {
        void vscode.window.showErrorMessage(`Valyria: activate failed — ${String(e)}`);
      }
    } else if (name === "firstRunSkipModel") {
      await this.context.globalState.update(MODEL_STEP_KEY, true);
      this.push();
    } else if (name === "firstRunOpenModelManager") {
      await vscode.commands.executeCommand("valyria.models.focus");
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
