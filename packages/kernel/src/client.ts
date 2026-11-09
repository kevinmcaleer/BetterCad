import type { KernelErrorData } from "./errors";
import type { Method, Methods, Request, Response } from "./protocol";

/**
 * The app's side of the kernel worker (#44): typed calls that return promises, cancellation, load progress, and a
 * restart when the worker dies. A crash rejects what was in flight with `kernel-crashed`; the next call starts a new
 * worker, so one bad operation never takes the editor down.
 */
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
}

export type KernelState = { status: "loading"; fraction: number } | { status: "ready"; ms: number } | { status: "failed"; error: KernelErrorData };

export interface Call<R> extends Promise<R> {
  cancel(): void;
}

export class KernelCallError extends Error implements KernelErrorData {
  readonly code: KernelErrorData["code"];
  readonly detail?: string;
  constructor(e: KernelErrorData) {
    super(e.message);
    this.name = "KernelError";
    this.code = e.code;
    this.detail = e.detail;
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  onProgress?: (f: number, steps?: [number, number]) => void;
}

export class KernelClient {
  private worker: WorkerLike | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private listeners = new Set<(s: KernelState) => void>();
  state: KernelState = { status: "loading", fraction: 0 };
  /** How many times the worker has been restarted after a crash. */
  restarts = 0;

  constructor(private spawn: () => WorkerLike) {}

  /** Starts the worker now rather than on the first call, so the WASM downloads while the app opens. */
  start(): this {
    this.ensure();
    return this;
  }

  subscribe(fn: (s: KernelState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  call<M extends Method>(method: M, params: Methods[M]["params"], onProgress?: (f: number, steps?: [number, number]) => void): Call<Methods[M]["result"]> {
    const id = this.nextId++;
    const w = this.ensure();
    const p = new Promise<Methods[M]["result"]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    }) as Call<Methods[M]["result"]>;
    p.cancel = () => {
      if (this.pending.has(id)) w.postMessage({ kind: "cancel", id } satisfies Request);
    };
    w.postMessage({ kind: "call", id, method, params } satisfies Request);
    return p;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.fail({ code: "cancelled", message: "Stopped." });
  }

  private set(s: KernelState) {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  private ensure(): WorkerLike {
    if (this.worker) return this.worker;
    const w = this.spawn();
    this.worker = w;
    if (this.state.status !== "ready") this.set({ status: "loading", fraction: 0 });
    w.onmessage = (ev) => this.receive(ev.data as Response);
    w.onerror = (ev) => {
      ev.preventDefault();
      this.crash(ev.message || "worker error");
    };
    return w;
  }

  private receive(msg: Response) {
    switch (msg.kind) {
      case "load":
        this.set({ status: "loading", fraction: msg.fraction });
        return;
      case "ready":
        this.set({ status: "ready", ms: msg.ms });
        return;
      case "load-error":
        this.set({ status: "failed", error: msg.error });
        this.fail(msg.error);
        return;
      case "progress":
        this.pending.get(msg.id)?.onProgress?.(msg.fraction, msg.steps);
        return;
      case "result": {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.resolve(msg.result);
        return;
      }
      case "error": {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.reject(new KernelCallError(msg.error));
        return;
      }
    }
  }

  /** The worker died (out of memory, a WASM trap): reject what was in flight and start afresh next time. */
  private crash(detail: string) {
    this.worker?.terminate();
    this.worker = null;
    this.restarts++;
    this.fail({ code: "kernel-crashed", message: "The geometry engine stopped. Your model is safe; try that again.", detail });
    this.set({ status: "loading", fraction: 0 });
  }

  private fail(error: KernelErrorData) {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) p.reject(new KernelCallError(error));
  }
}
