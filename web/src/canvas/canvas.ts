import { planeFrame, type PlaneRef } from "@bettercad/sketch";
import type { BuiltConstruct, CanvasImage, ModelDoc } from "../state/document";
import type { FaceFrame, Placement, V3 } from "../decal/place";

/**
 * Canvases (#248): pictures pinned to a plane at true size, to trace over. Framework-free, so the maths is tested
 * without a view. They are not steps: they live in `doc.canvases`, and their bytes in the document's blobs.
 */

/** A plane's frame where it is now, with its up axis: a construction plane's comes from the step as built. */
export function canvasFrame(plane: PlaneRef, construct: BuiltConstruct[] = []): FaceFrame {
  let f = planeFrame(plane);
  if (plane.kind === "construct") {
    const c = construct.find((x) => x.id === plane.step);
    if (c?.geo.what === "plane") f = planeFrame({ ...plane, frame: c.geo.frame });
  }
  const n = f.normal as V3;
  const x = f.x as V3;
  const y: V3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  return { origin: f.origin as V3, x, y, normal: n, size: [0, 0] };
}

/**
 * Calibrates a canvas: `a` and `b` are two spots on it (mm on its plane) that are really `length` mm apart. It grows or
 * shrinks about `a`, so the first spot stays where it is. Null when the spots are on top of each other.
 */
export function calibrate(c: Placement, a: [number, number], b: [number, number], length: number): Pick<Placement, "x" | "y" | "width" | "height"> | null {
  const now = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (now < 1e-6 || !(length > 0)) return null;
  const k = length / now;
  return { x: a[0] + (c.x - a[0]) * k, y: a[1] + (c.y - a[1]) * k, width: c.width * k, height: c.height * k };
}

/** A new canvas's size: 100 mm across, or the picture's shape at 100 mm on its long side. */
export function firstCanvasSize(image: { width: number; height: number }): { width: number; height: number } {
  const w = Math.max(1, image.width);
  const h = Math.max(1, image.height);
  const k = 100 / Math.max(w, h);
  return { width: Math.round(w * k * 10) / 10, height: Math.round(h * k * 10) / 10 };
}

/** The next free "Canvas N". */
export function nextCanvasName(doc: ModelDoc): string {
  const names = new Set((doc.canvases ?? []).map((c) => c.name));
  let n = 1;
  while (names.has(`Canvas ${n}`)) n += 1;
  return `Canvas ${n}`;
}

/** Adds a canvas, keeping its picture's bytes (base64) in the document's blobs. */
export function addCanvas(doc: ModelDoc, c: Omit<CanvasImage, "name">, data: string): ModelDoc {
  const blobs = doc.blobs?.[c.image.blob] ? doc.blobs : { ...doc.blobs, [c.image.blob]: data };
  return { ...doc, blobs, canvases: [...(doc.canvases ?? []), { ...c, name: nextCanvasName(doc) }] };
}

/** Changes a canvas; `data` brings a new picture's bytes. */
export function updateCanvas(doc: ModelDoc, id: string, change: Partial<CanvasImage>, data?: string): ModelDoc {
  const blob = change.image?.blob;
  const blobs = blob && data && !doc.blobs?.[blob] ? { ...doc.blobs, [blob]: data } : doc.blobs;
  return { ...doc, ...(blobs ? { blobs } : {}), canvases: (doc.canvases ?? []).map((c) => (c.id === id ? { ...c, ...change } : c)) };
}

/** Removes a canvas, and its picture's bytes when nothing else shows them. */
export function removeCanvas(doc: ModelDoc, id: string): ModelDoc {
  const gone = doc.canvases?.find((c) => c.id === id);
  if (!gone) return doc;
  const canvases = doc.canvases!.filter((c) => c.id !== id);
  const blob = gone.image.blob;
  const used =
    canvases.some((c) => c.image.blob === blob) ||
    doc.features.some((f) => (f.type === "decal" && f.image.blob === blob) || (f.type === "import" && f.blob === blob));
  let blobs = doc.blobs;
  if (!used && blobs?.[blob] !== undefined) {
    blobs = { ...blobs };
    delete blobs[blob];
  }
  return { ...doc, canvases, ...(blobs ? { blobs } : {}) };
}

/** A change from the browser: show or hide one canvas (or, with no id, all of them), rename or delete one. */
export function browserChange(doc: ModelDoc, id: string | null, act: "hide" | "rename" | "delete", name?: string): [(d: ModelDoc) => ModelDoc, string] {
  if (act === "delete") return [(d) => removeCanvas(d, id!), "Delete canvas"];
  if (act === "rename") return [(d) => updateCanvas(d, id!, { name }), "Rename canvas"];
  const all = doc.canvases ?? [];
  const hide = id ? !all.find((c) => c.id === id)?.hidden : !all.every((c) => c.hidden);
  return [
    (d) => ({ ...d, canvases: d.canvases?.map((c) => (!id || c.id === id ? { ...c, hidden: hide || undefined } : c)) }),
    hide ? "Hide canvas" : "Show canvas",
  ];
}
