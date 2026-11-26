import { describe, expect, it, vi } from "vitest";
import type { RenderShot } from "@bettercad/kernel/document";
import { memoryKV } from "../files/idb";
import { RenderJobs, shotKey, type CloudPictures, type Picture, type RenderFn } from "./jobs";
import type { RenderBody } from "./pathRender";

const shot = (id: string, o: Partial<RenderShot> = {}): RenderShot => ({
  id,
  name: `Render ${id}`,
  camera: { target: [0, 0, 0], azimuth: 45, elevation: 30, distance: 100, ortho: false },
  preset: "studio",
  style: "finishes",
  background: "lightbox",
  focus: "soft",
  quality: "good",
  width: 160,
  height: 90,
  auto: true,
  ...o,
});
const bodies = [{ id: "b" } as unknown as RenderBody];

/** A render that finishes when the test says so, after reporting half way. */
function controlled() {
  const pending: { id: string; done: () => void; signal: AbortSignal }[] = [];
  const render: RenderFn = (s, _b, progress, _wait, signal) =>
    new Promise((resolve, reject) => {
      progress(0.5);
      signal.addEventListener("abort", () => reject(new Error("Stopped")));
      pending.push({ id: s.id, signal, done: () => resolve(new Blob([s.id], { type: "image/jpeg" })) });
    });
  return { render, pending };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
URL.createObjectURL ??= () => "blob:x";
URL.revokeObjectURL ??= () => {};

const filming = { name: "Orbit video", frame: 0, frames: 10, sample: 0, samples: 16, started: 0, canvas: null };

describe("render jobs", () => {
  it("runs a video render in the background: the wheel counts it, shots wait, and Stop is heard at once", async () => {
    const { render, pending } = controlled();
    const jobs = new RenderJobs({ store: memoryKV(), render });
    let finish: (b: Blob) => void = () => {};
    let signal: AbortSignal | null = null;
    let update: (c: Partial<typeof filming>) => void = () => {};
    const video = jobs.film(filming, (u, s) => {
      update = u;
      signal = s;
      return new Promise<Blob>((resolve, reject) => {
        finish = resolve;
        s.addEventListener("abort", () => setTimeout(() => reject(new Error("Stopped")), 50));
      });
    });
    await tick();
    expect(jobs.overall()).toEqual({ count: 1, progress: 0, name: "Orbit video" });
    // Frame 5 of 10 done, half way through the sixth.
    update({ frame: 5, sample: 8 });
    expect(jobs.overall()?.progress).toBeCloseTo(0.55);
    // A shot asked for now waits for the video.
    jobs.enqueue(shot("a"), "k", bodies);
    await tick();
    expect(pending).toEqual([]);
    await expect(jobs.film(filming, async () => new Blob())).rejects.toThrow("already rendering");
    // Stop: the video is gone from the wheel at once, though its last tile is still winding up.
    jobs.stopVideo();
    expect(signal!.aborted).toBe(true);
    expect(jobs.get().video).toBeNull();
    await expect(video).rejects.toThrow("Stopped");
    await tick();
    expect(pending.map((p) => p.id)).toEqual(["a"]);
    finish(new Blob());
    jobs.dispose();
  });

  it("starts a new video render once a stopped one has wound up", async () => {
    const jobs = new RenderJobs({ store: memoryKV(), render: controlled().render });
    const order: string[] = [];
    const first = jobs.film(
      filming,
      (_u, s) =>
        new Promise((_r, reject) => s.addEventListener("abort", () => setTimeout(() => (order.push("first ended"), reject(new Error("Stopped"))), 20))),
    );
    await tick();
    jobs.stopVideo();
    const second = jobs.film({ ...filming, name: "Push in video" }, async () => (order.push("second started"), new Blob(["v"])));
    expect(jobs.get().video?.name).toBe("Push in video");
    await expect(first).rejects.toThrow();
    expect(await second).toBeInstanceOf(Blob);
    expect(order).toEqual(["first ended", "second started"]);
    expect(jobs.get().video).toBeNull();
    jobs.dispose();
  });

  it("renders one shot at a time and keeps each picture", async () => {
    const { render, pending } = controlled();
    const store = memoryKV<Picture>();
    const jobs = new RenderJobs({ store, render });
    jobs.enqueue(shot("a"), "k1", bodies);
    jobs.enqueue(shot("b"), "k2", bodies);
    await tick();
    expect(pending.map((p) => p.id)).toEqual(["a"]);
    expect(jobs.get().jobs).toEqual([
      { shot: "a", name: "Render a", progress: 0.5, running: true },
      { shot: "b", name: "Render b", progress: 0, running: false },
    ]);
    expect(jobs.overall()).toEqual({ count: 2, progress: 0.25, name: "Render a" });
    pending[0].done();
    await tick();
    await tick();
    expect(jobs.get().pictures.a.key).toBe("k1");
    expect((await store.get("a"))?.key).toBe("k1");
    expect(pending.map((p) => p.id)).toEqual(["a", "b"]);
    pending[1].done();
    await tick();
    await tick();
    expect(jobs.get().jobs).toEqual([]);
    expect(jobs.overall()).toBeNull();
    jobs.dispose();
  });

  it("starts a running shot again with the newer model, and stops a cancelled one", async () => {
    const { render, pending } = controlled();
    const jobs = new RenderJobs({ store: memoryKV(), render });
    jobs.enqueue(shot("a"), "old", bodies);
    await tick();
    jobs.enqueue(shot("a"), "new", bodies);
    await tick();
    await tick();
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending).toHaveLength(2);
    pending[1].done();
    await tick();
    await tick();
    expect(jobs.get().pictures.a.key).toBe("new");
    jobs.enqueue(shot("b"), "k", bodies);
    await tick();
    jobs.cancel("b");
    await tick();
    expect(jobs.get().jobs).toEqual([]);
    expect(jobs.get().pictures.b).toBeUndefined();
    jobs.dispose();
  });

  it("sends a finished picture to the account and fetches ones this browser lacks", async () => {
    const { render, pending } = controlled();
    const cloud: CloudPictures = {
      list: vi.fn(async () => [{ shot: "c", key: "kc", url: "/c" }]),
      fetch: vi.fn(async () => new Blob(["c"])),
      put: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const jobs = new RenderJobs({ store: memoryKV(), render, cloud: () => cloud });
    await jobs.load([shot("c")]);
    expect(jobs.get().pictures.c.key).toBe("kc");
    jobs.enqueue(shot("a"), "ka", bodies);
    await tick();
    pending[0].done();
    await tick();
    await tick();
    expect(cloud.put).toHaveBeenCalledWith("a", expect.any(Blob), "ka");
    await jobs.remove("a");
    expect(cloud.remove).toHaveBeenCalledWith("a");
    expect(jobs.get().pictures.a).toBeUndefined();
    jobs.dispose();
  });

  it("shows the running render's picture so far, and drops it when the render ends", async () => {
    let send: ((b: Blob) => void) | undefined;
    let finish = () => {};
    const render: RenderFn = (_s, _b, progress, _w, _sig, preview) =>
      new Promise((resolve) => {
        progress(0.3);
        send = preview;
        finish = () => resolve(new Blob(["done"]));
      });
    const jobs = new RenderJobs({ store: memoryKV(), render });
    jobs.enqueue(shot("a"), "k", bodies);
    await tick();
    expect(jobs.get().jobs[0].preview).toBeUndefined();
    send!(new Blob(["half"]));
    expect(jobs.get().jobs[0]).toMatchObject({ shot: "a", running: true, progress: 0.3, preview: "blob:x" });
    finish();
    await tick();
    await tick();
    expect(jobs.get().jobs).toEqual([]);
    expect(jobs.get().pictures.a.key).toBe("k");
    jobs.dispose();
  });

  it("shows a first look until the render lands, and renders waiting shots in the order given", async () => {
    const { render, pending } = controlled();
    const jobs = new RenderJobs({ store: memoryKV(), render });
    await jobs.seed("a", new Blob(["look"]));
    expect(jobs.get().pictures.a.key).toBe("");
    jobs.enqueue(shot("a"), "ka", bodies);
    jobs.enqueue(shot("b"), "kb", bodies);
    jobs.enqueue(shot("c"), "kc", bodies);
    await tick();
    jobs.order(["c", "a", "b"]);
    expect(jobs.get().jobs.map((j) => j.shot)).toEqual(["a", "c", "b"]);
    pending[0].done();
    await tick();
    await tick();
    expect(jobs.get().pictures.a.key).toBe("ka");
    await jobs.seed("a", new Blob(["late"]));
    expect(jobs.get().pictures.a.key).toBe("ka");
    expect(pending.map((p) => p.id)).toEqual(["a", "c"]);
    jobs.dispose();
  });

  it("keys a picture by the model and the shot, not its name or auto switch", () => {
    const doc = { features: [], looks: {} };
    const k = shotKey(doc, shot("a"));
    expect(shotKey(doc, shot("a", { name: "Front", auto: false }))).toBe(k);
    expect(shotKey(doc, shot("a", { background: "grey" }))).not.toBe(k);
    expect(shotKey({ ...doc, looks: { b: { colour: "#ff0000" } } } as never, shot("a"))).not.toBe(k);
    // A board's design counts once the model has a Board step, and only then.
    const mask = (m: string) => ({ board: { mask: m } }) as never;
    expect(shotKey({ ...doc, electronics: mask("green") }, shot("a"))).toBe(k);
    const withBoard = { ...doc, features: [{ id: "pcb", type: "board" }] as never };
    expect(shotKey({ ...withBoard, electronics: mask("green") }, shot("a"))).not.toBe(shotKey({ ...withBoard, electronics: mask("blue") }, shot("a")));
  });
});
