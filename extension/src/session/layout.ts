/**
 * Dual-mode layout (docs/UX-DIFFERENTIATION.md, lever C).
 *
 * Valyria ships two workbench layouts that share the same underlying panels:
 *
 *   - **agent**  — the Valyria Home / Task Workspace surfaces are the centre of
 *     gravity; the activity bar is hidden, editor tabs are single, the panel is
 *     tucked away. Navigation is driven from the Valyria surfaces.
 *   - **editor** — a faithful VS Code-shaped layout for muscle memory: activity
 *     bar on the side, multiple tabs, panel visible.
 *
 * A mode is a *bundle of workbench settings* (`layoutBundles.ts`) applied through
 * the config API plus a `setContext('valyria.layoutMode', …)` that gates Valyria
 * `when` clauses and the editor-panel opener. Nothing here is a lock — every key
 * is also reachable in Settings, so the accessibility gate ("never trap the
 * user") holds.
 *
 * Persistence: the last explicit choice is remembered per workspace
 * (`workspaceState`); a fresh workspace starts at `valyria.layout.defaultMode`.
 */
import * as vscode from "vscode";
import {
  LAYOUT_MODES,
  resolveLayoutSettings,
  type LayoutMode,
} from "./layoutBundles";

export {
  LAYOUT_BUNDLES,
  LAYOUT_MODES,
  MANAGED_KEYS,
  resolveLayoutSettings,
  type LayoutBundle,
  type LayoutMode,
} from "./layoutBundles";

const STATE_KEY = "valyria.layout.mode";
const CTX_KEY = "valyria.layoutMode";

export class LayoutController implements vscode.Disposable {
  private _mode: LayoutMode;
  private readonly _onDidChange = new vscode.EventEmitter<LayoutMode>();
  readonly onDidChange = this._onDidChange.event;

  private readonly hasRememberedChoice: boolean;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel
  ) {
    const remembered = context.workspaceState.get<LayoutMode>(STATE_KEY);
    this.hasRememberedChoice = !!remembered && LAYOUT_MODES.includes(remembered);
    this._mode = this.hasRememberedChoice
      ? (remembered as LayoutMode)
      : this.configuredDefault();
  }

  get mode(): LayoutMode {
    return this._mode;
  }

  private configuredDefault(): LayoutMode {
    const v = vscode.workspace
      .getConfiguration("valyria")
      .get<string>("layout.defaultMode", "editor");
    return v === "agent" ? "agent" : "editor";
  }

  private applyWorkbenchDefaults(): boolean {
    return vscode.workspace
      .getConfiguration("valyria")
      .get<boolean>("layout.applyWorkbenchDefaults", true);
  }

  /** Push the current mode into the `when`-clause context. */
  async syncContext(): Promise<void> {
    await vscode.commands.executeCommand("setContext", CTX_KEY, this._mode);
  }

  /** Switch mode. `explicit` marks a user choice (persisted); an implicit call
   *  is not remembered, so a later default change still takes. */
  async setMode(mode: LayoutMode, opts: { explicit?: boolean } = {}): Promise<void> {
    const changed = mode !== this._mode;
    this._mode = mode;
    if (opts.explicit) {
      await this.context.workspaceState.update(STATE_KEY, mode);
    }
    await this.syncContext();
    if (this.applyWorkbenchDefaults()) {
      await this.writeSettings(resolveLayoutSettings(mode));
    }
    if (changed) {
      this.log.info(`layout mode → ${mode}${opts.explicit ? " (explicit)" : ""}`);
      this._onDidChange.fire(mode);
    }
  }

  async toggle(): Promise<void> {
    await this.setMode(this._mode === "agent" ? "editor" : "agent", { explicit: true });
  }

  /** Apply the remembered mode's settings on activate. The `when`-clause context
   *  is always set; the `workbench.*` bundle is only written when the user has
   *  *explicitly* chosen a mode for this workspace before — a fresh workspace on
   *  the default never gets a `.vscode/settings.json` it did not ask for. */
  async applyOnActivate(): Promise<void> {
    await this.syncContext();
    if (this.hasRememberedChoice && this.applyWorkbenchDefaults()) {
      await this.writeSettings(resolveLayoutSettings(this._mode));
    }
  }

  private async writeSettings(desired: Record<string, unknown>): Promise<void> {
    const cfg = vscode.workspace.getConfiguration();
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    for (const [key, value] of Object.entries(desired)) {
      try {
        const cur = cfg.inspect(key);
        const at =
          target === vscode.ConfigurationTarget.Workspace
            ? cur?.workspaceValue
            : cur?.globalValue;
        if (at === value) continue;
        if (value === undefined && at === undefined) continue;
        await cfg.update(key, value, target);
      } catch (e) {
        this.log.warn(`layout: could not set ${key}: ${String(e)}`);
      }
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
