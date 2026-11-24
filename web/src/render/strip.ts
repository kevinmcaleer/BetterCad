/**
 * The render film strip's actions, for the editor: adding a shot from the Render view, rendering again after a save,
 * saving a picture, and keeping the pictures in the account beside the model. Loads with the strip, apart from the
 * shell; the editor only holds the controller.
 */
import type { ModelDoc, RenderShot } from "@bettercad/kernel/document";
import type { createApi } from "../cloud/api";
import type { OutFile } from "../files/fileStore";
import { idbKV } from "../files/idb";
import type { CameraState } from "../viewport/camera";
import { dataUrl, RenderJobs, shotKey, type CloudPictures } from "./jobs";
import type { RenderBody } from "./pathRender";
import type { RenderSession } from "./session";

export interface StripDeps {
  api: ReturnType<typeof createApi>;
  /** The open model's id in the account, or null when it is only on disk, in this browser or someone else's. */
  cloudModel: string | null;
  doc: ModelDoc;
  /** The shown bodies, as the path tracer draws them. */
  bodies: () => RenderBody[];
  edit: (change: (doc: ModelDoc) => ModelDoc, label: string) => void;
  say: (text: string, bad?: boolean) => void;
  saveFiles: (files: OutFile[]) => Promise<{ names: string[] } | undefined>;
  newId: (prefix: string) => string;
}

/** A shot is drawn this wide; its height follows the Render view's shape. */
const WIDTH = 1600;

export class StripController {
  readonly jobs: RenderJobs;

  constructor(private deps: () => StripDeps) {
    this.jobs = new RenderJobs({ store: idbKV("renders"), cloud: () => this.cloud() });
  }

  private cloud(): CloudPictures | null {
    const { api, cloudModel: id } = this.deps();
    if (!id) return null;
    const base = `models/${encodeURIComponent(id)}/renders`;
    const one = (shot: string) => `${base}/${encodeURIComponent(shot)}`;
    return {
      list: () => api.call<{ renders: { shot: string; key: string; url: string }[] }>("GET", base).then((r) => r.renders),
      fetch: (url) => fetch(url, { credentials: "same-origin" }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error("Missing")))),
      put: (shot, image, key) => dataUrl(image).then((data) => api.call("PUT", one(shot), { image: data, key })),
      remove: (shot) => api.call("DELETE", one(shot)),
    };
  }

  keyOf = (s: RenderShot): string => shotKey(this.deps().doc, s);

  /** Renders the shot again, from the model as it is now. */
  render = (s: RenderShot): void => this.jobs.enqueue(s, this.keyOf(s), this.deps().bodies());

  /** Shows the model's pictures; in the Render view, shots never rendered start rendering. */
  async load(shots: RenderShot[], start: boolean): Promise<void> {
    await this.jobs.load(shots);
    if (!start) return;
    const { pictures, jobs } = this.jobs.get();
    for (const s of shots) if (!pictures[s.id] && !jobs.some((j) => j.shot === s.id)) this.render(s);
  }

  /** After a save: each shot that follows saves renders again, unless its picture already shows this model. */
  saved(doc: ModelDoc): void {
    const { pictures } = this.jobs.get();
    const bodies = this.deps().bodies();
    for (const s of doc.renders ?? []) {
      if (!s.auto) continue;
      const key = shotKey(doc, s);
      if (pictures[s.id]?.key !== key) this.jobs.enqueue(s, key, bodies);
    }
  }

  private shots(change: (list: RenderShot[]) => RenderShot[], label: string) {
    this.deps().edit((x) => {
      const renders = change(x.renders ?? []);
      const next: ModelDoc = { ...x, renders };
      if (!renders.length) delete next.renders;
      return next;
    }, label);
  }

  /** Keeps the Render view's current shot on the strip and renders it in the background. */
  add(session: RenderSession, camera: CameraState): void {
    const { doc, newId, say } = this.deps();
    const r = session.get();
    const size = session.size?.() ?? { width: 16, height: 9 };
    const height = Math.max(200, Math.min(3200, Math.round((WIDTH * Math.max(1, size.height)) / Math.max(1, size.width))));
    const list = doc.renders ?? [];
    const used = new Set(list.map((s) => s.name));
    let n = list.length + 1;
    while (used.has(`Render ${n}`)) n++;
    const shot: RenderShot = {
      id: newId("r"),
      name: `Render ${n}`,
      camera: { ...camera, ortho: false },
      preset: r.preset,
      style: r.style,
      background: r.background,
      focus: r.focus,
      quality: r.quality,
      width: WIDTH,
      height,
      auto: true,
    };
    this.shots((l) => [...l, shot], "Add render");
    this.render(shot);
    say(`Added ${shot.name}. It renders in the background.`);
  }

  /** Puts the Render view on the shot: its light, background, finish and camera. */
  use(session: RenderSession, s: RenderShot): void {
    session.set({ preset: s.preset, style: s.style, background: s.background, focus: s.focus, quality: s.quality });
    session.look?.({ ...s.camera, ortho: false });
  }

  change = (s: RenderShot): void =>
    this.shots((list) => list.map((x) => (x.id === s.id ? s : x)), s.auto ? "Update render when saved" : "Stop updating render");

  remove = (s: RenderShot): void => {
    this.shots((list) => list.filter((x) => x.id !== s.id), "Delete render");
    void this.jobs.remove(s.id);
  };

  /** Saves the picture as a JPEG. Called straight from the click, so the browser still lets it ask where to save. */
  save = (s: RenderShot): void => {
    const { doc, say, saveFiles } = this.deps();
    const data = this.jobs.blob(s.id).then((b) => (b ? b.arrayBuffer() : Promise.reject(new Error("Not rendered yet"))));
    saveFiles([{ name: `${doc.name} ${s.name}.jpg`, data, mime: "image/jpeg" }]).then(
      (saved) => saved && say(`Saved ${saved.names[0]}`),
      () => say(`Couldn't save ${s.name}`, true),
    );
  };

  dispose(): void {
    this.jobs.dispose();
  }
}
