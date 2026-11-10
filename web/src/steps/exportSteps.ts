/**
 * Export build steps: replays the timeline one step at a time in the kernel, draws a picture after each, and packs
 * the pictures, a Markdown guide (README.md) and the model itself into a .zip. Loads on first use, apart from the
 * shell.
 */
import { DEFLECTION, type BodyMesh, type Call, type Methods } from "@bettercad/kernel";
import { saveBcad } from "@bettercad/kernel/bcad";
import { zip } from "@bettercad/kernel/zip";
import { build, type ModelDoc } from "../state/document";
import type { FileStore } from "../files/fileStore";
import { liveFrame } from "../sketch/useSketch";
import { buildSteps, imageName, stepsMarkdown } from "./instructions";
import { sketchDiagram } from "./sketchDiagram";
import { Bounds, StepPictures, sketchLines, type PictureBody, type PictureSketch } from "./picture";

export interface StepsExport {
  doc: ModelDoc;
  upTo: number;
  call: <M extends keyof Methods>(method: M, params: Methods[M]["params"]) => Call<Methods[M]["result"]> | null;
  /** How far along, 0 to 1, with what it is doing. */
  onProgress?: (fraction: number, text: string) => void;
  /** Also pack an STL of each part under models/, to print from (Send to kevsrobots). */
  parts?: boolean;
}

export interface StepsZip {
  name: string;
  bytes: Uint8Array;
  steps: number;
}

/** A cheap fingerprint of a mesh, to tell which bodies a step changed. */
function meshKey(m: BodyMesh): string {
  const p = m.positions;
  let h = 0;
  const stride = Math.max(1, Math.floor(p.length / 997));
  for (let i = 0; i < p.length; i += stride) h = (h * 31 + Math.round(p[i]! * 1000)) | 0;
  return `${p.length}:${m.indices.length}:${h}`;
}

/** Safe in a file name on every system. */
export const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Untitled model";

export async function exportSteps(o: StepsExport): Promise<StepsZip> {
  const { doc, upTo } = o;
  const steps = buildSteps(doc, upTo);
  if (!steps.length) throw new Error("There are no steps to show yet.");
  const enc = new TextEncoder();
  const images = new Map<number, string>();
  const diagrams = new Map<number, string>();
  const files: { name: string; data: Uint8Array }[] = [];

  // First every step's bodies, so one camera frames the whole build.
  const frames: { bodies: PictureBody[]; sketch?: PictureSketch }[] = [];
  const failed = new Map<string, string>();
  const bounds = new Bounds();
  let before = new Map<string, string>();
  for (const [i, s] of steps.entries()) {
    o.onProgress?.((i / steps.length) * 0.5, `Building step ${s.n} of ${steps.length}`);
    const k = o.call("build", { doc, upTo: s.at });
    if (!k) throw new Error("The geometry engine is off, so the steps can't be drawn.");
    const r = await k;
    for (const [id, why] of r.failed) if (id === s.feature.id) failed.set(id, why);
    const built = build(doc, s.at);
    const parts = new Map(built.parts.map((p) => [p.id, p]));
    const now = new Map<string, string>();
    const bodies: PictureBody[] = [];
    for (const b of r.bodies) {
      const part = parts.get(b.id);
      if (!part || part.hidden || part.reference) continue;
      const key = meshKey(b.mesh);
      now.set(b.id, key);
      bodies.push({ id: b.id, mesh: b.mesh, colour: part.colour, hole: part.hole, changed: before.get(b.id) !== key });
      bounds.add(b.mesh.positions);
    }
    before = now;
    let sketch: PictureSketch | undefined;
    if (s.feature.type === "sketch") {
      sketch = { sketch: s.feature.sketch, frame: liveFrame(s.feature.sketch.plane, built.construct) };
      for (const l of sketchLines(sketch)) for (const q of l) bounds.add(q);
    }
    frames.push({ bodies, sketch });
  }

  const pictures = new StepPictures();
  try {
    pictures.frame(bounds);
    for (const [i, s] of steps.entries()) {
      o.onProgress?.(0.5 + (i / steps.length) * 0.5, `Drawing step ${s.n} of ${steps.length}`);
      const f = frames[i]!;
      const png = await pictures.draw(f.bodies, f.sketch);
      const name = `images/${imageName(s.n, steps.length)}`;
      files.push({ name, data: new Uint8Array(await png.arrayBuffer()) });
      images.set(s.n, name);
      if (s.feature.type === "sketch") {
        const diagram = await sketchDiagram(s.feature.sketch);
        if (diagram) {
          const dn = `images/${imageName(s.n, steps.length, "-sketch")}`;
          files.push({ name: dn, data: new Uint8Array(await diagram.arrayBuffer()) });
          diagrams.set(s.n, dn);
        }
      }
    }
    const last = frames[frames.length - 1]!;
    const done = await pictures.draw(last.bodies.map((b) => ({ ...b, changed: false })));
    files.push({ name: "images/finished.png", data: new Uint8Array(await done.arrayBuffer()) });
  } finally {
    pictures.dispose();
  }

  if (o.parts) {
    o.onProgress?.(1, "Making the parts to print");
    const k = o.call("export", {
      doc,
      upTo,
      bodies: null,
      format: "stl",
      deflection: DEFLECTION.normal,
      separate: true,
      keepPosition: false,
      posed: false,
      rosPackage: false,
      name: doc.name,
    });
    if (k) for (const f of (await k).files) files.push({ name: `models/${fileSafe(f.name)}`, data: new Uint8Array(f.data) });
  }

  const base = fileSafe(doc.name);
  const modelFile = `${base}.bcad`;
  const md = stepsMarkdown(doc, steps, { modelFile, failed, images, diagrams, finished: "images/finished.png" });
  files.unshift({ name: "README.md", data: enc.encode(md) }, { name: modelFile, data: enc.encode(saveBcad(doc)) });
  o.onProgress?.(1, "Packing the steps");
  return { name: `${base} build steps.zip`, bytes: zip(files), steps: steps.length };
}

/**
 * Asks where to save first, while the click still lets the page ask, then draws the steps and writes the .zip there.
 * Progress and the outcome go to the status line.
 */
export async function saveSteps(o: Omit<StepsExport, "onProgress"> & { files: FileStore; say: (text: string, bad?: boolean) => void }): Promise<void> {
  const name = `${fileSafe(o.doc.name)} build steps.zip`;
  o.say("Drawing the build steps…");
  const made = exportSteps({ ...o, onProgress: (_, text) => o.say(`${text}…`) });
  try {
    const saved = await o.files.saveFiles([{ name, data: made.then((r) => r.bytes.slice().buffer), mime: "application/zip" }]);
    const r = await made;
    if (saved) o.say(`Exported ${r.steps === 1 ? "1 step" : `${r.steps} steps`} to ${saved.names[0]}`);
  } catch (e) {
    o.say((e as { message?: string })?.message ?? "The build steps didn't export.", true);
  }
}
