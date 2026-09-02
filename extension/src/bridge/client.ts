/**
 * JSON-RPC 2.0 client over a duplex byte stream (the bridge-host's stdio).
 *
 * Framing: LSP-style. Each message is
 *   `Content-Length: <n>\r\n\r\n<n bytes of UTF-8 JSON>`
 *
 * Kept dependency-free so the extension has no runtime deps beyond `vscode`.
 */
import type { Readable, Writable } from "node:stream";
import type {
  NotificationMethod,
  Notifications,
  RequestMethod,
  Requests,
} from "./protocol";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class BridgeRpcError extends Error {
  constructor(public readonly rpc: RpcError) {
    super(rpc.message);
    this.name = "BridgeRpcError";
  }
}

type NotificationHandler<M extends NotificationMethod> = (
  params: Notifications[M]
) => void;

export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, Set<(p: unknown) => void>>();
  private buffer = Buffer.alloc(0);
  private contentLength = -1;
  private closed = false;

  constructor(
    private readonly stdout: Readable,
    private readonly stdin: Writable
  ) {
    this.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.stdout.on("close", () => this.onClose(new Error("bridge-host stdout closed")));
    this.stdin.on("error", (e) => this.onClose(e));
  }

  /** Send a request and await its result. */
  request<M extends RequestMethod>(
    method: M,
    params: Requests[M][0]
  ): Promise<Requests[M][1]> {
    if (this.closed) {
      return Promise.reject(new Error(`bridge-host is not running (${method})`));
    }
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(msg);
    }) as Promise<Requests[M][1]>;
  }

  /** Subscribe to a host notification. Returns a disposer. */
  on<M extends NotificationMethod>(
    method: M,
    handler: NotificationHandler<M>
  ): () => void {
    let set = this.handlers.get(method);
    if (!set) {
      set = new Set();
      this.handlers.set(method, set);
    }
    const h = handler as (p: unknown) => void;
    set.add(h);
    return () => set?.delete(h);
  }

  dispose(): void {
    this.onClose(new Error("client disposed"));
  }

  // --- framing ---

  private write(msg: unknown): void {
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    this.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.stdin.write(body);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.contentLength < 0) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = this.buffer.subarray(0, headerEnd).toString("ascii");
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m || !m[1]) {
          this.onClose(new Error(`malformed frame header: ${JSON.stringify(header)}`));
          return;
        }
        this.contentLength = Number.parseInt(m[1], 10);
        this.buffer = this.buffer.subarray(headerEnd + 4);
      }
      if (this.buffer.length < this.contentLength) return;
      const body = this.buffer.subarray(0, this.contentLength).toString("utf8");
      this.buffer = this.buffer.subarray(this.contentLength);
      this.contentLength = -1;
      this.dispatch(body);
    }
  }

  private dispatch(body: string): void {
    let msg: {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: RpcError;
    };
    try {
      msg = JSON.parse(body);
    } catch {
      return; // never crash on a bad frame (PLAN.md D5 spirit)
    }

    if (typeof msg.id === "number" && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new BridgeRpcError(msg.error));
      else p.resolve(msg.result ?? null);
      return;
    }

    if (typeof msg.method === "string") {
      const set = this.handlers.get(msg.method);
      if (!set) return;
      for (const h of set) {
        try {
          h(msg.params);
        } catch {
          /* a handler throwing must not take down the pump */
        }
      }
    }
  }

  private onClose(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
    this.handlers.clear();
  }
}
