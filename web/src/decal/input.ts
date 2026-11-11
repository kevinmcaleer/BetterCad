import type { BodyMesh } from "@bettercad/kernel";
import { newId, type DecalFeature, type DecalParams, type DecalImage } from "../state/document";
import type { Engine } from "../viewport/engine";
import { faceFrame, inFace } from "./place";
import { firstSize, readPicture } from "./picture";

/**
 * The Decal tool's pointer work and picture reading (#263). It loads when the tool is first armed, so the editor's
 * first paint carries only the thin hook in useDecal.
 */
export interface DecalInputCtx {
  feature(): DecalFeature | null;
  busy(): boolean;
  setBusy(b: boolean): void;
  meshes(): Map<string, { mesh: BodyMesh; names?: { faces: string[] } }> | undefined;
  change(c: Partial<DecalParams>, data?: string): void;
  /** Adds a new Decal step and opens it. */
  add(params: DecalParams, data: string, id: string): void;
  say(text: string, error?: boolean): void;
}

/** A spot on a face, mm from its middle, held to 0.5 mm and pulled onto the middle lines when close. */
const snap = (v: number) => (Math.abs(v) < 1.5 ? 0 : Math.round(v * 2) / 2);

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
async function pickPicture(ctx: DecalInputCtx): Promise<{ image: DecalImage; data: string } | null> {
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

/** Swaps the picture, keeping the decal's width and the new picture's shape. */
export async function changePicture(ctx: DecalInputCtx) {
  const f = ctx.feature();
  if (!f) return;
  const r = await pickPicture(ctx);
  if (!r) return;
  const height = Math.round(((f.width * r.image.height) / Math.max(1, r.image.width)) * 10) / 10;
  ctx.change({ image: r.image, height }, r.data);
}

/** The face under the pointer, if it's flat: the body, the face (by number and name), its frame and the spot hit. */
function faceAt(ctx: DecalInputCtx, eng: Engine, x: number, y: number) {
  const hit = eng.pick(x, y, "face");
  if (!hit) return null;
  const built = ctx.meshes()?.get(hit.body);
  const frame = built && faceFrame(built.mesh, hit.index);
  if (!frame) return { flat: false as const };
  const w = eng.rayPlane(x, y, frame.origin, frame.normal);
  if (!w) return null;
  const [u, v] = inFace(frame, w);
  return { flat: true as const, part: hit.body, face: hit.index, faceName: built.names?.faces[hit.index], frame, u, v };
}

/** Wires the pointer to the tool; returns the undo. */
export function attachDecalInput(eng: Engine, ctx: DecalInputCtx): () => void {
  /** A drag moving the decal about its face: how far from its centre it was grabbed. */
  let drag: { dx: number; dy: number } | null = null;
  eng.setInput({
    move: (p, _m, pressed) => {
      const f = ctx.feature();
      if (pressed && drag && f) {
        const at = faceAt(ctx, eng, p.x, p.y);
        if (at?.flat && at.part === f.part) ctx.change({ x: snap(at.u - drag.dx), y: snap(at.v - drag.dy) });
        return;
      }
      if (!pressed) eng.showHover(eng.pick(p.x, p.y, "face"));
    },
    down: (p) => {
      if (ctx.busy()) return true;
      const at = faceAt(ctx, eng, p.x, p.y);
      if (!at) return false;
      if (!at.flat) {
        ctx.say("Decals go on flat faces", true);
        return true;
      }
      const f = ctx.feature();
      if (f) {
        const place = { part: at.part, face: at.face, faceName: at.faceName };
        // On its own face, grab it where it is; elsewhere, it jumps to the click.
        if (f.part === at.part && f.face === at.face) drag = { dx: at.u - f.x, dy: at.v - f.y };
        else {
          drag = { dx: 0, dy: 0 };
          ctx.change({ ...place, x: snap(at.u), y: snap(at.v) });
        }
        return true;
      }
      void pickPicture(ctx).then((r) => {
        if (!r) return;
        const params: DecalParams = {
          part: at.part,
          face: at.face,
          ...(at.faceName ? { faceName: at.faceName } : {}),
          image: r.image,
          x: snap(at.u),
          y: snap(at.v),
          angle: 0,
          ...firstSize(r.image, at.frame.size),
        };
        ctx.add(params, r.data, newId("f"));
      });
      eng.showHover(null);
      return true;
    },
    up: () => {
      drag = null;
    },
    cancel: () => {
      drag = null;
    },
    leave: () => eng.showHover(null),
  });
  return () => {
    eng.setInput(null);
    eng.showHover(null);
  };
}
