import * as vscode from "vscode";
import { modelServers } from "@valyria/state";
import { WebviewBase } from "./webviewBase";
import { modelChatModel } from "../store/models";
import type { ModelSummary } from "../store/models";
import type { ModelChatModel, ModelChatTurn } from "../webviews/shared/protocol";
import { CMD } from "../webviews/shared/protocol";
import type { Store } from "../store/store";
import type { Supervisor } from "../session/supervisor";
import type { BridgeHost } from "../bridge/host";

/**
 * A plain chat window on top of whatever local models are activated — not
 * the agent task system (§8/§10's `chatModel` deliberately excludes model
 * text). This talks straight to a `model_inference`-managed server's own
 * OpenAI-compat endpoint (`POST /v1/chat/completions`, streamed) so a user
 * can try a model out before pointing a role at it for real work.
 */
export class ModelChatViewProvider extends WebviewBase {
  static readonly viewId = "valyria.modelChat";
  readonly viewId = ModelChatViewProvider.viewId;
  protected readonly bundle = "modelChat";

  private models: ModelSummary[] | null = null;
  private role: string | null = null;
  private readonly transcripts = new Map<string, ModelChatTurn[]>();
  private sending = false;
  private inflight: AbortController | null = null;
  private turnSeq = 0;

  constructor(
    extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly supervisor: Supervisor,
    private readonly host: BridgeHost,
    private readonly log: vscode.LogOutputChannel
  ) {
    super(extensionUri);
  }

  private currentModel(): ModelChatModel {
    return modelChatModel({
      inferenceCapable: this.supervisor.has("model_inference"),
      servers: modelServers(this.store.getState()),
      models: this.models,
      role: this.role,
      transcripts: Object.fromEntries(this.transcripts),
      sending: this.sending,
    });
  }

  protected buildModel(): unknown {
    return this.currentModel();
  }

  protected onCommand(name: string, args: unknown): void {
    const a = (args ?? {}) as { role?: string; text?: string };
    switch (name) {
      case CMD.selectModelChatRole:
        if (a.role) {
          this.role = a.role;
          this.push();
        }
        break;
      case CMD.sendModelChatMessage: {
        const text = a.text?.trim();
        if (text) void this.send(text);
        break;
      }
      case CMD.stopModelChatGeneration:
        this.inflight?.abort();
        break;
      case CMD.clearModelChat: {
        const role = this.currentModel().role;
        if (role) {
          this.transcripts.delete(role);
          this.push();
        }
        break;
      }
      case CMD.openModelManager:
        void vscode.commands.executeCommand("valyria.models.focus");
        break;
    }
  }

  protected wire(refresh: () => void): vscode.Disposable[] {
    void this.refreshModels();
    return [
      this.supervisor.onDidChange(refresh),
      { dispose: this.store.onDidChange(() => this.onStoreChange(refresh)) },
    ];
  }

  private lastTerminalSeq = 0;

  /** Same shape as the Models panel's own refresh gate: a server reaching a
   *  terminal state is the only thing that changes which roles are
   *  chattable, so that's the only trigger for re-fetching `model/list`
   *  (for display names) — everything else re-renders off local state. */
  private onStoreChange(cheapRerender: () => void): void {
    const state = this.store.getState();
    const latestTerminal = Math.max(
      0,
      ...modelServers(state)
        .filter((s) => s.state === "ready" || s.state === "failed" || s.state === "stopped")
        .map((s) => s.lastSeq)
    );
    if (latestTerminal > this.lastTerminalSeq) {
      this.lastTerminalSeq = latestTerminal;
      void this.refreshModels().then(cheapRerender);
    } else {
      cheapRerender();
    }
  }

  private async refreshModels(): Promise<void> {
    if (this.supervisor.state !== "ready") return;
    try {
      const r = (await this.host.client.request("model/list", {})) as { models?: ModelSummary[] };
      this.models = r.models ?? [];
    } catch {
      this.models = null;
    }
  }

  private pushThrottled(lastPush: { at: number }): void {
    const now = Date.now();
    if (now - lastPush.at < 40) return;
    lastPush.at = now;
    this.push();
  }

  private async send(text: string): Promise<void> {
    const role = this.currentModel().role;
    const server = role
      ? modelServers(this.store.getState()).find((s) => s.role === role && s.state === "ready" && s.port)
      : undefined;
    if (!role || !server?.port) return;

    const turns = this.transcripts.get(role) ?? [];
    this.transcripts.set(role, turns);
    turns.push({ id: `t${++this.turnSeq}`, role: "user", text, pending: false });
    const assistantId = `t${++this.turnSeq}`;
    turns.push({ id: assistantId, role: "assistant", text: "", pending: true });
    this.sending = true;
    this.push();

    const controller = new AbortController();
    this.inflight = controller;
    const messages = turns
      .filter((t) => t.id !== assistantId && t.role !== "error")
      .map((t) => ({ role: t.role, content: t.text }));

    const assistantTurn = (): ModelChatTurn => turns.find((t) => t.id === assistantId)!;

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: server.modelId, messages, stream: true }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        // llama-server's own error detail (e.g. "this model does not
        // support completions") lands in the body — the status line alone
        // isn't enough to act on.
        const detail = (await res.text().catch(() => "")).slice(0, 300).trim();
        throw new Error(
          `model server responded ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`
        );
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const lastPush = { at: 0 };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const evt = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) {
              assistantTurn().text += delta;
              this.pushThrottled(lastPush);
            }
          } catch {
            // a malformed SSE frame — skip it rather than aborting the stream
          }
        }
      }
      const turn = assistantTurn();
      turn.pending = false;
      if (!turn.text) turn.text = "(no response)";
    } catch (e) {
      const turn = assistantTurn();
      if (controller.signal.aborted) {
        turn.pending = false;
        if (!turn.text) turn.text = "(stopped)";
      } else {
        turn.role = "error";
        turn.pending = false;
        turn.text = `Request failed: ${e instanceof Error ? e.message : String(e)}`;
        this.log.warn(`model chat request failed: ${String(e)}`);
      }
    } finally {
      this.sending = false;
      this.inflight = null;
      this.push();
    }
  }
}
