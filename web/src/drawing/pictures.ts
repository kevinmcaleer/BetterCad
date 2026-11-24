/**
 * Shaded and rendered drawing views (Kev, 2026-11-24): a picture of the bodies a view shows, seen square on from its
 * direction through an orthographic camera that frames exactly the view's box, so it lies under the view's lines on
 * the sheet and in every export but DXF. Shaded is drawn by WebGL in a moment; rendered by the path tracer, which
 * takes a few seconds, so a view shows the shaded picture until the rendered one is ready.
 *
 * Every picture is a JPEG on white: PDF embeds JPEGs as they are, and the sheet lays it over the paper with multiply,
 * so the white takes the paper's colour in every theme. This module and three.js's renderers load only when a sheet
 * has a shaded or rendered view.
 */
import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
  BufferAttribute,
  BufferGeometry,
} from "three";
import { DEFAULT_COLOUR } from "@bettercad/kernel";
import { linkTransforms, poseNesting, resolvePose, type Build, type Pose } from "@bettercad/kernel/document";
import type { DrawingSheet, DrawingView } from "@bettercad/kernel/drawing";
import { frameOf, styleOf, viewScale } from "./DrawingView";
import { viewAxes, type ModelView } from "@bettercad/kernel/view";
import type { RenderBody } from "../render/pathRender";
import type { ViewPicture } from "./export/scene";

/** What a picture is made from: the kernel's meshes, each body's look, and the joints that pose them. */
export interface PictureModel {
  meshes: ReadonlyMap<string, { mesh: RenderBody["mesh"] }>;
  parts: readonly Pick<RenderBody, "id" | "colour" | "finish" | "catalogue">[];
  built: Pick<Build, "joints" | "drives" | "links" | "components" | "rigid">;
  pose?: Pose;
}

export type PictureStyle = "shaded" | "rendered";

/** Pixels per paper millimetre: about 200 dpi shaded, 125 dpi rendered (the path tracer's cost grows with each pixel). */
const DENSITY: Record<PictureStyle, number> = { shaded: 8, rendered: 5 };
/** The longest side, in pixels, whatever the view's size on paper. */
const MOST: Record<PictureStyle, number> = { shaded: 2400, rendered: 1400 };
export const RENDER_SAMPLES = 32;
/** Past this the path tracer gives up, and the view keeps its shaded picture. */
const GIVE_UP_MS = 30_000;

/** The bodies a view drew, placed where the model's pose puts them. */
export function posedBodies(ids: readonly string[], m: PictureModel): RenderBody[] {
  const moves = m.pose ? linkTransforms(m.built.joints, resolvePose(m.built.drives, m.pose), poseNesting(m.built)) : new Map<string, number[]>();
  const linkOf = new Map<string, string>();
  for (const l of m.built.links) for (const id of l.parts) linkOf.set(id, l.id);
  const looks = new Map(m.parts.map((p) => [p.id, p]));
  return ids.flatMap((id) => {
    const b = m.meshes.get(id);
    if (!b) return [];
    const move = moves.get(linkOf.get(id) ?? "");
    const p = looks.get(id);
    return [{ id, mesh: b.mesh, matrix: move ? new Matrix4().fromArray(move) : new Matrix4(), colour: p?.colour, finish: p?.finish, catalogue: p?.catalogue }];
  });
}

/** Where the camera stands and what it frames, in the model's own millimetres (Z up). */
interface Framing {
  eye: [number, number, number];
  look: [number, number, number];
  up: [number, number, number];
  half: [number, number];
  far: number;
}

function framing(bodies: RenderBody[], view: ModelView, dv: DrawingView): Framing | null {
  const box = new Box3();
  const v = new Vector3();
  for (const b of bodies) {
    const p = b.mesh.positions;
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(v.set(p[i]!, p[i + 1]!, p[i + 2]!).applyMatrix4(b.matrix));
  }
  if (box.isEmpty()) return null;
  const sphere = box.getBoundingSphere(new Sphere());
  const { x, y, z } = viewAxes(frameOf(dv.direction));
  const { min, max } = view.box;
  const mid = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  // In front of everything along the line of sight, centred on the view's box across it.
  const depth = sphere.center.x * z[0] + sphere.center.y * z[1] + sphere.center.z * z[2] + sphere.radius + 10;
  const at = (d: number) => [0, 1, 2].map((i) => x[i]! * mid[0]! + y[i]! * mid[1]! + z[i]! * d) as [number, number, number];
  return {
    eye: at(depth),
    look: at(depth - 1),
    up: y,
    half: [Math.max(1e-3, (max[0] - min[0]) / 2), Math.max(1e-3, (max[1] - min[1]) / 2)],
    far: sphere.radius * 2 + 20,
  };
}

/** The picture's size in pixels for a view drawn `w` × `h` mm on paper. */
export function pictureSize(w: number, h: number, style: PictureStyle): { w: number; h: number } {
  const k = Math.min(DENSITY[style], MOST[style] / Math.max(w, h, 1e-6));
  return { w: Math.max(2, Math.round(w * k)), h: Math.max(2, Math.round(h * k)) };
}

const WHITE = new Color(1, 1, 1);

/** Shaded: each body in its colour, lit from above the viewer's left shoulder, on white. */
function shade(bodies: RenderBody[], f: Framing, px: { w: number; h: number }): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = px.w;
  canvas.height = px.h;
  let r: WebGLRenderer;
  try {
    r = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  const scene = new Scene();
  const made: { dispose(): void }[] = [];
  try {
    r.setPixelRatio(1);
    r.setSize(px.w, px.h, false);
    r.setClearColor(WHITE, 1);
    const cam = new OrthographicCamera(-f.half[0], f.half[0], f.half[1], -f.half[1], 0.1, f.far);
    cam.position.set(...f.eye);
    cam.up.set(...f.up);
    cam.lookAt(...f.look);
    cam.updateMatrixWorld();
    // Lit as the modelling view is: a headlight above the viewer's left shoulder, a soft sky and a light from overhead.
    const sky = new HemisphereLight(WHITE, new Color(0.5, 0.5, 0.52), 0.75);
    sky.position.set(0, 0, 1);
    const top = new DirectionalLight(WHITE, 0.55);
    top.position.set(0.3, -0.2, 1);
    const key = new DirectionalLight(WHITE, 1.25);
    const [ex, ey, ez] = f.eye;
    const [lx, ly, lz] = f.look;
    const back = new Vector3(ex - lx, ey - ly, ez - lz).normalize();
    const up = new Vector3(...f.up);
    const right = new Vector3().crossVectors(up, back);
    key.position.copy(back.add(up.multiplyScalar(0.8)).add(right.multiplyScalar(-0.6)));
    scene.add(sky, top, key);
    for (const b of bodies) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(b.mesh.positions, 3));
      g.setAttribute("normal", new BufferAttribute(b.mesh.normals, 3));
      g.setIndex(new BufferAttribute(b.mesh.indices, 1));
      const m = new MeshStandardMaterial({ color: new Color(b.colour ?? DEFAULT_COLOUR), roughness: 0.7, metalness: 0 });
      made.push(g, m);
      const mesh = new Mesh(g, m);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(b.matrix);
      scene.add(mesh);
    }
    scene.updateMatrixWorld(true);
    r.render(scene, cam);
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch {
    return null;
  } finally {
    for (const x of made) x.dispose();
    r.dispose();
    r.forceContextLoss();
  }
}

/** Rendered: the path tracer in Studio light with each body's finish, on white. Null when the browser can't. */
async function trace(bodies: RenderBody[], f: Framing, px: { w: number; h: number }, wanted: () => boolean): Promise<string | null> {
  if (!wanted()) return null;
  const { PathRender } = await import("../render/pathRender");
  const canvas = document.createElement("canvas");
  let pr: InstanceType<typeof PathRender>;
  try {
    pr = new PathRender(canvas, { alpha: true });
  } catch {
    return null;
  }
  // Software WebGL (no graphics card) would take minutes and hold the page up meanwhile: the view stays shaded.
  if (softwareGl(pr.renderer.getContext())) {
    pr.dispose();
    pr.renderer.forceContextLoss();
    return null;
  }
  const until = performance.now() + GIVE_UP_MS;
  try {
    pr.maxSamples = RENDER_SAMPLES;
    pr.setBodies(bodies);
    pr.setPreset("studio");
    pr.setStyle("finishes");
    pr.square(f);
    const png = await pr.snapshot(px.w, px.h, RENDER_SAMPLES, () => {
      if (performance.now() > until) throw new Error("Too slow");
      if (!wanted()) throw new Error("Not wanted now");
    });
    const img = await createImageBitmap(png);
    const c = document.createElement("canvas");
    c.width = px.w;
    c.height = px.h;
    const ctx = c.getContext("2d")!;
    // Clear behind the model: laid on white, as the shaded picture is.
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, px.w, px.h);
    ctx.drawImage(img, 0, 0, px.w, px.h);
    img.close();
    return c.toDataURL("image/jpeg", 0.9);
  } catch {
    return null;
  } finally {
    pr.dispose();
    pr.renderer.forceContextLoss();
  }
}

/** True when WebGL is drawn by the processor (SwiftShader, llvmpipe), not a graphics card. */
function softwareGl(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|software/i.test(name);
}

// One picture at a time: each takes a WebGL context of its own, and browsers allow only a handful.
let queue: Promise<unknown> = Promise.resolve();
const inTurn = <T>(job: () => Promise<T>): Promise<T> => {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
};

// Each mesh gets a number, so a picture's key can say which meshes it was made of cheaply.
const ids = new WeakMap<object, number>();
let count = 0;
const stamp = (o: object) => ids.get(o) ?? (ids.set(o, ++count), count);

const KEPT = 24;
const made = new Map<string, Promise<ViewPicture | null>>();

/**
 * A view's picture in a style, made once for each set of meshes, pose, direction and size, and kept for the next
 * draw and for export. Null when there is nothing to draw or the browser has no WebGL. A render stops, with null, as
 * soon as `wanted` says it no longer is (the style changed, or the sheet closed).
 */
export function viewPicture(
  model: PictureModel,
  view: ModelView,
  dv: DrawingView,
  scale: number,
  style: PictureStyle,
  wanted: () => boolean = () => true,
): Promise<ViewPicture | null> {
  const bodies = posedBodies(view.bodies, model);
  const { min, max } = view.box;
  const px = pictureSize((max[0] - min[0]) * scale, (max[1] - min[1]) * scale, style);
  const key = JSON.stringify([
    style,
    px,
    view.box,
    frameOf(dv.direction),
    bodies.map((b) => [stamp(b.mesh), b.matrix.elements, b.colour ?? "", b.finish ?? ""]),
  ]);
  const had = made.get(key);
  if (had) {
    made.delete(key);
    made.set(key, had);
    return had;
  }
  const f = framing(bodies, view, dv);
  const job: Promise<ViewPicture | null> = f
    ? inTurn(async () => {
        const data = style === "shaded" ? shade(bodies, f, px) : await trace(bodies, f, px, wanted);
        return data ? { data, px } : null;
      })
    : Promise.resolve(null);
  made.set(key, job);
  // A failure is not kept, so it is tried again next time.
  void job.then((p) => !p && made.get(key) === job && made.delete(key));
  while (made.size > KEPT) made.delete(made.keys().next().value!);
  return job;
}

/** The picture style a view needs, if any: breaks leave a view as lines, because the picture can't be broken. */
export function pictureStyle(v: DrawingView): PictureStyle | undefined {
  const s = styleOf(v);
  return (s === "shaded" || s === "rendered") && !v.breaks?.length ? s : undefined;
}

/** Every shaded and rendered view's picture on a sheet, for export: a rendered view that fails falls back to shaded. */
export async function sheetPictures(
  sheet: DrawingSheet,
  viewOf: (id: string) => ModelView | undefined,
  model: PictureModel,
): Promise<(id: string) => ViewPicture | undefined> {
  const out = new Map<string, ViewPicture>();
  await Promise.all(
    sheet.views.map(async (v) => {
      const style = pictureStyle(v);
      const view = viewOf(v.id);
      if (!style || !view) return;
      const s = viewScale(sheet, v);
      const pic = (await viewPicture(model, view, v, s, style)) ?? (style === "rendered" ? await viewPicture(model, view, v, s, "shaded") : null);
      if (pic) out.set(v.id, pic);
    }),
  );
  return (id) => out.get(id);
}
