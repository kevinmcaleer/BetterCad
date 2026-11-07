import { KernelClient, type WorkerLike } from "./client";
import type { Request, Response } from "./protocol";

/** A worker stand-in: records what it is sent and lets the test answer. */
class FakeWorker implements WorkerLike {
  sent: Request[] = [];
  terminated = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  postMessage(msg: unknown) {
    this.sent.push(msg as Request);
  }
  terminate() {
    this.terminated = true;
  }
  reply(msg: Response) {
    this.onmessage?.({ data: msg } as MessageEvent);
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = new KernelClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  return { client, workers };
}

describe("KernelClient", () => {
  it("reports load progress, then ready", () => {
    const { client, workers } = setup();
    const states: string[] = [];
    client.start().subscribe((s) => states.push(s.status === "loading" ? `loading ${s.fraction}` : s.status));
    workers[0]!.reply({ kind: "load", fraction: 0.5 });
    workers[0]!.reply({ kind: "ready", ms: 200 });
    expect(states).toEqual(["loading 0", "loading 0.5", "ready"]);
  });

  it("matches replies to calls by id", async () => {
    const { client, workers } = setup();
    const a = client.call("ping", {});
    const b = client.call("ping", {});
    const [ra, rb] = workers[0]!.sent as Extract<Request, { kind: "call" }>[];
    workers[0]!.reply({ kind: "result", id: rb!.id, result: { ok: true, engine: "b" } });
    workers[0]!.reply({ kind: "result", id: ra!.id, result: { ok: true, engine: "a" } });
    await expect(a).resolves.toEqual({ ok: true, engine: "a" });
    await expect(b).resolves.toEqual({ ok: true, engine: "b" });
  });

  it("turns error replies into KernelErrors", async () => {
    const { client, workers } = setup();
    const a = client.call("ping", {});
    workers[0]!.reply({ kind: "error", id: 1, error: { code: "boolean-failed", message: "These bodies could not be joined." } });
    await expect(a).rejects.toMatchObject({ code: "boolean-failed", message: "These bodies could not be joined." });
  });

  it("sends a cancel for a call still running", () => {
    const { client, workers } = setup();
    const a = client.call("ping", {});
    a.cancel();
    expect(workers[0]!.sent.at(-1)).toEqual({ kind: "cancel", id: 1 });
    a.catch(() => undefined);
  });

  it("restarts the worker after a crash and rejects what was in flight", async () => {
    const { client, workers } = setup();
    const a = client.call("ping", {});
    workers[0]!.onerror?.(new Event("error") as ErrorEvent);
    await expect(a).rejects.toMatchObject({ code: "kernel-crashed" });
    expect(workers[0]!.terminated).toBe(true);
    expect(client.restarts).toBe(1);
    const b = client.call("ping", {});
    expect(workers).toHaveLength(2);
    workers[1]!.reply({ kind: "result", id: 2, result: { ok: true, engine: "x" } });
    await expect(b).resolves.toMatchObject({ ok: true });
  });
});
