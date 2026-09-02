/**
 * Which task the Agent / Task / Timeline panels are showing.
 *
 * Default: the store's most recent task. History (or a command) can pin an
 * explicit one; a `reset()` (new session) clears the pin.
 */
import * as vscode from "vscode";

export class TaskFocus implements vscode.Disposable {
  private _pinned: string | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  /** The explicitly pinned task id, or undefined to follow "most recent". */
  get pinned(): string | undefined {
    return this._pinned;
  }

  pin(taskId: string): void {
    if (this._pinned === taskId) return;
    this._pinned = taskId;
    this._onDidChange.fire();
  }

  clear(): void {
    if (this._pinned === undefined) return;
    this._pinned = undefined;
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
