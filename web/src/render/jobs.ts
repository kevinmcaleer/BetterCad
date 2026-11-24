/**
 * The render film strip's jobs: shots rendered one at a time in the background, in this browser, while you keep
 * modelling. Each finished picture is kept beside the model (this browser's store, and the account when the model is
 * saved there), never in the model file. A job waits while you drag in the view or the tab is hidden, and takes one
 * sample a frame, so the modelling view stays smooth.
 * Framework-free; the strip and the top bar's progress wheel subscribe to it.
 */
import type { ModelDoc, RenderShot } from "@bettercad/kernel/document";
import type { KV } from "../files/idb";
import type { RenderBody } from "./pathRender";
import { samplesFor } from "./session";

/** A finished render as kept in this browser. */
export interface Picture {
  /** The model and shot it was rendered from (`shotKey`): a different key now means it is out of date. */
  key: string;
  blob: Blob;
  date: number;
}

export interface Job {
  shot: string;
  name: string;
  /** 0 to 1; 0 while it waits its turn. */
  progress: number;
  running: boolean;
}

export interface JobsState {
  jobs: Job[];
  /** Object URLs of the finished pictures, by shot id, and the key each was made from. */
  pictures: Record<string, { url: string; key: string; date: number }>;
}

/** Renders one shot to a picture. Injected so tests needn't run the path tracer. */
export type RenderFn = (
  shot: RenderShot,
  bodies: RenderBody[],
  progress: (f: number) => void,
  wait: () => Promise<unknown>,
  signal: AbortSignal,
) => Promise<Blob>;

/** Where the account keeps the pictures, when the model is saved there. */
export interface CloudPictures {
  list(): Promise<{ shot: string; key: string; url: string }[]>;
  fetch(url: string): Promise<Blob>;
  put(shot: string, image: Blob, key: string): Promise<unknown>;
  remove(shot: string): Promise<unknown>;
}

export interface JobsDeps {
  store: KV<Picture>;
  render?: RenderFn;
  /** The account's copy for the open model, or null for a model only on disk or in this browser. */
  cloud?: () => CloudPictures | null;
}

/** FNV-1a over a string, as 8 hex digits: enough to tell one version of a model from the next. */
function hash(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** What a shot's picture depends on: the model's steps, colours and pose, and the shot itself (less its name and auto). */
export function shotKey(doc: Pick<ModelDoc, "features" | "looks" | "pose">, shot: RenderShot): string {
  const look = [shot.camera, shot.preset, shot.style, shot.background, shot.focus, shot.quality, shot.width, shot.height];
  const model = hash(JSON.stringify([doc.features, doc.looks, doc.pose ?? null]));
  return model.toString(16).padStart(8, "0") + hash(JSON.stringify(look)).toString(16).padStart(8, "0");
}

/** Tests cap the samples so a software GPU finishes. */
const testMax = () => (typeof window === "undefined" ? undefined : (window as unknown as { __bcRenderMax?: number }).__bcRenderMax);

/**
 * End-to-end tests on a software GPU swap the path tracer for a plain picture made over a few frames: building a
 * second path tracer takes minutes there, and the Render view's own tests already cover it.
 */
const testFake = () => typeof window !== "undefined" && !!(window as unknown as { __bcFakeRenderJobs?: boolean }).__bcFakeRenderJobs;

async function fakeRender(shot: RenderShot, progress: (f: number) => void, wait: () => Promise<unknown>, signal: AbortSignal): Promise<Blob> {
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    if (signal.aborted) throw new Error("Stopped");
    await wait();
    await new Promise((r) => setTimeout(r, 100));
    progress(i / steps);
  }
  const c = document.createElement("canvas");
  c.width = shot.width / 10;
  c.height = shot.height / 10;
  c.getContext("2d")!.fillRect(0, 0, c.width, c.height);
  return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("No image"))), "image/jpeg"));
}

/** The path tracer, in its own canvas, for one shot. Loaded with the jobs, apart from the shell. */
export const pathTrace: RenderFn = async (shot, bodies, progress, wait, signal) => {
  if (testFake()) return fakeRender(shot, progress, wait, signal);
  const { PathRender } = await import("./pathRender");
  const { FOCUSES } = await import("./session");
  const canvas = document.createElement("canvas");
  const pr = new PathRender(canvas);
  try {
    pr.setBodies(bodies);
    pr.setPreset(shot.preset);
    pr.setStyle(shot.style);
    pr.setBackground(shot.background);
    pr.setFocus(FOCUSES.find((f) => f.id === shot.focus)?.aperture ?? 0);
    pr.setSize(shot.width, shot.height);
    pr.setCamera(shot.camera);
    const samples = testMax() ?? samplesFor(shot.quality);
    pr.maxSamples = samples;
    const png = await pr.snapshot(shot.width, shot.height, samples, progress, signal, wait);
    return await toJpeg(png);
  } finally {
    pr.dispose();
    pr.renderer.forceContextLoss();
  }
};

/** A JPEG of the PNG: about a tenth the size, and the same to look at. */
async function toJpeg(png: Blob): Promise<Blob> {
  const img = await createImageBitmap(png);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.drawImage(img, 0, 0);
  img.close();
  return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("No image"))), "image/jpeg", 0.92));
}

interface Queued {
  shot: RenderShot;
  key: string;
  bodies: RenderBody[];
  /** Where the picture goes in the account: the model open when the job was asked for, not whatever is open later. */
  cloud: CloudPictures | null;
}

/**
 * The queue. One job runs at a time; asking for a shot that is already waiting replaces its turn with the newer
 * model, and asking for the one that is running starts it again.
 */
export class RenderJobs {
  private state: JobsState = { jobs: [], pictures: {} };
  private subs = new Set<() => void>();
  private queue: Queued[] = [];
  private running: { job: Queued; stop: AbortController } | null = null;
  private held = 0;
  private readonly render: RenderFn;
  private disposed = false;

  constructor(private deps: JobsDeps) {
    this.render = deps.render ?? pathTrace;
    if (typeof window !== "undefined") {
      window.addEventListener("pointerdown", this.press, true);
      window.addEventListener("pointerup", this.release, true);
      window.addEventListener("pointercancel", this.release, true);
    }
  }

  get = (): JobsState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  private set(change: Partial<JobsState>) {
    this.state = { ...this.state, ...change };
    for (const f of this.subs) f();
  }

  /** How far all the jobs have got together, 0 to 1, or null when nothing is waiting or running. */
  overall(): { count: number; progress: number; name: string } | null {
    const { jobs } = this.state;
    if (!jobs.length) return null;
    const done = jobs.reduce((s, j) => s + j.progress, 0);
    return { count: jobs.length, progress: done / jobs.length, name: (jobs.find((j) => j.running) ?? jobs[0]).name };
  }

  // A press anywhere (orbiting, dragging a sketch point) holds the render until you let go.
  private press = () => void (this.held = 1);
  private release = () => void (this.held = 0);
  private wait = async () => {
    do await new Promise((r) => (typeof requestAnimationFrame === "undefined" ? setTimeout(r, 16) : requestAnimationFrame(() => setTimeout(r, 0))));
    while (!this.disposed && (this.held || (typeof document !== "undefined" && document.hidden)));
  };

  /** Shows the pictures kept for these shots: this browser's first, then any the account has that this browser lacks. */
  async load(shots: RenderShot[]): Promise<void> {
    const pictures = { ...this.state.pictures };
    for (const s of shots) {
      if (pictures[s.id]) continue;
      const p = await this.deps.store.get(s.id).catch(() => undefined);
      if (p) pictures[s.id] = { url: URL.createObjectURL(p.blob), key: p.key, date: p.date };
    }
    this.set({ pictures });
    const cloud = this.deps.cloud?.();
    if (!cloud) return;
    const wanted = new Set(shots.filter((s) => !pictures[s.id]).map((s) => s.id));
    if (!wanted.size) return;
    const list = await cloud.list().catch(() => []);
    for (const r of list) {
      if (!wanted.has(r.shot)) continue;
      const blob = await cloud.fetch(r.url).catch(() => null);
      if (blob) await this.keep(r.shot, blob, r.key, null);
    }
  }

  /** Renders the shot in the background with these bodies (the model as it is now). */
  enqueue(shot: RenderShot, key: string, bodies: RenderBody[]): void {
    if (!bodies.length) return;
    const job = { shot, key, bodies, cloud: this.deps.cloud?.() ?? null };
    if (this.running?.job.shot.id === shot.id) {
      this.running.stop.abort();
      this.queue.unshift(job);
    } else {
      const i = this.queue.findIndex((q) => q.shot.id === shot.id);
      if (i >= 0) this.queue[i] = job;
      else this.queue.push(job);
    }
    this.publish();
    void this.next();
  }

  /** Stops a shot's job, waiting or running. */
  cancel(id: string): void {
    this.queue = this.queue.filter((q) => q.shot.id !== id);
    if (this.running?.job.shot.id === id) this.running.stop.abort();
    this.publish();
  }

  /** Takes a shot off the strip: its job and its pictures. */
  async remove(id: string): Promise<void> {
    this.cancel(id);
    const pictures = { ...this.state.pictures };
    if (pictures[id]) URL.revokeObjectURL(pictures[id].url);
    delete pictures[id];
    this.set({ pictures });
    await this.deps.store.del(id).catch(() => undefined);
    await this.deps
      .cloud?.()
      ?.remove(id)
      .catch(() => undefined);
  }

  /** A finished picture's file, to save. */
  async blob(id: string): Promise<Blob | null> {
    return (await this.deps.store.get(id).catch(() => undefined))?.blob ?? null;
  }

  private publish(progress = this.running ? (this.state.jobs.find((j) => j.running)?.progress ?? 0) : 0) {
    const jobs: Job[] = [];
    if (this.running) jobs.push({ shot: this.running.job.shot.id, name: this.running.job.shot.name, progress, running: true });
    for (const q of this.queue) jobs.push({ shot: q.shot.id, name: q.shot.name, progress: 0, running: false });
    this.set({ jobs });
  }

  private async keep(shot: string, blob: Blob, key: string, upload: CloudPictures | null) {
    const date = Date.now();
    await this.deps.store.set(shot, { key, blob, date }).catch(() => undefined);
    const pictures = { ...this.state.pictures };
    if (pictures[shot]) URL.revokeObjectURL(pictures[shot].url);
    pictures[shot] = { url: URL.createObjectURL(blob), key, date };
    this.set({ pictures });
    await upload?.put(shot, blob, key).catch(() => undefined);
  }

  private async next(): Promise<void> {
    if (this.running || this.disposed) return;
    const job = this.queue.shift();
    if (!job) return this.publish();
    const stop = new AbortController();
    this.running = { job, stop };
    this.publish(0);
    try {
      const blob = await this.render(job.shot, job.bodies, (f) => this.publish(Math.min(1, f)), this.wait, stop.signal);
      if (!stop.signal.aborted && !this.disposed) await this.keep(job.shot.id, blob, job.key, job.cloud);
    } catch {
      // Stopped, or the browser couldn't render: the old picture stays.
    } finally {
      this.running = null;
      this.publish();
      void this.next();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.running?.stop.abort();
    for (const p of Object.values(this.state.pictures)) URL.revokeObjectURL(p.url);
    if (typeof window !== "undefined") {
      window.removeEventListener("pointerdown", this.press, true);
      window.removeEventListener("pointerup", this.release, true);
      window.removeEventListener("pointercancel", this.release, true);
    }
  }
}

/** A picture as a data URL, the way the account takes it. */
export function dataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}
