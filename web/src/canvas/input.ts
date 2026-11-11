import { squareFrame, type PlaneRef } from "@bettercad/sketch";
import type { Pair } from "@bettercad/kernel";
import { newId, type BuiltConstruct, type CanvasImage, type DecalImage } from "../state/document";
import type { Engine } from "../viewport/engine";
import { inFace, pictureAt, type FaceFrame, type V3 } from "../decal/place";
import { readPicture } from "../decal/picture";
import { MeasureOverlay } from "../measure/overlay";
import { canvasFrame, firstCanvasSize } from "./canvas";

/**
 * The Canvas tool's pointer work and picture reading (#248). It loads when the tool is first armed, so the editor's
 * first paint carries only the thin hook in useCanvas.
 */
export type Calib = { a?: [number, number]; b?: [number, number] };

export interface CanvasInputCtx {
  canvas(): CanvasImage | null;
  construct(): BuiltConstruct[] | undefined;
  busy(): boolean;
  setBusy(b: boolean): void;
  calib(): Calib | null;
  setCalib(c: Calib | null): void;
  change(c: Partial<CanvasImage>, data?: string): void;
  /** Adds a new canvas and opens it. */
  add(c: Omit<CanvasImage, "name">, data: string): void;
  say(text: string, error?: boolean): void;
}

const PLANES_ONLY = new Set(["plane"] as const);
const round = (v: number) => Math.round(v * 10) / 10;

/** Asks for a picture file; resolves with it, or null when the person closes the dialog. */
function choosePicture(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** Asks for a picture and reads it; says why when it can't. */
async function pickPicture(ctx: CanvasInputCtx): Promise<{ image: DecalImage; data: string } | null> {
  const file = await choosePicture();
  if (!file) return null;
  ctx.setBusy(true);
  try {
    const r = await readPicture(file);
    if (typeof r === "string") {
      ctx.say(r, true);
      return null;
    }
    return r;
  } finally {
    ctx.setBusy(false);
  }
}

/** Swaps the picture, keeping the canvas's width and the new picture's shape. */
export async function changePicture(ctx: CanvasInputCtx) {
  const c = ctx.canvas();
  if (!c) return;
  const r = await pickPicture(ctx);
  if (!r) return;
  ctx.change({ image: r.image, height: round((c.width * r.image.height) / Math.max(1, r.image.width)) }, r.data);
}

/** The plane under the pointer: a flat face first, then a construction plane, then an origin plane. */
function planeAt(eng: Engine, ctx: CanvasInputCtx, x: number, y: number): { plane: PlaneRef; name: string } | null {
  const pick = eng.pick(x, y, "face");
  if (pick) {
    const info = eng.faceInfo(pick.body, pick.index);
    if (info?.flat)
      return {
        plane: { kind: "face", face: { body: pick.body, face: pick.index }, offset: 0, frame: squareFrame(info.centroid, info.normal) },
        name: "the face",
      };
  }
  const id = eng.constructAt(x, y, PLANES_ONLY);
  const c = id ? ctx.construct()?.find((k) => k.id === id) : undefined;
  if (c?.geo.what === "plane") return { plane: { kind: "construct", step: c.id, offset: 0, frame: c.geo.frame }, name: c.name };
  const w = eng.planeAt(x, y);
  return w ? { plane: { kind: "world", plane: w, offset: 0 }, name: `the ${w} plane` } : null;
}

/** Where the pointer meets the canvas's plane, in mm on it, and whether that is on the picture. */
function onCanvas(eng: Engine, f: FaceFrame, c: CanvasImage, x: number, y: number) {
  const w = eng.rayPlane(x, y, f.origin, f.normal);
  if (!w) return null;
  const [s, t] = pictureAt(f, c, w);
  return { uv: inFace(f, w), on: s >= 0 && s <= 1 && t >= 0 && t <= 1 };
}

/** Wires the pointer to the tool; returns the undo. */
export function attachCanvasInput(eng: Engine, ctx: CanvasInputCtx): () => void {
  let drag: { dx: number; dy: number } | null = null;
  const marks = new MeasureOverlay(eng);
  const world = (f: FaceFrame, p: [number, number]): V3 => [0, 1, 2].map((k) => f.origin[k]! + f.x[k]! * p[0] + f.y[k]! * p[1]) as V3;
  /** The calibration line so far: from the first spot to the second, or to the pointer. */
  const showMarks = (f: FaceFrame | null, a?: [number, number], b?: [number, number]) => {
    if (!f || !a) return marks.update(undefined, false);
    const [from, to] = [world(f, a), world(f, b ?? a)];
    marks.update({ from, to, distance: Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) } as Pair, false);
  };
  const frameOf = (c: CanvasImage) => canvasFrame(c.plane, ctx.construct());
  const noCanvas = !ctx.canvas();
  if (noCanvas) eng.showPlanes(true);
  eng.setInput({
    move: (p, _m, pressed) => {
      const c = ctx.canvas();
      if (!c) {
        if (pressed) return;
        const pk = eng.pick(p.x, p.y, "face");
        eng.showHover(pk);
        eng.hoverPlane(pk ? null : eng.planeAt(p.x, p.y));
        return;
      }
      const f = frameOf(c);
      const at = onCanvas(eng, f, c, p.x, p.y);
      const cal = ctx.calib();
      if (cal) {
        if (cal.a && !cal.b && at) showMarks(f, cal.a, at.uv);
        return;
      }
      if (pressed && drag && at) ctx.change({ x: round(at.uv[0] - drag.dx), y: round(at.uv[1] - drag.dy) });
    },
    down: (p) => {
      if (ctx.busy()) return true;
      const c = ctx.canvas();
      if (c) {
        const f = frameOf(c);
        const at = onCanvas(eng, f, c, p.x, p.y);
        const cal = ctx.calib();
        if (cal) {
          if (!at) return true;
          const next = !cal.a || cal.b ? { a: at.uv } : { a: cal.a, b: at.uv };
          ctx.setCalib(next);
          showMarks(f, next.a, next.b);
          return true;
        }
        if (!at?.on) return false;
        if (!c.locked) drag = { dx: at.uv[0] - c.x, dy: at.uv[1] - c.y };
        return true;
      }
      const t = planeAt(eng, ctx, p.x, p.y);
      if (!t) return false;
      eng.showHover(null);
      eng.hoverPlane(null);
      // Its middle where you clicked.
      const f = canvasFrame(t.plane, ctx.construct());
      const hit = eng.rayPlane(p.x, p.y, f.origin, f.normal);
      const [x, y] = hit ? inFace(f, hit).map(round) : [0, 0];
      void pickPicture(ctx).then((r) => {
        if (!r) return;
        ctx.add({ id: newId("cv"), plane: t.plane, image: r.image, x, y, angle: 0, opacity: 0.5, ...firstCanvasSize(r.image) }, r.data);
        ctx.say(`Put ${r.image.file} on ${t.name}`);
      });
      return true;
    },
    up: () => {
      drag = null;
    },
    cancel: () => {
      drag = null;
    },
    leave: () => {
      eng.showHover(null);
      eng.hoverPlane(null);
    },
  });
  const cal = ctx.calib();
  const c = ctx.canvas();
  if (cal && c) showMarks(frameOf(c), cal.a, cal.b);
  return () => {
    eng.setInput(null);
    eng.showHover(null);
    eng.hoverPlane(null);
    if (noCanvas) eng.showPlanes(false);
    marks.dispose();
  };
}
