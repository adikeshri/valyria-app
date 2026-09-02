/**
 * The ext-host projection (PLAN.md D3/D4).
 *
 * One `@valyria/state` store per session. It is fed the batched Core event
 * stream from the bridge-host and the connection state; every Valyria view is a
 * selector over it. The reducer is pure and synchronous — this module only adds
 * the I/O-adjacent concerns: contiguity assertion, change notification, and
 * reset on a new session.
 *
 * Deliberately free of any `vscode` import so it can be unit-tested by replaying
 * `fixtures/traces/*.jsonl` (D4).
 */
import {
  applyBatch,
  emptyStore,
  needsResubscribe,
  setConnection,
  timelineRows,
  activityLine,
  currentTask,
  type StoreState,
} from "@valyria/state";
import type { EventBatch, ConnectionState } from "../bridge/protocol";

export interface StoreLogger {
  warn(message: string): void;
}

/** Minimal synchronous listener registry — no `vscode` dependency. */
class Emitter {
  private readonly fns = new Set<() => void>();
  on(fn: () => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  fire(): void {
    for (const fn of this.fns) fn();
  }
}

export class Store {
  private state: StoreState = emptyStore();
  private _lastSeq = 0;
  private _expectedNextSeq = 1;
  private readonly emitter = new Emitter();

  constructor(private readonly log: StoreLogger) {}

  /** Subscribe to any change. Returns a disposer. */
  onDidChange(fn: () => void): () => void {
    return this.emitter.on(fn);
  }

  get lastSeq(): number {
    return this._lastSeq;
  }

  getState(): StoreState {
    return this.state;
  }

  /** Drop everything — used when a new session opens (replay starts at seq 0). */
  reset(): void {
    this.state = emptyStore();
    this._lastSeq = 0;
    this._expectedNextSeq = 1;
    this.emitter.fire();
  }

  ingestBatch(batch: EventBatch): void {
    if (batch.events.length === 0) return;

    if (
      batch.firstSeq !== this._expectedNextSeq &&
      !batch.gapBefore &&
      this._lastSeq !== 0
    ) {
      this.log.warn(
        `event gap: expected seq ${this._expectedNextSeq}, batch starts at ${batch.firstSeq}`
      );
    }
    this.state = applyBatch(this.state, batch.events);
    this._lastSeq = Math.max(this._lastSeq, batch.lastSeq);
    this._expectedNextSeq = batch.lastSeq + 1;

    if (needsResubscribe(this.state)) {
      this.log.warn(
        `store flagged a hole in the event stream (lastSeq ${this._lastSeq}); ` +
          `a reconnect will replay from the journal`
      );
    }
    this.emitter.fire();
  }

  setConnection(s: ConnectionState): void {
    // The bridge-host and @valyria/state share the exact 7-state vocabulary.
    this.state = setConnection(this.state, s);
    this.emitter.fire();
  }

  // --- view-model helpers (selectors live in @valyria/state) --------------

  activityLines(): string[] {
    return timelineRows(this.state).map(activityLine);
  }

  currentTaskId(): string | undefined {
    return currentTask(this.state)?.id;
  }
}
