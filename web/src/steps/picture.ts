/**
 * The build steps' pictures: an offscreen three.js view of the bodies after each step, from one fixed camera so the
 * pictures read as a sequence. What a step made or changed has its edges in the accent colour; a sketch step draws
 * its curves in the accent colour over the model. Always the Light theme's colours, on the view's background.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  Vector3,
  type Object3D,
} from "three";
import type { BodyMesh } from "@bettercad/kernel";
import { toWorld, type Frame, type Sketch } from "@bettercad/sketch";
import { sketchCurves } from "./curves";
import { cameraBasis, DEFAULT_CAMERA, fit, FOV, type V3 } from "../viewport/camera";
import { readPalette, type Palette } from "../viewport/colours";

export interface PictureBody {
  id: string;
  mesh: BodyMesh;
  colour?: string;
  /** A hole shape: drawn see-through. */
  hole?: boolean;
  /** Made or changed by this step. */
  changed?: boolean;
}

export interface PictureSketch {
  sketch: Sketch;
  frame: Frame;
}

/** A sketch's own curves (not construction), as world-space polylines. */
export function sketchLines({ sketch, frame }: PictureSketch): V3[][] {
  return sketchCurves(sketch)
    .filter((c) => !c.construction)
    .map((c) => {
      const pts = c.points.map((q) => toWorld(frame, q) as V3);
      return c.closed && pts.length ? [...pts, pts[0]!] : pts;
    });
}

/** The Light theme's view colours, whatever theme is on. */
export function lightPalette(): Palette {
  const probe = document.body.appendChild(document.createElement("i"));
  probe.dataset.theme = "light";
  try {
    return readPalette(probe);
  } finally {
    probe.remove();
  }
}

/** Bounds of points, for framing every step from one camera. */
export class Bounds {
  min: V3 = [Infinity, Infinity, Infinity];
  max: V3 = [-Infinity, -Infinity, -Infinity];
  add(p: ArrayLike<number>): void {
    for (let i = 0; i + 2 < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const v = p[i + k]!;
        if (v < this.min[k]!) this.min[k] = v;
        if (v > this.max[k]!) this.max[k] = v;
      }
  }
  get empty(): boolean {
    return !(this.min[0] <= this.max[0]);
  }
  get centre(): V3 {
    return [(this.min[0] + this.max[0]) / 2, (this.min[1] + this.max[1]) / 2, (this.min[2] + this.max[2]) / 2];
  }
  get radius(): number {
    return Math.hypot(this.max[0] - this.min[0], this.max[1] - this.min[1], this.max[2] - this.min[2]) / 2;
  }
}

/** One WebGL context for all of a model's pictures; dispose it when done. */
export const toPng = (c: HTMLCanvasElement) => new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("No picture"))), "image/png"));

export class StepPictures {
  readonly canvas = document.createElement("canvas");
  private renderer: WebGLRenderer;
  private palette = lightPalette();
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 100_000);
  private scene = new Scene();
  private lights: Object3D[];

  constructor(
    readonly width = 1200,
    readonly height = 900,
  ) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(this.palette.viewport, 1);
    this.camera.aspect = width / height;
    const hemi = new HemisphereLight(new Color(1, 1, 1), this.palette.stage, 0.75);
    hemi.position.set(0, 0, 1);
    const head = new DirectionalLight(new Color(1, 1, 1), 1.25);
    const top = new DirectionalLight(new Color(1, 1, 1), 0.55);
    top.position.set(0.3, -0.2, 1);
    this.lights = [hemi, head, top];
  }

  /** Frames everything in `b` from the default corner view. */
  frame(b: Bounds): void {
    const r = Math.max(b.radius, 5);
    const cam = fit(DEFAULT_CAMERA, b.empty ? [0, 0, 0] : b.centre, r, this.width / this.height);
    const { position, up, right } = cameraBasis(cam);
    this.camera.position.set(...position);
    this.camera.up.set(...up);
    this.camera.lookAt(...cam.target);
    this.camera.near = Math.max(0.1, cam.distance / 1000);
    this.camera.far = cam.distance * 100 + 10_000;
    this.camera.updateProjectionMatrix();
    // The key light sits up and left of the camera, as the view's headlight does.
    const head = this.lights[1] as DirectionalLight;
    head.position.set(...([0, 1, 2].map((k) => position[k]! + up[k]! * r - right[k]! * r * 0.6) as V3));
    head.target.position.set(...cam.target);
    head.target.updateMatrixWorld();
  }

  /** A PNG of the bodies, and the sketch if the step drew one. */
  async draw(bodies: PictureBody[], sketch?: PictureSketch): Promise<Blob> {
    const p = this.palette;
    const scene = this.scene;
    scene.clear();
    scene.add(...this.lights);
    const made: { dispose(): void }[] = [];
    const anyChanged = bodies.some((b) => b.changed);
    for (const b of bodies) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(b.mesh.positions, 3));
      g.setAttribute("normal", new BufferAttribute(b.mesh.normals, 3));
      g.setIndex(new BufferAttribute(b.mesh.indices, 1));
      const colour = b.colour ? new Color().setStyle(b.colour) : p["part-fill"].clone();
      // What this step made or changed is tinted toward the accent, so you can see where to look.
      if (b.changed && anyChanged && !sketch) colour.lerp(p.accent, 0.35);
      const m = new MeshStandardMaterial({
        color: colour,
        roughness: 0.9,
        metalness: 0,
        transparent: !!b.hole || (!!sketch && !b.changed),
        opacity: b.hole ? 0.35 : sketch ? 0.6 : 1,
        depthWrite: !b.hole,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const eg = new BufferGeometry();
      eg.setAttribute("position", new BufferAttribute(b.mesh.edgePositions, 3));
      const em = new LineBasicMaterial({ color: b.changed && anyChanged && !sketch ? p.accent : p["part-line"] });
      scene.add(new Mesh(g, m), new LineSegments(eg, em));
      made.push(g, m, eg, em);
    }
    try {
      this.renderer.render(scene, this.camera);
      if (!sketch) return await toPng(this.canvas);
      // The sketch goes on top in 2D, so its lines can be thicker than WebGL draws lines.
      const out = document.createElement("canvas");
      out.width = this.width;
      out.height = this.height;
      const ctx = out.getContext("2d");
      if (!ctx) return await toPng(this.canvas);
      ctx.drawImage(this.canvas, 0, 0);
      ctx.strokeStyle = `#${p.accent.getHexString()}`;
      ctx.lineWidth = Math.max(2, this.width / 400);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const v = new Vector3();
      for (const line of sketchLines(sketch)) {
        ctx.beginPath();
        line.forEach((q, i) => {
          v.set(...q).project(this.camera);
          const x = ((v.x + 1) / 2) * this.width;
          const y = ((1 - v.y) / 2) * this.height;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
      }
      return await toPng(out);
    } finally {
      for (const x of made) x.dispose();
    }
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
