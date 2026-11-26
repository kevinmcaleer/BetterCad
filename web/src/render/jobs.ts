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
import { filmProgress, samplesFor, type Filming } from "./session";

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
  /** The running render as it clears: a small picture, refreshed about once a second. */
  preview?: string;
}

export interface JobsState {
  jobs: Job[];
  /** Object URLs of the finished pictures, by shot id, and the key each was made from. */
  pictures: Record<string, { url: string; key: string; date: number }>;
  /** A video render, which keeps going when you leave the Render view, or null. */
  video?: Filming | null;
}

/** Renders one shot to a picture. Injected so tests needn't run the path tracer. */
export type RenderFn = (
  shot: RenderShot,
  bodies: RenderBody[],
  progress: (f: number) => void,
  wait: () => Promise<unknown>,
  signal: AbortSignal,
  /** The picture so far, small, now and then while it renders. */
  preview?: (b: Blob) => void,
) => Promise<Blob>;

/** How often a running render sends the strip its picture so far. */
export const PREVIEW_MS = 1000;
/** A preview's width: the strip's tiles are 128 px wide, twice that for sharp screens. */
const PREVIEW_W = 256;

/**
 * Copies the canvas into a small JPEG, at once: a WebGL canvas keeps its picture only until the next task, so this
 * runs straight after a sample is drawn.
 */
export function previewOf(canvas: HTMLCanvasElement, send: (b: Blob) => void): void {
  const c = document.createElement("canvas");
  c.width = PREVIEW_W;
  c.height = Math.max(1, Math.round((PREVIEW_W * canvas.height) / Math.max(1, canvas.width)));
  const g = c.getContext("2d");
  if (!g) return;
  g.drawImage(canvas, 0, 0, c.width, c.height);
  c.toBlob((b) => b && send(b), "image/jpeg", 0.8);
}

/** Calls `fn` at most every `ms`, starting with the first call. */
function every(ms: number, fn: () => void): () => void {
  let last = -Infinity;
  return () => {
    const now = performance.now();
    if (now - last < ms) return;
    last = now;
    fn();
  };
}

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
export function shotKey(doc: Pick<ModelDoc, "features" | "looks" | "pose" | "electronics">, shot: RenderShot): string {
  const look = [shot.camera, shot.preset, shot.style, shot.background, shot.focus, shot.quality, shot.width, shot.height];
  // A Board step is built from the board's design, so its picture is out of date when the board changes (#654).
  const board = doc.features.some((f) => f.type === "board") ? (doc.electronics ?? null) : null;
  const model = hash(JSON.stringify(board ? [doc.features, doc.looks, doc.pose ?? null, board] : [doc.features, doc.looks, doc.pose ?? null]));
  return model.toString(16).padStart(8, "0") + hash(JSON.stringify(look)).toString(16).padStart(8, "0");
}

/** Tests cap the samples so a software GPU finishes. */
const testMax = () => (typeof window === "undefined" ? undefined : (window as unknown as { __bcRenderMax?: number }).__bcRenderMax);

/**
 * End-to-end tests on a software GPU swap the path tracer for a plain picture made over a few frames: building a
 * second path tracer takes minutes there, and the Render view's own tests already cover it.
 */
const testFake = () => typeof window !== "undefined" && !!(window as unknown as { __bcFakeRenderJobs?: boolean }).__bcFakeRenderJobs;

async function fakeRender(
  shot: RenderShot,
  progress: (f: number) => void,
  wait: () => Promise<unknown>,
  signal: AbortSignal,
  preview?: (b: Blob) => void,
): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = shot.width / 10;
  c.height = shot.height / 10;
  const g = c.getContext("2d")!;
  const tick = every(PREVIEW_MS, () => preview && previewOf(c, preview));
  // Timers rather than frames: a busy software GPU can hold frames back for seconds.
  await wait();
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    if (signal.aborted) throw new Error("Stopped");
    await new Promise((r) => setTimeout(r, 100));
    // Fills in from the left, so a preview part way shows a part-drawn picture.
    g.fillRect(0, 0, (c.width * i) / steps, c.height);
    progress(i / steps);
    tick();
  }
  return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("No image"))), "image/jpeg"));
}

/** The path tracer, in its own canvas, for one shot. Loaded with the jobs, apart from the shell. */
export const pathTrace: RenderFn = async (shot, bodies, progress, wait, signal, preview) => {
  if (testFake()) return fakeRender(shot, progress, wait, signal, preview);
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
    const tick = every(PREVIEW_MS, () => preview && previewOf(canvas, preview));
    const png = await pr.snapshot(
      shot.width,
      shot.height,
      samples,
      (f) => {
        progress(f);
        // Straight after the sample, while the canvas still holds it.
        tick();
      },
      signal,
      wait,
    );
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

  /** How far all the jobs have got together, 0 to 1, or null when nothing is waiting or running. A video counts as one. */
  overall(): { count: number; progress: number; name: string } | null {
    const { jobs, video } = this.state;
    const count = jobs.length + (video ? 1 : 0);
    if (!count) return null;
    const done = jobs.reduce((s, j) => s + j.progress, 0) + (video ? filmProgress(video) : 0);
    return { count, progress: done / count, name: video?.name ?? (jobs.find((j) => j.running) ?? jobs[0]).name };
  }

  private filmStop: AbortController | null = null;
  /** The video render's work, until it has wound up, stopped or not. */
  private filmEnd: Promise<unknown> = Promise.resolve();

  /**
   * Runs a video render in the background: `work` makes the video, telling `update` how far it has got, and stops
   * when `signal` does. Shots wait their turn until it is done (one running already carries on). One at a time: a
   * new one waits for a stopped one to wind up, and is refused while one is still going.
   */
  film(start: Filming, work: (update: (change: Partial<Filming>) => void, signal: AbortSignal) => Promise<Blob>): Promise<Blob> {
    if (this.filmStop && !this.filmStop.signal.aborted) return Promise.reject(new Error("A video is already rendering"));
    const stop = new AbortController();
    const before = this.filmEnd;
    this.filmStop = stop;
    this.set({ video: start });
    const update = (change: Partial<Filming>) => {
      if (this.filmStop === stop && !stop.signal.aborted && this.state.video) this.set({ video: { ...this.state.video, ...change } });
    };
    const done = (async () => {
      try {
        await before;
        if (stop.signal.aborted) throw new Error("Stopped");
        return await work(update, stop.signal);
      } finally {
        if (this.filmStop === stop) {
          this.filmStop = null;
          if (this.state.video) this.set({ video: null });
        }
        void this.next();
      }
    })();
    this.filmEnd = done.catch(() => {});
    return done;
  }

  /** Stops the video render, if one is running: the view hears at once, while the last tile on the GPU finishes. */
  stopVideo(): void {
    if (!this.filmStop) return;
    this.filmStop.abort();
    if (this.state.video) this.set({ video: null });
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

  /**
   * A first look at a shot not rendered yet: the Render view's picture as it was when the shot was added, so a tile
   * waiting its turn shows what it will be. It stays until the render replaces it, and is never sent to the account.
   */
  async seed(shot: string, image: Blob): Promise<void> {
    if (this.state.pictures[shot]) return;
    await this.keep(shot, image, "", null);
  }

  /** Puts the waiting jobs in this order of shots (the strip's order after a drag); the running one carries on. */
  order(ids: string[]): void {
    const at = new Map(ids.map((id, i) => [id, i]));
    this.queue = [...this.queue].sort((a, b) => (at.get(a.shot.id) ?? ids.length) - (at.get(b.shot.id) ?? ids.length));
    this.publish();
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

  /** The running job's latest preview, an object URL. */
  private preview: string | null = null;
  private setPreview(b: Blob | null) {
    if (this.preview) URL.revokeObjectURL(this.preview);
    this.preview = b ? URL.createObjectURL(b) : null;
  }

  private publish(progress = this.running ? (this.state.jobs.find((j) => j.running)?.progress ?? 0) : 0) {
    const jobs: Job[] = [];
    if (this.running)
      jobs.push({
        shot: this.running.job.shot.id,
        name: this.running.job.shot.name,
        progress,
        running: true,
        ...(this.preview ? { preview: this.preview } : {}),
      });
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
    // A video render has the GPU to itself: shots wait for it.
    if (this.running || this.disposed || this.filmStop) return;
    const job = this.queue.shift();
    if (!job) return this.publish();
    const stop = new AbortController();
    this.running = { job, stop };
    this.publish(0);
    try {
      const blob = await this.render(
        job.shot,
        job.bodies,
        (f) => this.publish(Math.min(1, f)),
        this.wait,
        stop.signal,
        (b) => {
          if (stop.signal.aborted || this.running?.job !== job) return;
          this.setPreview(b);
          this.publish();
        },
      );
      if (!stop.signal.aborted && !this.disposed) await this.keep(job.shot.id, blob, job.key, job.cloud);
    } catch {
      // Stopped, or the browser couldn't render: the old picture stays.
    } finally {
      this.running = null;
      this.setPreview(null);
      this.publish();
      void this.next();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.running?.stop.abort();
    this.filmStop?.abort();
    this.setPreview(null);
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
